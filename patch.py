import re
with open('src/lib/geminiLive.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('    if (msg.setupComplete) {\n      logAiEvent(\'setup_complete\', {})\n      setStatus(\'listening\')\n', '    if (msg.setupComplete) {\n      logAiEvent(\'setup_complete\', {})\n      setStatus(\'listening\')\n      if (initialTextRef.current && ws && ws.readyState === WebSocket.OPEN) {\n        try {\n          ws.send(JSON.stringify({ clientContent: { turns: [{ role: \'user\', parts: [{ text: initialTextRef.current }] }], turnComplete: true } }))\n          setStatus(\'thinking\')\n          initialTextRef.current = null\n        } catch (_) {}\n      }\n')

with open('src/lib/geminiLive.js', 'w', encoding='utf-8') as f:
    f.write(content)
