import { Router, Request, Response } from "express";
import { ENV } from "./_core/env";
import { getConversationById, getMessagesByConversationId, createMessage, getTrialStatus, incrementDailyUsage, createConversation } from "./db";
import { buildSystemPrompt, detectUserLevel, CharacterName } from "./characters";
import { generateSpeech } from "./elevenlabs";
import { authenticateRequestStandalone } from "./standalone-auth";

const router = Router();

function resolveApiUrl() {
  if (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) {
    return `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`;
  }
  return "https://api.openai.com/v1/chat/completions";
}

function getApiKey() {
  if (ENV.forgeApiKey && ENV.forgeApiKey.trim().length > 0) return ENV.forgeApiKey;
  if (ENV.openaiApiKey && ENV.openaiApiKey.trim().length > 0) return ENV.openaiApiKey;
  throw new Error("No API key configured");
}

function getModelName() {
  if (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) return "gemini-2.5-flash";
  return "gpt-4o";
}

router.post("/api/chat/stream", async (req: Request, res: Response) => {
  try {
    let user;
    try {
      user = await authenticateRequestStandalone(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { message, conversationId: inputConvId, avatar = "kelion", imageUrl } = req.body;
    if (!message) {
      res.status(400).json({ error: "Message required" });
      return;
    }

    // Check trial/usage limits
    const trialStatus = await getTrialStatus(user.id);
    if (!trialStatus.canUse) {
      res.status(403).json({ error: trialStatus.reason || "Usage limit reached" });
      return;
    }

    // Get or create conversation
    let conversationId = inputConvId;
    if (!conversationId) {
      const title = message.slice(0, 50) + (message.length > 50 ? "..." : "");
      const result = await createConversation(user.id, title);
      conversationId = (result as any)?.id || (result as any)[0]?.id;
      if (!conversationId) {
        res.status(500).json({ error: "Failed to create conversation" });
        return;
      }
    }

    // Verify ownership
    const conversation = await getConversationById(conversationId);
    if (!conversation || conversation.userId !== user.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Store user message
    await createMessage(conversationId, "user", message);

    // Build history
    const dbMessages = await getMessagesByConversationId(conversationId);
    const history = dbMessages.map((m: any) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content || "",
    }));

    // Get character system prompt
    const character = avatar as CharacterName;
    const level = detectUserLevel(message);
    const systemPrompt = buildSystemPrompt(character, level);

    // Build messages for LLM
    const llmMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...history.slice(-20),
    ];

    // If image, add to last user message
    if (imageUrl) {
      const lastMsg = llmMessages[llmMessages.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.content = [
          { type: "text", text: lastMsg.content },
          { type: "image_url", image_url: { url: imageUrl } },
        ];
      }
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send conversationId first
    res.write(`data: ${JSON.stringify({ type: "meta", conversationId })}\n\n`);

    // Call LLM with streaming
    const payload: Record<string, unknown> = {
      model: getModelName(),
      messages: llmMessages,
      stream: true,
      max_tokens: 4096,
    };

    const response = await fetch(resolveApiUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text();
      res.write(`data: ${JSON.stringify({ type: "error", error: errText })}\n\n`);
      res.end();
      return;
    }

    let fullContent = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            res.write(`data: ${JSON.stringify({ type: "token", content: delta.content })}\n\n`);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Store AI response
    await createMessage(conversationId, "assistant", fullContent, "brain-v4");

    // Generate TTS audio
    let audioUrl: string | undefined;
    try {
      // Use short version for TTS (first 500 chars)
      const ttsText = fullContent.slice(0, 500);
      const ttsResult = await generateSpeech({ text: ttsText, avatar: character });
      audioUrl = ttsResult.audioUrl;
    } catch (e) {
      console.error("[Streaming] TTS failed:", e);
    }

    // Send final event with audio
    res.write(`data: ${JSON.stringify({ type: "done", audioUrl, conversationId })}\n\n`);

    // Update usage
    if (trialStatus.isTrialUser) {
      await incrementDailyUsage(user.id, 1, 2);
    }

    res.end();
  } catch (err: any) {
    console.error("[Streaming] Error:", err);
    try {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    } catch {
      // response already ended
    }
  }
});

export default router;
