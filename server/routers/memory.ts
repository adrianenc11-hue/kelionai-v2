import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getUserMemories, deleteUserMemory, clearUserMemories } from "../db";

export const memoryRouter = router({
  getMemories: protectedProcedure.query(async ({ ctx }) => {
    return await getUserMemories(ctx.user.id);
  }),

  deleteMemory: protectedProcedure
    .input(z.object({ memoryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteUserMemory(input.memoryId, ctx.user.id);
      return { success: true };
    }),

  clearAll: protectedProcedure.mutation(async ({ ctx }) => {
    await clearUserMemories(ctx.user.id);
    return { success: true };
  }),
});
