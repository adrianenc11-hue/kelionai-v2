import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getSubscriptionPlans } from "../db";
import Stripe from "stripe";

type StripeSubscription = Stripe.Subscription & {
  current_period_end?: number;
  cancel_at_period_end?: boolean;
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

export const subscriptionRouter = router({
  /**
   * Get all available subscription plans
   */
  getPlans: publicProcedure.query(async () => {
    return await getSubscriptionPlans();
  }),

  /**
   * Create a checkout session for subscription purchase
   */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        planId: z.string(),
        billingCycle: z.enum(["monthly", "yearly"]),
        referralCode: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Get or create Stripe customer
        let customerId = ctx.user.stripeCustomerId;

        if (!customerId) {
          const customer = await stripe.customers.create({
            email: ctx.user.email || undefined,
            name: ctx.user.name || undefined,
            metadata: {
              userId: ctx.user.id.toString(),
            },
          });
          customerId = customer.id;
        }

        // Price mapping - use Stripe price IDs
        // These should match your Stripe dashboard products
        const priceMap: Record<string, Record<string, string>> = {
          pro: {
            monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || "price_pro_monthly",
            yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "price_pro_yearly",
          },
          enterprise: {
            monthly: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID || "price_enterprise_monthly",
            yearly: process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || "price_enterprise_yearly",
          },
        };

        const priceId = priceMap[input.planId]?.[input.billingCycle] || input.planId;

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "subscription",
          payment_method_types: ["card"],
          allow_promotion_codes: true,
          line_items: [
            {
              price: priceId,
              quantity: 1,
            },
          ],
          success_url: `${ctx.req.headers.origin || "https://kelionai.app"}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${ctx.req.headers.origin || "https://kelionai.app"}/pricing`,
          client_reference_id: ctx.user.id.toString(),
          customer_email: !customerId ? (ctx.user.email || undefined) : undefined,
          metadata: {
            userId: ctx.user.id.toString(),
            planId: input.planId,
            billingCycle: input.billingCycle,
            referralCode: input.referralCode || "",
            customerEmail: ctx.user.email || "",
            customerName: ctx.user.name || "",
          },
        });

        return {
          sessionId: session.id,
          url: session.url,
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
    try {
      if (!ctx.user.stripeSubscriptionId) {
        return {
          status: "none",
          tier: ctx.user.subscriptionTier || "free",
          currentPeriodEnd: null,
        };
      }

      const subscription = await stripe.subscriptions.retrieve(ctx.user.stripeSubscriptionId) as any;

      return {
        status: subscription.status,
        tier: ctx.user.subscriptionTier,
        currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    } catch (error) {
      console.error("[Subscription] Status retrieval failed:", error);
      return {
        status: "error",
        tier: ctx.user.subscriptionTier || "free",
        currentPeriodEnd: null,
      };
    }
  }),

  /**
   * Cancel current subscription
   */
  cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      if (!ctx.user.stripeSubscriptionId) {
        throw new Error("No active subscription");
      }

      const subscription = await stripe.subscriptions.update(ctx.user.stripeSubscriptionId, {
        cancel_at_period_end: true,
      }) as any;

      return {
        success: true,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
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
    try {
      if (!ctx.user.stripeCustomerId) {
        return [];
      }

      const invoices = await stripe.invoices.list({
        customer: ctx.user.stripeCustomerId,
        limit: 10,
      });

      return invoices.data.map((invoice: Stripe.Invoice) => ({
        id: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status,
        date: new Date(invoice.created * 1000),
        pdfUrl: invoice.invoice_pdf,
      }));
    } catch (error) {
      console.error("[Subscription] Payment history retrieval failed:", error);
      return [];
    }
  }),
});
