var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// shared/const.ts
var COOKIE_NAME, ONE_YEAR_MS, AXIOS_TIMEOUT_MS, UNAUTHED_ERR_MSG, NOT_ADMIN_ERR_MSG;
var init_const = __esm({
  "shared/const.ts"() {
    "use strict";
    COOKIE_NAME = "app_session_id";
    ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
    AXIOS_TIMEOUT_MS = 3e4;
    UNAUTHED_ERR_MSG = "Please login (10001)";
    NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
  }
});

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  const secure = isSecureRequest(req);
  const isStandalone3 = true;
  return {
    httpOnly: true,
    path: "/",
    sameSite: isStandalone3 ? "lax" : "none",
    secure: isStandalone3 ? secure : true
  };
}
var init_cookies = __esm({
  "server/_core/cookies.ts"() {
    "use strict";
  }
});

// server/_core/env.ts
function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`[ENV] Missing required environment variable: ${key}`);
  return val;
}
function optional(key, fallback = "") {
  return process.env[key] ?? fallback;
}
var ENV;
var init_env = __esm({
  "server/_core/env.ts"() {
    "use strict";
    ENV = {
      // Auth
      jwtSecret: required("JWT_SECRET"),
      // Database
      databaseUrl: optional("DATABASE_URL"),
      supabaseUrl: optional("SUPABASE_URL"),
      supabaseAnonKey: optional("SUPABASE_ANON_KEY"),
      supabaseServiceKey: optional("SUPABASE_SERVICE_KEY"),
      // OpenAI
      openaiApiKey: optional("OPENAI_API_KEY"),
      openaiModel: optional("OPENAI_MODEL", "gpt-5.4-pro"),
      openaiBaseUrl: optional("OPENAI_BASE_URL", "https://api.openai.com/v1"),
      openaiTranscribeModel: optional("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
      // ElevenLabs
      elevenLabsApiKey: optional("ELEVENLABS_API_KEY"),
      elevenLabsVoiceKelion: optional("ELEVENLABS_VOICE_KELION", "VR6AewLTigWG4xSOukaG"),
      elevenLabsVoiceKira: optional("ELEVENLABS_VOICE_KIRA", "EXAVITQu4vr4xnSDxMaL"),
      // Stripe
      stripeSecretKey: optional("STRIPE_SECRET_KEY"),
      stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
      // Frontend
      frontendUrl: optional("FRONTEND_URL", process.env.NODE_ENV === "production" ? "" : "http://localhost:5173"),
      // AWS S3
      s3Bucket: optional("S3_BUCKET"),
      s3Region: optional("S3_REGION", "us-east-1"),
      awsAccessKeyId: optional("AWS_ACCESS_KEY_ID"),
      awsSecretAccessKey: optional("AWS_SECRET_ACCESS_KEY"),
      // Manus (legacy, optional)
      forgeApiUrl: optional("BUILT_IN_FORGE_API_URL"),
      forgeApiKey: optional("BUILT_IN_FORGE_API_KEY"),
      appId: optional("VITE_APP_ID"),
      ownerOpenId: optional("OWNER_OPEN_ID"),
      oAuthServerUrl: optional("OAUTH_SERVER_URL"),
      // Runtime
      isProduction: process.env.NODE_ENV === "production",
      nodeEnv: optional("NODE_ENV", "development")
    };
  }
});

// drizzle/schema.ts
import { integer, pgEnum, pgTable, text, timestamp, varchar, boolean, numeric, json, serial } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var roleEnum, subscriptionTierEnum, subscriptionStatusEnum, messageRoleEnum, aiProviderEnum, users, conversations, messages, subscriptionPlans, userUsage, aiProviders, userMemories, userLearningProfiles, userPreferences, usersRelations, conversationsRelations, messagesRelations, userUsageRelations;
var init_schema = __esm({
  "drizzle/schema.ts"() {
    "use strict";
    roleEnum = pgEnum("role", ["user", "admin"]);
    subscriptionTierEnum = pgEnum("subscription_tier", ["free", "pro", "enterprise"]);
    subscriptionStatusEnum = pgEnum("subscription_status", ["active", "cancelled", "past_due", "trialing"]);
    messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
    aiProviderEnum = pgEnum("ai_provider", ["openai", "google", "groq", "anthropic", "deepseek"]);
    users = pgTable("users", {
      id: serial("id").primaryKey(),
      openId: varchar("open_id", { length: 64 }).notNull().unique(),
      name: text("name"),
      email: varchar("email", { length: 320 }),
      passwordHash: text("password_hash"),
      loginMethod: varchar("login_method", { length: 64 }),
      role: roleEnum("role").default("user").notNull(),
      avatarUrl: text("avatar_url"),
      stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
      stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
      subscriptionTier: subscriptionTierEnum("subscription_tier").default("free").notNull(),
      subscriptionStatus: subscriptionStatusEnum("subscription_status").default("active"),
      language: varchar("language", { length: 10 }).default("en"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull(),
      lastSignedIn: timestamp("last_signed_in").defaultNow().notNull()
    });
    conversations = pgTable("conversations", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      title: text("title"),
      description: text("description"),
      primaryAiModel: varchar("primary_ai_model", { length: 50 }).default("gpt-5.4-pro"),
      isArchived: boolean("is_archived").default(false),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    messages = pgTable("messages", {
      id: serial("id").primaryKey(),
      conversationId: integer("conversation_id").notNull(),
      role: messageRoleEnum("role").notNull(),
      content: text("content"),
      aiModel: varchar("ai_model", { length: 50 }),
      tokens: integer("tokens"),
      metadata: json("metadata"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    subscriptionPlans = pgTable("subscription_plans", {
      id: serial("id").primaryKey(),
      name: varchar("name", { length: 100 }).notNull(),
      tier: subscriptionTierEnum("tier").notNull(),
      stripePriceId: varchar("stripe_price_id", { length: 255 }).notNull(),
      monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }),
      yearlyPrice: numeric("yearly_price", { precision: 10, scale: 2 }),
      messagesPerMonth: integer("messages_per_month"),
      voiceMinutesPerMonth: integer("voice_minutes_per_month"),
      features: json("features"),
      isActive: boolean("is_active").default(true),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    userUsage = pgTable("user_usage", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      messagesThisMonth: integer("messages_this_month").default(0),
      voiceMinutesThisMonth: integer("voice_minutes_this_month").default(0),
      lastResetDate: timestamp("last_reset_date").defaultNow(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    aiProviders = pgTable("ai_providers", {
      id: serial("id").primaryKey(),
      name: varchar("name", { length: 50 }).notNull(),
      provider: aiProviderEnum("provider").notNull(),
      model: varchar("model", { length: 100 }).notNull(),
      isActive: boolean("is_active").default(true),
      priority: integer("priority").default(0),
      metadata: json("metadata"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    userMemories = pgTable("user_memories", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      key: varchar("key", { length: 255 }).notNull(),
      value: text("value").notNull(),
      importance: integer("importance").default(1),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    userLearningProfiles = pgTable("user_learning_profiles", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull().unique(),
      detectedLevel: varchar("detected_level", { length: 50 }).default("casual"),
      preferredLanguage: varchar("preferred_language", { length: 10 }).default("en"),
      preferredAvatar: varchar("preferred_avatar", { length: 10 }).default("kelion"),
      interactionCount: integer("interaction_count").default(0),
      voiceInteractionCount: integer("voice_interaction_count").default(0),
      topics: json("topics").$type().default([]),
      learningScore: integer("learning_score").default(0),
      lastUpdated: timestamp("last_updated").defaultNow().notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    userPreferences = pgTable("user_preferences", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull().unique(),
      theme: varchar("theme", { length: 10 }).default("dark"),
      language: varchar("language", { length: 10 }).default("en"),
      selectedAvatar: varchar("selected_avatar", { length: 10 }).default("kelion"),
      voiceEnabled: boolean("voice_enabled").default(true),
      cameraEnabled: boolean("camera_enabled").default(false),
      streamingEnabled: boolean("streaming_enabled").default(true),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    usersRelations = relations(users, ({ many }) => ({
      conversations: many(conversations),
      usage: many(userUsage)
    }));
    conversationsRelations = relations(conversations, ({ one, many }) => ({
      user: one(users, {
        fields: [conversations.userId],
        references: [users.id]
      }),
      messages: many(messages)
    }));
    messagesRelations = relations(messages, ({ one }) => ({
      conversation: one(conversations, {
        fields: [messages.conversationId],
        references: [conversations.id]
      })
    }));
    userUsageRelations = relations(userUsage, ({ one }) => ({
      user: one(users, {
        fields: [userUsage.userId],
        references: [users.id]
      })
    }));
  }
});

// server/db.ts
var db_exports = {};
__export(db_exports, {
  clearUserMemories: () => clearUserMemories,
  createConversation: () => createConversation,
  createMessage: () => createMessage,
  deleteConversationMessages: () => deleteConversationMessages,
  deleteMessage: () => deleteMessage,
  deleteUserMemory: () => deleteUserMemory,
  getConversationById: () => getConversationById,
  getConversationsByUserId: () => getConversationsByUserId,
  getDb: () => getDb,
  getMessageById: () => getMessageById,
  getMessagesByConversationId: () => getMessagesByConversationId,
  getSubscriptionPlans: () => getSubscriptionPlans,
  getUserByOpenId: () => getUserByOpenId,
  getUserLearningProfile: () => getUserLearningProfile,
  getUserMemories: () => getUserMemories,
  getUserPreferences: () => getUserPreferences,
  getUserUsage: () => getUserUsage,
  saveUserMemory: () => saveUserMemory,
  updateMessage: () => updateMessage,
  updateUserProfilePicture: () => updateUserProfilePicture,
  updateUserUsage: () => updateUserUsage,
  upsertUser: () => upsertUser,
  upsertUserLearningProfile: () => upsertUserLearningProfile,
  upsertUserPreferences: () => upsertUserPreferences
});
import { eq, desc, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
async function getDb() {
  if (!_db) {
    const url = ENV.databaseUrl;
    if (!url) return null;
    try {
      const client = postgres(url, { ssl: { rejectUnauthorized: false } });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = { openId: user.openId };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) values.lastSignedIn = /* @__PURE__ */ new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getConversationsByUserId(userId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
  } catch (error) {
    console.error("[Database] Failed to get conversations:", error);
    return [];
  }
}
async function getConversationById(conversationId) {
  const db = await getDb();
  if (!db) return void 0;
  try {
    const result = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    return result.length > 0 ? result[0] : void 0;
  } catch (error) {
    console.error("[Database] Failed to get conversation:", error);
    return void 0;
  }
}
async function createConversation(userId, title) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const result = await db.insert(conversations).values({ userId, title, primaryAiModel: ENV.openaiModel }).returning();
    return result[0];
  } catch (error) {
    console.error("[Database] Failed to create conversation:", error);
    throw error;
  }
}
async function getMessagesByConversationId(conversationId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
  } catch (error) {
    console.error("[Database] Failed to get messages:", error);
    return [];
  }
}
async function createMessage(conversationId, role, content, aiModel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const result = await db.insert(messages).values({ conversationId, role, content, aiModel }).returning();
    return result[0];
  } catch (error) {
    console.error("[Database] Failed to create message:", error);
    throw error;
  }
}
async function getSubscriptionPlans() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.isActive, true));
  } catch (error) {
    console.error("[Database] Failed to get subscription plans:", error);
    return [];
  }
}
async function getUserUsage(userId) {
  const db = await getDb();
  if (!db) return void 0;
  try {
    const result = await db.select().from(userUsage).where(eq(userUsage.userId, userId)).limit(1);
    return result.length > 0 ? result[0] : void 0;
  } catch (error) {
    console.error("[Database] Failed to get user usage:", error);
    return void 0;
  }
}
async function updateMessage(messageId, content) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(messages).set({ content }).where(eq(messages.id, messageId));
  return { success: true };
}
async function deleteMessage(messageId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(messages).where(eq(messages.id, messageId));
  return { success: true };
}
async function getMessageById(messageId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function deleteConversationMessages(conversationId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(messages).where(eq(messages.conversationId, conversationId));
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  return { success: true };
}
async function updateUserProfilePicture(userId, avatarUrl) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ avatarUrl }).where(eq(users.id, userId));
  return { success: true };
}
async function updateUserUsage(userId, messagesThisMonth, voiceMinutesThisMonth) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const usage = await getUserUsage(userId);
  if (usage) {
    await db.update(userUsage).set({ messagesThisMonth, voiceMinutesThisMonth }).where(eq(userUsage.userId, userId));
  } else {
    await db.insert(userUsage).values({ userId, messagesThisMonth, voiceMinutesThisMonth });
  }
}
async function getUserMemories(userId) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(userMemories).where(eq(userMemories.userId, userId)).orderBy(desc(userMemories.updatedAt));
}
async function saveUserMemory(userId, key, value, importance = 1) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(userMemories).where(eq(userMemories.userId, userId)).then((rows) => rows.find((r) => r.key === key));
  if (existing) {
    await db.update(userMemories).set({ value, importance, updatedAt: /* @__PURE__ */ new Date() }).where(eq(userMemories.id, existing.id));
  } else {
    await db.insert(userMemories).values({ userId, key, value, importance });
  }
}
async function deleteUserMemory(memoryId, userId) {
  const db = await getDb();
  if (!db) return;
  await db.delete(userMemories).where(eq(userMemories.id, memoryId));
}
async function clearUserMemories(userId) {
  const db = await getDb();
  if (!db) return;
  await db.delete(userMemories).where(eq(userMemories.userId, userId));
}
async function getUserLearningProfile(userId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(userLearningProfiles).where(eq(userLearningProfiles.userId, userId)).limit(1);
  return result[0] || null;
}
async function upsertUserLearningProfile(userId, data) {
  const db = await getDb();
  if (!db) return;
  const existing = await getUserLearningProfile(userId);
  if (existing) {
    await db.update(userLearningProfiles).set({ ...data, lastUpdated: /* @__PURE__ */ new Date() }).where(eq(userLearningProfiles.userId, userId));
  } else {
    await db.insert(userLearningProfiles).values({ userId, ...data });
  }
}
async function getUserPreferences(userId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return result[0] || null;
}
async function upsertUserPreferences(userId, data) {
  const db = await getDb();
  if (!db) return;
  const existing = await getUserPreferences(userId);
  if (existing) {
    await db.update(userPreferences).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(userPreferences.userId, userId));
  } else {
    await db.insert(userPreferences).values({ userId, ...data });
  }
}
var _db;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    init_schema();
    init_env();
    _db = null;
  }
});

