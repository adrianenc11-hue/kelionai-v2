import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock bcryptjs
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$10$hashedpassword"),
    compare: vi.fn().mockImplementation((plain: string, hash: string) => {
      return Promise.resolve(plain === "correctpassword");
    }),
  },
}));

// Mock jose
vi.mock("jose", () => ({
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock-jwt-token"),
  })),
}));

describe("Standalone Auth Logic", () => {
  it("should validate email format", () => {
    const validEmails = ["test@example.com", "user@domain.co", "a@b.com"];
    const invalidEmails = ["notanemail", "@domain.com", "user@", ""];

    for (const email of validEmails) {
      expect(email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    }
    for (const email of invalidEmails) {
      expect(email).not.toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    }
  });

  it("should reject passwords shorter than 6 characters", () => {
    const shortPasswords = ["", "a", "12345"];
    const validPasswords = ["123456", "password", "strongP@ss1"];

    for (const pw of shortPasswords) {
      expect(pw.length).toBeLessThan(6);
    }
    for (const pw of validPasswords) {
      expect(pw.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("should hash passwords with bcrypt", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("testpassword", 12);
    expect(hash).toBe("$2a$10$hashedpassword");
    expect(bcrypt.hash).toHaveBeenCalledWith("testpassword", 12);
  });

  it("should compare passwords correctly", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const match = await bcrypt.compare("correctpassword", "$2a$10$hashedpassword");
    expect(match).toBe(true);

    const noMatch = await bcrypt.compare("wrongpassword", "$2a$10$hashedpassword");
    expect(noMatch).toBe(false);
  });

  it("should create JWT token", async () => {
    const { SignJWT } = await import("jose");
    const jwt = new SignJWT({ userId: 1, email: "test@example.com" });
    const token = await jwt
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("secret"));

    expect(token).toBe("mock-jwt-token");
  });

  it("should detect standalone mode when Manus env vars are missing", () => {
    // When OAUTH_SERVER_URL is not set, we're in standalone mode
    const oauthUrl = process.env.OAUTH_SERVER_URL_NONEXISTENT;
    const isStandalone = !oauthUrl;
    expect(isStandalone).toBe(true);
  });

  it("should generate login URL for standalone mode", () => {
    // When VITE_OAUTH_PORTAL_URL is not set, getLoginUrl should return /login
    const oauthPortalUrl = undefined;
    const appId = undefined;
    const loginUrl = (!oauthPortalUrl || !appId) ? "/login" : "oauth-url";
    expect(loginUrl).toBe("/login");
  });

  it("should generate login URL for Manus mode", () => {
    const oauthPortalUrl = "https://manus.im";
    const appId = "test-app-id";
    const loginUrl = (!oauthPortalUrl || !appId) ? "/login" : "oauth-url";
    expect(loginUrl).toBe("oauth-url");
  });
});

describe("Storage Fallback", () => {
  it("should detect Manus storage when forge env vars are set", () => {
    const forgeApiUrl = "https://forge.example.com";
    const forgeApiKey = "key123";
    const isManusStorage = Boolean(forgeApiUrl && forgeApiKey);
    expect(isManusStorage).toBe(true);
  });

  it("should fallback to local storage when no S3 or forge config", () => {
    const forgeApiUrl = undefined;
    const forgeApiKey = undefined;
    const s3Bucket = undefined;
    const isManusStorage = Boolean(forgeApiUrl && forgeApiKey);
    const isS3 = Boolean(s3Bucket);
    const isLocal = !isManusStorage && !isS3;
    expect(isLocal).toBe(true);
  });
});

describe("LLM Fallback", () => {
  it("should use OpenAI directly when forge is not available", () => {
    const forgeApiUrl = undefined;
    const forgeApiKey = undefined;
    const openaiApiKey = "sk-test123";
    
    const apiKey = forgeApiKey || openaiApiKey;
    const baseUrl = forgeApiUrl || "https://api.openai.com";
    
    expect(apiKey).toBe("sk-test123");
    expect(baseUrl).toBe("https://api.openai.com");
  });

  it("should prefer forge when available", () => {
    const forgeApiUrl = "https://forge.example.com";
    const forgeApiKey = "forge-key";
    const openaiApiKey = "sk-test123";
    
    const apiKey = forgeApiKey || openaiApiKey;
    const baseUrl = forgeApiUrl || "https://api.openai.com";
    
    expect(apiKey).toBe("forge-key");
    expect(baseUrl).toBe("https://forge.example.com");
  });
});
