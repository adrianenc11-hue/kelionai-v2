import Stripe from "stripe";
import { Request, Response } from "express";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "./env";

const stripe = ENV.stripeSecretKey ? new Stripe(ENV.stripeSecretKey) : null;
const webhookSecret = ENV.stripeWebhookSecret;

export async function handleStripeWebhook(req: Request, res: Response) {
  if (!stripe || !webhookSecret) {
    return res.status(503).json({ error: "Stripe not configured" });
  }

  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle test events
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
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("[Stripe Webhook] Checkout session completed:", session.id);

        if (session.client_reference_id) {
          const userId = parseInt(session.client_reference_id);
          const customerId = session.customer as string;
          const subscriptionId = session.subscription as string;

          // Update user with Stripe IDs
          await db
            .update(users)
            .set({
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              subscriptionTier: (session.metadata?.planId || "pro") as "free" | "pro" | "enterprise",
              subscriptionStatus: "active",
            })
            .where(eq(users.id, userId));

          console.log("[Stripe Webhook] User subscription updated:", userId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("[Stripe Webhook] Subscription updated:", subscription.id);

        // Find user by Stripe subscription ID
        const userRecord = await db
          .select()
          .from(users)
          .where(eq(users.stripeSubscriptionId, subscription.id))
          .limit(1);

        if (userRecord.length > 0) {
          const status = subscription.status === "active" ? "active" : "cancelled";
          await db
            .update(users)
            .set({ subscriptionStatus: status })
            .where(eq(users.id, userRecord[0].id));

          console.log("[Stripe Webhook] User subscription status updated:", userRecord[0].id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("[Stripe Webhook] Subscription deleted:", subscription.id);

        // Find user and downgrade to free
        const userRecord = await db
          .select()
          .from(users)
          .where(eq(users.stripeSubscriptionId, subscription.id))
          .limit(1);

        if (userRecord.length > 0) {
          await db
            .update(users)
            .set({
              subscriptionTier: "free",
              subscriptionStatus: "cancelled",
              stripeSubscriptionId: null,
            })
            .where(eq(users.id, userRecord[0].id));

          console.log("[Stripe Webhook] User downgraded to free:", userRecord[0].id);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[Stripe Webhook] Invoice paid:", invoice.id);
        // Implement invoice paid logic if needed
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[Stripe Webhook] Invoice payment failed:", invoice.id);

        // Find user and update status
        if (invoice.customer) {
          const userRecord = await db
            .select()
            .from(users)
            .where(eq(users.stripeCustomerId, invoice.customer as string))
            .limit(1);

          if (userRecord.length > 0) {
            await db
              .update(users)
              .set({ subscriptionStatus: "past_due" })
              .where(eq(users.id, userRecord[0].id));

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
