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
  trialStartDate: timestamp("trial_start_date").defaultNow(),
  trialExpired: boolean("trial_expired").default(false),
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
  primaryAiModel: varchar("primary_ai_model", { length: 50 }).default("gpt-4"),
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
  stripePriceId: varchar("stripe_price_id", { length: 255 }).notNull(),
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

export const referralCodes = pgTable("referral_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  senderUserId: integer("sender_user_id").notNull(),
  recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedBy: integer("used_by"),
  usedAt: timestamp("used_at"),
  bonusApplied: boolean("bonus_applied").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReferralCode = typeof referralCodes.$inferSelect;
export type InsertReferralCode = typeof referralCodes.$inferInsert;

export const refundStatusEnum = pgEnum("refund_status", ["pending", "approved", "denied", "completed"]);

export const refundRequests = pgTable("refund_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  billingCycle: varchar("billing_cycle", { length: 10 }).notNull(), // monthly or yearly
  subscriptionStartDate: timestamp("subscription_start_date"),
  monthsElapsed: integer("months_elapsed").default(0),
  refundAmount: numeric("refund_amount", { precision: 10, scale: 2 }),
  status: refundStatusEnum("status").default("pending").notNull(),
  reason: text("reason"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export type RefundRequest = typeof refundRequests.$inferSelect;
export type InsertRefundRequest = typeof refundRequests.$inferInsert;

export const dailyUsage = pgTable("daily_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  minutesUsed: integer("minutes_used").default(0).notNull(),
  messagesCount: integer("messages_count").default(0).notNull(),
  lastActivityAt: timestamp("last_activity_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DailyUsage = typeof dailyUsage.$inferSelect;
export type InsertDailyUsage = typeof dailyUsage.$inferInsert;

export const userUsageRelations = relations(userUsage, ({ one }) => ({
  user: one(users, {
    fields: [userUsage.userId],
    references: [users.id],
  }),
}));

export const dailyUsageRelations = relations(dailyUsage, ({ one }) => ({
  user: one(users, {
    fields: [dailyUsage.userId],
    references: [users.id],
  }),
}));
