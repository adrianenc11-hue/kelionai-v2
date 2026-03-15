const fs = require('fs');
let f = fs.readFileSync('server/routes/admin.js', 'utf8');

// Fix 1: trim the code from req.body
f = f.replace(
  'const { code } = req.body || {};',
  'const { code: rawCode } = req.body || {};\n  const code = (rawCode || "").trim();'
);

// Fix 2: trim accessCode
f = f.replace(
  'process.env.ADMIN_ACCESS_CODE || process.env.ADMIN_EXIT_CODE;',
  '(process.env.ADMIN_ACCESS_CODE || process.env.ADMIN_EXIT_CODE || "").trim();'
);

// Fix 3: trim exitCode 
f = f.replace(
  'const exitCode = process.env.ADMIN_EXIT_CODE || process.env.ADMIN_ACCESS_CODE;',
  'const exitCode = (process.env.ADMIN_EXIT_CODE || process.env.ADMIN_ACCESS_CODE || "").trim();'
);

// Fix 4: trim secret
f = f.replace(
  'const secret = process.env.ADMIN_SECRET_KEY;',
  'const secret = (process.env.ADMIN_SECRET_KEY || "").trim();'
);

fs.writeFileSync('server/routes/admin.js', f);
console.log('Admin verify-code .trim() fix applied!');
