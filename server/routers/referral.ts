import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { createReferralCode, getReferralByCode, getUserReferrals } from "../db";
import { notifyOwner } from "../_core/notification";

export const referralRouter = router({
  /**
   * Generate a referral code and send it via email to a potential client
   * Since we can't send emails directly to arbitrary addresses,
   * we notify the owner and return the code for the user to share manually
   */
  sendReferral: protectedProcedure
    .input(z.object({
      recipientEmail: z.string().email(),
      recipientName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Create referral code in DB (valid 1 week)
        const referral = await createReferralCode(ctx.user.id, input.recipientEmail);

        // Notify owner about the referral
        await notifyOwner({
          title: `New Referral Code Generated`,
          content: `User ${ctx.user.name || ctx.user.email || ctx.user.id} generated referral code ${referral.code} for ${input.recipientEmail}. Code expires ${referral.expiresAt.toISOString().slice(0, 10)}. Please forward this code to the recipient.`,
        }).catch(() => {
          console.warn("[Referral] Owner notification failed, code still created");
        });

        console.log(`[Referral] Code ${referral.code} created by user ${ctx.user.id} for ${input.recipientEmail}`);

        return {
          success: true,
          code: referral.code,
          expiresAt: referral.expiresAt,
          recipientEmail: input.recipientEmail,
          message: `Referral code ${referral.code} generated! Share this code with ${input.recipientName || input.recipientEmail}. Valid for 7 days. When they subscribe using this code, you'll receive 5 bonus days on your subscription.`,
        };
      } catch (error) {
        console.error("[Referral] Failed to create referral:", error);
        throw new Error("Failed to create referral code");
      }
    }),

  /**
   * Validate a referral code (used at checkout)
   */
  validateCode: protectedProcedure
    .input(z.object({
      code: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const referral = await getReferralByCode(input.code);

      if (!referral) {
        return { valid: false, message: "Invalid referral code." };
      }

      if (referral.usedBy) {
        return { valid: false, message: "This referral code has already been used." };
      }

      if (new Date() > referral.expiresAt) {
        return { valid: false, message: "This referral code has expired." };
      }

      // Can't use your own referral code
      if (referral.senderUserId === ctx.user.id) {
        return { valid: false, message: "You cannot use your own referral code." };
      }

      return {
        valid: true,
        referralId: referral.id,
        message: "Referral code is valid! The referrer will receive 5 bonus days on their subscription after your payment is confirmed.",
      };
    }),

  /**
   * Get my sent referrals
   */
  myReferrals: protectedProcedure.query(async ({ ctx }) => {
    return await getUserReferrals(ctx.user.id);
  }),
});
