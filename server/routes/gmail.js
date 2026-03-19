// ═══════════════════════════════════════════════════════════
// KelionAI — Gmail API Integration
// OAuth2 flow for reading/sending emails
// Requires: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET env vars
// User must connect Gmail via /api/gmail/auth
// ═══════════════════════════════════════════════════════════
const logger = require('../logger');

// Gmail OAuth2 tokens are stored per-user in Supabase brain_memory
// memory_type: 'gmail_tokens'

async function getGmailTokens(userId, supabase) {
  if (!supabase || !userId) return null;
  const { data } = await supabase.from('brain_memory')
    .select('context')
    .eq('user_id', userId)
    .eq('memory_type', 'gmail_tokens')
    .single();
  return data?.context || null;
}

async function callGmail(endpoint, tokens) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${endpoint}`, {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 401) throw new Error('Gmail token expired. User must re-authenticate.');
  if (!r.ok) throw new Error(`Gmail API ${r.status}`);
  return r.json();
}

// ── Tool Handlers ────────────────────────────────────────

async function list_emails(input, userId, supabase) {
  const tokens = await getGmailTokens(userId, supabase);
  if (!tokens) return { error: 'Gmail not connected. User must link their Gmail account first via Settings.' };

  const max = Math.min(input.maxResults || 10, 20);
  const q = input.query ? `&q=${encodeURIComponent(input.query)}` : '';

  try {
    const list = await callGmail(`messages?maxResults=${max}${q}`, tokens);
    if (!list.messages || list.messages.length === 0) return { emails: [], message: 'No emails found' };

    // Fetch headers for each message
    const emails = await Promise.all(list.messages.slice(0, max).map(async (msg) => {
      try {
        const detail = await callGmail(`messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, tokens);
        const headers = detail.payload?.headers || [];
        return {
          id: msg.id,
          from: headers.find(h => h.name === 'From')?.value || 'unknown',
          subject: headers.find(h => h.name === 'Subject')?.value || '(no subject)',
          date: headers.find(h => h.name === 'Date')?.value || '',
          snippet: detail.snippet || '',
          unread: (detail.labelIds || []).includes('UNREAD'),
        };
      } catch (_) { return { id: msg.id, error: 'Could not fetch' }; }
    }));

    return { emails, count: emails.length };
  } catch (e) {
    return { error: `Gmail error: ${e.message}` };
  }
}

async function read_email(input, userId, supabase) {
  const tokens = await getGmailTokens(userId, supabase);
  if (!tokens) return { error: 'Gmail not connected.' };
  if (!input.emailId) return { error: 'emailId required' };

  try {
    const msg = await callGmail(`messages/${input.emailId}?format=full`, tokens);
    const headers = msg.payload?.headers || [];

    // Extract body
    let body = '';
    function extractText(part) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += Buffer.from(part.body.data, 'base64').toString('utf8');
      }
      if (part.parts) part.parts.forEach(extractText);
    }
    extractText(msg.payload || {});

    return {
      id: msg.id,
      from: headers.find(h => h.name === 'From')?.value || '',
      to: headers.find(h => h.name === 'To')?.value || '',
      subject: headers.find(h => h.name === 'Subject')?.value || '',
      date: headers.find(h => h.name === 'Date')?.value || '',
      body: body.substring(0, 5000),
      attachments: (msg.payload?.parts || []).filter(p => p.filename).map(p => ({ name: p.filename, size: p.body?.size })),
    };
  } catch (e) {
    return { error: `Gmail error: ${e.message}` };
  }
}

async function draft_reply(input, userId, supabase) {
  const tokens = await getGmailTokens(userId, supabase);
  if (!tokens) return { error: 'Gmail not connected.' };
  if (!input.emailId || !input.body) return { error: 'emailId and body required' };

  try {
    // Get original message for thread ID and reply headers
    const orig = await callGmail(`messages/${input.emailId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`, tokens);
    const headers = orig.payload?.headers || [];
    const from = headers.find(h => h.name === 'From')?.value || '';
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const messageId = headers.find(h => h.name === 'Message-ID')?.value || '';

    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const rawEmail = [
      `To: ${from}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      input.body,
    ].join('\r\n');

    const encoded = Buffer.from(rawEmail).toString('base64url');

    // Create draft (NOT send)
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: encoded, threadId: orig.threadId } }),
    });

    if (!r.ok) throw new Error(`Draft creation failed: ${r.status}`);
    const draft = await r.json();

    return {
      success: true,
      draftId: draft.id,
      message: `Draft reply created for "${replySubject}" to ${from}. User can review and send from Gmail.`,
    };
  } catch (e) {
    return { error: `Gmail error: ${e.message}` };
  }
}

module.exports = { list_emails, read_email, draft_reply };
