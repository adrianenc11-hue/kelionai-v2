import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, decimal, json } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  avatarUrl: text("avatarUrl"),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  subscriptionTier: mysqlEnum("subscriptionTier", ["free", "pro", "enterprise"]).default("free").notNull(),
  subscriptionStatus: mysqlEnum("subscriptionStatus", ["active", "cancelled", "past_due", "trialing"]).default("active"),
  language: varchar("language", { length: 10 }).default("en"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Conversations table for storing chat sessions
 */
export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: text("title"),
  description: text("description"),
  primaryAiModel: varchar("primaryAiModel", { length: 50 }).default("gpt-4"),
  isArchived: boolean("isArchived").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * Messages table for storing individual messages in conversations
 */
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content"),
  aiModel: varchar("aiModel", { length: 50 }),
  tokens: int("tokens"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/**
 * Subscription plans table
 */
export const subscriptionPlans = mysqlTable("subscriptionPlans", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  tier: mysqlEnum("tier", ["free", "pro", "enterprise"]).notNull(),
  stripePriceId: varchar("stripePriceId", { length: 255 }).notNull(),
  monthlyPrice: decimal("monthlyPrice", { precision: 10, scale: 2 }),
  yearlyPrice: decimal("yearlyPrice", { precision: 10, scale: 2 }),
  messagesPerMonth: int("messagesPerMonth"),
  voiceMinutesPerMonth: int("voiceMinutesPerMonth"),
  features: json("features"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = typeof subscriptionPlans.$inferInsert;

/**
 * User usage tracking for rate limiting and analytics
 */
export const userUsage = mysqlTable("userUsage", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  messagesThisMonth: int("messagesThisMonth").default(0),
  voiceMinutesThisMonth: int("voiceMinutesThisMonth").default(0),
  lastResetDate: timestamp("lastResetDate").defaultNow(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserUsage = typeof userUsage.$inferSelect;
export type InsertUserUsage = typeof userUsage.$inferInsert;

/**
 * AI provider configuration for multi-model routing
 */
export const aiProviders = mysqlTable("aiProviders", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  provider: mysqlEnum("provider", ["openai", "google", "groq", "anthropic", "deepseek"]).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  isActive: boolean("isActive").default(true),
  priority: int("priority").default(0),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiProvider = typeof aiProviders.$inferSelect;
export type InsertAiProvider = typeof aiProviders.$inferInsert;

/**
 * Relations
 */
export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  usage: many(userUsage),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const userUsageRelations = relations(userUsage, ({ one }) => ({
  user: one(users, {
    fields: [userUsage.userId],
    references: [users.id],
  }),
}));
