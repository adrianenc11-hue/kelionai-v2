// Debug: show exactly what statements the splitter produces around brain_metrics
const fs = require('fs');
const src = fs.readFileSync('server/migrate.js', 'utf8');
const match = src.match(/const MIGRATION_SQL = `([\s\S]*?)`;/);
const SQL = match[1];

const statements = [];
let buf = '';
let inBlock = false;
let blockTag = '';
for (const line of SQL.split('\n')) {
  buf += line + '\n';
  const trimmed = line.trim();
  if (!inBlock) {
    const startMatch = trimmed.match(/(\$[a-zA-Z_]*\$)\s*(?:BEGIN|DECLARE)?/);
    if (startMatch && !trimmed.endsWith(startMatch[1] + ';')) {
      inBlock = true;
      blockTag = startMatch[1];
    } else if (trimmed.endsWith(';')) {
      statements.push(buf.trim());
      buf = '';
    }
  } else {
    if (trimmed.includes(blockTag) && trimmed.endsWith(';')) {
      inBlock = false;
      blockTag = '';
      statements.push(buf.trim());
      buf = '';
    }
  }
}
if (buf.trim()) statements.push(buf.trim());

// Find statements that mention brain_metrics, brain_profiles, brain_plugins, etc
const missing = ['brain_metrics', 'brain_plugins', 'autonomous_tasks', 'tenants', 'brain_admin_sessions', 'chat_feedback', 'payments', 'generated_documents', 'cloned_voices', 'brain_usage', 'brain_projects', 'brain_procedures'];
for (const t of missing) {
  const idx = statements.findIndex(s => s.includes(`CREATE TABLE IF NOT EXISTS ${t}`));
  if (idx >= 0) {
    const stmt = statements[idx];
    const firstLine = stmt.split('\n')[0];
    const lastLine = stmt.split('\n').slice(-1)[0];
    console.log(`[#${idx}] ${t}: starts="${firstLine.substring(0,80)}" ends="${lastLine.substring(0,80)}" len=${stmt.length}`);
    // Check if it starts with something else (combined with previous)
    if (!stmt.startsWith('CREATE TABLE')) {
      console.log(`  ^^ PROBLEM: combined with previous statement!`);
      console.log(`  First 200 chars: ${stmt.substring(0,200)}`);
    }
  } else {
    console.log(`[??] ${t}: NOT FOUND as separate statement`);
  }
}
