const fs = require('fs');
const readline = require('readline');

/**
 * ═══════════════════════════════════════════════════════════════
 * 🎙️ KelionAI VOICE DIAGNOSTICS v2.0 - PATH SEGREGATION
 * Runs trace analytics, separates TTFA by Happy/Degraded/Interrupt.
 * Models breakdown & latency calculation.
 * ═══════════════════════════════════════════════════════════════
 */

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args.find((a) => !a.startsWith('--'));
  const outFileArgIndex = args.indexOf('--out');
  const outputFile = outFileArgIndex > -1 ? args[outFileArgIndex + 1] : null;
  const _isStrict = args.includes('--strict');

  if (!inputFile) {
    console.error('Usage: node scripts/voice_diagnostics.js <path> [--out <report.json>] [--strict]');
    process.exit(1);
  }

  console.log(`\n🔍 KelionAI Voice Diagnostics Tool v2.0`);
  console.log(`📂 Analyzing: ${inputFile}...\n`);

  const events = [];
  try {
    if (inputFile.endsWith('.ndjson')) {
      const fileStream = fs.createReadStream(inputFile);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (line.trim()) events.push(JSON.parse(line));
      }
    } else {
      events.push(...JSON.parse(fs.readFileSync(inputFile, 'utf-8')));
    }
  } catch (err) {
    console.error(`❌ Failed to read: ${err.message}`);
    process.exit(1);
  }

  const sessions = {};
  for (const ev of events) {
    if (!sessions[ev.session_id]) sessions[ev.session_id] = { turns: {} };
    if (!sessions[ev.session_id].turns[ev.turn_id])
      sessions[ev.session_id].turns[ev.turn_id] = { events: [], meta: {} };
    sessions[ev.session_id].turns[ev.turn_id].events.push(ev);
    if (ev.meta) Object.assign(sessions[ev.session_id].turns[ev.turn_id].meta, ev.meta);
  }

  const report = {
    total_sessions: Object.keys(sessions).length,
    total_turns: 0,
    paths: {
      happy: { count: 0, sum_ttfa: 0 },
      degraded: { count: 0, sum_ttfa: 0, fallbacks: 0, errors: 0 },
      interrupted: { count: 0, sum_interrupt_latency: 0 },
    },
    models: {},
    turns: [],
  };

  for (const [sessionId, session] of Object.entries(sessions)) {
    for (const [turnId, turn] of Object.entries(session.turns)) {
      report.total_turns++;

      const evMap = {};
      turn.events.forEach((e) => {
        evMap[e.event] = e.ts;
      });
      const model = turn.meta.route_model || 'unknown';

      // Advanced metrics
      const metrics = {
        stt_partial_latency: evMap.stt_partial && evMap.vad_start ? evMap.stt_partial - evMap.vad_start : null,
        stt_final_latency: evMap.stt_final && evMap.vad_end ? evMap.stt_final - evMap.vad_end : null,
        route_decision: evMap.route_selected && evMap.stt_final ? evMap.route_selected - evMap.stt_final : null,
        llm_ttft: evMap.llm_first_token && evMap.llm_start ? evMap.llm_first_token - evMap.llm_start : null,
        tts_ttfa: evMap.tts_first_chunk && evMap.tts_start ? evMap.tts_first_chunk - evMap.tts_start : null,
        ttfa:
          evMap.playback_start && (evMap.vad_end || evMap.audio_in_start)
            ? evMap.playback_start - (evMap.vad_end || evMap.audio_in_start)
            : null,
        interrupt_latency:
          evMap.playback_stopped && evMap.interrupt_detected ? evMap.playback_stopped - evMap.interrupt_detected : null,
        fallback_delay: evMap.fallback_triggered && evMap.error ? evMap.fallback_triggered - evMap.error : null,
      };

      // Determine Path
      let pathType = 'happy';
      if (evMap.interrupt_detected) pathType = 'interrupted';
      else if (evMap.error || evMap.fallback_triggered || evMap.reconnect) pathType = 'degraded';

      // Global aggregations by Path
      if (pathType === 'happy') {
        report.paths.happy.count++;
        if (metrics.ttfa) report.paths.happy.sum_ttfa += metrics.ttfa;
      } else if (pathType === 'degraded') {
        report.paths.degraded.count++;
        if (metrics.ttfa) report.paths.degraded.sum_ttfa += metrics.ttfa;
        if (evMap.fallback_triggered) report.paths.degraded.fallbacks++;
        if (evMap.error) report.paths.degraded.errors++;
      } else if (pathType === 'interrupted') {
        report.paths.interrupted.count++;
        if (metrics.interrupt_latency) report.paths.interrupted.sum_interrupt_latency += metrics.interrupt_latency;
      }

      // Aggregations by Model
      if (!report.models[model]) {
        report.models[model] = {
          count: 0,
          sum_ttfa: 0,
          valid_ttfa_count: 0,
          errors: 0,
          fallbacks: 0,
          interruptions: 0,
        };
      }
      report.models[model].count++;
      if (pathType !== 'interrupted' && metrics.ttfa) {
        report.models[model].sum_ttfa += metrics.ttfa;
        report.models[model].valid_ttfa_count++;
      }
      if (evMap.error) report.models[model].errors++;
      if (evMap.fallback_triggered) report.models[model].fallbacks++;
      if (pathType === 'interrupted') report.models[model].interruptions++;

      // Log turn
      report.turns.push({ session_id: sessionId, turn_id: turnId, text: turn.meta.text, model, pathType, metrics });
    }
  }

  // --- Console Output ---
  console.log(`─────────────────────────────────────────────────────────────`);
  console.log(`📊 PATH ANALYSIS (${report.total_turns} Total Turns)`);
  console.log(`─────────────────────────────────────────────────────────────`);

  const hAvg = report.paths.happy.count ? Math.round(report.paths.happy.sum_ttfa / report.paths.happy.count) : 0;
  const dAvg = report.paths.degraded.count
    ? Math.round(report.paths.degraded.sum_ttfa / report.paths.degraded.count)
    : 0;
  const iAvg = report.paths.interrupted.count
    ? Math.round(report.paths.interrupted.sum_interrupt_latency / report.paths.interrupted.count)
    : 0;

  console.log(`🟢 HAPPY PATH:       ${report.paths.happy.count} turns | Avg TTFA: ${hAvg > 0 ? hAvg : 'N/A'} ms`);
  console.log(`🟡 DEGRADED PATH:    ${report.paths.degraded.count} turns | Avg TTFA: ${dAvg > 0 ? dAvg : 'N/A'} ms`);
  console.log(
    `🔴 INTERRUPTED PATH: ${report.paths.interrupted.count} turns | Avg Stop Latency: ${iAvg > 0 ? iAvg : 'N/A'} ms`
  );
  console.log(``);

  console.log(`📝 MODEL BREAKDOWN`);
  const modelArr = Object.entries(report.models).map(([name, m]) => ({
    Model: name.substring(0, 25),
    Turns: m.count,
    Avg_TTFA: m.valid_ttfa_count ? Math.round(m.sum_ttfa / m.valid_ttfa_count) : 'N/A',
    Err_Rate: Math.round((m.errors / m.count) * 100) + '%',
    FB_Rate: Math.round((m.fallbacks / m.count) * 100) + '%',
    Int_Rate: Math.round((m.interruptions / m.count) * 100) + '%',
  }));
  console.table(modelArr);

  // Diagnosis Rules
  console.log(`💡 DIAGNOSIS:`);
  if (hAvg > 1500) console.log(`  🔴 Happy Path TTFA is severely degraded (> 1.5s). Main providers are too slow.`);
  else if (hAvg > 800)
    console.log(`  🟡 Happy Path TTFA is acceptable, but >800ms breaks conversational illusion. Optimize routes.`);
  else if (hAvg > 0) console.log(`  🟢 Happy Path TTFA is excellent (< 800ms). Native streaming is working well.`);

  if (dAvg > 3000)
    console.log(`  🔴 Fallback/Error penalty is massive! TTFA is ${dAvg}ms. You need a faster fallback strategy.`);
  if (iAvg > 500)
    console.log(`  🔴 Barge-in latency is slow (${iAvg}ms). Audio overlap will occur. Kill playback synchronously.`);

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
    console.log(`\n✅ Saved JSON report to: ${outputFile}`);
  }
}

main();
