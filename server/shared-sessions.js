/**
 * KelionAI — Shared Sessions (Real-time Collaboration — Tier 0)
 *
 * Multiple users + AI in the same conversation.
 * Uses WebSocket rooms for real-time sync.
 *
 * Features:
 * - Create/join shared rooms
 * - Broadcast messages to all participants
 * - AI responds to group context
 * - Participant presence tracking
 */
'use strict';

const logger = require('./logger');

// ═══ IN-MEMORY ROOM STORAGE ═══
const rooms = new Map(); // roomId → { participants, messages, createdAt, ownerId }

/**
 * Create a new shared session room
 */
function createRoom(userId, options = {}) {
  const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const room = {
    id: roomId,
    name: options.name || `Session ${roomId.slice(-4)}`,
    ownerId: userId,
    participants: new Map(), // userId → { name, joinedAt, ws, isOnline }
    messages: [], // { userId, name, content, timestamp, type }
    createdAt: new Date().toISOString(),
    maxParticipants: options.maxParticipants || 10,
    isPublic: options.isPublic || false,
    aiEnabled: options.aiEnabled !== false,
  };

  rooms.set(roomId, room);

  logger.info({ component: 'SharedSession', roomId, ownerId: userId }, `🤝 Room created: ${room.name}`);

  return {
    roomId,
    name: room.name,
    inviteCode: roomId, // Simple invite — use roomId as code
  };
}

/**
 * Join an existing room
 */
function joinRoom(roomId, userId, userName, ws = null) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  if (room.participants.size >= room.maxParticipants) {
    return { error: 'Room is full' };
  }

  room.participants.set(userId, {
    name: userName || `User-${userId.slice(0, 6)}`,
    joinedAt: new Date().toISOString(),
    ws,
    isOnline: true,
  });

  // Notify others
  const joinMsg = {
    userId: 'system',
    name: 'System',
    content: `${userName || userId.slice(0, 6)} joined the session`,
    timestamp: new Date().toISOString(),
    type: 'system',
  };
  room.messages.push(joinMsg);
  broadcastToRoom(roomId, {
    type: 'participant_joined',
    userId,
    name: userName,
    message: joinMsg,
  });

  logger.info({ component: 'SharedSession', roomId, userId }, `🤝 User joined: ${userName}`);

  return {
    success: true,
    roomId,
    name: room.name,
    participants: getParticipantList(roomId),
    recentMessages: room.messages.slice(-20),
  };
}

/**
 * Leave a room
 */
function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(userId);
  room.participants.delete(userId);

  // Notify others
  const leaveMsg = {
    userId: 'system',
    name: 'System',
    content: `${participant?.name || userId.slice(0, 6)} left the session`,
    timestamp: new Date().toISOString(),
    type: 'system',
  };
  room.messages.push(leaveMsg);
  broadcastToRoom(roomId, {
    type: 'participant_left',
    userId,
    message: leaveMsg,
  });

  // Auto-delete empty rooms after 5 minutes
  if (room.participants.size === 0) {
    setTimeout(
      () => {
        if (rooms.has(roomId) && rooms.get(roomId).participants.size === 0) {
          rooms.delete(roomId);
          logger.info({ component: 'SharedSession', roomId }, '🤝 Room auto-deleted (empty)');
        }
      },
      5 * 60 * 1000
    );
  }
}

/**
 * Send message to room (from user or AI)
 */
function sendMessage(roomId, userId, content, type = 'user') {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const participant = room.participants.get(userId);
  const message = {
    userId,
    name: type === 'ai' ? 'Kelion AI' : participant?.name || userId.slice(0, 6),
    content,
    timestamp: new Date().toISOString(),
    type, // "user" | "ai" | "system"
  };

  room.messages.push(message);

  // Keep last 200 messages per room
  if (room.messages.length > 200) {
    room.messages = room.messages.slice(-200);
  }

  // Broadcast to all participants
  broadcastToRoom(roomId, { type: 'new_message', message });

  return { success: true, message };
}

/**
 * Broadcast data to all WebSocket connections in a room
 */
function broadcastToRoom(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = JSON.stringify(data);

  for (const [_userId, participant] of room.participants) {
    if (participant.ws && participant.ws.readyState === 1) {
      // WebSocket.OPEN
      try {
        participant.ws.send(payload);
      } catch {
        participant.isOnline = false;
      }
    }
  }
}

/**
 * Get participant list for a room
 */
function getParticipantList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return [...room.participants.entries()].map(([id, p]) => ({
    userId: id,
    name: p.name,
    joinedAt: p.joinedAt,
    isOnline: p.isOnline && p.ws?.readyState === 1,
    isOwner: id === room.ownerId,
  }));
}

/**
 * Get room info
 */
function getRoomInfo(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    participants: getParticipantList(roomId),
    messageCount: room.messages.length,
    createdAt: room.createdAt,
    aiEnabled: room.aiEnabled,
    maxParticipants: room.maxParticipants,
  };
}

/**
 * List public rooms
 */
function listPublicRooms() {
  const publicRooms = [];
  for (const [id, room] of rooms) {
    if (room.isPublic) {
      publicRooms.push({
        id,
        name: room.name,
        participants: room.participants.size,
        maxParticipants: room.maxParticipants,
        createdAt: room.createdAt,
      });
    }
  }
  return publicRooms;
}

/**
 * Get user's active rooms
 */
function getUserRooms(userId) {
  const userRooms = [];
  for (const [id, room] of rooms) {
    if (room.participants.has(userId) || room.ownerId === userId) {
      userRooms.push({
        id,
        name: room.name,
        participants: room.participants.size,
        isOwner: room.ownerId === userId,
      });
    }
  }
  return userRooms;
}

/**
 * Build group context for AI (combines recent messages from all participants)
 */
function buildGroupContext(roomId, limit = 10) {
  const room = rooms.get(roomId);
  if (!room) return '';

  const recent = room.messages
    .filter((m) => m.type !== 'system')
    .slice(-limit)
    .map((m) => `[${m.name}]: ${m.content}`)
    .join('\n');

  const participants = getParticipantList(roomId)
    .map((p) => p.name)
    .join(', ');

  return `[SHARED SESSION — Participants: ${participants}]\n${recent}`;
}

/**
 * Update participant WebSocket reference
 */
function updateParticipantWs(roomId, userId, ws) {
  const room = rooms.get(roomId);
  if (!room) return;
  const participant = room.participants.get(userId);
  if (participant) {
    participant.ws = ws;
    participant.isOnline = true;
  }
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  sendMessage,
  broadcastToRoom,
  getParticipantList,
  getRoomInfo,
  listPublicRooms,
  getUserRooms,
  buildGroupContext,
  updateParticipantWs,
  rooms,
};