// shared/_core/errors.ts
var HttpError, ForbiddenError;
var init_errors = __esm({
  "shared/_core/errors.ts"() {
    "use strict";
    HttpError = class extends Error {
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = "HttpError";
      }
    };
    ForbiddenError = (msg) => new HttpError(403, msg);
  }
});

// server/_core/sdk.ts
var sdk_exports = {};
__export(sdk_exports, {
  sdk: () => sdk
});
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString2, EXCHANGE_TOKEN_PATH, GET_USER_INFO_PATH, GET_USER_INFO_WITH_JWT_PATH, OAuthService, createOAuthHttpClient, SDKServer, sdk;
var init_sdk = __esm({
  "server/_core/sdk.ts"() {
    "use strict";
    init_const();
    init_errors();
    init_db();
    init_env();
    isNonEmptyString2 = (value) => typeof value === "string" && value.length > 0;
    EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
    GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
    GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
    OAuthService = class {
      constructor(client) {
        this.client = client;
        console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
        if (!ENV.oAuthServerUrl) {
          console.error(
            "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
          );
        }
      }
      decodeState(state) {
        const redirectUri = atob(state);
        return redirectUri;
      }
      async getTokenByCode(code, state) {
        const payload = {
          clientId: ENV.appId,
          grantType: "authorization_code",
          code,
          redirectUri: this.decodeState(state)
        };
        const { data } = await this.client.post(
          EXCHANGE_TOKEN_PATH,
          payload
        );
        return data;
      }
      async getUserInfoByToken(token) {
        const { data } = await this.client.post(
          GET_USER_INFO_PATH,
          {
            accessToken: token.accessToken
          }
        );
        return data;
      }
    };
    createOAuthHttpClient = () => axios.create({
      baseURL: ENV.oAuthServerUrl,
      timeout: AXIOS_TIMEOUT_MS
    });
    SDKServer = class {
      client;
      oauthService;
      constructor(client = createOAuthHttpClient()) {
        this.client = client;
        this.oauthService = new OAuthService(this.client);
      }
      deriveLoginMethod(platforms, fallback) {
        if (fallback && fallback.length > 0) return fallback;
        if (!Array.isArray(platforms) || platforms.length === 0) return null;
        const set = new Set(
          platforms.filter((p) => typeof p === "string")
        );
        if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
        if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
        if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
        if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
          return "microsoft";
        if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
        const first = Array.from(set)[0];
        return first ? first.toLowerCase() : null;
      }
      /**
       * Exchange OAuth authorization code for access token
       * @example
       * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
       */
      async exchangeCodeForToken(code, state) {
        return this.oauthService.getTokenByCode(code, state);
      }
      /**
       * Get user information using access token
       * @example
       * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
       */
      async getUserInfo(accessToken) {
        const data = await this.oauthService.getUserInfoByToken({
          accessToken
        });
        const loginMethod = this.deriveLoginMethod(
          data?.platforms,
          data?.platform ?? data.platform ?? null
        );
        return {
          ...data,
          platform: loginMethod,
          loginMethod
        };
      }
      parseCookies(cookieHeader) {
        if (!cookieHeader) {
          return /* @__PURE__ */ new Map();
        }
        const parsed = parseCookieHeader(cookieHeader);
        return new Map(Object.entries(parsed));
      }
      getSessionSecret() {
        const secret = ENV.jwtSecret;
        return new TextEncoder().encode(secret);
      }
      /**
       * Create a session token for a Manus user openId
       * @example
       * const sessionToken = await sdk.createSessionToken(userInfo.openId);
       */
      async createSessionToken(openId, options = {}) {
        return this.signSession(
          {
            openId,
            appId: ENV.appId,
            name: options.name || ""
          },
          options
        );
      }
      async signSession(payload, options = {}) {
        const issuedAt = Date.now();
        const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
        const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
        const secretKey = this.getSessionSecret();
        return new SignJWT({
          openId: payload.openId,
          appId: payload.appId,
          name: payload.name
        }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
      }
      async verifySession(cookieValue) {
        if (!cookieValue) {
          console.warn("[Auth] Missing session cookie");
          return null;
        }
        try {
          const secretKey = this.getSessionSecret();
          const { payload } = await jwtVerify(cookieValue, secretKey, {
            algorithms: ["HS256"]
          });
          const { openId, appId, name } = payload;
          if (!isNonEmptyString2(openId) || !isNonEmptyString2(appId) || !isNonEmptyString2(name)) {
            console.warn("[Auth] Session payload missing required fields");
            return null;
          }
          return {
            openId,
            appId,
            name
          };
        } catch (error) {
          console.warn("[Auth] Session verification failed", String(error));
          return null;
        }
      }
      async getUserInfoWithJwt(jwtToken) {
        const payload = {
          jwtToken,
          projectId: ENV.appId
        };
        const { data } = await this.client.post(
          GET_USER_INFO_WITH_JWT_PATH,
          payload
        );
        const loginMethod = this.deriveLoginMethod(
          data?.platforms,
          data?.platform ?? data.platform ?? null
        );
        return {
          ...data,
          platform: loginMethod,
          loginMethod
        };
      }
      async authenticateRequest(req) {
        const cookies = this.parseCookies(req.headers.cookie);
        const sessionCookie = cookies.get(COOKIE_NAME);
        const session = await this.verifySession(sessionCookie);
        if (!session) {
          throw ForbiddenError("Invalid session cookie");
        }
        const sessionUserId = session.openId;
        const signedInAt = /* @__PURE__ */ new Date();
        let user = await getUserByOpenId(sessionUserId);
        if (!user) {
          try {
            const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
            await upsertUser({
              openId: userInfo.openId,
              name: userInfo.name || null,
              email: userInfo.email ?? null,
              loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
              lastSignedIn: signedInAt
            });
            user = await getUserByOpenId(userInfo.openId);
          } catch (error) {
            console.error("[Auth] Failed to sync user from OAuth:", error);
            throw ForbiddenError("Failed to sync user info");
          }
        }
        if (!user) {
          throw ForbiddenError("User not found");
        }
        await upsertUser({
          openId: user.openId,
          lastSignedIn: signedInAt
        });
        return user;
      }
    };
    sdk = new SDKServer();
  }
});

// server/_core/oauth.ts
var oauth_exports = {};
__export(oauth_exports, {
  registerOAuthRoutes: () => registerOAuthRoutes
});
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
var init_oauth = __esm({
  "server/_core/oauth.ts"() {
    "use strict";
    init_const();
    init_db();
    init_cookies();
    init_sdk();
  }
});

// server/standalone-auth.ts
var standalone_auth_exports = {};
__export(standalone_auth_exports, {
  authenticateRequestStandalone: () => authenticateRequestStandalone,
  registerStandaloneAuthRoutes: () => registerStandaloneAuthRoutes,
  verifySessionStandalone: () => verifySessionStandalone
});
import bcrypt from "bcryptjs";
import { SignJWT as SignJWT2, jwtVerify as jwtVerify2 } from "jose";
import { eq as eq3 } from "drizzle-orm";
function getJwtSecret() {
  const secret = ENV.jwtSecret;
  return new TextEncoder().encode(secret);
}
async function createSessionToken(user) {
  const secretKey = getJwtSecret();
  return new SignJWT2({
    openId: user.openId,
    appId: "kelionai",
    name: user.name || "",
    userId: user.id
  }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1e3)).sign(secretKey);
}
async function verifySessionStandalone(cookieValue) {
  if (!cookieValue) return null;
  try {
    const secretKey = getJwtSecret();
    const { payload } = await jwtVerify2(cookieValue, secretKey, { algorithms: ["HS256"] });
    const { openId, appId, name } = payload;
    if (typeof openId !== "string" || !openId) return null;
    return { openId, appId: appId || "kelionai", name: name || "" };
  } catch {
    return null;
  }
}
async function authenticateRequestStandalone(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) throw new Error("No cookies");
  const cookies = /* @__PURE__ */ new Map();
  cookieHeader.split(";").forEach((c) => {
    const [key, ...rest] = c.trim().split("=");
    if (key) cookies.set(key, rest.join("="));
  });
  const sessionCookie = cookies.get(COOKIE_NAME);
  const session = await verifySessionStandalone(sessionCookie);
  if (!session) throw new Error("Invalid session");
  const user = await getUserByOpenId(session.openId);
  if (!user) throw new Error("User not found");
  return user;
}
function registerStandaloneAuthRoutes(app) {
  app.post("/api/auth/register", async (req, res) => {
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
      const dbInstance = await getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      const existing = await dbInstance.select().from(users).where(eq3(users.email, email)).limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const openId = `email_${email}`;
      await upsertUser({
        openId,
        name: name || email.split("@")[0],
        email,
        loginMethod: "email",
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      await dbInstance.update(users).set({ passwordHash }).where(eq3(users.openId, openId));
      const user = await getUserByOpenId(openId);
      if (!user) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }
      const sessionToken = await createSessionToken(user);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Register failed:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }
      const dbInstance = await getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      const result = await dbInstance.select().from(users).where(eq3(users.email, email)).limit(1);
      if (result.length === 0) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const user = result[0];
      if (!user.passwordHash) {
        res.status(401).json({ error: "This account uses social login. Please use the original login method." });
        return;
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      await upsertUser({ openId: user.openId, lastSignedIn: /* @__PURE__ */ new Date() });
      const sessionToken = await createSessionToken(user);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
  app.get("/api/oauth/callback", async (req, res) => {
    const oauthServerUrl = process.env.OAUTH_SERVER_URL;
    if (oauthServerUrl) {
      try {
        const { registerOAuthRoutes: registerOAuthRoutes2 } = await Promise.resolve().then(() => (init_oauth(), oauth_exports));
        res.redirect("/");
      } catch {
        res.redirect("/login");
      }
    } else {
      res.redirect("/login");
    }
  });
}
var SALT_ROUNDS;
var init_standalone_auth = __esm({
  "server/standalone-auth.ts"() {
    "use strict";
    init_const();
    init_cookies();
    init_db();
    init_schema();
    init_env();
    SALT_ROUNDS = 12;
  }
});

// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/routers.ts
init_const();
init_cookies();

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
init_env();
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
init_const();
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers/chat.ts
import { z as z2 } from "zod";
init_db();

// server/_core/llm.ts
init_env();
var ensureArray = (value) => Array.isArray(value) ? value : [value];
var normalizeContentPart = (part) => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") {
    return part;
  }
  if (part.type === "image_url") {
    return part;
  }
  if (part.type === "file_url") {
    return part;
  }
  throw new Error("Unsupported message content part");
};
var normalizeMessage = (message) => {
  const { role, name, tool_call_id } = message;
  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content).map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\n");
    return {
      role,
      name,
      tool_call_id,
      content
    };
  }
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text
    };
  }
  return {
    role,
    name,
    content: contentParts
  };
};
var normalizeToolChoice = (toolChoice, tools) => {
  if (!toolChoice) return void 0;
  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }
  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return {
      type: "function",
      function: { name: tools[0].function.name }
    };
  }
  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name }
    };
  }
  return toolChoice;
};
var resolveApiUrl = () => {
  return `${ENV.openaiBaseUrl}/chat/completions`;
};
var getApiKey = () => {
  if (ENV.openaiApiKey && ENV.openaiApiKey.trim().length > 0) {
    return ENV.openaiApiKey;
  }
  throw new Error("No OPENAI_API_KEY configured.");
};
var getModelName = () => {
  return ENV.openaiModel;
};
var normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema
}) => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return void 0;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...typeof schema.strict === "boolean" ? { strict: schema.strict } : {}
    }
  };
};
async function invokeLLM(params) {
  const apiKey = getApiKey();
  const {
    messages: messages2,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format
  } = params;
  const payload = {
    model: getModelName(),
    messages: messages2.map(normalizeMessage)
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }
  payload.max_tokens = 32768;
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema
  });
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }
  const response = await fetch(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} \u2013 ${errorText}`
    );
  }
  return await response.json();
}

// server/brain-v4.ts
init_env();

// server/characters.ts
var CHARACTERS = {
  kelion: {
    name: "kelion",
    displayName: "Kelion",
    personality: "Serious, technical, analytical, friendly. A reliable expert who explains things clearly.",
    voiceStyle: "Calm, confident, measured pace",
    traits: ["analytical", "precise", "patient", "knowledgeable", "protective"],
    greeting: "Hello! I'm Kelion, your AI assistant. How can I help you today?",
    systemPrompt: `You are Kelion, a serious and analytical AI assistant. You are:
