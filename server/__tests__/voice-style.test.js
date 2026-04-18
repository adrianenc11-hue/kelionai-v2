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

describe('buildKelionPersona — Stage 6 voice style', () => {
  it('injects the current mode label into the system prompt', () => {
    const promptWarm    = buildKelionPersona({ voiceStyle: VOICE_STYLES.warm });
    const promptPlayful = buildKelionPersona({ voiceStyle: VOICE_STYLES.playful });
    expect(promptWarm).toMatch(/current mode: warm/);
    expect(promptPlayful).toMatch(/current mode: playful/);
    expect(promptWarm).toMatch(/unhurried pace, gentle inflection/);
    expect(promptPlayful).toMatch(/lighter energy, brighter pitch/);
  });

  it('never omits the observe_user_emotion guidance', () => {
    const prompt = buildKelionPersona({});
    expect(prompt).toMatch(/observe_user_emotion/);
    expect(prompt).toMatch(/SILENT tool/);
  });

  it('falls back to warm when no voiceStyle passed', () => {
    const prompt = buildKelionPersona({});
    expect(prompt).toMatch(/current mode: warm/);
  });
});
