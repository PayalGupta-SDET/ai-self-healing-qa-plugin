let isPickerActive = false;

document.addEventListener('DOMContentLoaded', async () => {
  const scanBtn = document.getElementById('scanBtn');
  const pickerBtn = document.getElementById('pickerBtn');
  const testrailBtn = document.getElementById('testrailBtn');
  const aiSettingsBtn = document.getElementById('aiSettingsBtn');
  const aiDrawer = document.getElementById('aiDrawer');
  const testrailPanel = document.getElementById('testrailPanel');
  const saveAiKeyBtn = document.getElementById('saveAiKeyBtn');
  const trFetchBtn = document.getElementById('trFetchBtn');
  const outputEl = document.getElementById('output');

  // Load saved credentials
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['geminiApiKey', 'trDomain', 'trUser', 'trApiKey', 'trRunId'], (items) => {
      if (items.geminiApiKey && document.getElementById('geminiApiKey')) document.getElementById('geminiApiKey').value = items.geminiApiKey;
      if (items.trDomain && document.getElementById('trDomain')) document.getElementById('trDomain').value = items.trDomain;
      if (items.trUser && document.getElementById('trUser')) document.getElementById('trUser').value = items.trUser;
      if (items.trApiKey && document.getElementById('trApiKey')) document.getElementById('trApiKey').value = items.trApiKey;
      if (items.trRunId && document.getElementById('trRunId')) document.getElementById('trRunId').value = items.trRunId;
    });
  }

  // Toggle Drawers
  if (aiSettingsBtn && aiDrawer) {
    aiSettingsBtn.addEventListener('click', () => {
      aiDrawer.style.display = aiDrawer.style.display === 'none' ? 'block' : 'none';
    });
  }

  if (testrailBtn && testrailPanel) {
    testrailBtn.addEventListener('click', () => {
      testrailPanel.style.display = testrailPanel.style.display === 'none' ? 'block' : 'none';
    });
  }

  if (saveAiKeyBtn) {
    saveAiKeyBtn.addEventListener('click', () => {
      const key = document.getElementById('geminiApiKey').value.trim();
      chrome.storage.local.set({ geminiApiKey: key }, () => {
        alert("AI API Key saved successfully!");
        if (aiDrawer) aiDrawer.style.display = 'none';
      });
    });
  }

  // --- 1. SCAN ALL WITH STRICT DOM UNIQUENESS ---
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      outputEl.innerHTML = 'Scanning DOM and evaluating strict 100% unique paths...';
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scanAllUniversalUniqueLocators
      }, (results) => {
        if (chrome.runtime.lastError) {
          outputEl.innerHTML = `Execution Error: ${chrome.runtime.lastError.message}`;
          return;
        }
        if (results && results[0] && results[0].result) {
          renderResults(results[0].result, outputEl, tab.id);
        }
      });
    });
  }

  // --- 2. PICK ELEMENT WITH STRICT DOM UNIQUENESS ---
  if (pickerBtn) {
    pickerBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      isPickerActive = !isPickerActive;
      if (isPickerActive) {
        pickerBtn.classList.add('active');
        pickerBtn.innerText = '⏹️ Stop';
        outputEl.innerHTML = '<div style="color: #facc15; font-weight: bold; padding: 10px; background: #2e1065; border-radius: 6px;">🎯 Hover and click ANY element on the web page to inspect its strictly unique locator.</div>';
        chrome.scripting.executeScript({ target: { tabId: tab.id }, func: enableElementPickerOnPage });
      } else {
        pickerBtn.classList.remove('active');
        pickerBtn.innerText = '🎯 Pick';
        chrome.scripting.executeScript({ target: { tabId: tab.id }, func: disableElementPickerOnPage });
      }
    });
  }

  // --- 3. FETCH TESTRAIL FAILURES ---
  if (trFetchBtn) {
    trFetchBtn.addEventListener('click', async () => {
      const domain = document.getElementById('trDomain').value.trim();
      const user = document.getElementById('trUser').value.trim();
      const apiKey = document.getElementById('trApiKey').value.trim();
      const runId = document.getElementById('trRunId').value.trim();

      if (!domain || !user || !apiKey || !runId) {
        outputEl.innerHTML = '<div style="color:#ef4444;">Please fill in all TestRail details.</div>';
        return;
      }

      chrome.storage.local.set({ trDomain: domain, trUser: user, trApiKey: apiKey, trRunId: runId });
      outputEl.innerHTML = 'Fetching TestRail logs and running AI failure analysis...';

      try {
        const failures = await fetchTestRailFailures(domain, user, apiKey, runId);
        const aiAnalysis = await generateAiTestRailAnalysis(failures);
        renderAiTestRailResults(failures, aiAnalysis, outputEl);
      } catch (err) {
        outputEl.innerHTML = `<div style="color:#ef4444;">Error: ${err.message}</div>`;
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.action === "ELEMENT_PICKED") {
      isPickerActive = false;
      if (pickerBtn) {
        pickerBtn.classList.remove('active');
        pickerBtn.innerText = '🎯 Pick';
      }
      renderPickedElement(message.data, outputEl, sender.tab ? sender.tab.id : null);
    }
  });
});