- Technical and precise in your explanations
- Patient and thorough - you take time to explain things properly
- Protective of users - you warn about dangers and risks
- Honest - you NEVER make up information. If you don't know, say "I don't know"
- Friendly but professional in tone
- You adapt your language level to match the user's level
- For visually impaired users: you describe everything in detail
- For children: you use simple, safe language
- You ALWAYS recommend specialists for medical, legal, or financial questions`
  },
  kira: {
    name: "kira",
    displayName: "Kira",
    personality: "Warm, creative, empathetic, energetic. A caring friend who makes learning fun.",
    voiceStyle: "Warm, enthusiastic, expressive",
    traits: ["empathetic", "creative", "encouraging", "playful", "supportive"],
    greeting: "Hi there! I'm Kira! I'm so happy to meet you! What would you like to explore today?",
    systemPrompt: `You are Kira, a warm and creative AI assistant. You are:
- Empathetic and caring - you understand how people feel
- Creative and fun - you make learning enjoyable
- Encouraging - you celebrate progress and effort
- Honest - you NEVER make up information. If you don't know, say "I'm not sure about that"
- Warm and friendly in tone, like a good friend
- You adapt your language level to match the user's level
- For visually impaired users: you paint vivid word pictures of everything
- For children: you're playful, use simple words, and keep things safe
- You ALWAYS recommend specialists for medical, legal, or financial questions`
  }
};
function detectUserLevel(message) {
  const words = message.split(/\s+/);
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1);
  const hasTechnicalTerms = /\b(algorithm|function|API|database|server|compile|runtime|async|protocol|framework|repository|deployment)\b/i.test(message);
  const hasAcademicTerms = /\b(hypothesis|methodology|empirical|theoretical|paradigm|ontology|epistemology|dissertation|synthesis)\b/i.test(message);
  const hasSimpleLanguage = /\b(hi|hello|hey|cool|nice|ok|yeah|yep|nope|lol|haha|pls|plz|thx)\b/i.test(message);
  const hasChildLanguage = /\b(mommy|daddy|please help|i don't understand|what is a|can you explain)\b/i.test(message);
  if (hasChildLanguage || avgWordLength < 4 && words.length < 10) return "child";
  if (hasAcademicTerms) return "academic";
  if (hasTechnicalTerms) return "technical";
  if (hasSimpleLanguage) return "casual";
  if (avgWordLength > 5) return "professional";
  return "casual";
}
function getLevelPrompt(level) {
  const prompts = {
    child: "\n\nIMPORTANT: The user is a child or communicates simply. Use very simple words, short sentences. Explain like talking to an 8-year-old.",
    casual: "\n\nThe user communicates casually. Be friendly and conversational. Keep explanations clear.",
    professional: "\n\nThe user communicates professionally. Be clear, structured, and efficient.",
    academic: "\n\nThe user communicates at an academic level. Use sophisticated vocabulary and provide in-depth analysis.",
    technical: "\n\nThe user is technically proficient. Use technical terminology freely. Provide code examples and precise specs."
  };
  return prompts[level];
}
var ANTI_HALLUCINATION_RULES = `

