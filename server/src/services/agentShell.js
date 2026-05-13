'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const ALLOWED_CWD = process.env.AGENT_SHELL_CWD || process.cwd();
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'dd if=/dev/zero',
  ':(){ :|:& };:',
  'mkfs',
  'fdisk',
  'format',
];

function isBlocked(cmd) {
  const c = cmd.toLowerCase().trim();
  return BLOCKED_COMMANDS.some(b => c.includes(b.toLowerCase()));
}

async function execCommand(command, timeout = 30000) {
  if (!command || typeof command !== 'string') {
    return { ok: false, error: 'No command provided.' };
  }
  if (isBlocked(command)) {
    return { ok: false, error: 'Command blocked for safety.' };
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: ALLOWED_CWD,
      timeout,
      maxBuffer: 5 * 1024 * 1024,
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
    });
    return { ok: true, stdout: stdout || '', stderr: stderr || '', exitCode: 0 };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.code || 1,
      error: e.message,
    };
  }
}

module.exports = { execCommand };
