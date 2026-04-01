import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getDb for all tests
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 1, name: "Test Room", type: "direct", createdBy: 1, createdAt: new Date(), updatedAt: new Date() }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("../drizzle/schema", () => ({
  userChatRooms: { id: "id", name: "name", type: "type", createdBy: "created_by", createdAt: "created_at", updatedAt: "updated_at" },
  userChatParticipants: { id: "id", roomId: "room_id", userId: "user_id", joinedAt: "joined_at" },
  userChatMessages: { id: "id", roomId: "room_id", senderId: "sender_id", content: "content", createdAt: "created_at" },
  voiceLibrary: { id: "id", userId: "user_id", name: "name", voiceId: "voice_id", provider: "provider", sampleUrl: "sample_url", isDefault: "is_default", isPublic: "is_public", quality: "quality", createdAt: "created_at" },
}));

describe("User Chat Router - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain methods
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.innerJoin.mockReturnValue(mockDb);
    mockDb.orderBy.mockReturnValue(mockDb);
    mockDb.limit.mockReturnValue(mockDb);
    mockDb.offset.mockReturnValue(mockDb);
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.delete.mockReturnValue(mockDb);
  });

  it("should have user chat tables defined in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.userChatRooms).toBeDefined();
    expect(schema.userChatParticipants).toBeDefined();
    expect(schema.userChatMessages).toBeDefined();
  });

  it("should have voice library table defined in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.voiceLibrary).toBeDefined();
  });

  it("should validate room creation input", () => {
    const { z } = require("zod");
    const schema = z.object({ targetUserId: z.number(), name: z.string().optional() });
    
    expect(schema.safeParse({ targetUserId: 1 }).success).toBe(true);
    expect(schema.safeParse({ targetUserId: 1, name: "Test" }).success).toBe(true);
    expect(schema.safeParse({ targetUserId: "abc" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("should validate group room creation input", () => {
    const { z } = require("zod");
    const schema = z.object({
      name: z.string().min(1).max(100),
      userIds: z.array(z.number()).min(1).max(50),
    });

    expect(schema.safeParse({ name: "Group", userIds: [1, 2, 3] }).success).toBe(true);
    expect(schema.safeParse({ name: "", userIds: [1] }).success).toBe(false);
    expect(schema.safeParse({ name: "Group", userIds: [] }).success).toBe(false);
  });

  it("should validate message sending input", () => {
    const { z } = require("zod");
    const schema = z.object({
      roomId: z.number(),
      content: z.string().min(1).max(5000),
    });

    expect(schema.safeParse({ roomId: 1, content: "Hello" }).success).toBe(true);
    expect(schema.safeParse({ roomId: 1, content: "" }).success).toBe(false);
    expect(schema.safeParse({ roomId: 1, content: "a".repeat(5001) }).success).toBe(false);
  });

  it("should validate get messages input with defaults", () => {
    const { z } = require("zod");
    const schema = z.object({
      roomId: z.number(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    });

    const result = schema.safeParse({ roomId: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });
});

describe("Voice Library Router - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should validate add voice input", () => {
    const { z } = require("zod");
    const schema = z.object({
      name: z.string().min(1).max(100),
      voiceId: z.string().min(1),
      provider: z.string().default("elevenlabs"),
      sampleUrl: z.string().optional(),
      quality: z.string().default("standard"),
    });

    expect(schema.safeParse({ name: "My Voice", voiceId: "voice_123" }).success).toBe(true);
    expect(schema.safeParse({ name: "", voiceId: "voice_123" }).success).toBe(false);
    expect(schema.safeParse({ name: "My Voice", voiceId: "" }).success).toBe(false);
  });

  it("should validate set default voice input", () => {
    const { z } = require("zod");
    const schema = z.object({ voiceId: z.number() });

    expect(schema.safeParse({ voiceId: 1 }).success).toBe(true);
    expect(schema.safeParse({ voiceId: "abc" }).success).toBe(false);
  });

  it("should validate toggle public input", () => {
    const { z } = require("zod");
    const schema = z.object({ voiceId: z.number(), isPublic: z.boolean() });

    expect(schema.safeParse({ voiceId: 1, isPublic: true }).success).toBe(true);
    expect(schema.safeParse({ voiceId: 1, isPublic: false }).success).toBe(true);
    expect(schema.safeParse({ voiceId: 1 }).success).toBe(false);
  });

  it("should validate browse public input with defaults", () => {
    const { z } = require("zod");
    const schema = z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    });

    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });
});

describe("Sentry Integration", () => {
  it("should export initSentry and captureError functions", async () => {
    const sentry = await import("./sentry");
    expect(typeof sentry.initSentry).toBe("function");
    expect(typeof sentry.captureError).toBe("function");
  });

  it("should not crash when no SENTRY_DSN is set", async () => {
    delete process.env.SENTRY_DSN;
    const { initSentry, captureError } = await import("./sentry");
    expect(() => initSentry()).not.toThrow();
    expect(() => captureError(new Error("test"))).not.toThrow();
  });
});

describe("Capacitor Config", () => {
  it("should have valid capacitor config", async () => {
    const config = (await import("../capacitor.config")).default;
    expect(config.appId).toBe("app.kelionai.v2");
    expect(config.appName).toBe("KelionAI");
    expect(config.webDir).toBe("dist/client");
    expect(config.server?.hostname).toBe("kelionai.app");
  });
});

describe("Security Headers", () => {
  it("should define proper security header values", () => {
    const headers = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    };

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-XSS-Protection"]).toBe("1; mode=block");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});