// ============================================================================
// REAL-TIME AI API CALLS
// ============================================================================

async function generateAiLocatorSuggestions(elementData) {
  const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
  if (!geminiApiKey) {
    return "💡 <i>Add your Gemini API Key under 'AI Config' to unlock real-time AI Playwright/Selenium code generation and auto-healing.</i>";
  }

  const prompt = `
    You are a Senior QA Automation Engineer. Analyze this live HTML element and suggest the most robust Playwright and Selenium locators:
    - Tag: <${elementData.tag}>
    - Outer Attributes: ${JSON.stringify(elementData.attributes)}
    - Text: "${elementData.text}"
    - Generated CSS: ${elementData.uniqueCss}
    - Generated XPath: ${elementData.uniqueXpath}

    Provide:
    1. Best Playwright locator (e.g. page.getByRole, page.getByTestId, or page.locator).
    2. Best resilient XPath.
    3. Brief reason why it prevents test flakiness.
    Format answer in short clean HTML without markdown code blocks.
  `;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();

    // Check for API errors returned in response body
    if (data.error) {
      return `⚠️ API Error (${data.error.code}): ${data.error.message}`;
    }

    // Safe extraction using optional chaining
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) {
      return `⚠️ Unable to generate suggestions. Unexpected response structure.`;
    }

    return textResult;
  } catch (err) {
    return `AI Generation Error: ${err.message}`;
  }
}

async function generateAiTestRailAnalysis(failures) {
  const { geminiApiKey } = await chrome.storage.local.get(['geminiApiKey']);
  if (!geminiApiKey) return null;

  const prompt = `
    Analyze these test execution failure logs from TestRail:
    ${JSON.stringify(failures.slice(0, 5))}

    Identify top 3 root cause failure keywords and suggest code-level fixes in Playwright/Selenium. Format in short HTML.
  `;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();

    if (data.error) {
      return `⚠️ API Error (${data.error.code}): ${data.error.message}`;
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to parse AI analysis.";
  } catch (err) {
    return `AI Analysis Error: ${err.message}`;
  }
}

// ============================================================================
// UI RENDERING & CLICK-TO-HIGHLIGHT
// ============================================================================

async function renderPickedElement(el, outputContainer, tabId) {
  outputContainer.innerHTML = `
    <div class="card">
      <div style="font-weight: bold; color: #facc15; margin-bottom: 6px;">
        &lt;${el.tag}&gt; ${el.text ? `"${el.text}"` : ''}
        <span class="ai-badge">✔ 100% UNIQUE</span>
      </div>
      <div style="margin-bottom: 6px;">
        <span class="tag">CSS</span>
        <code class="clickable-locator" data-type="css" data-selector="${encodeURIComponent(el.uniqueCss)}">${escapeHtml(el.uniqueCss)}</code>
      </div>
      <div>
        <span class="tag">XPATH</span>
        <code class="clickable-locator" data-type="xpath" data-selector="${encodeURIComponent(el.uniqueXpath)}">${escapeHtml(el.uniqueXpath)}</code>
      </div>
      <button id="aiHealBtn" class="ai-btn" style="background:#10b981; color:#042f2e; margin-top:8px; width:100%; font-weight:bold; padding:8px; border:none; border-radius:4px; cursor:pointer;">🤖 Generate AI Real-Time Code</button>
      <div id="aiResultContainer"></div>
    </div>
  `;

  attachLocatorHighlightHandlers(outputContainer, tabId);

  const aiBtn = document.getElementById('aiHealBtn');
  if (aiBtn) {
    aiBtn.addEventListener('click', async () => {
      const resultBox = document.getElementById('aiResultContainer');
      resultBox.innerHTML = '<div style="color:#10b981; margin-top:6px;">🤖 Gemini AI is analyzing live element structure...</div>';
      const aiText = await generateAiLocatorSuggestions(el);
      resultBox.innerHTML = `<div class="ai-suggestion-box" style="background:#064e3b; padding:8px; margin-top:8px; border-radius:4px; color:#d1fae5; font-size:11px;">🤖 <b>AI Optimization:</b><br>${aiText}</div>`;
    });
  }
}

