import re
with open('server/src/routes/realtime.js', 'r', encoding='utf-8') as f:
    content = f.read()

tools_to_add = """    {
      name: 'run_command',
      description: 'Run a shell command on the host. Use for OS interaction, starting servers, running build scripts, etc.',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory for the command.' }
      },
      required: ['command']
    },
    {
      name: 'write_to_file',
      description: 'Create or overwrite a file with given content. WARNING: Replaces entire file.',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path.' },
        content: { type: 'string', description: 'Complete file content.' }
      },
      required: ['path', 'content']
    },
    {
      name: 'replace_file_content',
      description: 'Replace a specific block of text in a file.',
      properties: {
        path: { type: 'string', description: 'Path to file.' },
        target_content: { type: 'string', description: 'Exact text to replace.' },
        replacement_content: { type: 'string', description: 'New text.' }
      },
      required: ['path', 'target_content', 'replacement_content']
    },
    {
      name: 'multi_replace_file_content',
      description: 'Apply multiple replacements to a file.',
      properties: {
        path: { type: 'string', description: 'Path to file.' },
        replacements: { type: 'string', description: 'JSON string of array of replacements [{target_content, replacement_content}].' }
      },
      required: ['path', 'replacements']
    },
"""

# Insert before the closing bracket of KELION_TOOLS
match = re.search(r'const KELION_TOOLS = \[\n', content)
if match:
    content = content[:match.end()] + tools_to_add + content[match.end():]
    with open('server/src/routes/realtime.js', 'w', encoding='utf-8') as f:
        f.write(content)
        print("Tools added successfully.")
