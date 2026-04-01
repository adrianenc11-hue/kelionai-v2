import { int, mysqlTable, text, timestamp, varchar, boolean, decimal, json, serial, mysqlEnum, datetime, tinyint } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: text("passwordHash"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  avatarUrl: text("avatarUrl"),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  subscriptionTier: mysqlEnum("subscriptionTier", ["free", "pro", "enterprise"]).default("free").notNull(),
  subscriptionStatus: mysqlEnum("subscriptionStatus", ["active", "cancelled", "past_due", "trialing"]).default("active"),
  language: varchar("language", { length: 10 }).default("en"),
  trialStartDate: timestamp("trial_start_date").defaultNow(),
  trialExpired: boolean("trial_expired").default(false),
  subscriptionStartDate: timestamp("subscription_start_date"),
  billingCycle: varchar("billing_cycle", { length: 10 }).default("monthly"),
  referralBonusDays: int("referral_bonus_days").default(0),
  accountClosed: boolean("account_closed").default(false),
  accountClosedAt: timestamp("account_closed_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const conversations = mysqlTable("conversations", {
  id: serial("id").primaryKey(),
  userId: int("userId").notNull(),
  title: text("title"),
  description: text("description"),
  primaryAiModel: varchar("primaryAiModel", { length: 50 }).default("gpt-4"),
  isArchived: boolean("isArchived").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

export const messages = mysqlTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content"),
  aiModel: varchar("aiModel", { length: 50 }),
  tokens: int("tokens"),
  metadata: json("metadata"),
  intent: varchar("intent", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export const subscriptionPlans = mysqlTable("subscriptionPlans", {
  id: serial("id").primaryKey(),
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
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = typeof subscriptionPlans.$inferInsert;

export const userUsage = mysqlTable("userUsage", {
  id: serial("id").primaryKey(),
  userId: int("userId").notNull(),
  messagesThisMonth: int("messagesThisMonth").default(0),
  voiceMinutesThisMonth: int("voiceMinutesThisMonth").default(0),
  lastResetDate: timestamp("lastResetDate").defaultNow(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type UserUsage = typeof userUsage.$inferSelect;
export type InsertUserUsage = typeof userUsage.$inferInsert;

export const aiProviders = mysqlTable("aiProviders", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  provider: mysqlEnum("provider", ["openai", "google", "groq", "anthropic", "deepseek"]).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  isActive: boolean("isActive").default(true),
  priority: int("priority").default(0),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type AiProvider = typeof aiProviders.$inferSelect;
export type InsertAiProvider = typeof aiProviders.$inferInsert;

export const referralCodes = mysqlTable("referral_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  senderUserId: int("sender_user_id").notNull(),
  recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedBy: int("used_by"),
  usedAt: timestamp("used_at"),
  bonusApplied: boolean("bonus_applied").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReferralCode = typeof referralCodes.$inferSelect;
export type InsertReferralCode = typeof referralCodes.$inferInsert;

export const refundRequests = mysqlTable("refund_requests", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  billingCycle: varchar("billing_cycle", { length: 10 }).notNull(),
  subscriptionStartDate: timestamp("subscription_start_date"),
  monthsElapsed: int("months_elapsed").default(0),
  refundAmount: decimal("refund_amount", { precision: 10, scale: 2 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  reason: text("reason"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export type RefundRequest = typeof refundRequests.$inferSelect;
export type InsertRefundRequest = typeof refundRequests.$inferInsert;

export const dailyUsage = mysqlTable("daily_usage", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  minutesUsed: int("minutes_used").default(0).notNull(),
  messagesCount: int("messages_count").default(0).notNull(),
  lastActivityAt: timestamp("last_activity_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DailyUsage = typeof dailyUsage.$inferSelect;
export type InsertDailyUsage = typeof dailyUsage.$inferInsert;

export const userClonedVoices = mysqlTable("user_cloned_voices", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull(),
  voiceId: varchar("voice_id", { length: 255 }).notNull(),
  voiceName: varchar("voice_name", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: datetime("created_at").default(new Date()),
});

export type UserClonedVoice = typeof userClonedVoices.$inferSelect;

export const payments = mysqlTable("payments", {
  id: serial("id").primaryKey(),
  userId: int("userId").notNull(),
  stripePaymentId: varchar("stripePaymentId", { length: 255 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("eur"),
  status: varchar("status", { length: 30 }).default("pending"),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Payment = typeof payments.$inferSelect;

// Relations
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

export const dailyUsageRelations = relations(dailyUsage, ({ one }) => ({
  user: one(users, {
    fields: [dailyUsage.userId],
    references: [users.id],
  }),
}));
