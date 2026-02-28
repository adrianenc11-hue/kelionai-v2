import type { ChecksumConfig } from "checksumai";

// LIVE ONLY — Checksum tests run against production
const config: ChecksumConfig = {
  apiKey: process.env.CHECKSUM_API_KEY || "",
  baseUrl: process.env.CHECKSUM_BASE_URL || "https://kelionai.app",
  testDir: "./checksum-tests",
  browser: "chromium",
};

export default config;
