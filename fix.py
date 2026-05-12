import sys
with open('server/src/routes/realtime.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("const { getModel } = require('../services/modelRouter');", "const { getModel, getEndpoint } = require('../services/modelRouter');")
content = content.replace("const chatModel = getModel('chat');", "const chatModel = getModel('chat');\n      const endpoint = getEndpoint(chatModel);")
content = content.replace("provider: 'openrouter',", "provider: endpoint.provider,")
content = content.replace("backend: 'openrouter',", "backend: endpoint.provider,")

with open('server/src/routes/realtime.js', 'w', encoding='utf-8') as f:
    f.write(content)
