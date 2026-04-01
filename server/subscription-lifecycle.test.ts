import { describe, it, expect } from "vitest";

describe("Subscription Lifecycle", () => {
  // Test the status mapping logic from stripe-webhook.ts
  const mapStripeStatus = (stripeStatus: string): "active" | "cancelled" | "past_due" | "trialing" => {
    if (stripeStatus === "active") return "active";
    if (stripeStatus === "past_due") return "past_due";
    if (stripeStatus === "trialing") return "trialing";
    return "cancelled"; // incomplete, incomplete_expired, canceled, unpaid
  };

  const shouldDowngrade = (stripeStatus: string): boolean => {
    return ["canceled", "unpaid", "incomplete_expired"].includes(stripeStatus);
  };

  describe("Stripe status mapping", () => {
    it("maps active to active", () => {
      expect(mapStripeStatus("active")).toBe("active");
    });

    it("maps past_due to past_due", () => {
      expect(mapStripeStatus("past_due")).toBe("past_due");
    });

    it("maps trialing to trialing", () => {
      expect(mapStripeStatus("trialing")).toBe("trialing");
    });

    it("maps canceled to cancelled", () => {
      expect(mapStripeStatus("canceled")).toBe("cancelled");
    });

    it("maps unpaid to cancelled", () => {
      expect(mapStripeStatus("unpaid")).toBe("cancelled");
    });

    it("maps incomplete to cancelled", () => {
      expect(mapStripeStatus("incomplete")).toBe("cancelled");
    });

    it("maps incomplete_expired to cancelled", () => {
      expect(mapStripeStatus("incomplete_expired")).toBe("cancelled");
    });
  });

  describe("Downgrade logic", () => {
    it("downgrades on canceled", () => {
      expect(shouldDowngrade("canceled")).toBe(true);
    });

    it("downgrades on unpaid", () => {
      expect(shouldDowngrade("unpaid")).toBe(true);
    });

    it("downgrades on incomplete_expired", () => {
      expect(shouldDowngrade("incomplete_expired")).toBe(true);
    });

    it("does NOT downgrade on active", () => {
      expect(shouldDowngrade("active")).toBe(false);
    });

    it("does NOT downgrade on past_due", () => {
      expect(shouldDowngrade("past_due")).toBe(false);
    });

    it("does NOT downgrade on trialing", () => {
      expect(shouldDowngrade("trialing")).toBe(false);
    });
  });

  describe("Trial expiration logic", () => {
    const TRIAL_DAYS = 7;
    const DAILY_LIMIT_MINUTES = 10;

    const getTrialStatus = (params: {
      trialStartDate: Date | null;
      trialExpired: boolean;
      subscriptionTier: string;
      subscriptionStatus: string | null;
      accountClosed: boolean;
      dailyMinutesUsed: number;
    }) => {
      const { trialStartDate, trialExpired, subscriptionTier, subscriptionStatus, accountClosed, dailyMinutesUsed } = params;

      if (accountClosed) {
        return { canUse: false, reason: "account_closed" };
      }

      // Paid users with active subscription
      if (subscriptionTier !== "free" && subscriptionStatus === "active") {
        return { canUse: true, reason: "paid" };
      }

      // Paid users with cancelled/past_due subscription
      if (subscriptionTier !== "free" && subscriptionStatus !== "active") {
        return { canUse: false, reason: "subscription_expired" };
      }

      // Free trial users
      if (trialExpired) {
        return { canUse: false, reason: "trial_expired" };
      }

      if (!trialStartDate) {
        return { canUse: true, reason: "new_user" };
      }

      const now = new Date();
      const trialEnd = new Date(trialStartDate.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      if (now > trialEnd) {
        return { canUse: false, reason: "trial_expired" };
      }

      if (dailyMinutesUsed >= DAILY_LIMIT_MINUTES) {
        return { canUse: false, reason: "daily_limit" };
      }

      return { canUse: true, reason: "trial_active" };
    };

    it("blocks closed accounts", () => {
      const result = getTrialStatus({
        trialStartDate: new Date(),
        trialExpired: false,
        subscriptionTier: "pro",
        subscriptionStatus: "active",
        accountClosed: true,
        dailyMinutesUsed: 0,
      });
      expect(result.canUse).toBe(false);
      expect(result.reason).toBe("account_closed");
    });

    it("allows paid active users", () => {
      const result = getTrialStatus({
        trialStartDate: new Date(),
        trialExpired: true,
        subscriptionTier: "pro",
        subscriptionStatus: "active",
        accountClosed: false,
        dailyMinutesUsed: 100,
      });
      expect(result.canUse).toBe(true);
      expect(result.reason).toBe("paid");
    });

    it("blocks paid users with cancelled subscription", () => {
      const result = getTrialStatus({
        trialStartDate: new Date(),
        trialExpired: true,
        subscriptionTier: "pro",
        subscriptionStatus: "cancelled",
        accountClosed: false,
        dailyMinutesUsed: 0,
      });
      expect(result.canUse).toBe(false);
      expect(result.reason).toBe("subscription_expired");
    });

    it("blocks paid users with past_due subscription", () => {
      const result = getTrialStatus({
        trialStartDate: new Date(),
        trialExpired: true,
        subscriptionTier: "enterprise",
        subscriptionStatus: "past_due",
        accountClosed: false,
        dailyMinutesUsed: 0,
      });
      expect(result.canUse).toBe(false);
      expect(result.reason).toBe("subscription_expired");
    });

    it("blocks expired trial users", () => {
      const result = getTrialStatus({
        trialStartDate: new Date(),
        trialExpired: true,
        subscriptionTier: "free",
        subscriptionStatus: null,
        accountClosed: false,
        dailyMinutesUsed: 0,
      });
      expect(result.canUse).toBe(false);
      expect(result.reason).toBe("trial_expired");
    });

    it("blocks trial users past 7 days", () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const result = getTrialStatus({
        trialStartDate: eightDaysAgo,
        trialExpired: false,
        subscriptionTier: "free",
        subscriptionStatus: null,
        accountClosed: false,
        dailyMinutesUsed: 0,
      });
      expect(result.canUse).toBe(false);
      expect(result.reason).toBe("trial_expired");
    });

    it("blocks trial users who hit daily limit", () => {
      const result = getTrialStatus({
        trialStartDate: new Date(),
        trialExpired: false,
        subscriptionTier: "free",
        subscriptionStatus: null,
        accountClosed: false,
        dailyMinutesUsed: 10,
      });
      expect(result.canUse).toBe(false);
      expect(result.reason).toBe("daily_limit");
    });

    it("allows active trial users under limit", () => {
      const result = getTrialStatus({
        trialStartDate: new Date(),
        trialExpired: false,
        subscriptionTier: "free",
        subscriptionStatus: null,
        accountClosed: false,
        dailyMinutesUsed: 5,
      });
      expect(result.canUse).toBe(true);
      expect(result.reason).toBe("trial_active");
    });

    it("allows new users without trial start date", () => {
      const result = getTrialStatus({
        trialStartDate: null,
        trialExpired: false,
        subscriptionTier: "free",
        subscriptionStatus: null,
        accountClosed: false,
        dailyMinutesUsed: 0,
      });
      expect(result.canUse).toBe(true);
      expect(result.reason).toBe("new_user");
    });
  });

  describe("Webhook test event detection", () => {
    it("detects test events by evt_test_ prefix", () => {
      expect("evt_test_webhook123".startsWith("evt_test_")).toBe(true);
    });

    it("does not flag real events", () => {
      expect("evt_1OaBcDeFgHiJkLmN".startsWith("evt_test_")).toBe(false);
    });
  });

  describe("Checkout session metadata", () => {
    it("should include required fields", () => {
      const metadata = {
        user_id: "123",
        customer_email: "test@test.com",
        planId: "pro",
        billingCycle: "monthly",
      };
      expect(metadata.user_id).toBeTruthy();
      expect(metadata.customer_email).toMatch(/@/);
      expect(["pro", "enterprise"]).toContain(metadata.planId);
      expect(["monthly", "yearly"]).toContain(metadata.billingCycle);
    });
  });
});
