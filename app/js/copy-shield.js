// ═══════════════════════════════════════════════════════════════
// App — CLIENT COPY SHIELD v1.0
// Anti-copy, anti-paste, anti-inspect, anti-scraping protection
// Runs in browser — prevents code/content theft
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────
  const CONFIG = {
    disableCopyPaste: true, // Block Ctrl+C, Ctrl+V on AI responses
    disableRightClick: true, // Block right-click context menu
    disableDevTools: true, // Detect and warn about DevTools
    disableTextSelection: true, // Prevent selecting AI response text
    disableViewSource: true, // Block Ctrl+U, F12
    disableDragDrop: true, // Block drag-and-drop of content
    disablePrintScreen: true, // Attempt to block PrintScreen
    watermarkResponses: true, // Add invisible watermark to copied text
    maxCopyAttempts: 5, // Max copy attempts before warning
    copyAttemptWindow: 60000, // 1 minute window for attempt counting
  };

  // ── State ──────────────────────────────────────────────────
  let copyAttempts = 0;
  let lastCopyAttemptTime = 0;
  let devToolsOpen = false;

  // ═══════════════════════════════════════════════════════════
  // KEYBOARD PROTECTION
  // ═══════════════════════════════════════════════════════════

  document.addEventListener(
    'keydown',
    function (e) {
      // Block Ctrl+C (copy) on non-input elements
      if (CONFIG.disableCopyPaste && (e.ctrlKey || e.metaKey) && e.key === 'c') {
        const target = e.target;
        const tagName = target.tagName.toLowerCase();
        // Allow copy in input fields and textareas (user's own text)
        if (tagName === 'input' || tagName === 'textarea') return;

        // Check if selection is within AI response area
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          const range = selection.getRangeAt(0);
          let container = range.commonAncestorContainer;
          if (container.nodeType === 3) container = container.parentNode;

          // Block copy from AI response containers
          if (isProtectedElement(container)) {
            e.preventDefault();
            e.stopPropagation();
            recordCopyAttempt();
            showCopyWarning();
            return false;
          }
        }
      }

      // Block Ctrl+U (view source)
      if (CONFIG.disableViewSource && (e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        return false;
      }

      // Block F12 (DevTools)
      if (CONFIG.disableDevTools && e.key === 'F12') {
        e.preventDefault();
        return false;
      }

      // Block Ctrl+Shift+I (DevTools)
      if (CONFIG.disableDevTools && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        return false;
      }

      // Block Ctrl+Shift+J (Console)
      if (CONFIG.disableDevTools && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        return false;
      }

      // Block Ctrl+Shift+C (Element inspector)
      if (CONFIG.disableDevTools && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        return false;
      }

      // Block Ctrl+S (save page)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        return false;
      }

      // Block Ctrl+A (select all) on protected areas
      if (CONFIG.disableTextSelection && (e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (!isInputElement(e.target)) {
          e.preventDefault();
          return false;
        }
      }

      // Block PrintScreen
      if (CONFIG.disablePrintScreen && e.key === 'PrintScreen') {
        e.preventDefault();
        // Clear clipboard
        try {
          navigator.clipboard.writeText('').catch(function () {});
        } catch (_) {
          /* ignored */
        }
        return false;
      }
    },
    true
  );

  // ═══════════════════════════════════════════════════════════
  // RIGHT-CLICK PROTECTION
  // ═══════════════════════════════════════════════════════════

  if (CONFIG.disableRightClick) {
    document.addEventListener('contextmenu', function (e) {
      // Allow right-click on input fields
      if (isInputElement(e.target)) return;

      // Block on protected elements
      if (isProtectedElement(e.target)) {
        e.preventDefault();
        return false;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // TEXT SELECTION PROTECTION
  // ═══════════════════════════════════════════════════════════

  if (CONFIG.disableTextSelection) {
    // Add CSS to prevent selection on AI responses
    const style = document.createElement('style');
    style.textContent = [
      '.ai-response, .chat-message.assistant, .bot-message, [data-role="assistant"] {',
      '  -webkit-user-select: none !important;',
      '  -moz-user-select: none !important;',
      '  -ms-user-select: none !important;',
      '  user-select: none !important;',
      '}',
      // Allow selection in code blocks (users need to copy code)
      '.ai-response code, .ai-response pre, .chat-message.assistant code, .chat-message.assistant pre {',
      '  -webkit-user-select: text !important;',
      '  -moz-user-select: text !important;',
      '  user-select: text !important;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // DRAG & DROP PROTECTION
  // ═══════════════════════════════════════════════════════════

  if (CONFIG.disableDragDrop) {
    document.addEventListener('dragstart', function (e) {
      if (isProtectedElement(e.target)) {
        e.preventDefault();
        return false;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CLIPBOARD PROTECTION — Watermark copied text
  // ═══════════════════════════════════════════════════════════

  if (CONFIG.watermarkResponses) {
    document.addEventListener('copy', function (e) {
      const selection = window.getSelection();
      if (!selection || selection.toString().length === 0) return;

      const text = selection.toString();
      let container = selection.getRangeAt(0).commonAncestorContainer;
      if (container.nodeType === 3) container = container.parentNode;

      // If copying from protected area, add watermark
      if (isProtectedElement(container)) {
        e.preventDefault();

        // Add invisible watermark + visible attribution
        const _appCfg = window.APP_CONFIG || {};
        const _appName = _appCfg.appName || 'KelionAI';
        const _studioName = _appCfg.studioName || 'EA Studio';
        let watermarked = text + '\n\n© ' + _appName + ' by ' + _studioName + ' — Content generated by proprietary AI';

        // Add zero-width watermark
        const zwsp = '\u200B';
        const zwnj = '\u200C';
        const timestamp = Date.now().toString(36);
        let watermark = '';
        for (let i = 0; i < timestamp.length; i++) {
          watermark += timestamp.charCodeAt(i) % 2 === 0 ? zwsp : zwnj;
        }

        watermarked = watermark + watermarked;

        if (e.clipboardData) {
          e.clipboardData.setData('text/plain', watermarked);
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // DEVTOOLS DETECTION
  // ═══════════════════════════════════════════════════════════

  if (CONFIG.disableDevTools) {
    // Method 1: Size-based detection
    const checkDevTools = function () {
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 160;

      if (widthThreshold || heightThreshold) {
        if (!devToolsOpen) {
          devToolsOpen = true;
          onDevToolsOpen();
        }
      } else {
        devToolsOpen = false;
      }
    };

    setInterval(checkDevTools, 1000);

    // Method 2: debugger detection (more aggressive)
    // Only in production
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      (function detectDebugger() {
        const start = performance.now();
        // debugger statement causes pause if DevTools is open
        // We don't actually use debugger; to avoid annoying users
        // Instead we use the timing method above
        const end = performance.now();
        if (end - start > 100) {
          onDevToolsOpen();
        }
        setTimeout(detectDebugger, 5000);
      })();
    }
  }

  function onDevToolsOpen() {
    const _c = window.APP_CONFIG || {};
    const _n = _c.appName || 'KelionAI';
    const _s = _c.studioName || 'EA Studio';
    const _f = _c.founderName || 'Mr. Adrian';
    console.warn('%c⚠️ ' + _n + ' Security', 'color: red; font-size: 20px; font-weight: bold;');
    console.warn(
      '%cThis application is protected by ' + _s + '. Unauthorized access to source code is prohibited.',
      'color: orange; font-size: 14px;'
    );
    console.warn(
      '%c© ' + _n + ' — Proprietary software by ' + _s + ', founded by ' + _f + '.',
      'color: gray; font-size: 12px;'
    );
  }

  // ═══════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════

  function isProtectedElement(el) {
    if (!el) return false;
    // Walk up the DOM tree to check for protected containers
    let current = el;
    let maxDepth = 10;
    while (current && maxDepth-- > 0) {
      if (current.classList) {
        if (
          current.classList.contains('ai-response') ||
          current.classList.contains('bot-message') ||
          current.classList.contains('assistant') ||
          current.classList.contains('chat-bubble-ai') ||
          current.classList.contains('kelion-response') ||
          current.classList.contains('kira-response')
        ) {
          return true;
        }
      }
      if (current.dataset && current.dataset.role === 'assistant') return true;
      if (current.dataset && current.dataset.protected === 'true') return true;
      current = current.parentNode;
    }
    return false;
  }

  function isInputElement(el) {
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || el.contentEditable === 'true';
  }

  function recordCopyAttempt() {
    const now = Date.now();
    if (now - lastCopyAttemptTime > CONFIG.copyAttemptWindow) {
      copyAttempts = 0;
    }
    copyAttempts++;
    lastCopyAttemptTime = now;

    if (copyAttempts >= CONFIG.maxCopyAttempts) {
      showBlockWarning();
    }
  }

  function showCopyWarning() {
    const _cs = (window.APP_CONFIG || {}).studioName || 'EA Studio';
    // Subtle notification
    const toast = document.createElement('div');
    toast.textContent = 'Content is protected by ' + _cs;
    toast.style.cssText = [
      'position:fixed;bottom:20px;right:20px;padding:12px 20px;',
      'background:#1a1a2e;color:#00ffff;border-radius:8px;',
      'font-size:14px;z-index:99999;opacity:0;transition:opacity 0.3s;',
      'border:1px solid #00ffff33;box-shadow:0 4px 12px rgba(0,255,255,0.1);',
    ].join('');
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
    });
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        toast.remove();
      }, 300);
    }, 2500);
  }

  function showBlockWarning() {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;top:0;left:0;width:100%;height:100%;',
      'background:rgba(0,0,0,0.85);z-index:999999;display:flex;',
      'align-items:center;justify-content:center;flex-direction:column;',
    ].join('');
    const _bCfg = window.APP_CONFIG || {};
    const _bName = _bCfg.appName || 'KelionAI';
    const _bStudio = _bCfg.studioName || 'EA Studio';
    const _bFounder = _bCfg.founderName || 'Mr. Adrian';
    overlay.innerHTML = [
      '<div style="text-align:center;color:#fff;padding:40px;">',
      '<h2 style="color:#ff4444;font-size:24px;">⚠️ Active Protection</h2>',
      '<p style="font-size:16px;margin:20px 0;">' + _bName + ' content is protected by copyright.</p>',
      '<p style="color:#888;">© ' + _bStudio + ' — Founder: ' + _bFounder + '</p>',
      '<button onclick="this.parentNode.parentNode.remove()" ',
      'style="margin-top:20px;padding:10px 30px;background:#00ffff;color:#000;',
      'border:none;border-radius:6px;cursor:pointer;font-size:14px;">I Understand</button>',
      '</div>',
    ].join('');
    document.body.appendChild(overlay);
    copyAttempts = 0;
  }

  // ═══════════════════════════════════════════════════════════
  // CONSOLE PROTECTION — Override console methods in production
  // ═══════════════════════════════════════════════════════════

  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    const _pc = window.APP_CONFIG || {};
    const _pn = _pc.appName || 'KelionAI';
    const _ps = _pc.studioName || 'EA Studio';
    const _pf = _pc.founderName || 'Mr. Adrian';
    // Show branding in console
    console.log('%c🛡️ ' + _pn, 'color: #00ffff; font-size: 24px; font-weight: bold;');
    console.log('%cOwner: ' + _ps + ' | Founder: ' + _pf, 'color: #888; font-size: 12px;');
    console.log('%cUnauthorized access to source code is prohibited.', 'color: #ff4444; font-size: 12px;');
  }

  // ═══════════════════════════════════════════════════════════
  // IFRAME PROTECTION — Prevent embedding
  // ═══════════════════════════════════════════════════════════

  if (window.self !== window.top) {
    // We're in an iframe — check if it's authorized
    try {
      const parentHost = window.parent.location.hostname;
      // Allow same-origin iframes
      if (parentHost !== window.location.hostname) {
        document.body.innerHTML = '<h1 style="color:red;text-align:center;padding:50px;">⚠️ Embedding not allowed</h1>';
      }
    } catch (_) {
      // Cross-origin iframe — block it
      document.body.innerHTML = '<h1 style="color:red;text-align:center;padding:50px;">⚠️ Embedding not allowed</h1>';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════

  // Run DevTools warning on load
  if (CONFIG.disableDevTools) {
    onDevToolsOpen(); // Show warning in console always
  }

  // Expose minimal API for internal use
  const _cfg = window.APP_CONFIG || {};
  window.__kelionShield = {
    version: '1.0.0',
    owner: _cfg.studioName || 'EA Studio',
    founder: _cfg.founderName || 'Mr. Adrian',
  };
})();
