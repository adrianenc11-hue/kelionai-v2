/**
 * Sample Plugin: Smart Reminder
 *
 * Schedules reminders and recurring tasks.
 * Demonstrates command-type plugin with memory integration.
 */

const manifest = {
  id: 'smart-reminder',
  name: 'Smart Reminder',
  version: '1.0.0',
  description: 'Set intelligent reminders with natural language. Supports one-time and recurring reminders.',
  author: 'KelionAI',
  icon: '⏰',
  category: 'productivity',
  type: 'command',
  pricing: 'free',
  commands: ['/remind', '/reminders'],
  endpoints: [],
  config: {
    maxRemindersPerUser: 50,
  },
};

/**
 * Parse natural language time expressions
 */
function parseTime(text) {
  const now = new Date();
  const lower = text.toLowerCase().trim();

  // Relative: "in 5 minutes", "in 2 hours", "in 3 days"
  const relMatch = lower.match(/in\s+(\d+)\s+(minute|minut|hour|ora|ore|day|zi|zile|week|saptamana)s?/i);
  if (relMatch) {
    const amount = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const ms =
      {
        minute: 60000,
        minut: 60000,
        hour: 3600000,
        ora: 3600000,
        ore: 3600000,
        day: 86400000,
        zi: 86400000,
        zile: 86400000,
        week: 604800000,
        saptamana: 604800000,
      }[unit] || 60000;
    return new Date(now.getTime() + amount * ms);
  }

  // "tomorrow", "mâine"
  if (/tomorrow|mâine|maine/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // "next week"
  if (/next\s+week|saptamana\s+viitoare/i.test(lower)) {
    return new Date(now.getTime() + 7 * 86400000);
  }

  // Default: 1 hour from now
  return new Date(now.getTime() + 3600000);
}

/**
 * Command: /remind <time> <message>
 */
async function onCommand(ctx) {
  const { args, userId } = ctx;

  // /reminders — list active reminders
  if (ctx.command === '/reminders' || (args[0] && args[0] === 'list')) {
    const reminders = await ctx.kelion.memory.list(`plugin:reminder:${userId}`);
    if (!reminders || reminders.length === 0) {
      return { response: '📭 No active reminders.' };
    }
    const list = reminders
      .map((r, i) => `${i + 1}. ⏰ ${r.message} — ${new Date(r.fireAt).toLocaleString()}`)
      .join('\n');
    return { response: `📋 Your reminders:\n${list}` };
  }

  if (!args || args.length < 2) {
    return {
      response:
        'Usage: /remind <time> <message>\nExamples:\n- /remind in 30 minutes Check email\n- /remind tomorrow Call dentist\n- /remind in 2 hours Take a break',
    };
  }

  // Parse time from first part, message from rest
  const timeText = args.slice(0, 3).join(' ');
  const fireAt = parseTime(timeText);
  const message = args.slice(timeText.split(' ').length).join(' ') || args.join(' ');

  // Save reminder
  await ctx.kelion.memory.set(`plugin:reminder:${userId}`, {
    message,
    fireAt: fireAt.toISOString(),
    createdAt: new Date().toISOString(),
    userId,
  });

  const timeStr = fireAt.toLocaleString('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return {
    response: `✅ Reminder set!\n⏰ "${message}"\n📅 ${timeStr}`,
  };
}

module.exports = { manifest, onCommand, parseTime };
