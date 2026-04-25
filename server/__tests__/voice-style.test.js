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
    expect(prompt).toMatch(/AE Studio/);
    expect(prompt).toMatch(/Adrian Enciulescu/);
  });

  it('never omits the observe_user_emotion tool', () => {
    const prompt = buildKelionPersona({});
    expect(prompt).toMatch(/observe_user_emotion/);
  });

  // Honesty hardening — pins the anti-hallucination rules so future edits
  // cannot silently water them down.
  describe('Honesty hardening', () => {
    const prompt = buildKelionPersona({});

    it('forbids invented actions', () => {
      expect(prompt).toMatch(/Never claim you did something you did not do/);
    });

    it('licences "I do not know" explicitly', () => {
      expect(prompt).toMatch(/I don't know/);
    });

    it('forbids guessing', () => {
      expect(prompt).toMatch(/Never guess/i);
    });

    it('forbids inventing facts', () => {
      expect(prompt).toMatch(/Never invent/i);
    });

    it('forbids inventing user requirements', () => {
      expect(prompt).toMatch(/Never invent requirements/i);
    });
  });

  describe('Tool catalog completeness', () => {
    const prompt = buildKelionPersona({});

    it('lists all core tool categories', () => {
      expect(prompt).toMatch(/Data & Search/);
      expect(prompt).toMatch(/Finance/);
      expect(prompt).toMatch(/Geography/);
      expect(prompt).toMatch(/Documents/);
      expect(prompt).toMatch(/Communication/);
      expect(prompt).toMatch(/Camera/);
      expect(prompt).toMatch(/Planning/);
    });

    it('lists key tools', () => {
      expect(prompt).toMatch(/calculate/);
      expect(prompt).toMatch(/get_weather/);
      expect(prompt).toMatch(/web_search/);
      expect(prompt).toMatch(/translate/);
      expect(prompt).toMatch(/get_crypto_price/);
      expect(prompt).toMatch(/play_radio/);
      expect(prompt).toMatch(/show_on_monitor/);
      expect(prompt).toMatch(/plan_task/);
      expect(prompt).toMatch(/read_pdf/);
      expect(prompt).toMatch(/ocr_image/);
    });
  });
});
