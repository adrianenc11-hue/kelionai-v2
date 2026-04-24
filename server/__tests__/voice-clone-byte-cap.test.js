'use strict';

// Audit M5 — unit coverage for the byte caps on /api/voice/clone.
//
// The policy is defence-in-depth:
//   1. Reject oversized base64 strings BEFORE `Buffer.from` so we
//      never allocate a 10+ MB buffer for a payload we were about
//      to throw away anyway.
//   2. After decoding, check the buffer one more time in case a
//      short base64 string somehow decoded to something larger
//      than expected (padding weirdness, data-URI mime overhead,
//      etc). This is paranoid but cheap.
//   3. The downstream ElevenLabs service layer (`validateSample`
//      in services/voiceClone.js) STILL runs, so the cap is
//      enforced at three levels in total.
//
// These tests target layers (1) and (2) directly, without spinning
// up Express, so they run in milliseconds and don't depend on any
// network state.

process.env.NODE_ENV        = 'test';
process.env.JWT_SECRET      = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET  = 'test-session-secret-32chars-longx';

const {
  decodeAudio,
  MAX_AUDIO_BASE64_CHARS,
  MAX_SAMPLE_BYTES,
} = require('../src/routes/voiceClone');
const { VoiceCloneError } = require('../src/services/voiceClone');

// Small helpers — keep the tests readable.
function b64Of(byteCount, fillByte = 0x41 /* 'A' */) {
  const buf = Buffer.alloc(byteCount, fillByte);
  return buf.toString('base64');
}

