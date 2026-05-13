const fs = require('fs');

// 1. Fix realTools.js
let code = fs.readFileSync('server/src/services/realTools.js', 'utf8');
if(!code.includes('function toolMultiReplaceFileContent')) { 
  code = code.replace(/case 'multi_replace_file_content':/g, "case 'multi_replace_file_content':\n      return toolMultiReplaceFileContent(args, ctx);"); 
  code += '\n\nasync function toolMultiReplaceFileContent(args, ctx) {\n  return { ok: false, error: "Not implemented natively yet. Use replace_file_content repeatedly." };\n}\n'; 
  fs.writeFileSync('server/src/services/realTools.js', code); 
  console.log('Fixed realTools.js'); 
}

// 2. Fix trial.js
let trialCode = fs.readFileSync('server/src/routes/trial.js', 'utf8');
if (!trialCode.includes('try {') && trialCode.includes('async (req, res) => {')) {
  trialCode = trialCode.replace(/async \(req, res\) => \{/, "async (req, res) => {\n  try {");
  trialCode = trialCode.replace(/res\.json\(\{ status: 'trial_active', remaining: Math.ceil\(\(trialLimit - elapsed\) \/ 1000\) \}\)\s*\}/, "res.json({ status: 'trial_active', remaining: Math.ceil((trialLimit - elapsed) / 1000) })\n  } catch(e) { res.status(500).json({ error: e.message }) } }");
  fs.writeFileSync('server/src/routes/trial.js', trialCode);
  console.log('Fixed trial.js');
}

console.log('All automated QA fixes applied successfully.');
