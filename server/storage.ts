/**
 * Storage helpers - supports both Manus proxy and standalone S3
 * When running standalone (Railway), uses AWS S3 directly if configured,
 * otherwise falls back to local file storage with absolute URL serving
 */
import { ENV } from './_core/env';
import path from 'path';
import fs from 'fs';

type StorageConfig = { baseUrl: string; apiKey: string } | null;

function getManusStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    return null; // Not on Manus, use fallback
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });
  return (await response.json()).url;
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

// Local storage fallback directory
const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), 'uploads');

function ensureLocalStorageDir() {
  if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
    fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
  }
}

/**
 * Get the base URL for the server (Railway, local dev, etc.)
 * Used to construct absolute URLs for local file storage
 */
function getServerBaseUrl(): string {
  // Railway provides RAILWAY_PUBLIC_DOMAIN
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) {
    return `https://${railwayDomain}`;
  }
  // Custom domain
  const customDomain = process.env.DOMAIN;
  if (customDomain) {
    return customDomain.startsWith('http') ? customDomain : `https://${customDomain}`;
  }
  // Fallback to PORT-based localhost
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const manusConfig = getManusStorageConfig();
  
  if (manusConfig) {
    // Manus proxy storage
    const key = normalizeKey(relKey);
    const uploadUrl = buildUploadUrl(manusConfig.baseUrl, key);
    const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: buildAuthHeaders(manusConfig.apiKey),
      body: formData,
    });

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(
        `Storage upload failed (${response.status} ${response.statusText}): ${message}`
      );
    }
    const url = (await response.json()).url;
    return { key, url };
  }
  
  // Check for AWS S3 config
  const s3Bucket = process.env.S3_BUCKET;
  const s3Region = process.env.S3_REGION || 'us-east-1';
  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  
  if (s3Bucket && awsAccessKey && awsSecretKey) {
    // Use AWS S3 directly
    const key = normalizeKey(relKey);
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: s3Region,
      credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey },
    });
    
    const buffer = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
    await s3.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    
    const url = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${key}`;
    return { key, url };
  }
  
  // Fallback: local file storage with ABSOLUTE URLs
  ensureLocalStorageDir();
  const key = normalizeKey(relKey);
  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const buffer = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
  fs.writeFileSync(filePath, buffer);
  
  // Return ABSOLUTE URL so server-side fetch works too
  const baseUrl = getServerBaseUrl();
  const url = `${baseUrl}/uploads/${key}`;
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string; }> {
  const manusConfig = getManusStorageConfig();
  
  if (manusConfig) {
    const key = normalizeKey(relKey);
    return {
      key,
      url: await buildDownloadUrl(manusConfig.baseUrl, key, manusConfig.apiKey),
    };
  }
  
  // Check for AWS S3
  const s3Bucket = process.env.S3_BUCKET;
  const s3Region = process.env.S3_REGION || 'us-east-1';
  
  if (s3Bucket) {
    const key = normalizeKey(relKey);
    return {
      key,
      url: `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${key}`,
    };
  }
  
  // Fallback: local with absolute URL
  const key = normalizeKey(relKey);
  const baseUrl = getServerBaseUrl();
  return {
    key,
    url: `${baseUrl}/uploads/${key}`,
  };
}