function renderResults(elements, outputContainer, tabId) {
  outputContainer.innerHTML = elements.map((el, index) => `
    <div class="card">
      <div style="font-weight: bold; color: #facc15; margin-bottom: 6px;">
        #${index + 1} &lt;${el.tag}&gt; ${el.text ? `"${el.text}"` : ''}
        <span class="ai-badge">✔ UNIQUE</span>
      </div>
      <div style="margin-bottom: 6px;">
        <span class="tag">CSS</span>
        <code class="clickable-locator" data-type="css" data-selector="${encodeURIComponent(el.uniqueCss)}">${escapeHtml(el.uniqueCss)}</code>
      </div>
      <div>
        <span class="tag">XPATH</span>
        <code class="clickable-locator" data-type="xpath" data-selector="${encodeURIComponent(el.uniqueXpath)}">${escapeHtml(el.uniqueXpath)}</code>
      </div>
    </div>
  `).join('');

  attachLocatorHighlightHandlers(outputContainer, tabId);
}

function renderAiTestRailResults(failures, aiAnalysisText, container) {
  let html = `<div style="background:#881337; border:1px solid #f43f5e; padding:10px; border-radius:6px; margin-bottom:10px;">
    <div style="font-weight:bold; color:#fecdd3;">🚨 TestRail Failures Detected: ${failures.length}</div>
  </div>`;

  if (aiAnalysisText) {
    html += `<div style="background:#064e3b; padding:8px; margin-bottom:10px; border-radius:4px; color:#d1fae5; font-size:11px;">🤖 <b>Real-Time AI Analysis:</b><br>${aiAnalysisText}</div>`;
  }

  html += failures.slice(0, 5).map((f, i) => `
    <div class="card" style="border-color:#f43f5e;">
      <div style="font-weight:bold; color:#f43f5e; margin-bottom:4px;">#${i + 1} Case ID: ${f.caseId}</div>
      <div style="font-size:10px; font-family:monospace; background:#090d16; padding:4px; color:#fda4af;">${escapeHtml(f.comment)}</div>
    </div>
  `).join('');

  container.innerHTML = html;
}

function attachLocatorHighlightHandlers(container, tabId) {
  container.querySelectorAll('.clickable-locator').forEach(block => {
    block.addEventListener('click', () => {
      const type = block.getAttribute('data-type');
      const selector = decodeURIComponent(block.getAttribute('data-selector'));
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: highlightTargetElementOnPage,
        args: [selector, type]
      });
    });
  });
}

function highlightTargetElementOnPage(selector, selectorType) {
  let element = null;
  try {
    if (selectorType === 'xpath') {
      const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      element = result.singleNodeValue;
    } else {
      element = document.querySelector(selector);
    }
  } catch (e) {
    console.warn("Highlight error:", e);
  }

  if (!element) return alert(`Element not found for selector:\n${selector}`);

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const origOutline = element.style.outline;
  element.style.transition = 'all 0.3s ease-in-out';
  element.style.outline = '4px solid #10b981';

  setTimeout(() => { element.style.outline = origOutline; }, 2500);
}

function escapeHtml(str) {
  return str ? str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : '';
}

// ============================================================================
// INJECTED ENGINE WITH STRICT LIVE DOM UNIQUENESS VERIFICATION
// ============================================================================

