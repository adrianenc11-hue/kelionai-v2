import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "./stripe-webhook";

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

// Always use standalone auth (email/password)
const isStandalone = true;

async function startServer() {
  const app = express();
  const server = createServer(app);
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

  // Stripe webhook - MUST be before express.json() for signature verification
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Auth routes - standalone or Manus OAuth
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
      const run = async (rawSql: string, label: string) => {
        try { await db.execute(sqlTag.raw(rawSql)); results.push(`OK: ${label}`); } catch (e: any) {
          const msg = e?.message || String(e);
          if (msg.includes('Duplicate') || msg.includes('ER_DUP_FIELDNAME') || msg.includes('already exists')) results.push(`SKIP: ${label}`);
          else results.push(`FAIL: ${label} - ${msg}`);
        }
      };
      // First, describe the users table to see what columns exist
      try {
        const [cols] = await db.execute(sqlTag.raw("SHOW COLUMNS FROM users"));
        results.push(`EXISTING COLUMNS: ${JSON.stringify(cols)}`);
      } catch (e: any) { results.push(`DESCRIBE FAIL: ${e.message}`); }
      // Add missing columns to users table (snake_case)
      await run("ALTER TABLE users ADD COLUMN open_id VARCHAR(64) NOT NULL DEFAULT ''", "users.open_id");
      await run("ALTER TABLE users ADD COLUMN password_hash TEXT", "users.password_hash");
      await run("ALTER TABLE users ADD COLUMN login_method VARCHAR(64)", "users.login_method");
      await run("ALTER TABLE users ADD COLUMN avatar_url TEXT", "users.avatar_url");
      await run("ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255)", "users.stripe_customer_id");
      await run("ALTER TABLE users ADD COLUMN stripe_subscription_id VARCHAR(255)", "users.stripe_subscription_id");
      await run("ALTER TABLE users ADD COLUMN subscription_tier ENUM('free','pro','enterprise') DEFAULT 'free' NOT NULL", "users.subscription_tier");
      await run("ALTER TABLE users ADD COLUMN subscription_status ENUM('active','cancelled','past_due','trialing') DEFAULT 'active'", "users.subscription_status");
      await run("ALTER TABLE users ADD COLUMN trial_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP", "users.trial_start_date");
      await run("ALTER TABLE users ADD COLUMN trial_expired TINYINT(1) DEFAULT 0", "users.trial_expired");
      await run("ALTER TABLE users ADD COLUMN subscription_start_date TIMESTAMP NULL", "users.subscription_start_date");
      await run("ALTER TABLE users ADD COLUMN billing_cycle VARCHAR(10) DEFAULT 'monthly'", "users.billing_cycle");
      await run("ALTER TABLE users ADD COLUMN referral_bonus_days INT DEFAULT 0", "users.referral_bonus_days");
      await run("ALTER TABLE users ADD COLUMN account_closed TINYINT(1) DEFAULT 0", "users.account_closed");
      await run("ALTER TABLE users ADD COLUMN account_closed_at TIMESTAMP NULL", "users.account_closed_at");
      await run("ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL", "users.created_at");
      await run("ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL", "users.updated_at");
      await run("ALTER TABLE users ADD COLUMN last_signed_in TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL", "users.last_signed_in");
      // Create tables with snake_case column names
      await run(`CREATE TABLE IF NOT EXISTS daily_usage (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        date VARCHAR(10) NOT NULL,
        minutes_used INT DEFAULT 0 NOT NULL,
        messages_count INT DEFAULT 0 NOT NULL,
        last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY unique_user_date (user_id, date)
      )`, "daily_usage table");
      await run(`CREATE TABLE IF NOT EXISTS referral_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        sender_user_id INT NOT NULL,
        recipient_email VARCHAR(320) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_by INT NULL,
        used_at TIMESTAMP NULL,
        bonus_applied TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`, "referral_codes table");
      await run(`CREATE TABLE IF NOT EXISTS refund_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        stripe_subscription_id VARCHAR(255),
        billing_cycle VARCHAR(10) NOT NULL,
        subscription_start_date TIMESTAMP NULL,
        months_elapsed INT DEFAULT 0,
        refund_amount DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'pending' NOT NULL,
        reason TEXT,
        admin_note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        resolved_at TIMESTAMP NULL
      )`, "refund_requests table");
      await run(`CREATE TABLE IF NOT EXISTS contact_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(320) NOT NULL,
        subject VARCHAR(500),
        message TEXT NOT NULL,
        ai_response TEXT,
        status VARCHAR(20) DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`, "contact_messages table");
      await run(`CREATE TABLE IF NOT EXISTS subscription_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        tier ENUM('free','pro','enterprise') NOT NULL,
        stripe_price_id VARCHAR(255),
        monthly_price DECIMAL(10,2),
        yearly_price DECIMAL(10,2),
        messages_per_month INT,
        voice_minutes_per_month INT,
        features JSON,
        message_limit INT,
        voice_minutes INT,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`, "subscription_plans table");
      await run(`CREATE TABLE IF NOT EXISTS user_cloned_voices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        voice_id VARCHAR(255) NOT NULL,
        voice_name VARCHAR(255) NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, "user_cloned_voices table");
      await run(`CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        stripe_payment_id VARCHAR(255),
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'eur',
        status VARCHAR(30) DEFAULT 'pending',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`, "payments table");
      // Insert subscription plans
      await run(`INSERT IGNORE INTO subscription_plans (name, tier, monthly_price, yearly_price, features, message_limit, voice_minutes) VALUES
        ('Pro', 'pro', 9.99, 99.90, '{"features": ["All features", "500 messages/month", "60 voice minutes"]}', 500, 60),
        ('Enterprise', 'enterprise', 29.99, 299.90, '{"features": ["Unlimited everything", "Priority support"]}', 999999, 999999)`, "subscription plans");
      res.json({ success: true, results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
  // Serve uploaded files (local storage fallback for standalone)
  app.use('/uploads', express.static('uploads'));

  // development mode uses Vite, production mode uses static files
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
