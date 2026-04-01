import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { chatRouter } from "./routers/chat";
import { subscriptionRouter } from "./routers/subscription";
import { adminRouter } from "./routers/admin";
import { voiceRouter } from "./routers/voice";
import { contactRouter } from "./routers/contact";
import { referralRouter } from "./routers/referral";
import { refundRouter } from "./routers/refund";
import { userChatRouter } from "./routers/userChat";
import { voiceLibraryRouter } from "./routers/voiceLibrary";
import { getTrialStatus, updateUserLanguage } from "./db";
import { z } from "zod";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  chat: chatRouter,
  subscription: subscriptionRouter,
  admin: adminRouter,
  voice: voiceRouter,
  contact: contactRouter,
  referral: referralRouter,
  refund: refundRouter,
  userChat: userChatRouter,
  voiceLibrary: voiceLibraryRouter,

  trial: router({
    getStatus: protectedProcedure.query(async ({ ctx }) => {
      return await getTrialStatus(ctx.user.id);
    }),
  }),

  profile: router({
    updateLanguage: protectedProcedure
      .input(z.object({ language: z.string().min(2).max(10) }))
      .mutation(async ({ ctx, input }) => {
        await updateUserLanguage(ctx.user.id, input.language);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
