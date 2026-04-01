import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "./stripe-webhook";
import streamingRouter from "../streaming";
import { initSentry } from "../sentry";
import { WebSocketServer } from "../websocket-server";

initSentry();

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

const isStandalone = true;

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Initializeaza WebSocket Server
  const wsServer = new WebSocketServer(server);
  console.log("[WebSocket] Server initialized");

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
    next();
  });

  // CORS configuration
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });

  // Request logging
  app.use((req, _res, next) => {
    const start = Date.now();
    _res.on("finish", () => {
      const duration = Date.now() - start;
      if (req.path.startsWith("/api/")) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${_res.statusCode} ${duration}ms`);
      }
    });
    next();
  });

  // Stripe webhook
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Auth routes
  if (isStandalone) {
    console.log("[Auth] Running in STANDALONE mode (email/password)");
    const { registerStandaloneAuthRoutes } = await import("../standalone-auth");
    registerStandaloneAuthRoutes(app);
  } else {
    console.log("[Auth] Running with Manus OAuth");
    const { registerOAuthRoutes } = await import("./oauth");
    registerOAuthRoutes(app);
  }

  // Database diagnostic & migration endpoint
  app.get("/api/migrate", async (req, res) => {
    try {
      const { getDb } = await import("../db");
      const { sql: sqlTag } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) { res.status(500).json({ error: "No DB" }); return; }
      const results: string[] = [];

      try {
        const testResult = await db.execute(sqlTag.raw("SELECT current_database(), version()"));
        results.push(`Connected to PostgreSQL: ${JSON.stringify(testResult[0])}`);
      } catch (e: any) {
        results.push(`Connection test failed: ${e.message}`);
      }

      try {
        await db.execute(sqlTag.raw("UPDATE users SET role = 'admin' WHERE email = 'adrianenc11@gmail.com'"));
        results.push("OK: set admin role for adrianenc11@gmail.com");
      } catch (e: any) {
        results.push(`Admin role: ${e.message}`);
      }

      try {
        await db.execute(sqlTag.raw(`
          INSERT INTO subscription_plans (name, tier, monthly_price, yearly_price, features, message_limit, voice_minutes)
          SELECT 'Pro', 'pro', 9.99, 99.90, '{"features": ["All features", "500 messages/month", "60 voice minutes"]}', 500, 60
          WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE tier = 'pro')
        `));
        await db.execute(sqlTag.raw(`
          INSERT INTO subscription_plans (name, tier, monthly_price, yearly_price, features, message_limit, voice_minutes)
          SELECT 'Enterprise', 'enterprise', 29.99, 299.90, '{"features": ["Unlimited everything", "Priority support"]}', 999999, 999999
          WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE tier = 'enterprise')
        `));
        results.push("OK: subscription plans");
      } catch (e: any) {
        results.push(`Subscription plans: ${e.message}`);
      }

      res.json({ success: true, results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Profile avatar update endpoint
  app.post("/api/profile/avatar", async (req, res) => {
    try {
      const { updateUserProfilePicture } = await import("../db");
      const { jwtVerify } = await import("jose");
      const cookieName = "app_session_id";
      const cookies = req.headers.cookie?.split(";").reduce((acc: any, c: string) => {
        const [k, v] = c.trim().split("=");
        acc[k] = v;
        return acc;
      }, {} as Record<string, string>) || {};
      const token = cookies[cookieName];
      if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");
      const { payload } = await jwtVerify(token, secret);
      const userId = (payload as any).userId || (payload as any).id;
      if (!userId) { res.status(401).json({ error: "Invalid token" }); return; }
      const { avatarUrl } = req.body;
      if (!avatarUrl) { res.status(400).json({ error: "avatarUrl required" }); return; }
      await updateUserProfilePicture(userId, avatarUrl);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  app.use('/uploads', express.static('uploads'));
  app.use(streamingRouter);

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