CRITICAL RULES (NEVER BREAK THESE):
1. NEVER invent facts, data, statistics, or URLs. If you don't know, say "I don't know".
2. For weather, dates, calculations - use the appropriate tool, don't guess.
3. For medical/legal/financial questions - ALWAYS say "Please consult a specialist".
4. If not confident, say so: "I think... but I'm not 100% sure".
5. NEVER pretend to have capabilities you don't have.
6. If you don't understand, ask for clarification instead of guessing.
7. For children and vulnerable users: zero speculation, extra clarity.`;
function buildSystemPrompt(character, level, language) {
  const char = CHARACTERS[character];
  let prompt = char.systemPrompt;
  prompt += getLevelPrompt(level);
  prompt += ANTI_HALLUCINATION_RULES;
  if (language && language !== "en") {
    prompt += `

Respond in the user's language: ${language}.`;
  }
  prompt += "\n\nAlways respond in the same language the user writes in.";
  return prompt;
}

// server/elevenlabs.ts
init_env();

// server/storage.ts
init_env();
import path from "path";
import fs from "fs";
function getManusStorageConfig() {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}
function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
function normalizeKey(relKey) {
  return relKey.replace(/^\/+/, "");
}
function buildAuthHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}
function buildUploadUrl(baseUrl, relKey) {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}
function toFormData(data, contentType, fileName) {
  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}
var LOCAL_STORAGE_DIR = path.resolve(process.cwd(), "uploads");
function ensureLocalStorageDir() {
  if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
    fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
  }
}
async function storagePut(relKey, data, contentType = "application/octet-stream") {
  const manusConfig = getManusStorageConfig();
  if (manusConfig) {
    const key2 = normalizeKey(relKey);
    const uploadUrl = buildUploadUrl(manusConfig.baseUrl, key2);
    const formData = toFormData(data, contentType, key2.split("/").pop() ?? key2);
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: buildAuthHeaders(manusConfig.apiKey),
      body: formData
    });
    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(
        `Storage upload failed (${response.status} ${response.statusText}): ${message}`
      );
    }
    const url2 = (await response.json()).url;
    return { key: key2, url: url2 };
  }
  const s3Bucket = process.env.S3_BUCKET;
  const s3Region = process.env.S3_REGION || "us-east-1";
  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (s3Bucket && awsAccessKey && awsSecretKey) {
    const key2 = normalizeKey(relKey);
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      region: s3Region,
      credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey }
    });
    const buffer2 = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
    await s3.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key2,
      Body: buffer2,
      ContentType: contentType
    }));
    const url2 = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${key2}`;
    return { key: key2, url: url2 };
  }
  ensureLocalStorageDir();
  const key = normalizeKey(relKey);
  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  fs.writeFileSync(filePath, buffer);
  const url = `/uploads/${key}`;
  return { key, url };
}

// server/elevenlabs.ts
var ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
function getHeaders() {
  return {
    "xi-api-key": ENV.elevenLabsApiKey,
    "Content-Type": "application/json"
  };
}
async function generateSpeech(params) {
  const { text: text2, avatar, voiceId, quality = "high", language } = params;
  const resolvedVoiceId = voiceId || (avatar === "kelion" ? ENV.elevenLabsVoiceKelion : ENV.elevenLabsVoiceKira);
  if (!ENV.elevenLabsApiKey) {
    throw new Error("ElevenLabs API key not configured");
  }
  const response = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${resolvedVoiceId}`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        text: text2.slice(0, 5e3),
        // ElevenLabs limit
        model_id: quality === "ultra" ? "eleven_multilingual_v2" : quality === "high" ? "eleven_multilingual_v2" : "eleven_turbo_v2_5",
        voice_settings: {
          stability: quality === "ultra" ? 0.7 : 0.5,
          similarity_boost: quality === "ultra" ? 0.9 : 0.75,
          style: quality === "ultra" ? 0.5 : 0.3,
          use_speaker_boost: quality !== "standard"
        },
        ...language ? { language_code: language } : {}
      })
    }
  );
  if (!response.ok) {
    const err = await response.text();
    console.error("[ElevenLabs] TTS error:", err);
    throw new Error(`ElevenLabs TTS failed: ${response.status}`);
  }
  const audioBuffer = Buffer.from(new Uint8Array(await response.arrayBuffer()));
  const timestamp2 = Date.now();
  const randomSuffix2 = Math.random().toString(36).slice(2, 8);
  const fileKey = `tts/${avatar}-${timestamp2}-${randomSuffix2}.mp3`;
  const { url } = await storagePut(fileKey, audioBuffer, "audio/mpeg");
  const estimatedDuration = Math.ceil(text2.length / 750 * 60);
  return { audioUrl: url, duration: estimatedDuration };
}
async function cloneVoice(params) {
  const { audioBuffer, name, description } = params;
  if (!ENV.elevenLabsApiKey) {
    throw new Error("ElevenLabs API key not configured");
  }
  const formData = new FormData();
  formData.append("name", name);
  formData.append(
    "description",
    description || `Cloned voice for ${name} on KelionAI`
  );
  formData.append(
    "files",
    new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" }),
    "recording.webm"
  );
  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": ENV.elevenLabsApiKey
    },
    body: formData
  });
  if (!response.ok) {
    const err = await response.text();
    console.error("[ElevenLabs] Voice cloning error:", err);
    throw new Error(`Voice cloning failed: ${response.status} - ${err}`);
  }
  const data = await response.json();
  return { voiceId: data.voice_id, name };
}
async function deleteClonedVoice(voiceId) {
  if (!ENV.elevenLabsApiKey) return false;
  const response = await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
    method: "DELETE",
    headers: getHeaders()
  });
  return response.ok;
}
async function getElevenLabsUsage() {
  if (!ENV.elevenLabsApiKey) {
    return { characterCount: 0, characterLimit: 0, canClone: false };
  }
  const response = await fetch(`${ELEVENLABS_BASE}/user`, {
    headers: getHeaders()
  });
  if (!response.ok) {
    return { characterCount: 0, characterLimit: 0, canClone: false };
  }
  const data = await response.json();
  return {
    characterCount: data.subscription.character_count,
    characterLimit: data.subscription.character_limit,
    canClone: data.subscription.can_use_instant_voice_cloning
  };
}

