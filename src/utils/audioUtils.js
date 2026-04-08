'use strict';

const SUPPORTED_FORMATS = ['mp3', 'wav', 'ogg', 'flac'];
const SUPPORTED_SAMPLE_RATES = [8000, 16000, 22050, 44100, 48000];
const MAX_AUDIO_DURATION_SECONDS = 600;

/**
 * Validates that an audio format string is supported.
 * @param {string} format
 * @returns {boolean}
 */
function isValidAudioFormat(format) {
  if (typeof format !== 'string') return false;
  return SUPPORTED_FORMATS.includes(format.toLowerCase());
}

/**
 * Validates that a sample rate is one of the supported values.
 * @param {number} sampleRate
 * @returns {boolean}
 */
function isValidSampleRate(sampleRate) {
  if (typeof sampleRate !== 'number' || !Number.isInteger(sampleRate)) return false;
  return SUPPORTED_SAMPLE_RATES.includes(sampleRate);
}

/**
 * Normalises a volume level to the range [0, 1].
 * Values below 0 are clamped to 0; values above 1 are clamped to 1.
 * @param {number} volume
 * @returns {number}
 */
function normaliseVolume(volume) {
  if (typeof volume !== 'number' || isNaN(volume)) {
    throw new TypeError('Volume must be a number');
  }
  return Math.min(1, Math.max(0, volume));
}

/**
 * Converts a duration in milliseconds to a human-readable string (mm:ss).
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (typeof ms !== 'number' || ms < 0 || !isFinite(ms)) {
    throw new RangeError('Duration must be a non-negative finite number');
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Returns true if the given duration (in seconds) is within the allowed maximum.
 * @param {number} durationSeconds
 * @returns {boolean}
 */
function isDurationAllowed(durationSeconds) {
  if (typeof durationSeconds !== 'number') return false;
  return durationSeconds >= 0 && durationSeconds <= MAX_AUDIO_DURATION_SECONDS;
}

/**
 * Calculates the approximate file size (in bytes) for a raw PCM audio clip.
 * @param {number} durationSeconds
 * @param {number} sampleRate
 * @param {number} [channels=1]
 * @param {number} [bitDepth=16]
 * @returns {number}
 */
function estimateFileSize(durationSeconds, sampleRate, channels = 1, bitDepth = 16) {
  if (
    typeof durationSeconds !== 'number' || durationSeconds < 0 ||
    typeof sampleRate !== 'number' || sampleRate <= 0 ||
    typeof channels !== 'number' || channels <= 0 ||
    typeof bitDepth !== 'number' || bitDepth <= 0
  ) {
    throw new RangeError('All parameters must be positive numbers');
  }
  return durationSeconds * sampleRate * channels * (bitDepth / 8);
}

module.exports = {
  SUPPORTED_FORMATS,
  SUPPORTED_SAMPLE_RATES,
  MAX_AUDIO_DURATION_SECONDS,
  isValidAudioFormat,
  isValidSampleRate,
  normaliseVolume,
  formatDuration,
  isDurationAllowed,
  estimateFileSize,
};
