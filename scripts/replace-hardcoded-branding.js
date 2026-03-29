#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI — Replace Hardcoded Branding Script
// Înlocuiește toate valorile hardcodate din fișierele app/ și server/
// cu referințe dinamice la APP_CONFIG / process.env
// ═══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Fișiere/directoare de ignorat ──
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'android', 'ios',
  'scripts', 'tests', 'testcomplet', 'tmp',
]);

const IGNORE_FILES = new Set([
  'client-config.js', 'copy-shield.js', 'identity-guard.js',
  'persona.js', 'voice-realtime.js', 'voice.js',
  'app.js',       // server/config/app.js — sursa de adevăr
  'models.js',    // server/config/models.js — deja actualizat
  'brain.js',     // server/brain.js — deja actualizat
  'replace-hardcoded-branding.js', // acest script
  'package.json', 'package-lock.json',
  'cspell.json',
]);

// ── Extensii procesate ──
const EXTS = new Set(['.js', '.html', '.json']);

// ── Înlocuiri pentru fișiere HTML (DOM runtime) ──
// Titluri <title> — înlocuim cu placeholder + script inline
const HTML_TITLE_REPLACEMENTS = [
  // <title>KelionAI — Ceva</title>  →  <title data-dynamic="true">Ceva</title>
  {
    pattern: /<title>KelionAI\s*[—\-–]\s*/g,
    replacement: '<title data-dynamic="true">',
  },
  {
    pattern: /<title>([^<]*KelionAI[^<]*)<\/title>/g,
    replacement: (_, inner) => `<title data-dynamic="true">${inner.replace(/KelionAI/g, '{{APP_NAME}}')}</title>`,
  },
];

// ── Înlocuiri text simple (JS + HTML) ──
const TEXT_REPLACEMENTS = [
  // LogRocket hardcoded app ID
  { pattern: /LogRocket\.init\(['"]bdaej1\/kelionai['"]\)/g,
    replacement: `LogRocket.init(window.APP_CONFIG && window.APP_CONFIG.logRocketId ? window.APP_CONFIG.logRocketId : '')` },

  // fingerprint canvas text
  { pattern: /ctx\.fillText\(['"]KelionAI-fp['"]/g,
    replacement: `ctx.fillText((window.APP_CONFIG && window.APP_CONFIG.appName ? window.APP_CONFIG.appName + '-fp' : 'app-fp')` },

  // i18n strings — înlocuim KelionAI cu placeholder dinamic
  // (vor fi rezolvate de i18n.js la runtime via APP_CONFIG)
];

// ── Colectează toate fișierele recurisv ──
function collectFiles(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTS.has(ext) && !IGNORE_FILES.has(entry.name)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// ── Procesează un fișier HTML ──
function processHtml(content, filePath) {
  let changed = false;
  let result = content;

  // 1. Înlocuiește <title>KelionAI — X</title>
  result = result.replace(/<title>KelionAI\s*[—\-–]\s*([^<]+)<\/title>/g, (_, suffix) => {
    changed = true;
    return `<title data-dynamic="true">${suffix.trim()}</title>`;
  });
  result = result.replace(/<title>([^<]*?)KelionAI([^<]*?)<\/title>/g, (_, pre, suf) => {
    changed = true;
    const inner = (pre + 'KelionAI' + suf).replace(/KelionAI/g, '{{APP_NAME}}');
    return `<title data-dynamic="true">${inner}</title>`;
  });

  // 2. Adaugă script de branding dinamic dacă nu există deja
  if (changed && !result.includes('dynamic-branding.js') && !result.includes('_applyDynamicBranding')) {
    const brandingSnippet = `
    <script>
      // Dynamic branding — replaces {{APP_NAME}} placeholders at runtime
      (function () {
        function _applyDynamicBranding(name) {
          if (!name) return;
          // Update <title>
          var titleEl = document.querySelector('title[data-dynamic="true"]');
          if (titleEl) {
            titleEl.textContent = titleEl.textContent.replace(/\\{\\{APP_NAME\\}\\}/g, name);
            document.title = titleEl.textContent;
          }
          // Update all text nodes containing {{APP_NAME}}
          var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
          var node;
          while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.includes('{{APP_NAME}}')) {
              node.nodeValue = node.nodeValue.replace(/\\{\\{APP_NAME\\}\\}/g, name);
            }
          }
          // Update element attributes (placeholder, content, value)
          ['placeholder', 'content', 'value', 'alt', 'aria-label'].forEach(function (attr) {
            document.querySelectorAll('[' + attr + '*="{{APP_NAME}}"]').forEach(function (el) {
              el.setAttribute(attr, el.getAttribute(attr).replace(/\\{\\{APP_NAME\\}\\}/g, name));
            });
          });
        }
        function _tryApply() {
          var name = window.APP_CONFIG && window.APP_CONFIG.appName;
          if (name) { _applyDynamicBranding(name); return; }
          window.addEventListener('app-config-loaded', function (e) {
            _applyDynamicBranding((e && e.detail && e.detail.appName) || '');
          });
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', _tryApply);
        } else {
          _tryApply();
        }
      })();
    </script>`;
    // Inserează înainte de </head>
    if (result.includes('</head>')) {
      result = result.replace('</head>', brandingSnippet + '\n  </head>');
    } else {
      result = brandingSnippet + '\n' + result;
    }
  }

  return { result, changed };
}

// ── Procesează un fișier JS ──
function processJs(content, filePath) {
  let changed = false;
  let result = content;

  // LogRocket hardcoded ID
  const lrPattern = /LogRocket\.init\(['"]bdaej1\/kelionai['"]\)/g;
  if (lrPattern.test(result)) {
    result = result.replace(
      /LogRocket\.init\(['"]bdaej1\/kelionai['"]\)/g,
      `LogRocket.init((window.APP_CONFIG && window.APP_CONFIG.logRocketId) || '')`
    );
    changed = true;
  }

  // Canvas fingerprint text
  const fpPattern = /ctx\.fillText\(['"]KelionAI-fp['"]/g;
  if (fpPattern.test(result)) {
    result = result.replace(
      /ctx\.fillText\(['"]KelionAI-fp['"]/g,
      `ctx.fillText(((window.APP_CONFIG && window.APP_CONFIG.appName) || 'app') + '-fp'`
    );
    changed = true;
  }

  return { result, changed };
}

// ── Main ──
function main() {
  const appDir = path.join(ROOT, 'app');
  const serverDir = path.join(ROOT, 'server');

  const files = [
    ...collectFiles(appDir),
    ...collectFiles(serverDir),
  ];

  let totalChanged = 0;
  const changedFiles = [];

  for (const filePath of files) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); }
    catch { continue; }

    const ext = path.extname(filePath).toLowerCase();
    let result = content;
    let changed = false;

    if (ext === '.html') {
      ({ result, changed } = processHtml(content, filePath));
    } else if (ext === '.js') {
      ({ result, changed } = processJs(content, filePath));
    }

    if (changed && result !== content) {
      fs.writeFileSync(filePath, result, 'utf8');
      totalChanged++;
      changedFiles.push(path.relative(ROOT, filePath));
    }
  }

  console.log(`\n✅ Done! Modified ${totalChanged} files:\n`);
  changedFiles.forEach(f => console.log('  •', f));
  console.log('');
}

main();