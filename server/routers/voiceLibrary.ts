import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { voiceLibrary } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export const voiceLibraryRouter = router({
  // Get all voices for the current user
  getMyVoices: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return await db.select().from(voiceLibrary)
      .where(eq(voiceLibrary.userId, ctx.user.id))
      .orderBy(desc(voiceLibrary.createdAt));
  }),

  // Add a new voice to the library
  addVoice: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      voiceId: z.string().min(1),
      provider: z.string().default("elevenlabs"),
      sampleUrl: z.string().optional(),
      quality: z.string().default("standard"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const [voice] = await db.insert(voiceLibrary).values({
        userId: ctx.user.id,
        name: input.name,
        voiceId: input.voiceId,
        provider: input.provider,
        sampleUrl: input.sampleUrl || null,
        quality: input.quality,
      }).returning();
      return voice;
    }),

  // Set a voice as default
  setDefault: protectedProcedure
    .input(z.object({ voiceId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      // Unset all defaults for this user
      await db.update(voiceLibrary)
        .set({ isDefault: false })
        .where(eq(voiceLibrary.userId, ctx.user.id));
      // Set the selected voice as default
      await db.update(voiceLibrary)
        .set({ isDefault: true })
        .where(and(eq(voiceLibrary.id, input.voiceId), eq(voiceLibrary.userId, ctx.user.id)));
      return { success: true };
    }),

  // Toggle public visibility (for marketplace)
  togglePublic: protectedProcedure
    .input(z.object({ voiceId: z.number(), isPublic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await db.update(voiceLibrary)
        .set({ isPublic: input.isPublic })
        .where(and(eq(voiceLibrary.id, input.voiceId), eq(voiceLibrary.userId, ctx.user.id)));
      return { success: true };
    }),

  // Delete a voice
  deleteVoice: protectedProcedure
    .input(z.object({ voiceId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await db.delete(voiceLibrary)
        .where(and(eq(voiceLibrary.id, input.voiceId), eq(voiceLibrary.userId, ctx.user.id)));
      return { success: true };
    }),

  // Browse public voices (marketplace)
  browsePublic: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const db = await requireDb();
      return await db.select().from(voiceLibrary)
        .where(eq(voiceLibrary.isPublic, true))
        .orderBy(desc(voiceLibrary.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),
});
