import type { ChecksumConfig } from "checksumai";

const config: ChecksumConfig = {
  apiKey: process.env.CHECKSUM_API_KEY || "",
  baseUrl: process.env.CHECKSUM_BASE_URL || "http://localhost:3000",
  testDir: "./checksum-tests",
  browser: "chromium",
};

export default config;
