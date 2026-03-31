import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { transcribeAudio } from "../_core/voiceTranscription";
import { generateSpeech, cloneVoice, getElevenLabsUsage, deleteClonedVoice } from "../elevenlabs";
import { getUserUsage, updateUserUsage, getDb } from "../db";
import { sql } from "drizzle-orm";

export const voiceRouter = router({
  /**
   * Transcribe audio file to text using Whisper API
   */
  transcribeAudio: protectedProcedure
    .input(
      z.object({
        audioUrl: z.string().url(),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const usage = await getUserUsage(ctx.user.id);
      const tier = ctx.user.subscriptionTier || "free";
      const limits: Record<string, number> = { free: 10, pro: 100, enterprise: 1000 };
      const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;

      if (voiceMinutesUsed >= limits[tier]) {
        throw new Error(`Voice usage limit reached for ${tier} tier`);
      }

      const result = await transcribeAudio({
        audioUrl: input.audioUrl,
        language: input.language,
      });

      const newVoiceMinutes = voiceMinutesUsed + 1;
      await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, newVoiceMinutes);

      const transcriptionResult = result as any;
      return {
        text: transcriptionResult.text || "",
        language: transcriptionResult.language || "en",
        duration: transcriptionResult.duration || 0,
      };
    }),

  /**
   * Generate speech from text using ElevenLabs TTS (REAL)
   */
  generateSpeech: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(5000),
        avatar: z.enum(["kelion", "kira"]).default("kelion"),
        useClonedVoice: z.boolean().default(false),
        quality: z.enum(["standard", "high", "ultra"]).default("high"),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const usage = await getUserUsage(ctx.user.id);
      const tier = ctx.user.subscriptionTier || "free";
      const limits: Record<string, number> = { free: 10, pro: 100, enterprise: 1000 };
      const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;

      if (voiceMinutesUsed >= limits[tier]) {
        throw new Error(`Voice usage limit reached for ${tier} tier`);
      }

      // Check if user has a cloned voice
      let customVoiceId: string | undefined;
      if (input.useClonedVoice) {
        const db = await getDb();
        if (db) {
          const rows = await db.execute(
            sql`SELECT voice_id FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = 1 LIMIT 1`
          );
          const result = rows as any;
          if (result?.[0]?.voice_id) {
            customVoiceId = result[0].voice_id;
          }
        }
      }

      // Generate real speech via ElevenLabs
      const { audioUrl, duration } = await generateSpeech({
        text: input.text,
        avatar: input.avatar,
        voiceId: customVoiceId,
        quality: input.quality,
        language: input.language,
      });

      // Update usage
      const estimatedMinutes = Math.max(1, Math.ceil(duration / 60));
      const newVoiceMinutes = voiceMinutesUsed + estimatedMinutes;
      await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, newVoiceMinutes);

      return { audioUrl, duration, avatar: input.avatar };
    }),

  /**
   * Clone user's voice - Step-by-step procedure from chat
   * Step 1: Upload recording
   * Step 2: Process with ElevenLabs
   * Step 3: Save voice ID per user
   */
  cloneVoice: protectedProcedure
    .input(
      z.object({
        audioBase64: z.string().min(1),
        voiceName: z.string().default("My Voice"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if ElevenLabs supports cloning
      const elUsage = await getElevenLabsUsage();
      if (!elUsage.canClone) {
        throw new Error("Voice cloning is not available on the current ElevenLabs plan");
      }

      // Convert base64 to buffer
      const audioBuffer = Buffer.from(input.audioBase64, "base64");

      // Clone voice with ElevenLabs
      const { voiceId, name } = await cloneVoice({
        audioBuffer,
        name: `${input.voiceName} - ${ctx.user.name || ctx.user.id}`,
        description: `Cloned voice for user ${ctx.user.name || ctx.user.id} on KelionAI`,
      });

      // Save to database
      const db = await getDb();
      if (db) {
        // Deactivate previous cloned voices
        await db.execute(
          sql`UPDATE user_cloned_voices SET is_active = 0 WHERE user_id = ${ctx.user.id}`
        );

        // Insert new cloned voice
        await db.execute(
          sql`INSERT INTO user_cloned_voices (user_id, voice_id, voice_name, is_active, created_at)
              VALUES (${ctx.user.id}, ${voiceId}, ${name}, 1, NOW())`
        );
      }

      return {
        success: true,
        voiceId,
        voiceName: name,
        message: "Voice cloned successfully! Your AI assistant will now use your voice.",
      };
    }),

  /**
   * Get user's cloned voice info
   */
  getClonedVoice: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { hasClonedVoice: false, voiceName: null, voiceId: null };

    const rows = await db.execute(
      sql`SELECT voice_id, voice_name, created_at FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = 1 LIMIT 1`
    );
    const result = rows as any;
    if (result?.[0]) {
      return {
        hasClonedVoice: true,
        voiceName: result[0].voice_name,
        voiceId: result[0].voice_id,
        createdAt: result[0].created_at,
      };
    }
    return { hasClonedVoice: false, voiceName: null, voiceId: null };
  }),

  /**
   * Delete user's cloned voice
   */
  deleteClonedVoice: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const rows = await db.execute(
      sql`SELECT voice_id FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = 1`
    );
    const result = rows as any;
    if (result?.[0]?.voice_id) {
      // Delete from ElevenLabs
      await deleteClonedVoice(result[0].voice_id);
      // Deactivate in DB
      await db.execute(
        sql`UPDATE user_cloned_voices SET is_active = 0 WHERE user_id = ${ctx.user.id}`
      );
    }

    return { success: true };
  }),

  /**
   * Get voice usage statistics
   */
  getVoiceUsage: protectedProcedure.query(async ({ ctx }) => {
    const usage = await getUserUsage(ctx.user.id);
    const tier = ctx.user.subscriptionTier || "free";
    const limits: Record<string, number> = { free: 10, pro: 100, enterprise: 1000 };
    const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
    const voiceMinutesLimit = limits[tier];

    // Also get ElevenLabs usage
    let elevenLabsUsage = { characterCount: 0, characterLimit: 0, canClone: false };
    try {
      elevenLabsUsage = await getElevenLabsUsage();
    } catch (_) { /* ignore */ }

    return {
      used: voiceMinutesUsed,
      limit: voiceMinutesLimit,
      remaining: Math.max(0, voiceMinutesLimit - voiceMinutesUsed),
      percentage: (voiceMinutesUsed / voiceMinutesLimit) * 100,
      elevenLabs: elevenLabsUsage,
    };
  }),
});
