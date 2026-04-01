import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { transcribeAudio } from "../_core/voiceTranscription";
import { generateSpeech, cloneVoice, getElevenLabsUsage, deleteClonedVoice } from "../elevenlabs";
import { getUserUsage, updateUserUsage, getDb, getTrialStatus, incrementDailyUsage } from "../db";
import { sql } from "drizzle-orm";
import { storagePut } from "../storage";

function randomSuffix() {
  return Math.random().toString(36).substring(2, 10);
}

/** Check if user can use features (trial + paid logic) */
async function checkAccess(userId: number, userRole?: string, subscriptionTier?: string) {
  // Admin always has access
  if (userRole === 'admin') return;
  // Paid users always have access
  if (subscriptionTier && subscriptionTier !== 'free') return;
  // Free users - check trial
  const trial = await getTrialStatus(userId);
  if (!trial.canUse) {
    throw new Error(trial.reason || "Trial expired or daily limit reached. Upgrade to continue.");
  }
}

export const voiceRouter = router({
  /**
   * Upload audio blob (base64) to S3, return URL for Whisper STT
   */
  uploadAudio: protectedProcedure
    .input(z.object({ audioBase64: z.string(), mimeType: z.string().default("audio/webm") }))
    .mutation(async ({ ctx, input }) => {
      await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);
      const buffer = Buffer.from(input.audioBase64, "base64");
      const ext = input.mimeType.includes("wav") ? "wav" : input.mimeType.includes("mp3") ? "mp3" : "webm";
      const key = `audio/${ctx.user.id}-${Date.now()}-${randomSuffix()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { audioUrl: url };
    }),

  /**
   * Upload image blob (base64) to S3, return URL for GPT vision
   */
  uploadImage: protectedProcedure
    .input(z.object({ imageBase64: z.string(), mimeType: z.string().default("image/jpeg") }))
    .mutation(async ({ ctx, input }) => {
      await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);
      const buffer = Buffer.from(input.imageBase64, "base64");
      const ext = input.mimeType.includes("png") ? "png" : "jpg";
      const key = `images/${ctx.user.id}-${Date.now()}-${randomSuffix()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { imageUrl: url };
    }),

  /**
   * Transcribe audio file to text using Whisper API
   */
  transcribeAudio: protectedProcedure
    .input(
      z.object({
        audioUrl: z.string().optional(),
        audioBase64: z.string().optional(),
        mimeType: z.string().optional(),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);

      // Support both direct buffer and URL-based transcription
      const transcribeOpts: any = {
        audioUrl: input.audioUrl || '',
        language: input.language,
      };
      
      // If base64 audio is provided, convert to buffer and pass directly
      if (input.audioBase64) {
        transcribeOpts.audioBuffer = Buffer.from(input.audioBase64, 'base64');
        transcribeOpts.audioMimeType = input.mimeType || 'audio/webm';
      }
      
      const result = await transcribeAudio(transcribeOpts);

      // Check if transcription returned an error
      if ('error' in result) {
        console.error('[Voice] Transcription error:', result);
        throw new Error(result.error + (result.details ? `: ${result.details}` : ''));
      }

      // Track daily usage (1 minute per transcription)
      await incrementDailyUsage(ctx.user.id, 1, 0);

      // Also update legacy monthly usage
      const usage = await getUserUsage(ctx.user.id);
      const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
      await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, voiceMinutesUsed + 1);

      return {
        text: result.text || "",
        language: result.language || "en",
        duration: result.duration || 0,
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
      await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);

      // Check if user has a cloned voice
      let customVoiceId: string | undefined;
      if (input.useClonedVoice) {
        const db = await getDb();
        if (db) {
          const rows = await db.execute(
            sql`SELECT voice_id FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true LIMIT 1`
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

      // Track daily usage
      const estimatedMinutes = Math.max(1, Math.ceil(duration / 60));
      await incrementDailyUsage(ctx.user.id, estimatedMinutes, 0);

      // Also update legacy monthly usage
      const usage = await getUserUsage(ctx.user.id);
      const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
      await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, voiceMinutesUsed + estimatedMinutes);

      return { audioUrl, duration, avatar: input.avatar };
    }),

  /**
   * Clone user's voice - Step-by-step procedure from chat
   */
  cloneVoice: protectedProcedure
    .input(
      z.object({
        audioBase64: z.string().min(1),
        voiceName: z.string().default("My Voice"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);

      const elUsage = await getElevenLabsUsage();
      if (!elUsage.canClone) {
        throw new Error("Voice cloning is not available on the current ElevenLabs plan");
      }

      const audioBuffer = Buffer.from(input.audioBase64, "base64");

      const { voiceId, name } = await cloneVoice({
        audioBuffer,
        name: `${input.voiceName} - ${ctx.user.name || ctx.user.id}`,
        description: `Cloned voice for user ${ctx.user.name || ctx.user.id} on KelionAI`,
      });

      const db = await getDb();
      if (db) {
        await db.execute(
          sql`UPDATE user_cloned_voices SET is_active = false WHERE user_id = ${ctx.user.id}`
        );
        await db.execute(
          sql`INSERT INTO user_cloned_voices (user_id, voice_id, voice_name, is_active, created_at)
              VALUES (${ctx.user.id}, ${voiceId}, ${name}, true, NOW())`
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
      sql`SELECT voice_id, voice_name, created_at FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true LIMIT 1`
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
      sql`SELECT voice_id FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true`
    );
    const result = rows as any;
    if (result?.[0]?.voice_id) {
      await deleteClonedVoice(result[0].voice_id);
      await db.execute(
        sql`UPDATE user_cloned_voices SET is_active = false WHERE user_id = ${ctx.user.id}`
      );
    }

    return { success: true };
  }),

  /**
   * Get voice usage statistics
   */
  getVoiceUsage: protectedProcedure.query(async ({ ctx }) => {
    const trial = await getTrialStatus(ctx.user.id);

    let elevenLabsUsage = { characterCount: 0, characterLimit: 0, canClone: false };
    try {
      elevenLabsUsage = await getElevenLabsUsage();
    } catch (_) { /* ignore */ }

    return {
      used: trial.dailyMinutesUsed,
      limit: trial.dailyMinutesLimit,
      remaining: Math.max(0, trial.dailyMinutesLimit - trial.dailyMinutesUsed),
      percentage: trial.dailyMinutesLimit > 0 ? (trial.dailyMinutesUsed / trial.dailyMinutesLimit) * 100 : 0,
      trialDaysLeft: trial.trialDaysLeft,
      canUse: trial.canUse,
      elevenLabs: elevenLabsUsage,
    };
  }),
});
