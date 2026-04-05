import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getUserLearningProfile, upsertUserLearningProfile } from "../db";

export const learningRouter = router({
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return await getUserLearningProfile(ctx.user.id);
  }),

  resetProfile: protectedProcedure.mutation(async ({ ctx }) => {
    await upsertUserLearningProfile(ctx.user.id, {
      detectedLevel: "casual",
      preferredLanguage: "en",
      interactionCount: 0,
      voiceInteractionCount: 0,
      topics: [],
      learningScore: 0,
    });
    return { success: true };
  }),
});
