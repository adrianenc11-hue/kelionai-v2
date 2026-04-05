import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";

// Detect if we're running standalone (no Manus OAuth configured)
const isStandalone = true; // Always use standalone auth (email/password)

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    if (isStandalone) {
      const { authenticateRequestStandalone } = await import("../standalone-auth");
      user = await authenticateRequestStandalone(opts.req);
    } else {
      const { sdk } = await import("./sdk");
      user = await sdk.authenticateRequest(opts.req);
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
