'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const execAsync = promisify(exec);

const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'dd if=/dev/zero',
  ':(){ :|:& };:',
  'mkfs',
  'fdisk',
  'format',
];
const PROTECTED_BRANCH_PUSH = /\bgit\s+push\b[^\r\n;|&]*(\bmaster\b|\bmain\b|refs\/heads\/master|refs\/heads\/main|\bHEAD\b)/i;

function getAllowedCwd() {
  const cwd = process.env.AGENT_SHELL_CWD || process.cwd();
  if (process.env.AGENT_ENABLED === '1' && !process.env.AGENT_SHELL_CWD) {
    return {
      ok: false,
      error: 'AGENT_SHELL_CWD must be set explicitly when AGENT_ENABLED=1.',
    };
  }
  if (!fs.existsSync(cwd)) {
    return { ok: false, error: `AGENT_SHELL_CWD does not exist: ${cwd}` };
  }
  return { ok: true, cwd };
}

function isBlocked(cmd) {
  const c = cmd.toLowerCase().trim();
  return BLOCKED_COMMANDS.some(b => c.includes(b.toLowerCase())) || PROTECTED_BRANCH_PUSH.test(cmd);
}

async function execCommand(command, timeout = 30000) {
  if (!command || typeof command !== 'string') {
    return { ok: false, error: 'No command provided.' };
  }
  if (isBlocked(command)) {
    return { ok: false, error: 'Command blocked for safety.' };
  }
  const cwdInfo = getAllowedCwd();
  if (!cwdInfo.ok) {
    return { ok: false, error: cwdInfo.error };
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwdInfo.cwd,
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

module.exports = { execCommand, isBlocked, getAllowedCwd };
