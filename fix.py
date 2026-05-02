with open('server/src/services/realTools.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
for i, line in enumerate(lines):
    if line.startswith('async function toolAskExpertCoder(args) {') and i > 3000:
        skip = True
    if skip and line.startswith('async function executeRealTool(name, args, ctx) {'):
        skip = False
    
    if not skip:
        new_lines.append(line)

with open('server/src/services/realTools.js', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
