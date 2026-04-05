/**
 * Storage - Supabase Storage (primary) + local fallback (dev)
 */
import { ENV } from "./_core/env";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import path from "path";
import fs from "fs";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = ENV.supabaseUrl;
  const key = ENV.supabaseServiceKey || ENV.supabaseAnonKey;
  if (!url || !key) return null;
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

const BUCKET = ENV.supabaseStorageBucket || "kelionai-uploads";
const LOCAL_DIR = path.resolve(process.cwd(), "uploads");

function ensureLocalDir() {
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  // Try Supabase Storage
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(key, buffer, { contentType, upsert: true });

      if (error) {
        // Bucket might not exist - try creating it
        if (error.message?.includes("not found") || error.message?.includes("Bucket")) {
          await supabase.storage.createBucket(BUCKET, { public: true });
          const retry = await supabase.storage.from(BUCKET).upload(key, buffer, { contentType, upsert: true });
          if (retry.error) throw retry.error;
        } else {
          throw error;
        }
      }

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
      return { key, url: urlData.publicUrl };
    } catch (e) {
      console.error("[Storage] Supabase error, falling back to local:", e);
    }
  }

  // Fallback: local file storage
  ensureLocalDir();
  const filePath = path.join(LOCAL_DIR, key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return { key, url: `/uploads/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);

  const supabase = getSupabase();
  if (supabase) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
    return { key, url: data.publicUrl };
  }

  return { key, url: `/uploads/${key}` };
}
