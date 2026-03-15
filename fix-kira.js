// Fix kira-tools.js: replace HOST_IP spam blocks with isPrivateHost()
const fs = require('fs');
const lines = fs.readFileSync('server/kira-tools.js', 'utf8').split('\n');

// Find and replace BLOCK 1 (scrapeUrl ~L155-224)
let i = 0;
while (i < lines.length) {
  if (lines[i].includes('// Block internal/private IPs') && lines[i+1] && lines[i+1].includes('const host = parsed.hostname')) {
    // Found block 1 start - find end
    let end = i + 2;
    while (end < lines.length && !lines[end].includes("return { success: false, error: 'Cannot access internal/private URLs' }")) {
      end++;
    }
    end++; // include the return line
    while (end < lines.length && !lines[end].trim().startsWith('}')) {
      end++;
    }
    end++; // include closing }
    
    // Replace with clean code
    const indent = '    ';
    const replacement = [
      indent + '// Block internal/private IPs',
      indent + 'if (isPrivateHost(parsed.hostname)) {',
      indent + "  return { success: false, error: 'Cannot access internal/private URLs' };",
      indent + '}',
    ];
    lines.splice(i, end - i, ...replacement);
    console.log(`Block 1 fixed: replaced lines ${i+1}-${end} with ${replacement.length} lines`);
    break;
  }
  i++;
}

// Find and replace BLOCK 2 (deepBrowse ~L474-542)
i = 0;
let block2Found = false;
while (i < lines.length) {
  if (lines[i].trim().startsWith('if (') && lines[i+1] && lines[i+1].trim() === '[' && lines[i+2] && lines[i+2].trim() === "'localhost',") {
    // Found block 2 start
    let end = i;
    while (end < lines.length && !lines[end].includes("return { success: false, error: 'Cannot access internal URLs' }")) {
      end++;
    }
    end++; // include return line
    while (end < lines.length && !lines[end].trim().startsWith('}')) {
      end++;
    }
    end++; // include closing }
    
    const indent = '    ';
    const replacement = [
      indent + 'if (isPrivateHost(parsed.hostname)) {',
      indent + "  return { success: false, error: 'Cannot access internal URLs' };",
      indent + '}',
    ];
    lines.splice(i, end - i, ...replacement);
    console.log(`Block 2 fixed: replaced lines ${i+1}-${end} with ${replacement.length} lines`);
    block2Found = true;
    break;
  }
  i++;
}

if (!block2Found) {
  console.log('Block 2 not found, searching alternative pattern...');
  // Try alternate: look for the array pattern with localhost
  for (let j = 0; j < lines.length; j++) {
    if (lines[j].includes("'localhost'") && lines[j+1] && lines[j+1].includes('process.env.HOST_IP ||')) {
      // Check if this is block 2 (not block 1 which we already fixed)
      let end = j;
      while (end < lines.length && !lines[end].includes("'Cannot access internal URLs'")) {
        end++;
        if (end > j + 100) break;
      }
      if (end <= j + 100) {
        end++;
        while (end < lines.length && !lines[end].trim().startsWith('}')) end++;
        end++;
        const indent = '    ';
        const replacement = [
          indent + 'if (isPrivateHost(parsed.hostname)) {',
          indent + "  return { success: false, error: 'Cannot access internal URLs' };",
          indent + '}',
        ];
        lines.splice(j, end - j, ...replacement);
        console.log(`Block 2 (alt) fixed: replaced lines ${j+1}-${end}`);
        break;
      }
    }
  }
}

fs.writeFileSync('server/kira-tools.js', lines.join('\n'));
console.log('Done! File saved.');
console.log('Total lines now:', lines.length);
