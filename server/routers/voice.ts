import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { transcribeAudio } from "../_core/voiceTranscription";
import { invokeLLM } from "../_core/llm";
import { getUserUsage, updateUserUsage } from "../db";

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
      try {
        // Check voice usage limits
        const usage = await getUserUsage(ctx.user.id);
        const tier = ctx.user.subscriptionTier || "free";
        const limits: Record<string, number> = {
          free: 10,
          pro: 100,
          enterprise: 1000,
        };

        const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
        if (voiceMinutesUsed >= limits[tier]) {
          throw new Error(`Voice usage limit reached for ${tier} tier`);
        }

        // Transcribe audio
        const result = await transcribeAudio({
          audioUrl: input.audioUrl,
          language: input.language,
        });

        // Estimate minutes (rough: 1 minute of audio per 60KB)
        const estimatedMinutes = 1;

        // Update usage
        const newVoiceMinutes = voiceMinutesUsed + estimatedMinutes;
        await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, newVoiceMinutes);

        const transcriptionResult = result as any;
        return {
          text: transcriptionResult.text || "",
          language: transcriptionResult.language || "en",
          duration: transcriptionResult.duration || 0,
        };
      } catch (error) {
        console.error("[Voice] Transcription failed:", error);
        throw new Error("Failed to transcribe audio");
      }
    }),

  /**
   * Generate speech from text using TTS
   */
  generateSpeech: protectedProcedure
    .input(
      z.object({
        text: z.string(),
        voice: z.enum(["male", "female"]).optional(),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Check voice usage limits
        const usage = await getUserUsage(ctx.user.id);
        const tier = ctx.user.subscriptionTier || "free";
        const limits: Record<string, number> = {
          free: 10,
          pro: 100,
          enterprise: 1000,
        };

        const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
        if (voiceMinutesUsed >= limits[tier]) {
          throw new Error(`Voice usage limit reached for ${tier} tier`);
        }

        // For now, return a placeholder
        // In production, integrate with ElevenLabs or similar TTS service
        const estimatedMinutes = Math.ceil(input.text.length / 1000);

        // Update usage
        const newVoiceMinutes = voiceMinutesUsed + estimatedMinutes;
        await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, newVoiceMinutes);

        return {
          audioUrl: "https://example.com/audio.mp3", // Placeholder
          duration: estimatedMinutes * 60,
          voice: input.voice || "female",
        };
      } catch (error) {
        console.error("[Voice] TTS generation failed:", error);
        throw new Error("Failed to generate speech");
      }
    }),

  /**
   * Get voice usage statistics
   */
  getVoiceUsage: protectedProcedure.query(async ({ ctx }) => {
    try {
      const usage = await getUserUsage(ctx.user.id);
      const tier = ctx.user.subscriptionTier || "free";
      const limits: Record<string, number> = {
        free: 10,
        pro: 100,
        enterprise: 1000,
      };

      const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
      const voiceMinutesLimit = limits[tier];

      return {
        used: voiceMinutesUsed,
        limit: voiceMinutesLimit,
        remaining: Math.max(0, voiceMinutesLimit - voiceMinutesUsed),
        percentage: (voiceMinutesUsed / voiceMinutesLimit) * 100,
      };
    } catch (error) {
      console.error("[Voice] Failed to get usage:", error);
      throw error;
    }
  }),
});
