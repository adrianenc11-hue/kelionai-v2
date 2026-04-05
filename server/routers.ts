import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { chatRouter } from "./routers/chat";
import { subscriptionRouter } from "./routers/subscription";
import { adminRouter } from "./routers/admin";
import { voiceRouter } from "./routers/voice";
import { contactRouter } from "./routers/contact";
import { memoryRouter } from "./routers/memory";
import { learningRouter } from "./routers/learning";
import { mediaRouter } from "./routers/media";

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
  memory: memoryRouter,
  learning: learningRouter,
  media: mediaRouter,
});

export type AppRouter = typeof appRouter;
