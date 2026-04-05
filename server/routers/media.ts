import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { storagePut } from "../storage";

function randomSuffix() {
  return Math.random().toString(36).substring(2, 10);
}

export const mediaRouter = router({
  /**
   * Generate image using Imagen 3
   */
  generateImage: protectedProcedure
    .input(z.object({
      prompt: z.string().min(1).max(1000),
      aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ENV.geminiApiKey) throw new Error("GEMINI_API_KEY not configured");

      const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${ENV.geminiApiKey}`;
      const payload = {
        instances: [{ prompt: input.prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: input.aspectRatio,
          safetyFilterLevel: "block_only_high",
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const e = await res.text();
        throw new Error(`Imagen 3 failed: ${res.status} - ${e.substring(0, 300)}`);
      }

      const data = await res.json() as any;
      const b64 = data.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new Error("No image returned from Imagen 3");

      const buffer = Buffer.from(b64, "base64");
      const key = `images/gen-${ctx.user.id}-${Date.now()}-${randomSuffix()}.png`;
      const { url: imageUrl } = await storagePut(key, buffer, "image/png");

      return { imageUrl, prompt: input.prompt };
    }),

  /**
   * Generate video using Veo 2 (async, polls for completion)
   */
  generateVideo: protectedProcedure
    .input(z.object({
      prompt: z.string().min(1).max(1000),
      durationSeconds: z.number().min(2).max(8).default(5),
      aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ENV.geminiApiKey) throw new Error("GEMINI_API_KEY not configured");

      // Start Veo 2 generation
      const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${ENV.geminiApiKey}`;
      const payload = {
        instances: [{
          prompt: input.prompt,
        }],
        parameters: {
          aspectRatio: input.aspectRatio,
          durationSeconds: input.durationSeconds,
          sampleCount: 1,
        },
      };

      const startRes = await fetch(startUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!startRes.ok) {
        const e = await startRes.text();
        throw new Error(`Veo 2 start failed: ${startRes.status} - ${e.substring(0, 300)}`);
      }

      const operation = await startRes.json() as any;
      const operationName = operation.name;
      if (!operationName) throw new Error("No operation name returned");

      // Poll for completion (max 120s)
      const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${ENV.geminiApiKey}`;
      let attempts = 0;
      while (attempts < 40) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch(pollUrl);
        if (!pollRes.ok) throw new Error(`Poll failed: ${pollRes.status}`);
        const pollData = await pollRes.json() as any;
        if (pollData.done) {
          const videoB64 = pollData.response?.predictions?.[0]?.bytesBase64Encoded;
          const videoUri = pollData.response?.predictions?.[0]?.video?.uri;
          if (videoB64) {
            const buffer = Buffer.from(videoB64, "base64");
            const key = `videos/gen-${ctx.user.id}-${Date.now()}-${randomSuffix()}.mp4`;
            const { url: videoUrl } = await storagePut(key, buffer, "video/mp4");
            return { videoUrl, operationName };
          }
          if (videoUri) {
            return { videoUrl: videoUri, operationName };
          }
          throw new Error("Video generation done but no video data");
        }
        attempts++;
      }
      throw new Error("Video generation timed out after 120s");
    }),
});
