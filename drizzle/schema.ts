import { integer, pgEnum, pgTable, text, timestamp, varchar, boolean, numeric, json, serial } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const subscriptionTierEnum = pgEnum("subscription_tier", ["free", "pro", "enterprise"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "cancelled", "past_due", "trialing"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
export const aiProviderEnum = pgEnum("ai_provider", ["openai", "google", "groq", "anthropic", "deepseek"]);

export const users = pgTable("users", {
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
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title"),
  description: text("description"),
  primaryAiModel: varchar("primary_ai_model", { length: 50 }).default("gpt-5.4-pro"),
  isArchived: boolean("is_archived").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: messageRoleEnum("role").notNull(),
  content: text("content"),
  aiModel: varchar("ai_model", { length: 50 }),
  tokens: integer("tokens"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export const subscriptionPlans = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  tier: subscriptionTierEnum("tier").notNull(),
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }),
  yearlyPrice: numeric("yearly_price", { precision: 10, scale: 2 }),
  messagesPerMonth: integer("messages_per_month"),
  voiceMinutesPerMonth: integer("voice_minutes_per_month"),
  features: json("features"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = typeof subscriptionPlans.$inferInsert;

export const userUsage = pgTable("user_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  messagesThisMonth: integer("messages_this_month").default(0),
  voiceMinutesThisMonth: integer("voice_minutes_this_month").default(0),
  lastResetDate: timestamp("last_reset_date").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserUsage = typeof userUsage.$inferSelect;
export type InsertUserUsage = typeof userUsage.$inferInsert;

export const aiProviders = pgTable("ai_providers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  provider: aiProviderEnum("provider").notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  isActive: boolean("is_active").default(true),
  priority: integer("priority").default(0),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AiProvider = typeof aiProviders.$inferSelect;
export type InsertAiProvider = typeof aiProviders.$inferInsert;

// User Memories
export const userMemories = pgTable("user_memories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  key: varchar("key", { length: 255 }).notNull(),
  value: text("value").notNull(),
  importance: integer("importance").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type UserMemory = typeof userMemories.$inferSelect;

// User Learning Profiles
export const userLearningProfiles = pgTable("user_learning_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  detectedLevel: varchar("detected_level", { length: 50 }).default("casual"),
  preferredLanguage: varchar("preferred_language", { length: 10 }).default("en"),
  preferredAvatar: varchar("preferred_avatar", { length: 10 }).default("kelion"),
  interactionCount: integer("interaction_count").default(0),
  voiceInteractionCount: integer("voice_interaction_count").default(0),
  topics: json("topics").$type<string[]>().default([]),
  learningScore: integer("learning_score").default(0),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type UserLearningProfile = typeof userLearningProfiles.$inferSelect;

// User Preferences
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  theme: varchar("theme", { length: 10 }).default("dark"),
  language: varchar("language", { length: 10 }).default("en"),
  selectedAvatar: varchar("selected_avatar", { length: 10 }).default("kelion"),
  voiceEnabled: boolean("voice_enabled").default(true),
  cameraEnabled: boolean("camera_enabled").default(false),
  streamingEnabled: boolean("streaming_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type UserPreference = typeof userPreferences.$inferSelect;

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

