'use strict';

const SUPPORTED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'zh'];
const SPEED_MIN = 0.25;
const SPEED_MAX = 4.0;
const DEFAULT_SPEED = 1.0;
const MAX_TEXT_LENGTH = 4096;

/**
 * Returns true when the voice identifier is valid.
 * @param {string} voice
 * @returns {boolean}
 */
function isValidVoice(voice) {
  if (typeof voice !== 'string') return false;
  return SUPPORTED_VOICES.includes(voice.toLowerCase());
}

/**
 * Returns true when the language code is supported.
 * @param {string} language
 * @returns {boolean}
 */
function isValidLanguage(language) {
  if (typeof language !== 'string') return false;
  return SUPPORTED_LANGUAGES.includes(language.toLowerCase());
}

/**
 * Clamps a speed value to the permitted [SPEED_MIN, SPEED_MAX] range.
 * @param {number} speed
 * @returns {number}
 */
function clampSpeed(speed) {
  if (typeof speed !== 'number' || isNaN(speed)) {
    throw new TypeError('Speed must be a number');
  }
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
}

/**
 * Validates and sanitises a text-to-speech request payload.
 * Returns an object with `valid`, `errors`, and `sanitised` fields.
 * @param {{ text: string, voice?: string, language?: string, speed?: number }} payload
 * @returns {{ valid: boolean, errors: string[], sanitised: object|null }}
 */
function validateTTSRequest(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'], sanitised: null };
  }

  const { text, voice = 'alloy', language = 'en', speed = DEFAULT_SPEED } = payload;

  if (typeof text !== 'string' || text.trim().length === 0) {
    errors.push('text is required and must be a non-empty string');
  } else if (text.length > MAX_TEXT_LENGTH) {
    errors.push(`text must not exceed ${MAX_TEXT_LENGTH} characters`);
  }

  if (!isValidVoice(voice)) {
    errors.push(`voice must be one of: ${SUPPORTED_VOICES.join(', ')}`);
  }

  if (!isValidLanguage(language)) {
    errors.push(`language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`);
  }

  if (typeof speed !== 'number' || isNaN(speed)) {
    errors.push('speed must be a number');
  } else if (speed < SPEED_MIN || speed > SPEED_MAX) {
    errors.push(`speed must be between ${SPEED_MIN} and ${SPEED_MAX}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, sanitised: null };
  }

  return {
    valid: true,
    errors: [],
    sanitised: {
      text: text.trim(),
      voice: voice.toLowerCase(),
      language: language.toLowerCase(),
      speed,
    },
  };
}

/**
 * Estimates the synthesised audio duration based on word count and speed.
 * Assumes an average speaking rate of 130 words per minute at 1x speed.
 * @param {string} text
 * @param {number} [speed=1.0]
 * @returns {number} estimated duration in seconds
 */
function estimateSpeechDuration(text, speed = DEFAULT_SPEED) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (typeof speed !== 'number' || speed <= 0) {
    throw new RangeError('speed must be a positive number');
  }
  const WORDS_PER_MINUTE = 130;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = words / (WORDS_PER_MINUTE * speed);
  return minutes * 60;
}

module.exports = {
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
};
