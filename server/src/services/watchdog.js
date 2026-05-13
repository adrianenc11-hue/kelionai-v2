'use strict';

const fs = require('fs');
const path = require('path');
const { smartFetch } = require('./modelRouter');
const { toolRunTerminalCommand } = require('./realTools');

let isDiagnosing = false;

/**
 * Perform a full auto-diagnosis of the system.
 */
async function performBootDiagnosis() {
  if (isDiagnosing) return;
  isDiagnosing = true;
  
  console.log('🤖 [WATCHDOG] Initiating Titan-Mode Auto-Diagnosis...');
  
  try {
    // 1. Ping test (Fast check)
    console.log('🤖 [WATCHDOG] Ping test initiated...');
    const pingRes = await smartFetch('chat', {
      messages: [{ role: 'user', content: 'Ping. Reply with exactly "PONG" and nothing else.' }],
      max_tokens: 10
    });
    
    if (pingRes && pingRes.response.ok) {
      console.log('✅ [WATCHDOG] Dolphin Mistral (Chat) is ONLINE.');
    } else {
      console.warn('⚠️ [WATCHDOG] Dolphin Mistral failed ping test.');
    }

    // 2. Scan critical logs or recent errors
    const logPath = path.join(__dirname, '../../../server.log');
    let recentLogs = 'No recent logs found.';
    if (fs.existsSync(logPath)) {
      const logs = fs.readFileSync(logPath, 'utf8');
      recentLogs = logs.split('\n').slice(-50).join('\n'); // last 50 lines
    }

    // 3. Ask Hermes 405B to analyze the system state
    console.log('🤖 [WATCHDOG] Hermes 405B analyzing system state...');
    const analysisRes = await smartFetch('chat_heavy', {
      messages: [
        { role: 'system', content: 'You are Kelion Watchdog (Hermes 3 405B). Analyze the system state. If there are critical errors, write a terminal command or a plan to fix them. If no errors, reply "SYSTEM OPTIMAL".' },
        { role: 'user', content: `Current Server Logs:\n${recentLogs}` }
      ],
      max_tokens: 500
    }, true);

    const data = await analysisRes.response.json();
    const analysisText = data.choices?.[0]?.message?.content || '';

    if (analysisText.includes('SYSTEM OPTIMAL')) {
      console.log('✅ [WATCHDOG] Hermes 405B reports SYSTEM OPTIMAL.');
    } else {
      console.log('⚠️ [WATCHDOG] Hermes 405B found issues:\n', analysisText);
      // Pass to Qwen Coder for execution
      console.log('🤖 [WATCHDOG] Passing issue to Qwen Coder for auto-healing...');
      const healRes = await smartFetch('coder_heavy', {
        messages: [
          { role: 'system', content: 'You are Kelion Auto-Healer (Qwen Coder). Your job is to output ONLY the exact bash terminal command needed to fix the issue described. E.g., npm install <package>. Do not use markdown formatting.' },
          { role: 'user', content: `Fix this issue: ${analysisText}` }
        ],
        max_tokens: 100
      }, true);
      
      const healData = await healRes.response.json();
      const commandToRun = healData.choices?.[0]?.message?.content?.trim() || '';
      
      if (commandToRun && commandToRun.length > 3 && !commandToRun.includes('No command')) {
         console.log(`🤖 [WATCHDOG] Qwen Coder is executing: ${commandToRun}`);
         await toolRunTerminalCommand({ command: commandToRun });
      }
    }
  } catch (err) {
    console.error('❌ [WATCHDOG] Auto-Diagnosis encountered an error:', err.message);
  } finally {
    isDiagnosing = false;
    console.log('🤖 [WATCHDOG] Auto-Diagnosis sequence complete.');
  }
}

/**
 * Start the Titan-Mode Watchdog.
 */
function startWatchdog() {
  console.log('🤖 [WATCHDOG] Titan-Mode active. Monitoring system health...');
  
  // Run diagnosis on boot
  performBootDiagnosis();

  // Intercept unhandled exceptions
  process.on('uncaughtException', async (err) => {
    console.error('🔥 [WATCHDOG] CRITICAL CRASH INTERCEPTED:', err.message);
    // In a real Titan system, we would ask Qwen to fix the file here.
    // For safety, we just log it and trigger diagnosis
    await performBootDiagnosis();
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('🔥 [WATCHDOG] UNHANDLED PROMISE REJECTION:', reason);
    await performBootDiagnosis();
  });
}

module.exports = { startWatchdog, performBootDiagnosis };