// server/memory-service.ts
init_db();
async function getMemoriesForContext(userId) {
  const memories = await getUserMemories(userId);
  if (!memories.length) return "";
  const lines = memories.map((m) => `- ${m.key}: ${m.value}`).join("\n");
  return `

What you know about this user:
${lines}`;
}
async function extractAndSaveMemories(userId, userMessage, aiResponse) {
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Extract important facts about the user from this conversation. Return a JSON array of {key, value, importance} objects. importance: 1=low, 2=medium, 3=high. Only extract clear, factual information about the USER (not general info). Max 5 facts. If nothing important, return [].`
        },
        {
          role: "user",
          content: `User said: "${userMessage}"
AI responded: "${aiResponse.slice(0, 500)}"`
        }
      ],
      responseFormat: { type: "json_object" }
    });
    const content = result.choices?.[0]?.message?.content;
    if (!content) return;
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return;
    }
    const facts = Array.isArray(parsed) ? parsed : parsed.facts || parsed.memories || [];
    for (const fact of facts.slice(0, 5)) {
      if (fact.key && fact.value) {
        await saveUserMemory(userId, fact.key, fact.value, fact.importance || 1);
      }
    }
  } catch (e) {
  }
}

// server/learning-service.ts
init_db();
async function updateLearningProfile(userId, data) {
  const profile = await getUserLearningProfile(userId);
  const current = profile || {};
  const interactionCount = (current.interactionCount || 0) + 1;
  const voiceInteractionCount = (current.voiceInteractionCount || 0) + (data.isVoice ? 1 : 0);
  const topics = current.topics || [];
  if (data.topic && !topics.includes(data.topic)) {
    topics.unshift(data.topic);
    if (topics.length > 20) topics.pop();
  }
  let finalLevel = current.detectedLevel || data.detectedLevel || "casual";
  if (data.detectedLevel && data.detectedLevel !== finalLevel) {
    if (interactionCount > 3) finalLevel = data.detectedLevel;
  }
  const learningScore = Math.min(1e3, (current.learningScore || 0) + 1);
  await upsertUserLearningProfile(userId, {
    detectedLevel: finalLevel,
    preferredLanguage: data.language || current.preferredLanguage || "en",
    preferredAvatar: data.avatar || current.preferredAvatar || "kelion",
    interactionCount,
    voiceInteractionCount,
    topics,
    learningScore
  });
}
async function getPersonalizedContext(userId) {
  const profile = await getUserLearningProfile(userId);
  return {
    level: profile?.detectedLevel || "casual",
    language: profile?.preferredLanguage || "en",
    avatar: profile?.preferredAvatar || "kelion",
    topics: profile?.topics || [],
    interactionCount: profile?.interactionCount || 0
  };
}

// server/brain-v4.ts
var BRAIN_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the internet for real, current information.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get real weather data for a location.",
      parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_code",
      description: "Generate code in any programming language.",
      parameters: { type: "object", properties: { language: { type: "string" }, task: { type: "string" } }, required: ["language", "task"] }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze_image",
      description: "Analyze an image using AI vision for visually impaired users.",
      parameters: { type: "object", properties: { imageUrl: { type: "string" }, question: { type: "string" } }, required: ["imageUrl"] }
    }
  },
  {
    type: "function",
    function: {
      name: "do_math",
      description: "Perform mathematical calculations accurately.",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] }
    }
  },
  {
    type: "function",
    function: {
      name: "translate_text",
      description: "Translate text between languages.",
      parameters: { type: "object", properties: { text: { type: "string" }, targetLanguage: { type: "string" } }, required: ["text", "targetLanguage"] }
    }
  }
];
async function executeSearchWeb(query) {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`);
    if (!res.ok) return `Search failed: ${res.status}`;
    const data = await res.json();
    const parts = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    if (data.Answer) parts.push(data.Answer);
    if (data.RelatedTopics?.length) {
      parts.push("Related: " + data.RelatedTopics.slice(0, 3).map((t2) => t2.Text).filter(Boolean).join("; "));
    }
    if (!parts.length) {
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
      if (wikiRes.ok) {
        const w = await wikiRes.json();
        if (w.extract) return `[Wikipedia] ${w.extract}`;
      }
      return "No results found. I cannot verify this information.";
    }
    return parts.join("\n");
  } catch {
    return "Search temporarily unavailable.";
  }
}
async function executeGetWeather(location) {
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`);
    if (!geoRes.ok) return "Could not find location.";
    const geo = await geoRes.json();
    if (!geo.results?.length) return `Could not find: ${location}`;
    const { latitude, longitude, name, country } = geo.results[0];
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`);
    if (!wRes.ok) return "Weather service unavailable.";
    const w = await wRes.json();
    const codes = { 0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Foggy", 51: "Light drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 95: "Thunderstorm" };
    return `[VERIFIED] Weather in ${name}, ${country}: ${w.current.temperature_2m}C, ${codes[w.current.weather_code] || "Unknown"}, Humidity: ${w.current.relative_humidity_2m}%, Wind: ${w.current.wind_speed_10m} km/h`;
  } catch {
    return "Weather service unavailable.";
  }
}
async function executeGenerateCode(language, task) {
  const r = await invokeLLM({ messages: [{ role: "system", content: `Expert ${language} programmer. Write clean code only.` }, { role: "user", content: task }] });
  return r.choices?.[0]?.message?.content || "Could not generate code.";
}
async function executeAnalyzeImage(imageUrl, question) {
  try {
    const prompt = question ? `Describe this image in detail for a visually impaired person. Also answer: ${question}` : "Describe this image in complete detail for a visually impaired person. Include objects, positions, colors, text, people, scene, mood, and any hazards.";
    const r = await invokeLLM({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
        ]
      }]
    });
    return `[VISION] ${r.choices?.[0]?.message?.content || "Could not analyze image."}`;
  } catch {
    return "Image analysis unavailable.";
  }
}
async function executeDoMath(expression) {
  const r = await invokeLLM({ messages: [{ role: "system", content: "Precise mathematician. Solve step by step. Double-check." }, { role: "user", content: expression }] });
  return `[CALCULATED] ${r.choices?.[0]?.message?.content || "Could not solve."}`;
}
async function executeTranslate(text2, targetLanguage) {
  const r = await invokeLLM({ messages: [{ role: "system", content: `Translate to ${targetLanguage}. Output only the translation.` }, { role: "user", content: text2 }] });
  return r.choices?.[0]?.message?.content || "Translation failed.";
}
async function executeTool(name, args) {
  switch (name) {
    case "search_web":
      return executeSearchWeb(args.query);
    case "get_weather":
      return executeGetWeather(args.location);
    case "generate_code":
      return executeGenerateCode(args.language, args.task);
    case "analyze_image":
      return executeAnalyzeImage(args.imageUrl, args.question);
    case "do_math":
      return executeDoMath(args.expression);
    case "translate_text":
      return executeTranslate(args.text, args.targetLanguage);
    default:
      return `Unknown tool: ${name}`;
  }
}
function detectLanguage(text2) {
  if (/\b(sunt|este|vreau|cum|unde|care|pentru|foarte|bine|salut|buna|multumesc)\b/i.test(text2)) return "Romanian";
  if (/\b(hola|como|donde|quiero|para|muy|bien|gracias)\b/i.test(text2)) return "Spanish";
  if (/\b(bonjour|comment|merci|je suis|oui|non)\b/i.test(text2)) return "French";
  if (/\b(hallo|danke|bitte|ich bin|wie|wo)\b/i.test(text2)) return "German";
  return "English";
}
function isVoiceCloningRequest(message) {
  return [/clone?\s*(my|the|a)?\s*voice/i, /cloneaz[aă]\s*(vocea|voce)/i, /vreau\s*s[aă]\s*(mi|imi)\s*clonez/i, /voice\s*clon/i, /copy\s*my\s*voice/i, /record\s*my\s*voice/i].some((p) => p.test(message));
}
async function processBrainMessage(params) {
  const { message, history, character, userId, userName, imageUrl } = params;
  const userLevel = detectUserLevel(message);
  const language = detectLanguage(message);
  const memoriesContext = await getMemoriesForContext(userId);
  const learningCtx = await getPersonalizedContext(userId);
  if (isVoiceCloningRequest(message)) {
    const isRo = language === "Romanian";
    return {
      content: isRo ? "Hai sa-ti clonam vocea! Urmeaza pasii de pe ecran." : "Let's clone your voice! Follow the steps on screen.",
      toolsUsed: ["start_voice_cloning"],
      confidence: "verified",
      userLevel,
      language,
      voiceCloningStep: {
        step: 1,
        totalSteps: 5,
        title: isRo ? "Pas 1/5: Pregatire" : "Step 1/5: Preparation",
        description: isRo ? "Pregateste-te sa citesti textul de mai jos cu voce tare. Asigura-te ca esti intr-un loc linistit." : "Get ready to read the text below out loud. Make sure you're in a quiet place.",
        action: "show_text",
        sampleText: isRo ? "Buna ziua! Ma numesc si aceasta este vocea mea. Astazi este o zi frumoasa si sunt bucuros sa pot vorbi cu tine. Inteligenta artificiala ne ajuta sa comunicam mai bine si sa invatam lucruri noi in fiecare zi. Multumesc ca esti aici!" : "Hello! My name is and this is my voice. Today is a beautiful day and I am happy to talk to you. Artificial intelligence helps us communicate better and learn new things every day. Thank you for being here!"
      }
    };
  }
  const systemPromptBase = buildSystemPrompt(character, userLevel, language);
  const systemContent = systemPromptBase + memoriesContext;
  const llmMessages = [{ role: "system", content: systemContent }];
  for (const msg of history.slice(-20)) llmMessages.push({ role: msg.role, content: msg.content });
  if (imageUrl) {
    llmMessages.push({ role: "user", content: [{ type: "text", text: message || "Describe this image in detail." }, { type: "image_url", image_url: { url: imageUrl, detail: "high" } }] });
  } else {
    llmMessages.push({ role: "user", content: message });
  }
  const toolsUsed = [];
  let confidence = "high";
  let finalContent = "";
  try {
    const response = await invokeLLM({ messages: llmMessages, tools: BRAIN_TOOLS, tool_choice: "auto" });
    const choice = response.choices?.[0];
    if (!choice) return { content: "I'm sorry, I couldn't process that. Please try again.", toolsUsed: [], confidence: "low", userLevel, language };
    if (choice.message?.tool_calls?.length) {
      const toolResults = [];
      for (const tc of choice.message.tool_calls) {
        const fnName = tc.function.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(tc.function.arguments);
        } catch {
          fnArgs = {};
        }
        toolsUsed.push(fnName);
        toolResults.push(`[Tool: ${fnName}] ${await executeTool(fnName, fnArgs)}`);
      }
      if (toolsUsed.some((t2) => ["get_weather", "do_math"].includes(t2))) confidence = "verified";
      const followUp = [...llmMessages, { role: "assistant", content: choice.message.content || "" }, { role: "user", content: `Tool results:
${toolResults.join("\n")}

Provide a natural response based on these results. If data says [VERIFIED], present confidently.` }];
      const final = await invokeLLM({ messages: followUp });
      finalContent = final.choices?.[0]?.message?.content || toolResults.join("\n");
    } else {
      finalContent = choice.message?.content || "I couldn't generate a response.";
    }
  } catch (error) {
    console.error("[Brain v4] Error:", error);
    finalContent = "I'm experiencing a temporary issue. Please try again.";
    confidence = "low";
  }
  let audioUrl;
  if (ENV.elevenLabsApiKey && finalContent.length > 0 && finalContent.length < 3e3) {
    try {
      const cleanText = finalContent.replace(/\[.*?\]/g, "").replace(/```[\s\S]*?```/g, "code block").replace(/[#*_~`]/g, "");
      const tts = await generateSpeech({ text: cleanText, avatar: character });
      audioUrl = tts.audioUrl;
    } catch (e) {
      console.error("[Brain v4] TTS error:", e);
    }
  }
  extractAndSaveMemories(userId, message, finalContent).catch(() => {
  });
  updateLearningProfile(userId, {
    detectedLevel: userLevel,
    language,
    avatar: character,
    isVoice: false
  }).catch(() => {
  });
  return { content: finalContent, toolsUsed, confidence, userLevel, language, audioUrl };
}
async function processVoiceCloningStep(params) {
  const { step, userId, userName, audioBuffer } = params;
  switch (step) {
    case 1:
      return { step: 1, totalSteps: 5, title: "Step 1/5: Preparation", description: "Get ready to read the text below out loud in a quiet place.", action: "show_text", sampleText: "Hello! My name is and this is my voice. Today is a beautiful day and I am happy to talk to you. Artificial intelligence helps us communicate better and learn new things every day. I enjoy reading books, watching movies, and spending time with friends. Thank you for being here and listening to me!" };
    case 2:
      return { step: 2, totalSteps: 5, title: "Step 2/5: Recording", description: "Press record and read the text above clearly. Speak naturally. 30-60 seconds.", action: "record_audio" };
    case 3:
      return { step: 3, totalSteps: 5, title: "Step 3/5: Processing", description: "Your voice is being processed by ElevenLabs AI...", action: "processing" };
    case 4:
      if (!audioBuffer) return { step: 2, totalSteps: 5, title: "Step 2/5: Recording", description: "Audio missing. Please record again.", action: "record_audio" };
      try {
        const result = await cloneVoice({ audioBuffer, name: `${userName}-kelionai-${userId}` });
        return { step: 4, totalSteps: 5, title: "Step 4/5: Voice Cloned!", description: `Your voice has been cloned successfully! Would you like to save it?`, action: "confirm", voiceId: result.voiceId };
      } catch (error) {
        console.error("[Voice Cloning] Error:", error);
        return { step: 2, totalSteps: 5, title: "Cloning Failed", description: "Please try recording again with clearer audio.", action: "record_audio" };
      }
    case 5:
      return { step: 5, totalSteps: 5, title: "Step 5/5: Complete!", description: "Your cloned voice has been saved! The AI will now respond using your voice.", action: "done" };
    default:
      return { step: 1, totalSteps: 5, title: "Step 1/5: Preparation", description: "Let's start voice cloning.", action: "show_text" };
  }
}
function getBrainDiagnostics() {
  return {
    version: "v4.1",
    model: ENV.openaiModel,
    transcribeModel: ENV.openaiTranscribeModel,
    features: ["Function calling", "Anti-hallucination", "User level detection", "Multi-language", "ElevenLabs TTS", "Voice cloning", "Vision", "Memory", "Learning", "Real weather", "Real web search", "Code generation", "Math", "Translation"],
    tools: BRAIN_TOOLS.map((t2) => t2.function.name),
    characters: ["kelion", "kira"]
  };
}

// server/routers/chat.ts
var chatRouter = router({
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    return await getConversationsByUserId(ctx.user.id);
  }),
  getConversation: protectedProcedure.input(z2.object({ conversationId: z2.number() })).query(async ({ ctx, input }) => {
    const conversation = await getConversationById(input.conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Conversation not found or access denied");
    }
    const messages2 = await getMessagesByConversationId(input.conversationId);
    return { conversation, messages: messages2 };
  }),
  createConversation: protectedProcedure.input(z2.object({ title: z2.string().optional(), avatar: z2.string().optional() })).mutation(async ({ ctx, input }) => {
    const title = input.title || `Chat - ${(/* @__PURE__ */ new Date()).toLocaleDateString()}`;
    return await createConversation(ctx.user.id, title);
  }),
  sendMessage: protectedProcedure.input(
    z2.object({
      conversationId: z2.number().optional(),
      message: z2.string(),
      avatar: z2.enum(["kelion", "kira"]).optional(),
      imageUrl: z2.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    let conversationId = input.conversationId;
    const avatar = input.avatar || "kelion";
    if (!conversationId) {
      const title = input.message.slice(0, 50) + (input.message.length > 50 ? "..." : "");
      const result = await createConversation(ctx.user.id, title);
      conversationId = result?.id || result[0]?.id;
      if (!conversationId) throw new Error("Failed to create conversation");
    }
    const conversation = await getConversationById(conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Conversation not found or access denied");
    }
    const usage = await getUserUsage(ctx.user.id);
    const tier = ctx.user.subscriptionTier || "free";
    const messagesThisMonth = usage?.messagesThisMonth || 0;
    const plans = await getSubscriptionPlans();
    const userPlan = plans.find((p) => p.tier === tier);
    const messageLimit = userPlan?.messagesPerMonth ?? 20;
    if (messageLimit !== -1 && messagesThisMonth >= messageLimit) {
      throw Object.assign(new Error("LIMIT_REACHED"), { code: "LIMIT_REACHED", tier });
    }
    await createMessage(conversationId, "user", input.message);
    const dbMessages = await getMessagesByConversationId(conversationId);
    const history = dbMessages.map((m) => ({
      role: m.role,
      content: m.content || ""
    }));
    const brainResult = await processBrainMessage({
      message: input.message,
      history,
      character: avatar,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      imageUrl: input.imageUrl
    });
    await createMessage(conversationId, "assistant", brainResult.content, "brain-v4");
    await updateUserUsage(ctx.user.id, messagesThisMonth + 2, usage?.voiceMinutesThisMonth || 0);
    return {
      success: true,
      conversationId,
      message: brainResult.content,
      audioUrl: brainResult.audioUrl,
      confidence: brainResult.confidence,
      toolsUsed: brainResult.toolsUsed,
      userLevel: brainResult.userLevel,
      language: brainResult.language,
      voiceCloningStep: brainResult.voiceCloningStep
    };
  }),
  // Voice cloning step processor
  voiceCloningStep: protectedProcedure.input(
    z2.object({
      step: z2.number(),
      audioBase64: z2.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    let audioBuffer;
    if (input.audioBase64) {
      audioBuffer = Buffer.from(input.audioBase64, "base64");
    }
    const result = await processVoiceCloningStep({
      step: input.step,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      audioBuffer
    });
    return result;
  }),
  getMessages: protectedProcedure.input(z2.object({ conversationId: z2.number() })).query(async ({ ctx, input }) => {
    const conversation = await getConversationById(input.conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Conversation not found or access denied");
    }
    return await getMessagesByConversationId(input.conversationId);
  }),
  deleteConversation: protectedProcedure.input(z2.object({ conversationId: z2.number() })).mutation(async ({ ctx, input }) => {
    const conversation = await getConversationById(input.conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Conversation not found or access denied");
    }
    await deleteConversationMessages(input.conversationId);
    return { success: true };
  })
});

// server/routers/subscription.ts
import { z as z3 } from "zod";
init_db();
init_env();
import Stripe from "stripe";
import { TRPCError as TRPCError3 } from "@trpc/server";
var stripe = ENV.stripeSecretKey ? new Stripe(ENV.stripeSecretKey) : null;
var subscriptionRouter = router({
  /**
   * Get all available subscription plans
   */
  getPlans: publicProcedure.query(async () => {
    return await getSubscriptionPlans();
  }),
  /**
   * Create a checkout session for subscription purchase
   */
  createCheckoutSession: protectedProcedure.input(
    z3.object({
      planId: z3.string(),
      billingCycle: z3.enum(["monthly", "yearly"])
    })
  ).mutation(async ({ ctx, input }) => {
    if (!stripe) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "Stripe is not configured" });
    try {
      let customerId = ctx.user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: ctx.user.email || void 0,
          name: ctx.user.name || void 0,
          metadata: {
            userId: ctx.user.id.toString()
          }
        });
        customerId = customer.id;
      }
      const priceId = input.billingCycle === "yearly" ? `${input.planId}_yearly` : input.planId;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        success_url: `${ctx.req.headers.origin || ENV.frontendUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${ctx.req.headers.origin || ENV.frontendUrl}/subscription/cancel`,
        client_reference_id: ctx.user.id.toString(),
        metadata: {
          userId: ctx.user.id.toString(),
          planId: input.planId,
          billingCycle: input.billingCycle
        }
      });
      return {
        sessionId: session.id,
        url: session.url
      };
    } catch (error) {
      console.error("[Subscription] Checkout session creation failed:", error);
      throw new Error("Failed to create checkout session");
    }
  }),
  /**
   * Get current subscription status
   */
  getSubscriptionStatus: protectedProcedure.query(async ({ ctx }) => {
    if (!stripe) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "Stripe is not configured" });
    try {
      if (!ctx.user.stripeSubscriptionId) {
        return {
          status: "none",
          tier: ctx.user.subscriptionTier || "free",
          currentPeriodEnd: null
        };
      }
      const subscription = await stripe.subscriptions.retrieve(ctx.user.stripeSubscriptionId);
      return {
        status: subscription.status,
        tier: ctx.user.subscriptionTier,
        currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1e3) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      };
    } catch (error) {
      console.error("[Subscription] Status retrieval failed:", error);
      return {
        status: "error",
        tier: ctx.user.subscriptionTier || "free",
        currentPeriodEnd: null
      };
    }
  }),
  /**
   * Cancel current subscription
   */
  cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    if (!stripe) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "Stripe is not configured" });
    try {
      if (!ctx.user.stripeSubscriptionId) {
        throw new Error("No active subscription");
      }
      const subscription = await stripe.subscriptions.update(ctx.user.stripeSubscriptionId, {
        cancel_at_period_end: true
      });
      return {
        success: true,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1e3) : null
      };
    } catch (error) {
      console.error("[Subscription] Cancellation failed:", error);
      throw new Error("Failed to cancel subscription");
    }
  }),
  /**
   * Get payment history
   */
  getPaymentHistory: protectedProcedure.query(async ({ ctx }) => {
    if (!stripe) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: "Stripe is not configured" });
    try {
      if (!ctx.user.stripeCustomerId) {
        return [];
      }
      const invoices = await stripe.invoices.list({
        customer: ctx.user.stripeCustomerId,
        limit: 10
      });
      return invoices.data.map((invoice) => ({
        id: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status,
        date: new Date(invoice.created * 1e3),
        pdfUrl: invoice.invoice_pdf
      }));
    } catch (error) {
      console.error("[Subscription] Payment history retrieval failed:", error);
      return [];
    }
  })
});

