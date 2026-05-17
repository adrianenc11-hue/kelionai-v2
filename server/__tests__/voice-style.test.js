'use strict';

// Stage 6 — M26: voice style resolution + persona injection.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/kelion-voice-style-test.db';

const realtime = require('../src/routes/realtime');
const { VOICE_STYLES, resolveVoiceStyle, buildKelionPersona } = realtime;

describe('resolveVoiceStyle', () => {
  it('returns the exact preset for known keys', () => {
    expect(resolveVoiceStyle('warm').label).toBe('warm');
    expect(resolveVoiceStyle('playful').label).toBe('playful');
    expect(resolveVoiceStyle('calm').label).toBe('calm');
    expect(resolveVoiceStyle('focused').label).toBe('focused');
  });
  it('is case-insensitive', () => {
    expect(resolveVoiceStyle('WARM').label).toBe('warm');
    expect(resolveVoiceStyle('Focused').label).toBe('focused');
  });
  it('defaults to warm for unknown / empty', () => {
    expect(resolveVoiceStyle('').label).toBe('warm');
    expect(resolveVoiceStyle(null).label).toBe('warm');
    expect(resolveVoiceStyle('stern').label).toBe('warm');
  });
});

describe('buildKelionPersona — minimal prompt with full tool catalog', () => {
  it('includes Kelion identity', () => {
    const prompt = buildKelionPersona({});
    expect(prompt).toMatch(/You are Kelion/);
    expect(prompt).toMatch(/High-performance/);
    expect(prompt).toMatch(/hyper-competent/);
  });

  it('never omits the observe_user_emotion tool', () => {
    const prompt = buildKelionPersona({});
    expect(prompt).toMatch(/observe_user_emotion/);
  });

  describe('Core rules hardening', () => {
    const prompt = buildKelionPersona({});

    it('enforces action-first', () => {
      expect(prompt).toMatch(/Action-first/i);
    });

    it('forbids placeholders', () => {
      expect(prompt).toMatch(/No placeholders/i);
    });

    it('enforces response length', () => {
      expect(prompt).toMatch(/<3 sentences/i);
    });
  });

  describe('Anti-hallucination rules (PR #659)', () => {
    const prompt = buildKelionPersona({});

    it('has the HONESTY block', () => {
      expect(prompt).toMatch(/HONESTY/);
    });

    it('forbids past-tense action claims without a tool result', () => {
      expect(prompt).toMatch(/NEVER claim an action was performed unless a tool call returned/i);
      expect(prompt).toMatch(/Am instalat/);
      expect(prompt).toMatch(/Am clonat/);
      expect(prompt).toMatch(/Am afișat/);
    });

    it('requires honest "nu am tool" fallback when no matching tool exists', () => {
      expect(prompt).toMatch(/Nu am tool pentru asta/);
    });

    it('routes display requests through show_on_monitor', () => {
      expect(prompt).toMatch(/DISPLAY REQUESTS/);
      expect(prompt).toMatch(/show_on_monitor/);
    });

    it('declares runtime capabilities (allows install at runtime)', () => {
      expect(prompt).toMatch(/RUNTIME CAPABILITIES/);
      expect(prompt).toMatch(/npm install/);
      expect(prompt).toMatch(/install dependencies/i);
    });
  });

  describe('Tool catalog completeness', () => {
    const prompt = buildKelionPersona({});

    it('lists tools from auto-generated catalog', () => {
      expect(prompt).toMatch(/get_weather/);
      expect(prompt).toMatch(/geocode/);
      expect(prompt).toMatch(/read_pdf/);
      expect(prompt).toMatch(/send_email/);
      expect(prompt).toMatch(/camera_on/);
      expect(prompt).toMatch(/generate_image/);
    });

    it('lists key tools', () => {
      expect(prompt).toMatch(/calculate/);
      expect(prompt).toMatch(/get_weather/);
      expect(prompt).toMatch(/web_search/);
      expect(prompt).toMatch(/get_crypto_price/);
      expect(prompt).toMatch(/play_radio/);
      expect(prompt).toMatch(/show_on_monitor/);
      expect(prompt).toMatch(/generate_image/);
      expect(prompt).toMatch(/read_pdf/);
      expect(prompt).toMatch(/ocr_image/);
    });
  });
});
