'use strict';

// ─────────────────────────────────────────────────────────────────────
// Resource Governor — Adaptive resource management for KelionAI.
//
// Pattern: OFF → MIN → MAX, pe necesitate.
//
// Every resource (camera frames, tools, vision, system prompt) has
// 3 operating levels that scale adaptively:
//
//   OFF  — Resource disabled, zero cost. Default state.
//   MIN  — Minimal operation (background, low-frequency).
//   MAX  — Full capability, maximum quality. Only for the duration needed.
//
// The governor tracks active resource levels per-session and provides
// hooks for the pipeline/voice to query the current required level.
// After each request, resources that are no longer needed drop back
// to OFF or MIN automatically.
// ─────────────────────────────────────────────────────────────────────

const LEVELS = { OFF: 0, MIN: 1, MAX: 2 };

// Resource definitions with their level-specific parameters
const RESOURCE_CONFIGS = {
  // Camera frame streaming (WebSocket path)
  camera_frames: {
    [LEVELS.OFF]: { fps: 0, quality: 0, resolution: 0, active: false },
    [LEVELS.MIN]: { fps: 1, quality: 0.55, resolution: 480, active: true },
    [LEVELS.MAX]: { fps: 4, quality: 0.78, resolution: 1024, active: true },
  },

  // Screen share streaming
  screen_frames: {
    [LEVELS.OFF]: { fps: 0, quality: 0, resolution: 0, active: false },
    [LEVELS.MIN]: { fps: 1, quality: 0.5, resolution: 640, active: true },
    [LEVELS.MAX]: { fps: 2, quality: 0.75, resolution: 1280, active: true },
  },

  // Vision API calls (REST path — /api/realtime/vision)
  vision_api: {
    [LEVELS.OFF]: { enabled: false, interval_ms: 0 },
    [LEVELS.MIN]: { enabled: true, interval_ms: 5000 },   // 1 call per 5s
    [LEVELS.MAX]: { enabled: true, interval_ms: 1000 },   // 1 call per 1s
  },

  // Tool schema inclusion in API requests
  tools: {
    [LEVELS.OFF]: { count: 0, categories: [] },            // No tools — pure chat
    [LEVELS.MIN]: { count: 6, categories: ['CORE'] },      // Only silent/system tools
    [LEVELS.MAX]: { count: 82, categories: ['ALL'] },      // Full catalog
  },

  // System prompt size
  system_prompt: {
    [LEVELS.OFF]: { size: 'none' },
    [LEVELS.MIN]: { size: 'compact' },   // Shortened persona
    [LEVELS.MAX]: { size: 'full' },      // Full persona with all rules
  },
};

/**
 * Determine the required resource level based on context.
 *
 * @param {string} resource - Resource name (camera_frames, vision_api, tools, etc.)
 * @param {object} context - Current context
 * @param {string} context.message - User's current message
 * @param {boolean} context.cameraActive - Whether camera is currently on
 * @param {boolean} context.narrationActive - Whether narration mode is enabled
 * @param {boolean} context.visionRequested - Whether user asked about vision
 * @param {string[]} context.toolCategories - Categories matched by toolRouter
 * @param {boolean} context.hasToolCalls - Whether the model wants to call tools
 * @returns {number} - LEVELS.OFF, LEVELS.MIN, or LEVELS.MAX
 */
function getResourceLevel(resource, context = {}) {
  const {
    message = '',
    cameraActive = false,
    narrationActive = false,
    visionRequested = false,
    toolCategories = [],
    hasToolCalls = false,
  } = context;

  switch (resource) {
    case 'camera_frames':
      // OFF: camera not active
      if (!cameraActive) return LEVELS.OFF;
      // MAX: user explicitly asking about vision or narration mode on
      if (visionRequested || narrationActive) return LEVELS.MAX;
      // MIN: camera is on but not actively being queried
      return LEVELS.MIN;

    case 'screen_frames':
      // Screen share is always user-initiated and always at MAX when active
      return context.screenActive ? LEVELS.MAX : LEVELS.OFF;

    case 'vision_api':
      // OFF: no camera, no narration
      if (!cameraActive && !narrationActive) return LEVELS.OFF;
      // MAX: narration mode active or user asking what they see
      if (narrationActive || visionRequested) return LEVELS.MAX;
      // MIN: camera on, background awareness only
      return LEVELS.MIN;

    case 'tools':
      // OFF: no categories matched — pure greeting/chat
      if (toolCategories.length === 0 && !hasToolCalls) return LEVELS.OFF;
      // MAX: specific tool categories matched — activate those specific tools
      return LEVELS.MAX;

    case 'system_prompt':
      // Always at least MIN (need persona identity)
      // MAX when tools are active or complex interaction
      if (toolCategories.length > 0 || hasToolCalls) return LEVELS.MAX;
      return LEVELS.MIN;

    default:
      return LEVELS.OFF;
  }
}

/**
 * Get the config for a resource at a given level.
 */
function getResourceConfig(resource, level) {
  const configs = RESOURCE_CONFIGS[resource];
  if (!configs) return null;
  return configs[level] || configs[LEVELS.OFF];
}

/**
 * Compute all resource levels for a given request context.
 * Returns a snapshot that pipeline/voice code can query.
 */
function computeResourceSnapshot(context) {
  const snapshot = {};
  for (const resource of Object.keys(RESOURCE_CONFIGS)) {
    const level = getResourceLevel(resource, context);
    snapshot[resource] = {
      level,
      levelName: Object.keys(LEVELS).find(k => LEVELS[k] === level) || 'OFF',
      config: getResourceConfig(resource, level),
    };
  }
  return snapshot;
}

/**
 * Log a resource transition for monitoring.
 */
function logTransition(resource, fromLevel, toLevel, reason) {
  const names = ['OFF', 'MIN', 'MAX'];
  if (fromLevel !== toLevel) {
    console.log(`[resourceGov] ${resource}: ${names[fromLevel]} → ${names[toLevel]} (${reason})`);
  }
}

module.exports = {
  LEVELS,
  RESOURCE_CONFIGS,
  getResourceLevel,
  getResourceConfig,
  computeResourceSnapshot,
  logTransition,
};