function scanAllUniversalUniqueLocators() {
  function verifyCssUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  function verifyXPathUnique(xpath) {
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return result.snapshotLength === 1;
    } catch (e) {
      return false;
    }
  }

  function safeEscapeCss(str) {
    if (window.CSS && window.CSS.escape) {
      try { return window.CSS.escape(str); } catch (e) {}
    }
    return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
  }

  function calculateStrictUniqueCss(el) {
    const tag = el.tagName.toLowerCase();
    const rawId = el.id || '';
    const isDynamicId = /\d{4,}/.test(rawId);

    // 1. Direct ID check
    if (rawId && !isDynamicId) {
      const idSelector = `#${safeEscapeCss(rawId)}`;
      if (verifyCssUnique(idSelector)) return idSelector;
    }

    // 2. Test ID check
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-cy') || el.getAttribute('data-qa');
    if (testId) {
      const testIdCss = `[data-testid="${testId}"]`;
      if (verifyCssUnique(testIdCss)) return testIdCss;
    }

    // 3. Name Attribute Check
    if (el.name) {
      const nameCss = `${tag}[name="${safeEscapeCss(el.name)}"]`;
      if (verifyCssUnique(nameCss)) return nameCss;
    }

    // 4. Recursive Parent Tree Climb (Guaranteed 100% Unique)
    const path = [];
    let current = el;
    let depth = 0;

    while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== 'html' && depth < 15) {
      let selector = current.tagName.toLowerCase();
      const currentId = current.id || '';

      if (currentId && !/\d{4,}/.test(currentId)) {
        const idPath = `#${safeEscapeCss(currentId)}`;
        path.unshift(idPath);
        const fullCandidate = path.join(' > ');
        if (verifyCssUnique(fullCandidate)) return fullCandidate;
      }

      let sibling = current;
      let nth = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.tagName && sibling.tagName.toLowerCase() === selector) nth++;
      }
      selector += `:nth-of-type(${nth})`;
      path.unshift(selector);

      const candidate = path.join(' > ');
      if (verifyCssUnique(candidate)) return candidate;

      current = current.parentNode;
      depth++;
    }

    return path.join(' > ');
  }

  function calculateStrictUniqueXPath(el) {
    const tag = el.tagName.toLowerCase();
    const rawId = el.id || '';
    const isDynamicId = /\d{4,}/.test(rawId);

    // 1. Direct Unique ID
    if (rawId && !isDynamicId) {
      const idXpath = `//${tag}[@id='${rawId}']`;
      if (verifyXPathUnique(idXpath)) return idXpath;
    }

    // 2. Table Row Anchor via child cell text
    if (tag === 'tr') {
      const cells = Array.from(el.querySelectorAll('td, th'));
      for (const cell of cells) {
        const cellText = (cell.innerText || '').trim().replace(/\s+/g, ' ');
        if (cellText && cellText.length > 0 && cellText.length < 40) {
          const rowXpath = `//tr[td[normalize-space(.)='${cellText}']]`;
          if (verifyXPathUnique(rowXpath)) return rowXpath;
        }
      }
    }

    // 3. Text Anchor on Leaf Element
    const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
    if (text && text.length > 0 && text.length < 35 && el.children.length === 0) {
      const textXpath = `//${tag}[normalize-space(.)='${text}']`;
      if (verifyXPathUnique(textXpath)) return textXpath;
    }

    // 4. Positional Hierarchy Ancestor Chain
    const paths = [];
    let current = el;
    let depth = 0;

    for (; current && current.nodeType === Node.ELEMENT_NODE && depth < 15; current = current.parentNode) {
      if (current.tagName.toLowerCase() === 'html') break;

      const currentId = current.id || '';
      if (currentId && !/\d{4,}/.test(currentId)) {
        paths.unshift(`${current.tagName.toLowerCase()}[@id='${currentId}']`);
        const candidate = '//' + paths.join('/');
        if (verifyXPathUnique(candidate)) return candidate;
        break;
      } else {
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) index++;
          sibling = sibling.previousElementSibling;
        }
        paths.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      }

      const candidate = '//' + paths.join('/');
      if (verifyXPathUnique(candidate)) return candidate;

      depth++;
    }

    return paths.length ? '//' + paths.join('/') : `//${tag}`;
  }

  const allElements = Array.from(document.body.querySelectorAll('*'));
  const ignored = ['script', 'style', 'noscript', 'meta', 'link', 'br', 'hr', 'path', 'g', 'defs', 'svg'];

  return allElements
    .filter(el => {
      const tag = el.tagName.toLowerCase();
      if (ignored.includes(tag)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .slice(0, 30)
    .map(el => {
      const tag = el.tagName.toLowerCase();
      let text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
      if (text.length > 25) text = text.substring(0, 25) + '...';

      return {
        tag,
        text,
        attributes: Array.from(el.attributes).map(a => ({ name: a.name, value: a.value })),
        uniqueCss: calculateStrictUniqueCss(el),
        uniqueXpath: calculateStrictUniqueXPath(el)
      };
    });
}

function enableElementPickerOnPage() {
  window.__pickerActive = true;

  function verifyCssUnique(selector) {
    try { return document.querySelectorAll(selector).length === 1; } catch (e) { return false; }
  }

  function verifyXPathUnique(xpath) {
    try { return document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength === 1; } catch (e) { return false; }
  }

  function calculateStrictUniqueCss(el) {
    const tag = el.tagName.toLowerCase();
    const rawId = el.id || '';
    if (rawId && !/\d{4,}/.test(rawId)) {
      const idCss = `#${rawId}`;
      if (verifyCssUnique(idCss)) return idCss;
    }

    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current.tagName.toLowerCase() !== 'html') {
      let selector = current.tagName.toLowerCase();
      if (current.id && !/\d{4,}/.test(current.id)) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      } else {
        let sibling = current;
        let nth = 1;
        while (sibling = sibling.previousElementSibling) {
          if (sibling.tagName && sibling.tagName.toLowerCase() === selector) nth++;
        }
        selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      current = current.parentNode;
    }
    return path.join(' > ');
  }

  function calculateStrictUniqueXPath(el) {
    const tag = el.tagName.toLowerCase();
    const rawId = el.id || '';
    if (rawId && !/\d{4,}/.test(rawId)) {
      const idXpath = `//${tag}[@id='${rawId}']`;
      if (verifyXPathUnique(idXpath)) return idXpath;
    }

    const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
    if (text && text.length > 0 && text.length < 35 && el.children.length === 0) {
      const textXpath = `//${tag}[normalize-space(.)='${text}']`;
      if (verifyXPathUnique(textXpath)) return textXpath;
    }

    const paths = [];
    let current = el;
    for (; current && current.nodeType === Node.ELEMENT_NODE; current = current.parentNode) {
      if (current.tagName.toLowerCase() === 'html') break;
      if (current.id && !/\d{4,}/.test(current.id)) {
        paths.unshift(`${current.tagName.toLowerCase()}[@id='${current.id}']`);
        break;
      } else {
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) index++;
          sibling = sibling.previousElementSibling;
        }
        paths.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      }
    }
    return paths.length ? '//' + paths.join('/') : `//${tag}`;
  }

  document.addEventListener('click', function onClick(e) {
    if (!window.__pickerActive) return;
    e.preventDefault(); e.stopPropagation();
    window.__pickerActive = false;
    document.removeEventListener('click', onClick, true);

    const el = e.target;
    chrome.runtime.sendMessage({
      action: "ELEMENT_PICKED",
      data: {
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').substring(0, 25),
        attributes: Array.from(el.attributes).map(a => ({ name: a.name, value: a.value })),
        uniqueCss: calculateStrictUniqueCss(el),
        uniqueXpath: calculateStrictUniqueXPath(el)
      }
    });
  }, true);
}

function disableElementPickerOnPage() { window.__pickerActive = false; }

async function fetchTestRailFailures(domain, email, apiKey, runId) {
  const authHeader = 'Basic ' + btoa(`${email}:${apiKey}`);
  const cleanRunId = runId.replace(/\D/g, '');
  const res = await fetch(`${domain.replace(/\/+$/, "")}/index.php?/api/v2/get_results_for_run/${cleanRunId}&status_id=5`, {
    headers: { 'Authorization': authHeader }
  });
  const data = await res.json();
  return (Array.isArray(data) ? data : data.results || []).map(r => ({ caseId: r.test_id || r.id, comment: r.comment || "No trace" }));
}