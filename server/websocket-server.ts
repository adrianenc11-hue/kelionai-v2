import { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";

/**
 * WebSocket Server for Real-time Communication
 * Handles streaming, live chat, and multi-modal interaction
 */

export interface ClientConnection {
  userId: number;
  socketId: string;
  agentName: "kelion" | "kira";
  isStreaming: boolean;
  audioBuffer: Buffer[];
}

export class WebSocketServer {
  private io: SocketIOServer;
  private clients: Map<string, ClientConnection> = new Map();
  private messageQueue: Array<{ userId: number; message: string; timestamp: Date }> = [];

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"],
      },
    });

    this.setupEventHandlers();
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      console.log(`[WebSocket] Client connected: ${socket.id}`);

      // Client joins
      socket.on("join", (data: { userId: number; agentName: "kelion" | "kira" }) => {
        this.clients.set(socket.id, {
          userId: data.userId,
          socketId: socket.id,
          agentName: data.agentName,
          isStreaming: false,
          audioBuffer: [],
        });

        socket.emit("joined", { message: "Connected to KelionAI" });
        console.log(`[WebSocket] User ${data.userId} joined with ${data.agentName}`);
      });

      // Send message
      socket.on("message", (data: { content: string; type: "text" | "voice" }) => {
        this.handleMessage(socket, data);
      });

      // Start audio stream
      socket.on("start-audio-stream", () => {
        this.handleStartAudioStream(socket);
      });

      // Send audio chunk
      socket.on("audio-chunk", (data: { chunk: Buffer }) => {
        this.handleAudioChunk(socket, data.chunk);
      });

      // End audio stream
      socket.on("end-audio-stream", () => {
        this.handleEndAudioStream(socket);
      });

      // Start video stream
      socket.on("start-video-stream", () => {
        this.handleStartVideoStream(socket);
      });

      // Send video frame
      socket.on("video-frame", (data: { frame: Buffer; timestamp: number }) => {
        this.handleVideoFrame(socket, data);
      });

      // End video stream
      socket.on("end-video-stream", () => {
        this.handleEndVideoStream(socket);
      });

      // Disconnect
      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });

      // Error handling
      socket.on("error", (error: any) => {
        console.error(`[WebSocket] Error from ${socket.id}:`, error);
      });
    });
  }

  /**
   * Handle text/voice message
   */
  private handleMessage(
    socket: Socket,
    data: { content: string; type: "text" | "voice" }
  ): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    console.log(`[WebSocket] Message from ${client.userId}: ${data.content}`);

    // Queue message for processing
    this.messageQueue.push({
      userId: client.userId,
      message: data.content,
      timestamp: new Date(),
    });

    // Emit to other connected clients (for multi-user scenarios)
    socket.broadcast.emit("message-received", {
      userId: client.userId,
      agentName: client.agentName,
      content: data.content,
      type: data.type,
      timestamp: new Date(),
    });
  }

  /**
   * Handle audio stream start
   */
  private handleStartAudioStream(socket: Socket): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    client.isStreaming = true;
    client.audioBuffer = [];

    console.log(`[WebSocket] Audio stream started for user ${client.userId}`);
    socket.emit("audio-stream-started", { message: "Ready to receive audio" });
  }

  /**
   * Handle audio chunk
   */
  private handleAudioChunk(socket: Socket, chunk: Buffer): void {
    const client = this.clients.get(socket.id);
    if (!client || !client.isStreaming) return;

    client.audioBuffer.push(chunk);

    // Send acknowledgment
    socket.emit("audio-chunk-received", { size: chunk.length });
  }

  /**
   * Handle audio stream end
   */
  private async handleEndAudioStream(socket: Socket): Promise<void> {
    const client = this.clients.get(socket.id);
    if (!client) return;

    client.isStreaming = false;

    // Combine audio chunks
    const audioData = Buffer.concat(client.audioBuffer);
    console.log(`[WebSocket] Audio stream ended for user ${client.userId}, size: ${audioData.length}`);

    // Emit audio processing event
    socket.emit("audio-stream-ended", {
      message: "Audio received and processing",
      size: audioData.length,
    });

    // Clear buffer
    client.audioBuffer = [];
  }

  /**
   * Handle video stream start
   */
  private handleStartVideoStream(socket: Socket): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    console.log(`[WebSocket] Video stream started for user ${client.userId}`);
    socket.emit("video-stream-started", { message: "Ready to receive video frames" });
  }

  /**
   * Handle video frame
   */
  private handleVideoFrame(
    socket: Socket,
    data: { frame: Buffer; timestamp: number }
  ): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    // Process frame for vision analysis
    console.log(
      `[WebSocket] Video frame received for user ${client.userId}, timestamp: ${data.timestamp}`
    );

    // Emit frame processed event
    socket.emit("video-frame-processed", {
      timestamp: data.timestamp,
      message: "Frame received for analysis",
    });
  }

  /**
   * Handle video stream end
   */
  private handleEndVideoStream(socket: Socket): void {
    const client = this.clients.get(socket.id);
    if (!client) return;

    console.log(`[WebSocket] Video stream ended for user ${client.userId}`);
    socket.emit("video-stream-ended", { message: "Video stream closed" });
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(socket: Socket): void {
    const client = this.clients.get(socket.id);
    if (client) {
      console.log(`[WebSocket] User ${client.userId} disconnected`);
      this.clients.delete(socket.id);
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcastMessage(message: string, data?: any): void {
    this.io.emit("broadcast", { message, data, timestamp: new Date() });
  }

  /**
   * Send message to specific user
   */
  sendToUser(userId: number, event: string, data: any): void {
    this.clients.forEach((client, socketId) => {
      if (client.userId === userId) {
        this.io.to(socketId).emit(event, data);
      }
    });
  }

  /**
   * Stream response to client
   */
  streamResponse(userId: number, content: string, chunkSize: number = 50): void {
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.substring(i, i + chunkSize);
      this.sendToUser(userId, "response-chunk", {
        chunk,
        index: Math.floor(i / chunkSize),
        total: Math.ceil(content.length / chunkSize),
      });
    }

    this.sendToUser(userId, "response-complete", { message: "Response streaming complete" });
  }

  /**
   * Get connected clients count
   */
  getConnectedClientsCount(): number {
    return this.clients.size;
  }

  /**
   * Get client info
   */
  getClientInfo(socketId: string): ClientConnection | undefined {
    return this.clients.get(socketId);
  }

  /**
   * Get all connected clients
   */
  getAllClients(): ClientConnection[] {
    const clients: ClientConnection[] = [];
    this.clients.forEach((client) => {
      clients.push(client);
    });
    return clients;
  }

  /**
   * Get message queue
   */
  getMessageQueue(): Array<{ userId: number; message: string; timestamp: Date }> {
    return this.messageQueue;
  }

  /**
   * Clear message queue
   */
  clearMessageQueue(): void {
    this.messageQueue = [];
  }
}

export default WebSocketServer;
