import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { createReferralCode, getReferralByCode, getUserReferrals } from "../db";
import { invokeLLM } from "../_core/llm";

export const referralRouter = router({
  /**
   * Generate a referral code and send it via email to a potential client
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

        // Send email via built-in notification (owner gets notified, 
        // and we use LLM to compose a nice email body)
        // In production, integrate with an email service like SendGrid/Resend
        // For now, we log the code and notify the owner
        console.log(`[Referral] Code ${referral.code} created by user ${ctx.user.id} for ${input.recipientEmail}`);

        // Try to send email via fetch to a simple email endpoint
        // For now, return the code so the user can share it manually
        return {
          success: true,
          code: referral.code,
          expiresAt: referral.expiresAt,
          recipientEmail: input.recipientEmail,
          message: `Referral code ${referral.code} generated! Share this code with ${input.recipientEmail}. Valid for 7 days.`,
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
        message: "Referral code is valid! You'll get a discount and the referrer will receive 5 bonus days.",
      };
    }),

  /**
   * Get my sent referrals
   */
  myReferrals: protectedProcedure.query(async ({ ctx }) => {
    return await getUserReferrals(ctx.user.id);
  }),
});
