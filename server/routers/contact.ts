import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { notifyOwner } from "../_core/notification";
import { getDb } from "../db";
import { sql } from "drizzle-orm";

export const contactRouter = router({
  /**
   * Send a contact message with AI auto-response
   */
  sendMessage: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        subject: z.string().min(1),
        message: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ input }) => {
      // 1. Save to database
      const db = await getDb();
      if (db) {
        try {
          await db.execute(
            sql`INSERT INTO contact_messages (name, email, subject, message, status, created_at)
                VALUES (${input.name}, ${input.email}, ${input.subject}, ${input.message}, 'new', NOW())`
          );
        } catch (err) {
          console.error("[Contact] Failed to save message:", err);
        }
      }

      // 2. Notify admin
      try {
        await notifyOwner({
          title: `New Contact: ${input.subject}`,
          content: `From: ${input.name} (${input.email})\n\n${input.message}`,
        });
      } catch (err) {
        console.error("[Contact] Failed to notify owner:", err);
      }

      // 3. Generate AI auto-response
      let aiResponse = "";
      try {
        const result = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are KelionAI's customer support assistant. Generate a brief, helpful auto-response to this contact form message. Be warm, professional, and acknowledge their specific concern. Keep it under 100 words. If it's a technical issue, suggest they try the chat feature. If it's billing, mention they can check their subscription page.`,
            },
            {
              role: "user",
              content: `Subject: ${input.subject}\nMessage: ${input.message}`,
            },
          ],
        });
        aiResponse = (result as any)?.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.error("[Contact] AI auto-response failed:", err);
        aiResponse = "Thank you for reaching out! Our team has received your message and will get back to you within 24 hours.";
      }

      return {
        success: true,
        aiResponse,
      };
    }),
});
