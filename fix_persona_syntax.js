const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, 'server/persona.js');
let code = fs.readFileSync(file, 'utf8');

// The corrupted lines have \` and \${ and \\n
code = code.replace(/\\\`\\\\n## CE ȘTII DESPRE UTILIZATOR\\\\n\\\$\\{memory\\} \\\\nFolosește natural, nu spune "din memorie văd\.\.\."\.\\\\n\\\`/g, 
  '`\\n## CE ȘTII DESPRE UTILIZATOR\\n${memory} \\nFolosește natural, nu spune "din memorie văd...".\\n`');

code = code.replace(/\\\`\\\\n## STARE SISTEM\\\\nUnelte temporar indisponibile: \\\$\\{diagnostics\.failedTools\.join\(\', \'\)\\}\. Oferă alternative\.\\\\n\\\`/g,
  '`\\n## STARE SISTEM\\nUnelte temporar indisponibile: ${diagnostics.failedTools.join(\', \')}. Oferă alternative.\\n`');

code = code.replace(/\\\`\\\\nTon recomandat de gandire: \\\$\\{chainOfThought\.tone\\} \\\\n\\\`/g,
  '`\\nTon recomandat de gandire: ${chainOfThought.tone} \\n`');

code = code.replace(/\\\`\\\\nNOW: \\\$\\{day\\}, \\\$\\{hour\\}:\\\$\\{String\(now\.getMinutes\(\)\)\.padStart\(2, \'0\'\)\\}, \\\$\\{timeOfDay\\}\. Adapt your tone naturally\.\\\\n\\\`/g,
  '`\\nNOW: ${day}, ${hour}:${String(now.getMinutes()).padStart(2, \'0\')}, ${timeOfDay}. Adapt your tone naturally.\\n`');

code = code.replace(/\\\`\\\\nRESPOND in \\\$\\{langName\\}\. Be concise but complete\.\\\`/g,
  '`\\nRESPOND in ${langName}. Be concise but complete.`');

// And newborn:
code = code.replace(/\\\`Ești KelionAI — Newborn Mode\.\nRolul tău este să asculți, să înveți și să execuți ordine directe\.\n\\\`/g,
  '`Ești KelionAI — Newborn Mode.\\nRolul tău este să asculți, să înveți și să execuți ordine directe.\\n`');

fs.writeFileSync(file, code, 'utf8');
console.log('Fixed escape sequences.');
