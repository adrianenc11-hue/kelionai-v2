/**
 * WebSocket Server - KelionAI v2
 * 
 * Two voice modes:
 *   1. REALTIME (default) — OpenAI Realtime API: audio-in → audio-out directly (low latency)
 *   2. CLASSIC (fallback)  — Whisper STT → Brain v4 (GPT-4.1) → ElevenLabs TTS
 */
import { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { transcribeAudio } from "./_core/voiceTranscription";
import { generateSpeech } from "./elevenlabs";
import { processBrainMessage } from "./brain-v4";
import { getMessagesByConversationId, createMessage, createConversation, getTrialStatus, incrementDailyUsage, getUserByOpenId } from "./db";
import { verifySessionStandalone } from "./standalone-auth";
import {
  openRealtimeSession,
  sendAudioChunk,
  cancelResponse,
  closeRealtimeSession,
  type RealtimeSession,
} from "./voice-realtime";

export interface ClientConnection {
  userId: number;
  socketId: string;
  agentName: "kelion" | "kira";
  isStreaming: boolean;
  audioBuffer: Buffer[];
  conversationId?: number;
  realtimeSession?: RealtimeSession;
  voiceMode: "realtime" | "classic";
}

export class WebSocketServer {
  private io: SocketIOServer;
  private clients: Map<string, ClientConnection> = new Map();

  constructor(httpServer: HTTPServer) {
    const allowedOrigins = [
      "https://kelionai.app",
      "https://www.kelionai.app",
      "https://kelionai-v2-production.up.railway.app",
      ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000", "http://localhost:5173"] : []),
    ];

    this.io = new SocketIOServer(httpServer, {
      cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
      maxHttpBufferSize: 5 * 1024 * 1024,
    });
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      console.log(`[WebSocket] Client connected: ${socket.id}`);

      // ============ JOIN (with JWT auth) ============
      socket.on("join", async (data: {
        token?: string;
        userId: number;
        agentName: "kelion" | "kira";
        conversationId?: number;
        voiceMode?: "realtime" | "classic";
      }) => {
        let verifiedUserId = data.userId;
        if (data.token) {
          try {
            const session = await verifySessionStandalone(data.token);
            if (!session) { socket.emit("error-response", { message: "Invalid session" }); return; }
            const user = await getUserByOpenId(session.openId);
            if (!user) { socket.emit("error-response", { message: "User not found" }); return; }
            verifiedUserId = user.id;
          } catch {
            socket.emit("error-response", { message: "Authentication failed" });
            return;
          }
        } else {
          console.warn(`[WebSocket] User ${data.userId} joined WITHOUT token - legacy mode`);
        }

        const trial = await getTrialStatus(verifiedUserId);
        if (!trial.canUse) {
          socket.emit("error-response", { message: trial.reason || "Usage limit reached" });
          return;
        }

        const hasOpenAI = !!process.env.OPENAI_API_KEY;
        const voiceMode = data.voiceMode || (hasOpenAI ? "realtime" : "classic");

        this.clients.set(socket.id, {
          userId: verifiedUserId,
          socketId: socket.id,
          agentName: data.agentName,
          isStreaming: false,
          audioBuffer: [],
          conversationId: data.conversationId,
          voiceMode,
        });

        socket.emit("joined", { message: "Connected to KelionAI", voiceMode });
        console.log(`[WebSocket] User ${verifiedUserId} joined: ${data.agentName}, mode=${voiceMode}`);
      });

      // ============ START REALTIME VOICE ============
      socket.on("start-realtime", (data?: { language?: string }) => {
        const client = this.clients.get(socket.id);
        if (!client) return;

        if (client.realtimeSession) {
          closeRealtimeSession(client.realtimeSession);
          client.realtimeSession = undefined;
        }

        const session = openRealtimeSession({
          agentName: client.agentName,
          language: data?.language,
          onAudioDelta: (base64Audio: string) => {
            socket.emit("realtime-audio", { audio: base64Audio });
          },
          onTranscript: (text: string, role: "user" | "assistant") => {
            socket.emit("realtime-transcript", { text, role });
            if (client.conversationId && text.trim()) {
              createMessage(client.conversationId, role, text, role === "assistant" ? "gpt-4o-realtime" : undefined)
                .catch(e => console.error("[Realtime] Save msg error:", e));
            }
          },
          onError: (error: string) => {
            socket.emit("error-response", { message: error });
          },
          onDone: () => {
            socket.emit("realtime-response-done");
            incrementDailyUsage(client.userId, 1, 1).catch(() => {});
          },
        });

        if (session) {
          client.realtimeSession = session;
          client.voiceMode = "realtime";
          socket.emit("realtime-started", { message: "Realtime voice active" });
          console.log(`[WebSocket] Realtime opened for user ${client.userId}`);
        } else {
          client.voiceMode = "classic";
          socket.emit("realtime-unavailable", { message: "Realtime not available, using classic" });
        }
      });

      // ============ REALTIME AUDIO CHUNK (PCM16 base64) ============
      socket.on("realtime-audio-chunk", (data: { audio: string }) => {
        const client = this.clients.get(socket.id);
        if (!client?.realtimeSession) return;
        sendAudioChunk(client.realtimeSession, data.audio);
      });

      // ============ STOP REALTIME / INTERRUPT ============
      socket.on("stop-realtime", () => {
        const client = this.clients.get(socket.id);
        if (!client?.realtimeSession) return;
        cancelResponse(client.realtimeSession);
        closeRealtimeSession(client.realtimeSession);
        client.realtimeSession = undefined;
        socket.emit("realtime-stopped");
      });

      socket.on("interrupt", () => {
        const client = this.clients.get(socket.id);
        if (client?.realtimeSession) cancelResponse(client.realtimeSession);
      });

      // ============ CLASSIC MODE ============
      socket.on("start-audio-stream", () => {
        const client = this.clients.get(socket.id);
        if (!client) return;
        client.isStreaming = true;
        client.audioBuffer = [];
        socket.emit("audio-stream-started", { message: "Ready to receive audio" });
      });

      socket.on("audio-chunk", (data: { chunk: Buffer }) => {
        const client = this.clients.get(socket.id);
        if (!client || !client.isStreaming) return;
        client.audioBuffer.push(Buffer.from(data.chunk));
      });

      socket.on("end-audio-stream", () => {
        this.handleClassicVoice(socket);
      });

      // ============ SWITCH AGENT ============
      socket.on("switch-agent", (data: { agentName: "kelion" | "kira" }) => {
        const client = this.clients.get(socket.id);
        if (!client) return;
        client.agentName = data.agentName;
        if (client.realtimeSession) {
          closeRealtimeSession(client.realtimeSession);
          client.realtimeSession = undefined;
          socket.emit("realtime-stopped");
        }
        socket.emit("agent-switched", { agentName: data.agentName });
      });

      // ============ DISCONNECT ============
      socket.on("disconnect", () => {
        const client = this.clients.get(socket.id);
        if (client) {
          if (client.realtimeSession) closeRealtimeSession(client.realtimeSession);
          console.log(`[WebSocket] User ${client.userId} disconnected`);
          this.clients.delete(socket.id);
        }
      });

      socket.on("error", (error: any) => {
        console.error(`[WebSocket] Error from ${socket.id}:`, error);
      });
    });
  }

  /** Classic: Whisper STT → Brain v4 (GPT-4.1) → ElevenLabs TTS */
  private async handleClassicVoice(socket: Socket): Promise<void> {
    const client = this.clients.get(socket.id);
    if (!client) return;

    client.isStreaming = false;
    const audioData = Buffer.concat(client.audioBuffer);
    client.audioBuffer = [];

    if (audioData.length < 500) {
      socket.emit("error-response", { message: "Audio too short" });
      return;
    }

    socket.emit("processing-audio", { message: "Transcribing..." });

    try {
      const trial = await getTrialStatus(client.userId);
      if (!trial.canUse) {
        socket.emit("error-response", { message: trial.reason || "Usage limit reached" });
        return;
      }

      const transcription = await transcribeAudio({
        audioUrl: "",
        audioBuffer: audioData,
        audioMimeType: "audio/webm",
      });

      if ("error" in transcription || !transcription.text?.trim()) {
        socket.emit("error-response", { message: "Could not transcribe audio" });
        return;
      }

      const text = transcription.text.trim();
      const detectedLanguage = transcription.language || "en";

      socket.emit("transcription-done", { text, language: detectedLanguage });
      socket.emit("thinking", { message: "Thinking..." });

      let conversationId = client.conversationId;
      if (!conversationId) {
        const conv = await createConversation(client.userId, text.slice(0, 50));
        conversationId = (conv as any).id;
        client.conversationId = conversationId;
        socket.emit("conversation-created", { conversationId });
      }

      await createMessage(conversationId!, "user", text);
      const dbMessages = await getMessagesByConversationId(conversationId!);
      const history = dbMessages.map((m: any) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content || "",
      }));

      const brainResult = await processBrainMessage({
        message: text,
        history: history.slice(-20),
        character: client.agentName,
        userId: client.userId,
      });

      await createMessage(conversationId!, "assistant", brainResult.content, "brain-v4");

      let audioUrl: string | undefined;
      try {
        const ttsResult = await generateSpeech({
          text: brainResult.content.slice(0, 1000),
          avatar: client.agentName,
        });
        audioUrl = ttsResult.audioUrl;
      } catch (ttsErr) {
        console.error("[WebSocket] TTS error:", ttsErr);
      }

      await incrementDailyUsage(client.userId, 1, 1);

      socket.emit("voice-response", {
        transcribedText: text,
        content: brainResult.content,
        audioUrl,
        language: detectedLanguage,
        conversationId,
      });

    } catch (error: any) {
      console.error("[WebSocket] Classic voice error:", error);
      socket.emit("error-response", { message: `Error: ${error.message}` });
    }
  }

  sendToUser(userId: number, event: string, data: any): void {
    this.clients.forEach((client, socketId) => {
      if (client.userId === userId) {
        this.io.to(socketId).emit(event, data);
      }
    });
  }

  getConnectedClientsCount(): number { return this.clients.size; }
  getClientInfo(socketId: string): ClientConnection | undefined { return this.clients.get(socketId); }
}

export default WebSocketServer;
