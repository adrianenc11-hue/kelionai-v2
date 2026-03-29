const fs = require('fs');
const files = [
  'server/routes/voice.js',
  'server/routes/vision.js',
  'server/routes/chat.js',
  'server/middleware/checkSubscription.js',
  'server/code-shield.js',
];

files.forEach((f) => {
  if (!fs.existsSync(f)) return;
  let content = fs.readFileSync(f, 'utf8');

  // Remove the require statements
  content = content.replace(
    /const \{ checkUsage, incrementUsage \} = require\('\.\.\/payments'\);/g,
    '// Removed legacy payments'
  );
  content = content.replace(/const \{ notify \} = require\('\.\.\/notifications'\);/g, 'const notify = () => {};');
  content = content.replace(/const \{ t: _t \} = require\('\.\.\/i18n'\);/g, 'const _t = (key, def) => def || key;');
  content = content.replace(/const \{ t: _t \} = require\('\.\/i18n'\);/g, 'const _t = (key, def) => def || key;');
  content = content.replace(
    /const \{ getUserPlan, _PLAN_LIMITS \} = require\('\.\.\/payments'\);/g,
    'const getUserPlan = () => ({ tier: "pro", tier_name: "Pro" }); const _PLAN_LIMITS = { pro: 999999 };'
  );

  // Stub the functions that were imported so the logic using them doesn't throw ReferenceError
  // checkUsage usually returns { ok: true } or { limitReached: false }
  const stubs = `
const checkUsage = async () => ({ limitReached: false });
const incrementUsage = async () => {};
`;
  // Prepend stubs after imports
  content = content.replace(/(const express = require\('express'\);)/, `$1\n${stubs}`);

  fs.writeFileSync(f, content, 'utf8');
});
console.log('Patched dangling imports!');
