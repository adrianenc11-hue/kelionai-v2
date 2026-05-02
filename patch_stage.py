import re
with open('src/pages/KelionStage.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add startRef where other liveHook refs are
content = content.replace('  statusRef.current = status\n  liveSendTextRef.current = liveSendText', '  statusRef.current = status\n  liveSendTextRef.current = liveSendText\n  const startRef = useRef(null)\n  startRef.current = start')

# Replace the dispatch in sendTextMessage
old_dispatch = "    if (liveSendTextRef.current) await liveSendTextRef.current(finalPayload.trim())\n  }, [chatInput, attachedFile, applyMuteCommand])"
new_dispatch = """    const payloadStr = finalPayload.trim()
    if (statusRef.current === 'idle' || statusRef.current === 'error') {
      const clean = turnsRef.current
        .filter((t) => t && t.role && t.text && String(t.text).trim())
        .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', text: String(t.text) }))
        .slice(-20)
      if (startRef.current) startRef.current({ textOnly: true, priorTurns: clean, initialText: payloadStr })
    } else {
      if (liveSendTextRef.current) await liveSendTextRef.current(payloadStr)
    }
  }, [chatInput, attachedFile, applyMuteCommand])"""
content = content.replace(old_dispatch, new_dispatch)

with open('src/pages/KelionStage.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