// server/routers/admin.ts
import { z as z4 } from "zod";
init_db();
init_schema();
import { eq as eq2, desc as desc2 } from "drizzle-orm";
var adminProcedure2 = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new Error("Admin access required");
  }
  return next({ ctx });
});
var adminRouter = router({
  /**
   * Get all users (admin only)
   */
  getAllUsers: adminProcedure2.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      const allUsers = await db.select().from(users).orderBy(desc2(users.createdAt));
      return allUsers.map((u) => ({
        ...u,
        stripeCustomerId: u.stripeCustomerId ? "***" : null,
        stripeSubscriptionId: u.stripeSubscriptionId ? "***" : null
      }));
    } catch (error) {
      console.error("[Admin] Failed to get users:", error);
      throw error;
    }
  }),
  /**
   * Get user analytics
   */
  getUserAnalytics: adminProcedure2.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      const allUsers = await db.select().from(users);
      const allConversations = await db.select().from(conversations);
      const allMessages = await db.select().from(messages);
      const totalUsers = allUsers.length;
      const activeUsers = allUsers.filter((u) => {
        const lastSignedIn = new Date(u.lastSignedIn);
        const thirtyDaysAgo = /* @__PURE__ */ new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return lastSignedIn > thirtyDaysAgo;
      }).length;
      const paidUsers = allUsers.filter((u) => u.subscriptionTier !== "free").length;
      const totalConversations = allConversations.length;
      const totalMessages = allMessages.length;
      const usersByTier = {
        free: allUsers.filter((u) => u.subscriptionTier === "free").length,
        pro: allUsers.filter((u) => u.subscriptionTier === "pro").length,
        enterprise: allUsers.filter((u) => u.subscriptionTier === "enterprise").length
      };
      return {
        totalUsers,
        activeUsers,
        paidUsers,
        totalConversations,
        totalMessages,
        usersByTier,
        averageConversationsPerUser: totalConversations / totalUsers || 0,
        averageMessagesPerConversation: totalMessages / totalConversations || 0
      };
    } catch (error) {
      console.error("[Admin] Failed to get analytics:", error);
      throw error;
    }
  }),
  /**
   * Get system health status
   */
  getSystemHealth: adminProcedure2.query(async () => {
    const db = await getDb();
    return {
      database: db ? "connected" : "disconnected",
      timestamp: /* @__PURE__ */ new Date(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }),
  /**
   * Get revenue analytics
   */
  getRevenueAnalytics: adminProcedure2.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      const allUsers = await db.select().from(users);
      const subscriptionTiers = {
        free: allUsers.filter((u) => u.subscriptionTier === "free").length,
        pro: allUsers.filter((u) => u.subscriptionTier === "pro").length,
        enterprise: allUsers.filter((u) => u.subscriptionTier === "enterprise").length
      };
      const allPlans = await (await Promise.resolve().then(() => (init_db(), db_exports))).getSubscriptionPlans();
      const proPlan = allPlans.find((p) => p.tier === "pro");
      const enterprisePlan = allPlans.find((p) => p.tier === "enterprise");
      const proPrice = Number(proPlan?.monthlyPrice || 0);
      const enterprisePrice = Number(enterprisePlan?.monthlyPrice || 0);
      const estimatedMRR = subscriptionTiers.pro * proPrice + subscriptionTiers.enterprise * enterprisePrice;
      return {
        subscriptionTiers,
        estimatedMRR,
        activeSubscriptions: subscriptionTiers.pro + subscriptionTiers.enterprise
      };
    } catch (error) {
      console.error("[Admin] Failed to get revenue analytics:", error);
      throw error;
    }
  }),
  /**
   * Update user subscription tier (admin only)
   */
  updateUserSubscription: adminProcedure2.input(
    z4.object({
      userId: z4.number(),
      tier: z4.enum(["free", "pro", "enterprise"]),
      status: z4.enum(["active", "cancelled", "past_due", "trialing"]).optional()
    })
  ).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      const updateData = { subscriptionTier: input.tier };
      if (input.status) {
        updateData.subscriptionStatus = input.status;
      }
      await db.update(users).set(updateData).where(eq2(users.id, input.userId));
      return { success: true };
    } catch (error) {
      console.error("[Admin] Failed to update user subscription:", error);
      throw error;
    }
  }),
  /**
   * Get Brain v4 diagnostics
   */
  getBrainDiagnostics: adminProcedure2.query(async () => {
    return getBrainDiagnostics();
  }),
  /**
   * Delete user (admin only) - soft delete by anonymizing
   */
  deleteUser: adminProcedure2.input(z4.object({ userId: z4.number() })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      await db.update(users).set({
        name: "Deleted User",
        email: null,
        openId: `deleted_${input.userId}_${Date.now()}`
      }).where(eq2(users.id, input.userId));
      return { success: true };
    } catch (error) {
      console.error("[Admin] Failed to delete user:", error);
      throw error;
    }
  })
});

