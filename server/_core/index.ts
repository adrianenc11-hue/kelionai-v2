import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import rateLimit from "express-rate-limit";
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

  // CORS configuration - whitelist allowed origins
  const ALLOWED_ORIGINS = new Set([
    "https://kelionai.app",
    "https://www.kelionai.app",
    "https://kelionai-v2-production.up.railway.app",
    ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000", "http://localhost:5173"] : []),
  ]);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
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

  // Rate limiting
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // max 20 login/register attempts per 15 min
    message: { error: "Too many authentication attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // max 60 API requests per minute
    message: { error: "Too many requests. Please slow down." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const chatLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 15, // max 15 chat messages per minute
    message: { error: "Too many messages. Please wait a moment." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use("/api/auth/", authLimiter);
  app.use("/api/chat/stream", chatLimiter);
  app.use("/api/trpc", apiLimiter);

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

  // Database diagnostic & migration endpoint (admin-only via secret token or session)
  app.get("/api/migrate", async (req, res) => {
    try {
      // Auth: require MIGRATE_SECRET token or admin session
      const migrateSecret = process.env.MIGRATE_SECRET;
      const providedSecret = req.query.secret as string;
      let isAuthorized = false;

      if (migrateSecret && providedSecret === migrateSecret) {
        isAuthorized = true;
      } else {
        try {
          const { authenticateRequestStandalone } = await import("../standalone-auth");
          const user = await authenticateRequestStandalone(req);
          if (user.role === "admin") isAuthorized = true;
        } catch {}
      }

      if (!isAuthorized) {
        res.status(403).json({ error: "Forbidden: admin access or MIGRATE_SECRET required" });
        return;
      }

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
      const { authenticateRequestStandalone } = await import("../standalone-auth");
      const user = await authenticateRequestStandalone(req);
      const { avatarUrl } = req.body;
      if (!avatarUrl) { res.status(400).json({ error: "avatarUrl required" }); return; }
      await updateUserProfilePicture(user.id, avatarUrl);
      res.json({ success: true });
    } catch (err: any) {
      res.status(401).json({ error: err.message || "Not authenticated" });
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
