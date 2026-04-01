import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { userChatMessages, userChatRooms, userChatParticipants } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export const userChatRouter = router({
  createRoom: protectedProcedure
    .input(z.object({ targetUserId: z.number(), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const existingRooms = await db
        .select()
        .from(userChatRooms)
        .innerJoin(userChatParticipants, eq(userChatRooms.id, userChatParticipants.roomId))
        .where(and(eq(userChatRooms.type, "direct"), eq(userChatParticipants.userId, ctx.user.id)));

      for (const room of existingRooms) {
        const otherParticipant = await db
          .select()
          .from(userChatParticipants)
          .where(and(eq(userChatParticipants.roomId, room.user_chat_rooms.id), eq(userChatParticipants.userId, input.targetUserId)));
        if (otherParticipant.length > 0) {
          return { roomId: room.user_chat_rooms.id, existing: true };
        }
      }

      const [newRoom] = await db
        .insert(userChatRooms)
        .values({ name: input.name || "Direct Chat", type: "direct", createdBy: ctx.user.id })
        .returning();

      await db.insert(userChatParticipants).values([
        { roomId: newRoom.id, userId: ctx.user.id },
        { roomId: newRoom.id, userId: input.targetUserId },
      ]);

      return { roomId: newRoom.id, existing: false };
    }),

  createGroupRoom: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100), userIds: z.array(z.number()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const [newRoom] = await db
        .insert(userChatRooms)
        .values({ name: input.name, type: "group", createdBy: ctx.user.id })
        .returning();

      const allUserIds = [ctx.user.id, ...input.userIds.filter(id => id !== ctx.user.id)];
      await db.insert(userChatParticipants).values(allUserIds.map(userId => ({ roomId: newRoom.id, userId })));

      return { roomId: newRoom.id };
    }),

  getMyRooms: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return await db
      .select({ roomId: userChatRooms.id, roomName: userChatRooms.name, roomType: userChatRooms.type, createdAt: userChatRooms.createdAt })
      .from(userChatParticipants)
      .innerJoin(userChatRooms, eq(userChatParticipants.roomId, userChatRooms.id))
      .where(eq(userChatParticipants.userId, ctx.user.id))
      .orderBy(desc(userChatRooms.createdAt));
  }),

  sendMessage: protectedProcedure
    .input(z.object({ roomId: z.number(), content: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const participant = await db.select().from(userChatParticipants)
        .where(and(eq(userChatParticipants.roomId, input.roomId), eq(userChatParticipants.userId, ctx.user.id)));
      if (participant.length === 0) throw new Error("Not a participant in this room");

      const [message] = await db
        .insert(userChatMessages)
        .values({ roomId: input.roomId, senderId: ctx.user.id, content: input.content })
        .returning();
      return message;
    }),

  getMessages: protectedProcedure
    .input(z.object({ roomId: z.number(), limit: z.number().min(1).max(100).default(50), offset: z.number().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const participant = await db.select().from(userChatParticipants)
        .where(and(eq(userChatParticipants.roomId, input.roomId), eq(userChatParticipants.userId, ctx.user.id)));
      if (participant.length === 0) throw new Error("Not a participant in this room");

      const msgs = await db.select().from(userChatMessages)
        .where(eq(userChatMessages.roomId, input.roomId))
        .orderBy(desc(userChatMessages.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return msgs.reverse();
    }),
});
