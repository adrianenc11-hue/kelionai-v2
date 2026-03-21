'use strict';

/**
 * K1 STATE PERSISTENCE — Salvează/încarcă starea K1 în Supabase
 *
 * Supraviețuiește restart-urilor de deploy Railway.
 * Salvează: world state markets, performance metrics, user model, cognitive history.
 * Tabel: k1_state (key TEXT PK, value JSONB, updated_at TIMESTAMPTZ)
 */

const logger = require('pino')({ name: 'k1-persist' });

// References — populated at loadState()
let worldState, performance, metaLearning, cognitive;

/**
 * Creează tabelul k1_state dacă nu există
 */
async function ensureTable(supabase) {
  if (!supabase) return;
  try {
    // Test dacă tabelul există
    const { error } = await supabase.from('k1_state').select('key').limit(1);
    if (error && error.message.includes('does not exist')) {
      // Creează tabelul
      await supabase
        .rpc('exec_sql', {
          sql: `CREATE TABLE IF NOT EXISTS k1_state (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL DEFAULT '{}',
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );`,
        })
        .catch(() => {
          logger.warn('[K1-Persist] Could not auto-create k1_state table — will retry on next save');
        });
    }
  } catch {
    /* ignored */
  }
}

/**
 * Salvează starea K1 în Supabase
 */
async function saveState(supabase) {
  if (!supabase) return { saved: 0 };

  const entries = [];

  try {
    // 1. World State markets
    if (worldState) {
      const ws = worldState.getWorldState();
      entries.push({ key: 'world_markets', value: ws.markets || {} });
      entries.push({ key: 'world_system', value: ws.system || {} });
    }
  } catch {
    /* ignored */
  }

  try {
    // 2. Performance metrics
    if (performance) {
      entries.push({
        key: 'performance_report',
        value: performance.getReport(),
      });
    }
  } catch {
    /* ignored */
  }

  try {
    // 3. User model
    if (metaLearning) {
      entries.push({ key: 'user_model', value: metaLearning.getUserModel() });
      entries.push({ key: 'strategies', value: metaLearning.getStrategies() });
      entries.push({
        key: 'evolution',
        value: metaLearning.getEvolutionReport(),
      });
    }
  } catch {
    /* ignored */
  }

  try {
    // 4. Cognitive performance history
    if (cognitive) {
      entries.push({
        key: 'cognitive_meta',
        value: cognitive.getMetaCognition(),
      });
    }
  } catch {
    /* ignored */
  }

  // Upsert fiecare entry
  let saved = 0;
  for (const entry of entries) {
    try {
      const { error } = await supabase.from('k1_state').upsert(
        {
          key: entry.key,
          value: entry.value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
      if (!error) saved++;
    } catch {
      /* ignored */
    }
  }

  if (saved > 0) {
    logger.info({ saved, total: entries.length }, `[K1-Persist] State saved: ${saved}/${entries.length}`);
  }
  return { saved, total: entries.length };
}

/**
 * Încarcă starea K1 din Supabase la boot
 */
async function loadState(supabase) {
  if (!supabase) return { loaded: 0 };

  // Lazy require — avoid circular deps
  try {
    worldState = require('./k1-world-state');
  } catch {
    /* ignored */
  }
  try {
    performance = require('./k1-performance');
  } catch {
    /* ignored */
  }
  try {
    metaLearning = require('./k1-meta-learning');
  } catch {
    /* ignored */
  }
  try {
    cognitive = require('./k1-cognitive');
  } catch {
    /* ignored */
  }

  await ensureTable(supabase);

  let loaded = 0;

  try {
    const { data, error } = await supabase.from('k1_state').select('key, value');
    if (error || !data || data.length === 0) {
      logger.info('[K1-Persist] No saved state found — starting fresh');
      return { loaded: 0 };
    }

    const stateMap = {};
    for (const row of data) stateMap[row.key] = row.value;

    // Restore world state markets
    if (stateMap.world_markets && worldState) {
      try {
        worldState.updateMarkets(stateMap.world_markets);
        loaded++;
        logger.info('[K1-Persist] ✅ World state markets restored');
      } catch {
        /* ignored */
      }
    }

    // Restore system info
    if (stateMap.world_system && worldState) {
      try {
        worldState.updateSystem(stateMap.world_system);
        loaded++;
      } catch {
        /* ignored */
      }
    }

    // Note: Performance, UserModel, Cognitive are in-memory singletons
    // They reset on restart, but the saved state provides a baseline reference
    // Future: hydrate these modules from saved state

    logger.info({ loaded, available: data.length }, `[K1-Persist] State loaded: ${loaded} modules restored`);
  } catch (e) {
    logger.warn({ err: e.message }, '[K1-Persist] loadState failed');
  }

  return { loaded };
}

module.exports = { saveState, loadState, ensureTable };
