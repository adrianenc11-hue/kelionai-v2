/**
 * Standalone authentication - email/password based
 * Replaces Manus OAuth for independent Railway deployment
 */
import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import * as db from "./db";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import type { User } from "../drizzle/schema";

const SALT_ROUNDS = 12;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("FATAL: JWT_SECRET environment variable is not set. Server cannot start securely.");
  }
  return new TextEncoder().encode(secret);
}

async function createSessionToken(user: { id: number; openId: string; name: string | null }): Promise<string> {
  const secretKey = getJwtSecret();
  return new SignJWT({
    openId: user.openId,
    appId: "kelionai",
    name: user.name || "",
    userId: user.id,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
    .sign(secretKey);
}

export async function verifySessionStandalone(
  cookieValue: string | undefined | null
): Promise<{ openId: string; appId: string; name: string } | null> {
  if (!cookieValue) return null;
  try {
    const secretKey = getJwtSecret();
    const { payload } = await jwtVerify(cookieValue, secretKey, { algorithms: ["HS256"] });
    const { openId, appId, name } = payload as Record<string, unknown>;
    if (typeof openId !== "string" || !openId) return null;
    return { openId, appId: (appId as string) || "kelionai", name: (name as string) || "" };
  } catch {
    return null;
  }
}

export async function authenticateRequestStandalone(req: Request): Promise<User> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) throw new Error("No cookies");
  
  const cookies = new Map<string, string>();
  cookieHeader.split(";").forEach(c => {
    const [key, ...rest] = c.trim().split("=");
    if (key) cookies.set(key, rest.join("="));
  });
  
  const sessionCookie = cookies.get(COOKIE_NAME);
  const session = await verifySessionStandalone(sessionCookie);
  if (!session) throw new Error("Invalid session");
  
  const user = await db.getUserByOpenId(session.openId);
  if (!user) throw new Error("User not found");
  
  return user;
}

export function registerStandaloneAuthRoutes(app: Express) {
  // Register endpoint
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }
      
      if (password.length < 6) {
        res.status(400).json({ error: "Password must be at least 6 characters" });
        return;
      }
      
      // Check if user already exists
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      
      const existing = await dbInstance.select().from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }
      
      // Hash password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      
      // Create user with email as openId (for compatibility)
      const openId = `email_${email}`;
      await db.upsertUser({
        openId,
        name: name || email.split("@")[0],
        email,
        loginMethod: "email",
        lastSignedIn: new Date(),
      });
      
      // Set password hash
      await dbInstance.update(users).set({ passwordHash }).where(eq(users.openId, openId));
      
      // Get the created user
      const user = await db.getUserByOpenId(openId);
      if (!user) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }
      
      // Create session
      const sessionToken = await createSessionToken(user);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Register failed:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Registration failed", detail: errMsg });
    }
  });
  
  // Login endpoint
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }
      
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      
      // Find user by email
      const result = await dbInstance.select().from(users).where(eq(users.email, email)).limit(1);
      if (result.length === 0) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      
      const user = result[0];
      
      // Verify password
      if (!user.passwordHash) {
        res.status(401).json({ error: "This account uses social login. Please use the original login method." });
        return;
      }
      
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      
      // Update last signed in
      await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
      
      // Create session
      const sessionToken = await createSessionToken(user);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
  
  // Google OAuth callback (for future use)
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    // If Manus OAuth is configured, use it; otherwise redirect to login page
    const oauthServerUrl = process.env.OAUTH_SERVER_URL;
    if (oauthServerUrl) {
      // Manus OAuth flow - import dynamically
      try {
        const { registerOAuthRoutes } = await import("./_core/oauth");
        // Already registered, this shouldn't be called
        res.redirect("/");
      } catch {
        res.redirect("/login");
      }
    } else {
      res.redirect("/login");
    }
  });
}