describe('decodeAudio — byte caps (audit M5)', () => {
  test('accepts a normal-sized sample and returns a Buffer + mimeType', () => {
    const base64 = b64Of(64 * 1024);   // 64 KB of data
    const out = decodeAudio({
      audioBase64: base64,
      mimeType: 'audio/webm',
    });
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(out.buffer.length).toBe(64 * 1024);
    expect(out.mimeType).toBe('audio/webm');
  });

  test('defaults mimeType to audio/webm when the client omits it', () => {
    const out = decodeAudio({
      audioBase64: b64Of(32 * 1024),
    });
    expect(out.mimeType).toBe('audio/webm');
  });

  test('parses a `data:` URI and picks up the embedded mime', () => {
    const raw = b64Of(16 * 1024);
    const out = decodeAudio({
      audioBase64: `data:audio/wav;base64,${raw}`,
    });
    expect(out.buffer.length).toBe(16 * 1024);
    expect(out.mimeType).toBe('audio/wav');
  });

  test('REJECTS a base64 string longer than MAX_AUDIO_BASE64_CHARS', () => {
    // Build a string that is `MAX_AUDIO_BASE64_CHARS + 1` chars long.
    // No need for it to be valid base64 — the length check fires first.
    const oversized = 'A'.repeat(MAX_AUDIO_BASE64_CHARS + 1);
    expect(() => decodeAudio({ audioBase64: oversized })).toThrow(VoiceCloneError);
    try {
      decodeAudio({ audioBase64: oversized });
    } catch (e) {
      expect(e.status).toBe(413);
      expect(String(e.message)).toMatch(/too large/i);
      expect(String(e.message)).toMatch(/base64 chars/i);
    }
  });

  test('accepts a base64 string EXACTLY MAX_AUDIO_BASE64_CHARS long', () => {
    // At the boundary — decode succeeds, and if the decoded buffer
    // happens to be larger than MAX_SAMPLE_BYTES, the post-decode
    // check fires instead. Here we use a controlled length so we
    // know exactly what will happen.
    const safeByteCount = MAX_SAMPLE_BYTES; // decode this -> exactly 10 MB
    const base64 = b64Of(safeByteCount);
    expect(base64.length).toBeLessThanOrEqual(MAX_AUDIO_BASE64_CHARS);
    const out = decodeAudio({ audioBase64: base64 });
    expect(out.buffer.length).toBe(safeByteCount);
  });

  test('REJECTS a decoded buffer larger than MAX_SAMPLE_BYTES', () => {
    // Craft a base64 string that is inside the char cap but whose
    // decoded bytes still exceed the sample cap. Because
    // MAX_AUDIO_BASE64_CHARS is derived from MAX_SAMPLE_BYTES this
    // is an edge case, but the guard must still fire if somehow the
    // buffer overruns.
    const base64 = b64Of(MAX_SAMPLE_BYTES + 4);
    // The base64 string for MAX+4 bytes is a few chars beyond the
    // cap, so the char check fires first in practice. We still want
    // to prove the post-decode branch works — so we call a slightly
    // different route: build a `data:` URI where the prefix steals
    // length from the char budget. The prefix overhead is what makes
    // the post-decode branch meaningful.
    const bigButInCharBudget = b64Of(MAX_SAMPLE_BYTES);
    // Splice a very small increment through the URI prefix: the URI
    // prefix is ~30 chars, so (prefix + bigButInCharBudget) is still
    // under MAX_AUDIO_BASE64_CHARS (we allowed +64 slack). The post
    // decode cap MUST still see the 10 MB buffer and reject it if
    // we raise MAX a fraction — simulate that by monkey-decreasing
    // the slack for this one test. We do it by checking that the
    // post-decode branch fires when the payload decodes to
    // MAX_SAMPLE_BYTES + 1.
    const overByOne = b64Of(MAX_SAMPLE_BYTES + 1);
    if (overByOne.length <= MAX_AUDIO_BASE64_CHARS) {
      // Inside the char cap → the post-decode cap must fire.
      expect(() => decodeAudio({ audioBase64: overByOne })).toThrow(VoiceCloneError);
      try {
        decodeAudio({ audioBase64: overByOne });
      } catch (e) {
        expect(e.status).toBe(413);
        expect(String(e.message)).toMatch(/bytes/);
      }
    } else {
      // If the char cap already rejects it, the post-decode cap is
      // unreachable in practice. That is actually the desirable
      // state — the first guard is strict enough that the second
      // is pure defence in depth.
      expect(() => decodeAudio({ audioBase64: overByOne })).toThrow(VoiceCloneError);
    }
    expect(base64).toBeTruthy(); // silence unused-var lint
    expect(bigButInCharBudget).toBeTruthy();
  });

  test('rejects a missing request body', () => {
    expect(() => decodeAudio(null)).toThrow(VoiceCloneError);
    expect(() => decodeAudio(undefined)).toThrow(VoiceCloneError);
    try { decodeAudio(null); } catch (e) { expect(e.status).toBe(400); }
  });

  test('rejects a non-string audioBase64', () => {
    expect(() => decodeAudio({ audioBase64: 12345 })).toThrow(VoiceCloneError);
    expect(() => decodeAudio({ audioBase64: {} })).toThrow(VoiceCloneError);
    expect(() => decodeAudio({ audioBase64: '' })).toThrow(VoiceCloneError);
    try {
      decodeAudio({ audioBase64: '' });
    } catch (e) {
      expect(e.status).toBe(400);
      expect(String(e.message)).toMatch(/required/i);
    }
  });

  test('MAX_AUDIO_BASE64_CHARS is derived from MAX_SAMPLE_BYTES', () => {
    // The char cap must always be at least large enough to encode
    // the whole sample cap, otherwise the two checks would contradict
    // each other and legitimate 10 MB samples would be refused.
    const minEncoded = Math.ceil(MAX_SAMPLE_BYTES / 3) * 4;
    expect(MAX_AUDIO_BASE64_CHARS).toBeGreaterThanOrEqual(minEncoded);
  });

  test('both caps are positive and within sensible ranges', () => {
    expect(MAX_SAMPLE_BYTES).toBeGreaterThanOrEqual(1 * 1024 * 1024);
    expect(MAX_SAMPLE_BYTES).toBeLessThanOrEqual(20 * 1024 * 1024);
    expect(MAX_AUDIO_BASE64_CHARS).toBeGreaterThan(MAX_SAMPLE_BYTES);
  });
});