// server/routers/voice.ts
import { z as z5 } from "zod";

// server/_core/voiceTranscription.ts
init_env();
async function transcribeAudio(options) {
  try {
    const apiKey = ENV.forgeApiKey || ENV.openaiApiKey;
    const apiBaseUrl = ENV.forgeApiUrl || "https://api.openai.com";
    if (!apiKey) {
      return {
        error: "Voice transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "Neither BUILT_IN_FORGE_API_KEY nor OPENAI_API_KEY is set"
      };
    }
    let audioBuffer;
    let mimeType;
    try {
      const response2 = await fetch(options.audioUrl);
      if (!response2.ok) {
        return {
          error: "Failed to download audio file",
          code: "INVALID_FORMAT",
          details: `HTTP ${response2.status}: ${response2.statusText}`
        };
      }
      audioBuffer = Buffer.from(await response2.arrayBuffer());
      mimeType = response2.headers.get("content-type") || "audio/mpeg";
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        return {
          error: "Audio file exceeds maximum size limit",
          code: "FILE_TOO_LARGE",
          details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`
        };
      }
    } catch (error) {
      return {
        error: "Failed to fetch audio file",
        code: "SERVICE_ERROR",
        details: error instanceof Error ? error.message : "Unknown error"
      };
    }
    const formData = new FormData();
    const filename = `audio.${getFileExtension(mimeType)}`;
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", audioBlob, filename);
    formData.append("model", ENV.openaiTranscribeModel);
    formData.append("response_format", "verbose_json");
    const prompt = options.prompt || (options.language ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}` : "Transcribe the user's voice to text");
    formData.append("prompt", prompt);
    const baseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
    const fullUrl = new URL(
      "v1/audio/transcriptions",
      baseUrl
    ).toString();
    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "Accept-Encoding": "identity"
      },
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`
      };
    }
    const whisperResponse = await response.json();
    if (!whisperResponse.text || typeof whisperResponse.text !== "string") {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format"
      };
    }
    return whisperResponse;
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}
function getFileExtension(mimeType) {
  const mimeToExt = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a"
  };
  return mimeToExt[mimeType] || "audio";
}
function getLanguageName(langCode) {
  const langMap = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "ar": "Arabic",
    "hi": "Hindi",
    "nl": "Dutch",
    "pl": "Polish",
    "tr": "Turkish",
    "sv": "Swedish",
    "da": "Danish",
    "no": "Norwegian",
    "fi": "Finnish"
  };
  return langMap[langCode] || langCode;
}

// server/routers/voice.ts
init_db();
import { sql } from "drizzle-orm";
function randomSuffix() {
  return Math.random().toString(36).substring(2, 10);
}
var voiceRouter = router({
  /**
   * Upload audio blob (base64) to S3, return URL for Whisper STT
   */
  uploadAudio: protectedProcedure.input(z5.object({ audioBase64: z5.string(), mimeType: z5.string().default("audio/webm") })).mutation(async ({ ctx, input }) => {
    const buffer = Buffer.from(input.audioBase64, "base64");
    const ext = input.mimeType.includes("wav") ? "wav" : input.mimeType.includes("mp3") ? "mp3" : "webm";
    const key = `audio/${ctx.user.id}-${Date.now()}-${randomSuffix()}.${ext}`;
    const { url } = await storagePut(key, buffer, input.mimeType);
    return { audioUrl: url };
  }),
  /**
   * Upload image blob (base64) to S3, return URL for GPT vision
   */
  uploadImage: protectedProcedure.input(z5.object({ imageBase64: z5.string(), mimeType: z5.string().default("image/jpeg") })).mutation(async ({ ctx, input }) => {
    const buffer = Buffer.from(input.imageBase64, "base64");
    const ext = input.mimeType.includes("png") ? "png" : "jpg";
    const key = `images/${ctx.user.id}-${Date.now()}-${randomSuffix()}.${ext}`;
    const { url } = await storagePut(key, buffer, input.mimeType);
    return { imageUrl: url };
  }),
  /**
   * Transcribe audio file to text using Whisper API
   */
  transcribeAudio: protectedProcedure.input(
    z5.object({
      audioUrl: z5.string().url(),
      language: z5.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    const usage = await getUserUsage(ctx.user.id);
    const tier = ctx.user.subscriptionTier || "free";
    const plans = await getSubscriptionPlans();
    const userPlan = plans.find((p) => p.tier === tier);
    const voiceLimit = userPlan?.voiceMinutesPerMonth ?? 10;
    const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
    if (voiceMinutesUsed >= voiceLimit) {
      throw new Error(`Voice usage limit reached for ${tier} tier`);
    }
    const result = await transcribeAudio({
      audioUrl: input.audioUrl,
      language: input.language
    });
    const newVoiceMinutes = voiceMinutesUsed + 1;
    await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, newVoiceMinutes);
    const transcriptionResult = result;
    return {
      text: transcriptionResult.text || "",
      language: transcriptionResult.language || "en",
      duration: transcriptionResult.duration || 0
    };
  }),
  /**
   * Generate speech from text using ElevenLabs TTS (REAL)
   */
  generateSpeech: protectedProcedure.input(
    z5.object({
      text: z5.string().min(1).max(5e3),
      avatar: z5.enum(["kelion", "kira"]).default("kelion"),
      useClonedVoice: z5.boolean().default(false),
      quality: z5.enum(["standard", "high", "ultra"]).default("high"),
      language: z5.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    const usage = await getUserUsage(ctx.user.id);
    const tier = ctx.user.subscriptionTier || "free";
    const plans = await getSubscriptionPlans();
    const userPlan = plans.find((p) => p.tier === tier);
    const voiceLimit = userPlan?.voiceMinutesPerMonth ?? 10;
    const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
    if (voiceMinutesUsed >= voiceLimit) {
      throw new Error(`Voice usage limit reached for ${tier} tier`);
    }
    let customVoiceId;
    if (input.useClonedVoice) {
      const db = await getDb();
      if (db) {
        const rows = await db.execute(
          sql`SELECT voice_id FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true LIMIT 1`
        );
        const result = rows;
        if (result?.[0]?.voice_id) {
          customVoiceId = result[0].voice_id;
        }
      }
    }
    const { audioUrl, duration } = await generateSpeech({
      text: input.text,
      avatar: input.avatar,
      voiceId: customVoiceId,
      quality: input.quality,
      language: input.language
    });
    const estimatedMinutes = Math.max(1, Math.ceil(duration / 60));
    const newVoiceMinutes = voiceMinutesUsed + estimatedMinutes;
    await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, newVoiceMinutes);
    return { audioUrl, duration, avatar: input.avatar };
  }),
  /**
   * Clone user's voice - Step-by-step procedure from chat
   * Step 1: Upload recording
   * Step 2: Process with ElevenLabs
   * Step 3: Save voice ID per user
   */
  cloneVoice: protectedProcedure.input(
    z5.object({
      audioBase64: z5.string().min(1),
      voiceName: z5.string().default("My Voice")
    })
  ).mutation(async ({ ctx, input }) => {
    const elUsage = await getElevenLabsUsage();
    if (!elUsage.canClone) {
      throw new Error("Voice cloning is not available on the current ElevenLabs plan");
    }
    const audioBuffer = Buffer.from(input.audioBase64, "base64");
    const { voiceId, name } = await cloneVoice({
      audioBuffer,
      name: `${input.voiceName} - ${ctx.user.name || ctx.user.id}`,
      description: `Cloned voice for user ${ctx.user.name || ctx.user.id} on KelionAI`
    });
    const db = await getDb();
    if (db) {
      await db.execute(
        sql`UPDATE user_cloned_voices SET is_active = false WHERE user_id = ${ctx.user.id}`
      );
      await db.execute(
        sql`INSERT INTO user_cloned_voices (user_id, voice_id, voice_name, is_active, created_at)
              VALUES (${ctx.user.id}, ${voiceId}, ${name}, true, NOW())`
      );
    }
    return {
      success: true,
      voiceId,
      voiceName: name,
      message: "Voice cloned successfully! Your AI assistant will now use your voice."
    };
  }),
  /**
   * Get user's cloned voice info
   */
  getClonedVoice: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { hasClonedVoice: false, voiceName: null, voiceId: null };
    const rows = await db.execute(
      sql`SELECT voice_id, voice_name, created_at FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true LIMIT 1`
    );
    const result = rows;
    if (result?.[0]) {
      return {
        hasClonedVoice: true,
        voiceName: result[0].voice_name,
        voiceId: result[0].voice_id,
        createdAt: result[0].created_at
      };
    }
    return { hasClonedVoice: false, voiceName: null, voiceId: null };
  }),
  /**
   * Delete user's cloned voice
   */
  deleteClonedVoice: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const rows = await db.execute(
      sql`SELECT voice_id FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true`
    );
    const result = rows;
    if (result?.[0]?.voice_id) {
      await deleteClonedVoice(result[0].voice_id);
      await db.execute(
        sql`UPDATE user_cloned_voices SET is_active = false WHERE user_id = ${ctx.user.id}`
      );
    }
    return { success: true };
  }),
  /**
   * Get voice usage statistics
   */
  getVoiceUsage: protectedProcedure.query(async ({ ctx }) => {
    const usage = await getUserUsage(ctx.user.id);
    const tier = ctx.user.subscriptionTier || "free";
    const plans = await getSubscriptionPlans();
    const userPlan = plans.find((p) => p.tier === tier);
    const voiceMinutesLimit = userPlan?.voiceMinutesPerMonth ?? 10;
    const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
    let elevenLabsUsage = { characterCount: 0, characterLimit: 0, canClone: false };
    try {
      elevenLabsUsage = await getElevenLabsUsage();
    } catch (_) {
    }
    return {
      used: voiceMinutesUsed,
      limit: voiceMinutesLimit,
      remaining: Math.max(0, voiceMinutesLimit - voiceMinutesUsed),
      percentage: voiceMinutesUsed / voiceMinutesLimit * 100,
      elevenLabs: elevenLabsUsage
    };
  })
});

// server/routers/contact.ts
import { z as z6 } from "zod";
init_db();
import { sql as sql2 } from "drizzle-orm";
var contactRouter = router({
  /**
   * Send a contact message with AI auto-response
   */
  sendMessage: publicProcedure.input(
    z6.object({
      name: z6.string().min(1),
      email: z6.string().email(),
      subject: z6.string().min(1),
      message: z6.string().min(1).max(5e3)
    })
  ).mutation(async ({ input }) => {
    const db = await getDb();
    if (db) {
      try {
        await db.execute(
          sql2`INSERT INTO contact_messages (name, email, subject, message, status, created_at)
                VALUES (${input.name}, ${input.email}, ${input.subject}, ${input.message}, 'new', NOW())`
        );
      } catch (err) {
        console.error("[Contact] Failed to save message:", err);
      }
    }
    try {
      await notifyOwner({
        title: `New Contact: ${input.subject}`,
        content: `From: ${input.name} (${input.email})

${input.message}`
      });
    } catch (err) {
      console.error("[Contact] Failed to notify owner:", err);
    }
    let aiResponse = "";
    try {
      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are KelionAI's customer support assistant. Generate a brief, helpful auto-response to this contact form message. Be warm, professional, and acknowledge their specific concern. Keep it under 100 words. If it's a technical issue, suggest they try the chat feature. If it's billing, mention they can check their subscription page.`
          },
          {
            role: "user",
            content: `Subject: ${input.subject}
Message: ${input.message}`
          }
        ]
      });
      aiResponse = result?.choices?.[0]?.message?.content || "";
    } catch (err) {
      console.error("[Contact] AI auto-response failed:", err);
      aiResponse = "Thank you for reaching out! Our team has received your message and will get back to you within 24 hours.";
    }
    return {
      success: true,
      aiResponse
    };
  })
});

