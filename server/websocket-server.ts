import { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { transcribeAudio } from "./_core/voiceTranscription";
import { generateSpeech } from "./elevenlabs";
import { processBrainMessage } from "./brain-v4";
import { getMessagesByConversationId, createMessage, createConversation, getTrialStatus, incrementDailyUsage } from "./db";

export interface ClientConnection {
  userId: number;
  socketId: string;
  agentName: "kelion" | "kira";
  isStreaming: boolean;
  audioBuffer: Buffer[];
  conversationId?: number;
}

export class WebSocketServer {
  private io: SocketIOServer;
  private clients: Map<string, ClientConnection> = new Map();

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] },
    });
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      console.log(`[WebSocket] Client connected: ${socket.id}`);

      socket.on("join", (data: { userId: number; agentName: "kelion" | "kira"; conversationId?: number }) => {
        this.clients.set(socket.id, {
          userId: data.userId,
          socketId: socket.id,
          agentName: data.agentName,
          isStreaming: false,
          audioBuffer: [],
          conversationId: data.conversationId,
        });
        socket.emit("joined", { message: "Connected to KelionAI" });
        console.log(`[WebSocket] User ${data.userId} joined with ${data.agentName}`);
      });

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
        socket.emit("audio-chunk-received", { size: data.chunk.length });
      });

      socket.on("end-audio-stream", () => {
        this.handleEndAudioStream(socket);
      });

      socket.on("disconnect", () => {
        const client = this.clients.get(socket.id);
        if (client) {
          console.log(`[WebSocket] User ${client.userId} disconnected`);
          this.clients.delete(socket.id);
        }
      });

      socket.on("error", (error: any) => {
        console.error(`[WebSocket] Error from ${socket.id}:`, error);
      });
    });
  }

  private async handleEndAudioStream(socket: Socket): Promise<void> {
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
      // Check trial
      const trial = await getTrialStatus(client.userId);
      if (!trial.canUse) {
        socket.emit("error-response", { message: trial.reason || "Usage limit reached" });
        return;
      }

      // STEP 1: Transcribe
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

      // STEP 2: Get history
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

      // STEP 3: Brain
      const brainResult = await processBrainMessage({
        message: text,
        history: history.slice(-20),
        character: client.agentName,
        userId: client.userId,
      });

      await createMessage(conversationId!, "assistant", brainResult.content, "brain-v4");

      // STEP 4: TTS
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

      // Update usage
      await incrementDailyUsage(client.userId, 1, 1);

      // STEP 5: Send response
      socket.emit("voice-response", {
        transcribedText: text,
        content: brainResult.content,
        audioUrl,
        language: detectedLanguage,
        conversationId,
      });

    } catch (error: any) {
      console.error("[WebSocket] Voice processing error:", error);
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
