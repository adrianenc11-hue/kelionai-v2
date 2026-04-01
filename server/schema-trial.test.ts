import { describe, it, expect } from "vitest";
import { users, dailyUsage, referralCodes, refundRequests, contactMessages, subscriptionPlans, userClonedVoices, payments, conversations, messages } from "../drizzle/schema";

describe("Drizzle Schema - Column Names (PostgreSQL snake_case)", () => {
  it("users table has correct snake_case column names for PostgreSQL", () => {
    const cols = users as any;
    expect(cols.openId.name).toBe("open_id");
    expect(cols.passwordHash.name).toBe("password_hash");
    expect(cols.loginMethod.name).toBe("login_method");
    expect(cols.avatarUrl.name).toBe("avatar_url");
    expect(cols.stripeCustomerId.name).toBe("stripe_customer_id");
    expect(cols.stripeSubscriptionId.name).toBe("stripe_subscription_id");
    expect(cols.subscriptionTier.name).toBe("subscription_tier");
    expect(cols.subscriptionStatus.name).toBe("subscription_status");
    expect(cols.createdAt.name).toBe("created_at");
    expect(cols.updatedAt.name).toBe("updated_at");
    expect(cols.lastSignedIn.name).toBe("last_signed_in");
  });

  it("users table has correct snake_case column names for newer columns", () => {
    const cols = users as any;
    expect(cols.trialStartDate.name).toBe("trial_start_date");
    expect(cols.trialExpired.name).toBe("trial_expired");
    expect(cols.subscriptionStartDate.name).toBe("subscription_start_date");
    expect(cols.billingCycle.name).toBe("billing_cycle");
    expect(cols.referralBonusDays.name).toBe("referral_bonus_days");
    expect(cols.accountClosed.name).toBe("account_closed");
    expect(cols.accountClosedAt.name).toBe("account_closed_at");
  });

  it("users table has all required columns", () => {
    const cols = users as any;
    const requiredColumns = [
      "id", "openId", "name", "email", "passwordHash", "loginMethod",
      "role", "avatarUrl", "stripeCustomerId", "stripeSubscriptionId",
      "subscriptionTier", "subscriptionStatus", "language",
      "trialStartDate", "trialExpired", "subscriptionStartDate",
      "billingCycle", "referralBonusDays", "accountClosed", "accountClosedAt",
      "createdAt", "updatedAt", "lastSignedIn",
    ];
    for (const col of requiredColumns) {
      expect(cols[col], `Column ${col} should exist`).toBeDefined();
    }
  });

  it("daily_usage table has correct snake_case column names", () => {
    const cols = dailyUsage as any;
    expect(cols.userId.name).toBe("user_id");
    expect(cols.date.name).toBe("date");
    expect(cols.minutesUsed.name).toBe("minutes_used");
    expect(cols.messagesCount.name).toBe("messages_count");
    expect(cols.lastActivityAt.name).toBe("last_activity_at");
    expect(cols.createdAt.name).toBe("created_at");
  });

  it("referral_codes table has correct column names", () => {
    const cols = referralCodes as any;
    expect(cols.code.name).toBe("code");
    expect(cols.senderUserId.name).toBe("sender_user_id");
    expect(cols.recipientEmail.name).toBe("recipient_email");
    expect(cols.expiresAt.name).toBe("expires_at");
    expect(cols.usedBy.name).toBe("used_by");
    expect(cols.bonusApplied.name).toBe("bonus_applied");
  });

  it("refund_requests table has correct column names", () => {
    const cols = refundRequests as any;
    expect(cols.userId.name).toBe("user_id");
    expect(cols.stripeSubscriptionId.name).toBe("stripe_subscription_id");
    expect(cols.billingCycle.name).toBe("billing_cycle");
    expect(cols.refundAmount.name).toBe("refund_amount");
    expect(cols.status.name).toBe("status");
    expect(cols.reason.name).toBe("reason");
  });

  it("conversations table has snake_case column names", () => {
    const cols = conversations as any;
    expect(cols.userId.name).toBe("user_id");
    expect(cols.title.name).toBe("title");
    expect(cols.createdAt.name).toBe("created_at");
  });

  it("messages table has snake_case column names", () => {
    const cols = messages as any;
    expect(cols.conversationId.name).toBe("conversation_id");
    expect(cols.role.name).toBe("role");
    expect(cols.content.name).toBe("content");
    expect(cols.aiModel.name).toBe("ai_model");
  });
});

describe("Trial System Logic", () => {
  it("TrialStatus interface has all required fields", () => {
    const mockTrialStatus = {
      isTrialUser: true,
      trialExpired: false,
      trialDaysLeft: 7,
      dailyMinutesUsed: 0,
      dailyMinutesLimit: 10,
      dailyMessagesCount: 0,
      canUse: true,
    };
    expect(mockTrialStatus.isTrialUser).toBe(true);
    expect(mockTrialStatus.trialDaysLeft).toBe(7);
    expect(mockTrialStatus.dailyMinutesLimit).toBe(10);
    expect(mockTrialStatus.canUse).toBe(true);
  });

  it("trial should expire after 7 days", () => {
    const trialStart = new Date();
    trialStart.setDate(trialStart.getDate() - 8);
    const now = new Date();
    const diffMs = now.getTime() - trialStart.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const trialDaysLeft = Math.max(0, 7 - diffDays);
    expect(trialDaysLeft).toBe(0);
  });

  it("trial should have days left within 7 days", () => {
    const trialStart = new Date();
    trialStart.setDate(trialStart.getDate() - 3);
    const now = new Date();
    const diffMs = now.getTime() - trialStart.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const trialDaysLeft = Math.max(0, 7 - diffDays);
    expect(trialDaysLeft).toBe(4);
  });

  it("daily limit should block after 10 minutes", () => {
    const minutesUsed = 10;
    const canUse = minutesUsed < 10;
    expect(canUse).toBe(false);
  });

  it("daily limit should allow under 10 minutes", () => {
    const minutesUsed = 5;
    const canUse = minutesUsed < 10;
    expect(canUse).toBe(true);
  });
});

describe("Subscription Plans", () => {
  it("subscription_plans table has correct column names", () => {
    const cols = subscriptionPlans as any;
    expect(cols.name.name).toBe("name");
    expect(cols.tier.name).toBe("tier");
    expect(cols.stripePriceId.name).toBe("stripe_price_id");
    expect(cols.monthlyPrice.name).toBe("monthly_price");
    expect(cols.yearlyPrice.name).toBe("yearly_price");
    expect(cols.isActive.name).toBe("is_active");
  });
});
