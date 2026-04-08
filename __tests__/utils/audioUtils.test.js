'use strict';

const {
  SUPPORTED_FORMATS,
  SUPPORTED_SAMPLE_RATES,
  MAX_AUDIO_DURATION_SECONDS,
  isValidAudioFormat,
  isValidSampleRate,
  normaliseVolume,
  formatDuration,
  isDurationAllowed,
  estimateFileSize,
} = require('../../src/utils/audioUtils');

describe('audioUtils', () => {
  describe('isValidAudioFormat', () => {
    it('returns true for every supported format', () => {
      SUPPORTED_FORMATS.forEach((fmt) => {
        expect(isValidAudioFormat(fmt)).toBe(true);
      });
    });

    it('is case-insensitive', () => {
      expect(isValidAudioFormat('MP3')).toBe(true);
      expect(isValidAudioFormat('WAV')).toBe(true);
      expect(isValidAudioFormat('OGG')).toBe(true);
    });

    it('returns false for an unsupported format', () => {
      expect(isValidAudioFormat('aac')).toBe(false);
      expect(isValidAudioFormat('wma')).toBe(false);
      expect(isValidAudioFormat('')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isValidAudioFormat(null)).toBe(false);
      expect(isValidAudioFormat(undefined)).toBe(false);
      expect(isValidAudioFormat(42)).toBe(false);
      expect(isValidAudioFormat({})).toBe(false);
    });
  });

  describe('isValidSampleRate', () => {
    it('returns true for every supported sample rate', () => {
      SUPPORTED_SAMPLE_RATES.forEach((rate) => {
        expect(isValidSampleRate(rate)).toBe(true);
      });
    });

    it('returns false for an unsupported rate', () => {
      expect(isValidSampleRate(12345)).toBe(false);
      expect(isValidSampleRate(0)).toBe(false);
      expect(isValidSampleRate(-16000)).toBe(false);
    });

    it('returns false for non-integer numbers', () => {
      expect(isValidSampleRate(44100.5)).toBe(false);
      expect(isValidSampleRate(NaN)).toBe(false);
    });

    it('returns false for non-number values', () => {
      expect(isValidSampleRate('44100')).toBe(false);
      expect(isValidSampleRate(null)).toBe(false);
    });
  });

  describe('normaliseVolume', () => {
    it('returns the value unchanged when already in range', () => {
      expect(normaliseVolume(0)).toBe(0);
      expect(normaliseVolume(0.5)).toBe(0.5);
      expect(normaliseVolume(1)).toBe(1);
    });

    it('clamps values below 0 to 0', () => {
      expect(normaliseVolume(-0.1)).toBe(0);
      expect(normaliseVolume(-100)).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
      expect(normaliseVolume(1.1)).toBe(1);
      expect(normaliseVolume(200)).toBe(1);
    });

    it('throws TypeError for non-number input', () => {
      expect(() => normaliseVolume('0.5')).toThrow(TypeError);
      expect(() => normaliseVolume(null)).toThrow(TypeError);
      expect(() => normaliseVolume(undefined)).toThrow(TypeError);
    });

    it('throws TypeError for NaN', () => {
      expect(() => normaliseVolume(NaN)).toThrow(TypeError);
    });
  });

  describe('formatDuration', () => {
    it('formats zero milliseconds correctly', () => {
      expect(formatDuration(0)).toBe('00:00');
    });

    it('formats exact minutes', () => {
      expect(formatDuration(60000)).toBe('01:00');
      expect(formatDuration(120000)).toBe('02:00');
    });

    it('formats mixed minutes and seconds', () => {
      expect(formatDuration(90000)).toBe('01:30');
      expect(formatDuration(3661000)).toBe('61:01');
    });

    it('zero-pads single-digit seconds', () => {
      expect(formatDuration(5000)).toBe('00:05');
    });

    it('truncates sub-second precision', () => {
      expect(formatDuration(1500)).toBe('00:01');
    });

    it('throws RangeError for negative duration', () => {
      expect(() => formatDuration(-1)).toThrow(RangeError);
    });

    it('throws RangeError for Infinity', () => {
      expect(() => formatDuration(Infinity)).toThrow(RangeError);
    });

    it('throws RangeError for non-number input', () => {
      expect(() => formatDuration('60000')).toThrow(RangeError);
    });
  });

  describe('isDurationAllowed', () => {
    it('returns true for 0 seconds', () => {
      expect(isDurationAllowed(0)).toBe(true);
    });

    it('returns true for the maximum allowed duration', () => {
      expect(isDurationAllowed(MAX_AUDIO_DURATION_SECONDS)).toBe(true);
    });

    it('returns false for durations exceeding the maximum', () => {
      expect(isDurationAllowed(MAX_AUDIO_DURATION_SECONDS + 1)).toBe(false);
    });

    it('returns false for negative values', () => {
      expect(isDurationAllowed(-1)).toBe(false);
    });

    it('returns false for non-number input', () => {
      expect(isDurationAllowed('300')).toBe(false);
      expect(isDurationAllowed(null)).toBe(false);
    });
  });

  describe('estimateFileSize', () => {
    it('calculates size for mono 16-bit 44100 Hz audio', () => {
      const result = estimateFileSize(1, 44100, 1, 16);
      expect(result).toBe(88200);
    });

    it('doubles the size for stereo vs mono', () => {
      const mono = estimateFileSize(1, 44100, 1, 16);
      const stereo = estimateFileSize(1, 44100, 2, 16);
      expect(stereo).toBe(mono * 2);
    });

    it('uses default channel and bit-depth values', () => {
      const withDefaults = estimateFileSize(1, 44100);
      const explicit = estimateFileSize(1, 44100, 1, 16);
      expect(withDefaults).toBe(explicit);
    });

    it('scales linearly with duration', () => {
      const one = estimateFileSize(1, 16000, 1, 16);
      const ten = estimateFileSize(10, 16000, 1, 16);
      expect(ten).toBe(one * 10);
    });

    it('throws RangeError for a negative duration', () => {
      expect(() => estimateFileSize(-1, 44100)).toThrow(RangeError);
    });

    it('throws RangeError for zero sample rate', () => {
      expect(() => estimateFileSize(1, 0)).toThrow(RangeError);
    });

    it('throws RangeError for negative channels', () => {
      expect(() => estimateFileSize(1, 44100, -1, 16)).toThrow(RangeError);
    });

    it('throws RangeError for zero bit depth', () => {
      expect(() => estimateFileSize(1, 44100, 1, 0)).toThrow(RangeError);
    });
  });
});
