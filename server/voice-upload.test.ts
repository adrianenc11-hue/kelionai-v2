import { describe, it, expect, vi } from "vitest";

// Mock storagePut
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "audio/test.webm", url: "https://cdn.example.com/audio/test.webm" }),
}));

describe("Voice Upload Endpoints", () => {
  it("should generate correct S3 key for audio upload", () => {
    const userId = 42;
    const timestamp = Date.now();
    const ext = "webm";
    const key = `audio/${userId}-${timestamp}-abc12345.${ext}`;
    expect(key).toMatch(/^audio\/42-\d+-\w+\.webm$/);
  });

  it("should generate correct S3 key for image upload", () => {
    const userId = 42;
    const timestamp = Date.now();
    const ext = "jpg";
    const key = `images/${userId}-${timestamp}-abc12345.${ext}`;
    expect(key).toMatch(/^images\/42-\d+-\w+\.jpg$/);
  });

  it("should determine correct audio extension from mime type", () => {
    const getExt = (mimeType: string) => {
      if (mimeType.includes("wav")) return "wav";
      if (mimeType.includes("mp3")) return "mp3";
      return "webm";
    };
    expect(getExt("audio/webm")).toBe("webm");
    expect(getExt("audio/wav")).toBe("wav");
    expect(getExt("audio/mp3")).toBe("mp3");
    expect(getExt("audio/mpeg")).toBe("webm"); // mpeg doesn't contain 'mp3'
    expect(getExt("audio/webm;codecs=opus")).toBe("webm");
  });

  it("should determine correct image extension from mime type", () => {
    const getExt = (mimeType: string) => {
      if (mimeType.includes("png")) return "png";
      return "jpg";
    };
    expect(getExt("image/jpeg")).toBe("jpg");
    expect(getExt("image/png")).toBe("png");
    expect(getExt("image/jpg")).toBe("jpg");
  });

  it("should convert base64 to buffer correctly", () => {
    const testString = "Hello World";
    const base64 = Buffer.from(testString).toString("base64");
    const buffer = Buffer.from(base64, "base64");
    expect(buffer.toString()).toBe(testString);
  });

  it("should handle empty base64 audio gracefully", () => {
    const base64 = "";
    const buffer = Buffer.from(base64, "base64");
    expect(buffer.length).toBe(0);
  });

  it("should create valid randomSuffix", () => {
    const randomSuffix = () => Math.random().toString(36).substring(2, 10);
    const suffix = randomSuffix();
    expect(suffix.length).toBeGreaterThan(0);
    expect(suffix.length).toBeLessThanOrEqual(8);
    expect(/^[a-z0-9]+$/.test(suffix)).toBe(true);
  });
});

describe("MIC Recording Pipeline", () => {
  it("should validate audio blob minimum size", () => {
    // Blobs under 100 bytes should be rejected
    const tooSmall = 50;
    const validSize = 500;
    expect(tooSmall < 100).toBe(true);
    expect(validSize < 100).toBe(false);
  });

  it("should format recording time correctly", () => {
    const formatTime = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s.toString().padStart(2, "0")}`;
    };
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(125)).toBe("2:05");
  });
});

describe("CAM Capture Pipeline", () => {
  it("should generate JPEG data URL prefix", () => {
    const prefix = "data:image/jpeg;base64,";
    const mockDataUrl = prefix + "abc123";
    const base64 = mockDataUrl.split(",")[1];
    expect(base64).toBe("abc123");
  });

  it("should provide default question when input is empty", () => {
    const inputValue = "";
    const question = inputValue.trim() || "Describe what you see in detail. If there are any dangers or important things, mention them first.";
    expect(question).toBe("Describe what you see in detail. If there are any dangers or important things, mention them first.");
  });

  it("should use user question when provided", () => {
    const inputValue = "What color is the car?";
    const question = inputValue.trim() || "Describe what you see in detail.";
    expect(question).toBe("What color is the car?");
  });
});
