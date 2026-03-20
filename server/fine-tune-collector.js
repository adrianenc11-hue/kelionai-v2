// ═══════════════════════════════════════════════════════════
// KelionAI — Fine-Tune Data Collector
// Saves high-quality conversation pairs for model fine-tuning
// Format: OpenAI JSONL (messages array)
// ═══════════════════════════════════════════════════════════
"use strict";

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data', 'fine-tune');
const JSONL_FILE = path.join(DATA_DIR, 'training-data.jsonl');
const MIN_PAIRS_FOR_TRAINING = 500;

// In-memory counter
let pairCount = 0;

// Ensure data directory exists
function _ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (_) { /* non-critical */ }
}

/**
 * Collect a high-quality conversation pair for fine-tuning
 * Only saves if: user gave 👍 OR confidence > 0.85
 * 
 * @param {string} systemPrompt - The system prompt used
 * @param {string} userMessage - User's message
 * @param {string} assistantReply - AI's response (cleaned)
 * @param {object} metadata - { confidence, feedback, engine, intent }
 */
function collectPair(systemPrompt, userMessage, assistantReply, metadata = {}) {
  try {
    // Quality gate: only save good conversations
    const isPositiveFeedback = metadata.feedback === 'positive' || metadata.feedback === '👍';
    const isHighConfidence = (metadata.confidence || 0) > 0.85;
    
    if (!isPositiveFeedback && !isHighConfidence) return;
    if (!userMessage || userMessage.length < 10) return;
    if (!assistantReply || assistantReply.length < 20) return;

    // Skip if reply contains error messages
    if (/eroare|error|nu am putut|failed|timeout/i.test(assistantReply)) return;

    _ensureDir();

    const entry = {
      messages: [
        {
          role: "system",
          content: (systemPrompt || '').substring(0, 2000), // Truncate system prompt
        },
        {
          role: "user",
          content: userMessage.substring(0, 1000),
        },
        {
          role: "assistant",
          content: assistantReply.substring(0, 4000),
        },
      ],
      metadata: {
        timestamp: new Date().toISOString(),
        engine: metadata.engine || 'unknown',
        intent: metadata.intent || 'unknown',
        confidence: metadata.confidence || 0,
        feedback: metadata.feedback || 'auto',
      },
    };

    // Append to JSONL file
    fs.appendFileSync(JSONL_FILE, JSON.stringify(entry) + '\n', 'utf8');
    pairCount++;

    logger.info({ component: 'FineTune', pairs: pairCount },
      `📦 Fine-tune pair collected (#${pairCount})`);

    // Notify when ready for training
    if (pairCount > 0 && pairCount % 100 === 0) {
      logger.info({ component: 'FineTune', total: pairCount, ready: pairCount >= MIN_PAIRS_FOR_TRAINING },
        `📦 Fine-tune milestone: ${pairCount} pairs${pairCount >= MIN_PAIRS_FOR_TRAINING ? ' — READY FOR TRAINING! 🎉' : ''}`);
    }
  } catch (e) {
    logger.debug({ component: 'FineTune', err: e.message }, 'Fine-tune collection skipped');
  }
}

/**
 * Get stats about collected data
 */
function getStats() {
  try {
    _ensureDir();
    if (!fs.existsSync(JSONL_FILE)) return { pairs: 0, sizeKB: 0, readyForTraining: false };
    const stats = fs.statSync(JSONL_FILE);
    // Count lines
    const content = fs.readFileSync(JSONL_FILE, 'utf8');
    const lines = content.split('\n').filter(l => l.trim()).length;
    return {
      pairs: lines,
      sizeKB: Math.round(stats.size / 1024),
      readyForTraining: lines >= MIN_PAIRS_FOR_TRAINING,
      file: JSONL_FILE,
    };
  } catch (_) {
    return { pairs: 0, sizeKB: 0, readyForTraining: false };
  }
}

/**
 * Export clean JSONL for OpenAI upload (without metadata)
 */
function exportForTraining() {
  try {
    if (!fs.existsSync(JSONL_FILE)) return null;
    const content = fs.readFileSync(JSONL_FILE, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const cleanFile = path.join(DATA_DIR, `training-export-${Date.now()}.jsonl`);
    
    const clean = lines.map(line => {
      const entry = JSON.parse(line);
      return JSON.stringify({ messages: entry.messages });
    }).join('\n');

    fs.writeFileSync(cleanFile, clean, 'utf8');
    logger.info({ component: 'FineTune', file: cleanFile, pairs: lines.length },
      `📦 Exported ${lines.length} pairs for training`);
    return cleanFile;
  } catch (e) {
    logger.warn({ component: 'FineTune', err: e.message }, 'Export failed');
    return null;
  }
}

// Initialize pair count from existing file
try {
  _ensureDir();
  if (fs.existsSync(JSONL_FILE)) {
    const content = fs.readFileSync(JSONL_FILE, 'utf8');
    pairCount = content.split('\n').filter(l => l.trim()).length;
    if (pairCount > 0) {
      logger.info({ component: 'FineTune', existing: pairCount },
        `📦 Fine-tune: ${pairCount} existing pairs loaded`);
    }
  }
} catch (_) { /* ignored */ }

module.exports = { collectPair, getStats, exportForTraining };