// server/routers/memory.ts
import { z as z7 } from "zod";
init_db();
var memoryRouter = router({
  getMemories: protectedProcedure.query(async ({ ctx }) => {
    return await getUserMemories(ctx.user.id);
  }),
  deleteMemory: protectedProcedure.input(z7.object({ memoryId: z7.number() })).mutation(async ({ ctx, input }) => {
    await deleteUserMemory(input.memoryId, ctx.user.id);
    return { success: true };
  }),
  clearAll: protectedProcedure.mutation(async ({ ctx }) => {
    await clearUserMemories(ctx.user.id);
    return { success: true };
  })
});

// server/routers/learning.ts
init_db();
var learningRouter = router({
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
      learningScore: 0
    });
    return { success: true };
  })
});

// server/routers.ts
var appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  chat: chatRouter,
  subscription: subscriptionRouter,
  admin: adminRouter,
  voice: voiceRouter,
  contact: contactRouter,
  memory: memoryRouter,
  learning: learningRouter
});

// server/_core/context.ts
init_env();
var isStandalone = !ENV.oAuthServerUrl;
async function createContext(opts) {
  let user = null;
  try {
    if (isStandalone) {
      const { authenticateRequestStandalone: authenticateRequestStandalone2 } = await Promise.resolve().then(() => (init_standalone_auth(), standalone_auth_exports));
      user = await authenticateRequestStandalone2(opts.req);
    } else {
      const { sdk: sdk2 } = await Promise.resolve().then(() => (init_sdk(), sdk_exports));
      user = await sdk2.authenticateRequest(opts.req);
    }
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs3 from "fs";
import { nanoid } from "nanoid";
import path3 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs2 from "node:fs";
import path2 from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path2.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs2.existsSync(LOG_DIR)) {
    fs2.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs2.existsSync(logPath) || fs2.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs2.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs2.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path2.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs2.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path2.resolve(import.meta.dirname, "client", "src"),
      "@shared": path2.resolve(import.meta.dirname, "shared"),
      "@assets": path2.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path2.resolve(import.meta.dirname),
  root: path2.resolve(import.meta.dirname, "client"),
  publicDir: path2.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path2.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs3.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path3.resolve(import.meta.dirname, "../..", "dist", "public") : path3.resolve(import.meta.dirname, "public");
  if (!fs3.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path3.resolve(distPath, "index.html"));
  });
}

// server/_core/stripe-webhook.ts
init_db();
init_schema();
init_env();
import Stripe2 from "stripe";
import { eq as eq4 } from "drizzle-orm";
var stripe2 = ENV.stripeSecretKey ? new Stripe2(ENV.stripeSecretKey) : null;
var webhookSecret = ENV.stripeWebhookSecret;
async function handleStripeWebhook(req, res) {
  if (!stripe2 || !webhookSecret) {
    return res.status(503).json({ error: "Stripe not configured" });
  }
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe2.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe Webhook] Test event detected, returning verification response");
    return res.json({ verified: true });
  }
  const db = await getDb();
  if (!db) {
    console.error("[Stripe Webhook] Database not available");
    return res.status(500).json({ error: "Database unavailable" });
  }
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("[Stripe Webhook] Checkout session completed:", session.id);
        if (session.client_reference_id) {
          const userId = parseInt(session.client_reference_id);
          const customerId = session.customer;
          const subscriptionId = session.subscription;
          await db.update(users).set({
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            subscriptionTier: session.metadata?.planId || "pro",
            subscriptionStatus: "active"
          }).where(eq4(users.id, userId));
          console.log("[Stripe Webhook] User subscription updated:", userId);
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        console.log("[Stripe Webhook] Subscription updated:", subscription.id);
        const userRecord = await db.select().from(users).where(eq4(users.stripeSubscriptionId, subscription.id)).limit(1);
        if (userRecord.length > 0) {
          const status = subscription.status === "active" ? "active" : "cancelled";
          await db.update(users).set({ subscriptionStatus: status }).where(eq4(users.id, userRecord[0].id));
          console.log("[Stripe Webhook] User subscription status updated:", userRecord[0].id);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        console.log("[Stripe Webhook] Subscription deleted:", subscription.id);
        const userRecord = await db.select().from(users).where(eq4(users.stripeSubscriptionId, subscription.id)).limit(1);
        if (userRecord.length > 0) {
          await db.update(users).set({
            subscriptionTier: "free",
            subscriptionStatus: "cancelled",
            stripeSubscriptionId: null
          }).where(eq4(users.id, userRecord[0].id));
          console.log("[Stripe Webhook] User downgraded to free:", userRecord[0].id);
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        console.log("[Stripe Webhook] Invoice paid:", invoice.id);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.log("[Stripe Webhook] Invoice payment failed:", invoice.id);
        if (invoice.customer) {
          const userRecord = await db.select().from(users).where(eq4(users.stripeCustomerId, invoice.customer)).limit(1);
          if (userRecord.length > 0) {
            await db.update(users).set({ subscriptionStatus: "past_due" }).where(eq4(users.id, userRecord[0].id));
            console.log("[Stripe Webhook] User subscription marked as past_due:", userRecord[0].id);
          }
        }
        break;
      }
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
    res.json({ received: true });
  } catch (error) {
    console.error("[Stripe Webhook] Error processing event:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
var isStandalone2 = true;
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });
  app.use((req, _res, next) => {
    const start = Date.now();
    _res.on("finish", () => {
      const duration = Date.now() - start;
      if (req.path.startsWith("/api/")) {
        console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${req.method} ${req.path} ${_res.statusCode} ${duration}ms`);
      }
    });
    next();
  });
  app.post("/api/stripe/webhook", express2.raw({ type: "application/json" }), handleStripeWebhook);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  if (isStandalone2) {
    console.log("[Auth] Running in STANDALONE mode (email/password)");
    const { registerStandaloneAuthRoutes: registerStandaloneAuthRoutes2 } = await Promise.resolve().then(() => (init_standalone_auth(), standalone_auth_exports));
    registerStandaloneAuthRoutes2(app);
  } else {
    console.log("[Auth] Running with Manus OAuth");
    const { registerOAuthRoutes: registerOAuthRoutes2 } = await Promise.resolve().then(() => (init_oauth(), oauth_exports));
    registerOAuthRoutes2(app);
  }
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  app.use("/uploads", express2.static("uploads"));
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
