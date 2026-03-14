/**
 * KelionAI v3.5 — Collaboration WebSocket Handler
 *
 * Upgrades HTTP connections on /ws/collab to WebSocket.
 * Bridges real-time communication into SharedSessions rooms.
 *
 * Protocol:
 * - Client sends: { type: "join|leave|message|typing|ping", ... }
 * - Server sends: { type: "joined|left|message|typing|presence|error", ... }
 */
"use strict";

const { WebSocketServer } = require("ws");
const sharedSessions = require("./shared-sessions");
const logger = require("./logger");

/**
 * Setup collaboration WebSocket server
 * @param {http.Server} httpServer
 */
function setupCollaboration(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws/collab",
    perMessageDeflate: false,
  });

  wss.on("connection", (ws, req) => {
    // Parse query params for auth
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get("userId") || `anon_${Date.now()}`;
    const userName =
      url.searchParams.get("name") || `User-${userId.slice(0, 6)}`;

    let currentRoom = null;

    logger.info(
      { component: "Collab", userId },
      `🤝 WebSocket connected: ${userName}`,
    );

    // ── Message handler ──
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case "join": {
            const roomId = msg.roomId;
            if (!roomId) {
              ws.send(
                JSON.stringify({ type: "error", error: "roomId required" }),
              );
              return;
            }

            // Leave current room if in one
            if (currentRoom) {
              sharedSessions.leaveRoom(currentRoom, userId);
            }

            // Join room
            const result = sharedSessions.joinRoom(
              roomId,
              userId,
              userName,
              ws,
            );
            if (result.error) {
              ws.send(JSON.stringify({ type: "error", error: result.error }));
              return;
            }

            currentRoom = roomId;
            sharedSessions.updateParticipantWs(roomId, userId, ws);

            ws.send(
              JSON.stringify({
                type: "joined",
                roomId,
                name: result.name,
                participants: result.participants,
                recentMessages: result.recentMessages,
              }),
            );
            break;
          }

          case "create": {
            const room = sharedSessions.createRoom(userId, {
              name: msg.name,
              maxParticipants: msg.maxParticipants || 10,
              isPublic: msg.isPublic || false,
              aiEnabled: msg.aiEnabled !== false,
            });

            // Auto-join the created room
            currentRoom = room.roomId;
            sharedSessions.joinRoom(room.roomId, userId, userName, ws);
            sharedSessions.updateParticipantWs(room.roomId, userId, ws);

            ws.send(JSON.stringify({ type: "created", ...room }));
            break;
          }

          case "message": {
            if (!currentRoom) {
              ws.send(
                JSON.stringify({ type: "error", error: "Not in a room" }),
              );
              return;
            }

            const result = sharedSessions.sendMessage(
              currentRoom,
              userId,
              msg.content,
              msg.messageType || "user",
            );

            if (result.error) {
              ws.send(JSON.stringify({ type: "error", error: result.error }));
            }
            // Message is broadcast to room by sendMessage
            break;
          }

          case "typing": {
            if (!currentRoom) return;
            sharedSessions.broadcastToRoom(currentRoom, {
              type: "typing",
              userId,
              name: userName,
              isTyping: msg.isTyping !== false,
            });
            break;
          }

          case "leave": {
            if (currentRoom) {
              sharedSessions.leaveRoom(currentRoom, userId);
              currentRoom = null;
            }
            ws.send(JSON.stringify({ type: "left" }));
            break;
          }

          case "rooms": {
            const myRooms = sharedSessions.getUserRooms(userId);
            const publicRooms = sharedSessions.listPublicRooms();
            ws.send(JSON.stringify({ type: "rooms", myRooms, publicRooms }));
            break;
          }

          case "info": {
            if (!currentRoom) {
              ws.send(
                JSON.stringify({ type: "error", error: "Not in a room" }),
              );
              return;
            }
            const info = sharedSessions.getRoomInfo(currentRoom);
            ws.send(JSON.stringify({ type: "room_info", ...info }));
            break;
          }

          case "ping": {
            ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
            break;
          }

          default:
            ws.send(
              JSON.stringify({
                type: "error",
                error: `Unknown message type: ${msg.type}`,
              }),
            );
        }
      } catch (e) {
        ws.send(
          JSON.stringify({ type: "error", error: `Parse error: ${e.message}` }),
        );
      }
    });

    // ── Disconnect handler ──
    ws.on("close", () => {
      if (currentRoom) {
        sharedSessions.leaveRoom(currentRoom, userId);
      }
      logger.info(
        { component: "Collab", userId },
        `🤝 WebSocket disconnected: ${userName}`,
      );
    });

    // ── Error handler ──
    ws.on("error", (err) => {
      logger.warn(
        { component: "Collab", userId, err: err.message },
        "WebSocket error",
      );
    });

    // Send welcome
    ws.send(
      JSON.stringify({
        type: "welcome",
        userId,
        name: userName,
        version: "3.5",
      }),
    );
  });

  // ── Heartbeat — cleanup stale connections ──
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
  });

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  logger.info(
    { component: "Collab", path: "/ws/collab" },
    "🤝 Collaboration WebSocket server ready",
  );

  return wss;
}

module.exports = { setupCollaboration };
