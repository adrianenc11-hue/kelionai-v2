import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { createRefundRequest, getRefundRequests, getAllRefundRequests, updateRefundStatus, closeUserAccount } from "../db";
import { notifyOwner } from "../_core/notification";
import Stripe from "stripe";
import { TRPCError } from "@trpc/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

export const refundRouter = router({
  /**
   * Request a refund - enforces policy:
   * - Monthly: NO refund, immediate denial with message
   * - Annual: stop current month, refund 11 months if < 3 months elapsed
   *           if >= 3 months elapsed, denied with message
   *           Account closed automatically on approved refund
   *           Refund processed in 15 business days
   */
  requestRefund: protectedProcedure
    .input(z.object({
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.stripeSubscriptionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No active subscription to refund." });
      }

      try {
        // Get subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(ctx.user.stripeSubscriptionId) as any;
        
        // Determine billing cycle from subscription interval
        const interval = subscription.items?.data?.[0]?.price?.recurring?.interval || "month";
        const billingCycle = interval === "year" ? "yearly" : "monthly";
        
        // Calculate months elapsed
        const startDate = new Date(subscription.start_date * 1000);
        const now = new Date();
        const monthsElapsed = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

        // Monthly = instant denial
        if (billingCycle === "monthly") {
          const refund = await createRefundRequest(
            ctx.user.id,
            ctx.user.stripeSubscriptionId,
            billingCycle,
            startDate,
            monthsElapsed,
            null,
            input.reason
          );
          return {
            success: false,
            status: "denied",
            message: "Monthly subscriptions are non-refundable. Your subscription will remain active until the end of the current billing period. You can cancel anytime from your subscription page.",
            refundId: refund.id,
          };
        }

        // Annual - check 3 month rule
        if (monthsElapsed >= 3) {
          const refund = await createRefundRequest(
            ctx.user.id,
            ctx.user.stripeSubscriptionId,
            billingCycle,
            startDate,
            monthsElapsed,
            null,
            input.reason
          );
          return {
            success: false,
            status: "denied",
            message: `Your annual subscription has been active for ${monthsElapsed} months. Refunds are only available within the first 3 months. You can cancel your subscription to prevent future charges.`,
            refundId: refund.id,
          };
        }

        // Annual, < 3 months - eligible for refund of 11 months
        const yearlyAmountCents = subscription.items?.data?.[0]?.price?.unit_amount || 0;
        const monthlyEquivalentCents = yearlyAmountCents / 12;
        const refundAmountCents = Math.round(monthlyEquivalentCents * 11);
        const refundAmount = (refundAmountCents / 100).toFixed(2);

        const refund = await createRefundRequest(
          ctx.user.id,
          ctx.user.stripeSubscriptionId,
          billingCycle,
          startDate,
          monthsElapsed,
          refundAmount,
          input.reason
        );

        // Cancel subscription immediately
        await stripe.subscriptions.cancel(ctx.user.stripeSubscriptionId);

        // Close the account automatically
        await closeUserAccount(ctx.user.id);

        // Notify owner about the refund request
        await notifyOwner({
          title: "Refund Request - Account Closed",
          content: `User ${ctx.user.name || ctx.user.email || ctx.user.id} requested a refund of €${refundAmount} (annual plan, ${monthsElapsed} months elapsed). Account has been closed. Please process the Stripe refund within 15 business days.`,
        }).catch(() => {});

        return {
          success: true,
          status: "pending",
          message: `Refund request submitted. Your account has been closed and €${refundAmount} (11 months) will be refunded within 15 business days.`,
          refundAmount,
          refundId: refund.id,
        };
      } catch (error: any) {
        console.error("[Refund] Error:", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to process refund request." });
      }
    }),

  /**
   * Get my refund requests
   */
  myRefunds: protectedProcedure.query(async ({ ctx }) => {
    return await getRefundRequests(ctx.user.id);
  }),

  /**
   * Admin: get all refund requests
   */
  allRefunds: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return await getAllRefundRequests();
  }),

  /**
   * Admin: process a refund (approve/deny)
   * When approved, executes actual Stripe refund
   */
  processRefund: protectedProcedure
    .input(z.object({
      refundId: z.number(),
      action: z.enum(["approved", "denied"]),
      adminNote: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      if (input.action === "approved") {
        // Execute actual Stripe refund
        try {
          // Get the refund request to find the subscription and amount
          const refunds = await getAllRefundRequests();
          const refundReq = refunds.find((r: any) => r.id === input.refundId);
          
          if (refundReq && refundReq.stripeSubscriptionId && refundReq.refundAmount) {
            // Find the latest invoice for this subscription to refund
            const invoices = await stripe.invoices.list({
              subscription: refundReq.stripeSubscriptionId,
              limit: 1,
            });
            
            if (invoices.data.length > 0 && (invoices.data[0] as any).payment_intent) {
              const refundAmountCents = Math.round(parseFloat(refundReq.refundAmount) * 100);
              await stripe.refunds.create({
                payment_intent: (invoices.data[0] as any).payment_intent as string,
                amount: refundAmountCents,
              });
              console.log(`[Refund] Stripe refund of ${refundReq.refundAmount} executed for refund #${input.refundId}`);
            }
          }
        } catch (stripeErr) {
          console.error("[Refund] Stripe refund execution failed:", stripeErr);
          // Still update status locally even if Stripe fails
        }
      }

      await updateRefundStatus(input.refundId, input.action, input.adminNote);

      return { success: true, message: `Refund ${input.action}.` };
    }),
});
