'use strict';

const {
  SUPPORTED_VOICES,
  SUPPORTED_LANGUAGES,
  SPEED_MIN,
  SPEED_MAX,
  DEFAULT_SPEED,
  MAX_TEXT_LENGTH,
  isValidVoice,
  isValidLanguage,
  clampSpeed,
  validateTTSRequest,
  estimateSpeechDuration,
} = require('../../src/utils/textToSpeech');

describe('textToSpeech utils', () => {
  describe('isValidVoice', () => {
    it('returns true for every supported voice', () => {
      SUPPORTED_VOICES.forEach((v) => {
        expect(isValidVoice(v)).toBe(true);
      });
    });

    it('is case-insensitive', () => {
      expect(isValidVoice('ALLOY')).toBe(true);
      expect(isValidVoice('Echo')).toBe(true);
    });

    it('returns false for unknown voices', () => {
      expect(isValidVoice('robot')).toBe(false);
      expect(isValidVoice('')).toBe(false);
    });

    it('returns false for non-string inputs', () => {
      expect(isValidVoice(null)).toBe(false);
      expect(isValidVoice(undefined)).toBe(false);
      expect(isValidVoice(1)).toBe(false);
    });
  });

  describe('isValidLanguage', () => {
    it('returns true for every supported language', () => {
      SUPPORTED_LANGUAGES.forEach((lang) => {
        expect(isValidLanguage(lang)).toBe(true);
      });
    });

    it('is case-insensitive', () => {
      expect(isValidLanguage('EN')).toBe(true);
      expect(isValidLanguage('Fr')).toBe(true);
    });

    it('returns false for unsupported language codes', () => {
      expect(isValidLanguage('xx')).toBe(false);
      expect(isValidLanguage('')).toBe(false);
    });

    it('returns false for non-string inputs', () => {
      expect(isValidLanguage(null)).toBe(false);
      expect(isValidLanguage(42)).toBe(false);
    });
  });

  describe('clampSpeed', () => {
    it('returns value unchanged when within range', () => {
      expect(clampSpeed(1.0)).toBe(1.0);
      expect(clampSpeed(SPEED_MIN)).toBe(SPEED_MIN);
      expect(clampSpeed(SPEED_MAX)).toBe(SPEED_MAX);
      expect(clampSpeed(2.5)).toBe(2.5);
    });

    it('clamps values below minimum to SPEED_MIN', () => {
      expect(clampSpeed(0)).toBe(SPEED_MIN);
      expect(clampSpeed(-5)).toBe(SPEED_MIN);
    });

    it('clamps values above maximum to SPEED_MAX', () => {
      expect(clampSpeed(10)).toBe(SPEED_MAX);
      expect(clampSpeed(SPEED_MAX + 0.1)).toBe(SPEED_MAX);
    });

    it('throws TypeError for non-number input', () => {
      expect(() => clampSpeed('fast')).toThrow(TypeError);
      expect(() => clampSpeed(null)).toThrow(TypeError);
    });

    it('throws TypeError for NaN', () => {
      expect(() => clampSpeed(NaN)).toThrow(TypeError);
    });
  });

  describe('validateTTSRequest', () => {
    const validPayload = { text: 'Hello world', voice: 'alloy', language: 'en', speed: 1.0 };

    it('returns valid=true for a fully valid payload', () => {
      const result = validateTTSRequest(validPayload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitised).toMatchObject({
        text: 'Hello world',
        voice: 'alloy',
        language: 'en',
        speed: 1.0,
      });
    });

    it('uses defaults for optional fields', () => {
      const result = validateTTSRequest({ text: 'Hi' });
      expect(result.valid).toBe(true);
      expect(result.sanitised.voice).toBe('alloy');
      expect(result.sanitised.language).toBe('en');
      expect(result.sanitised.speed).toBe(DEFAULT_SPEED);
    });

    it('trims leading/trailing whitespace from text', () => {
      const result = validateTTSRequest({ text: '  trimmed  ' });
      expect(result.sanitised.text).toBe('trimmed');
    });

    it('normalises voice and language to lowercase', () => {
      const result = validateTTSRequest({ text: 'Hi', voice: 'ALLOY', language: 'EN' });
      expect(result.sanitised.voice).toBe('alloy');
      expect(result.sanitised.language).toBe('en');
    });

    it('returns valid=false when text is missing', () => {
      const result = validateTTSRequest({ voice: 'alloy' });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('text'))).toBe(true);
    });

    it('returns valid=false when text is empty string', () => {
      const result = validateTTSRequest({ text: '   ' });
      expect(result.valid).toBe(false);
    });

    it('returns valid=false when text exceeds MAX_TEXT_LENGTH', () => {
      const result = validateTTSRequest({ text: 'a'.repeat(MAX_TEXT_LENGTH + 1) });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('characters'))).toBe(true);
    });

    it('returns valid=false for an invalid voice', () => {
      const result = validateTTSRequest({ text: 'Hi', voice: 'unknown' });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('voice'))).toBe(true);
    });

    it('returns valid=false for an invalid language', () => {
      const result = validateTTSRequest({ text: 'Hi', language: 'zz' });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('language'))).toBe(true);
    });

    it('returns valid=false when speed is out of range', () => {
      const result = validateTTSRequest({ text: 'Hi', speed: 10 });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('speed'))).toBe(true);
    });

    it('returns valid=false when speed is not a number', () => {
      const result = validateTTSRequest({ text: 'Hi', speed: 'fast' });
      expect(result.valid).toBe(false);
    });

    it('returns valid=false when payload is not an object', () => {
      expect(validateTTSRequest(null).valid).toBe(false);
      expect(validateTTSRequest('text').valid).toBe(false);
      expect(validateTTSRequest(undefined).valid).toBe(false);
    });

    it('accumulates multiple errors', () => {
      const result = validateTTSRequest({ text: '', voice: 'bad', language: 'xx', speed: 99 });
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('returns sanitised=null when validation fails', () => {
      const result = validateTTSRequest({ voice: 'alloy' });
      expect(result.sanitised).toBeNull();
    });
  });

  describe('estimateSpeechDuration', () => {
    it('returns 0 for empty text', () => {
      expect(estimateSpeechDuration('')).toBe(0);
      expect(estimateSpeechDuration('   ')).toBe(0);
    });

    it('scales proportionally with word count', () => {
      const oneWord = estimateSpeechDuration('hello');
      const twoWords = estimateSpeechDuration('hello world');
      expect(twoWords).toBeCloseTo(oneWord * 2, 5);
    });

    it('decreases duration when speed is increased', () => {
      const normal = estimateSpeechDuration('hello world', 1.0);
      const fast = estimateSpeechDuration('hello world', 2.0);
      expect(fast).toBeCloseTo(normal / 2, 5);
    });

    it('uses default speed of 1.0 when omitted', () => {
      const withDefault = estimateSpeechDuration('hello');
      const explicit = estimateSpeechDuration('hello', 1.0);
      expect(withDefault).toBe(explicit);
    });

    it('throws TypeError when text is not a string', () => {
      expect(() => estimateSpeechDuration(null)).toThrow(TypeError);
      expect(() => estimateSpeechDuration(42)).toThrow(TypeError);
    });

    it('throws RangeError when speed is zero or negative', () => {
      expect(() => estimateSpeechDuration('hi', 0)).toThrow(RangeError);
      expect(() => estimateSpeechDuration('hi', -1)).toThrow(RangeError);
    });
  });
});
