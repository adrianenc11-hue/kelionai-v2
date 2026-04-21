// Conversation history — client-side store with two backends:
//   • Signed-in users hit `/api/conversations/*` (Postgres / SQLite
//     on the server, survives across devices & browsers).
//   • Guests persist to localStorage (same-device only, key
//     `kelion.conversations.v1`, max 20 threads, 500 msgs each).
//
// The surface is intentionally the same in both modes so KelionStage
// doesn't have to branch. Callers:
//   await ensureActiveConversation(firstMessageText?)
//   await appendMessage({ role, content })
//   await listConversations()                 → [{id,title,updated_at,...}]
//   await loadConversation(id)                 → { id, title, messages:[...] }
//   await deleteConversation(id)
//   setActiveConversationId(id | null)
//   getActiveConversationId()
//   startNewConversation()                     → clears the active id

const STORAGE_KEY         = 'kelion.conversations.v1';
const ACTIVE_KEY          = 'kelion.activeConversationId.v1';
const GUEST_MAX_CONVS     = 20;
const GUEST_MAX_MSGS_CONV = 500;

let authTokenGetter = () => null;
let isSignedInGetter = () => false;

// KelionStage wires these up once after auth state resolves so the store
// can pick the right backend without re-reading React state per call.
export function configureConversationStore({ getAuthToken, getIsSignedIn }) {
  if (typeof getAuthToken === 'function') authTokenGetter = getAuthToken;
  if (typeof getIsSignedIn === 'function') isSignedInGetter = getIsSignedIn;
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  try {
    const tok = authTokenGetter && authTokenGetter();
    if (tok) h['Authorization'] = `Bearer ${tok}`;
  } catch { /* ignore */ }
  return h;
}

function signedIn() {
  try { return !!(isSignedInGetter && isSignedInGetter()); } catch { return false; }
}

// ─── localStorage helpers (guest path) ───────────────────────────
function readGuestStore() {
  if (typeof window === 'undefined' || !window.localStorage) return { conversations: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { conversations: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.conversations)) return { conversations: [] };
    return parsed;
  } catch {
    return { conversations: [] };
  }
}

function writeGuestStore(store) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    // Prune — keep newest GUEST_MAX_CONVS by updated_at.
    const pruned = [...store.conversations]
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, GUEST_MAX_CONVS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations: pruned }));
  } catch {
    /* quota — ignore */
  }
}

function guestNextId() {
  // Prefix so guest IDs never collide with server BIGINT IDs (numeric).
  return 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function guestDeriveTitle(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

// ─── Active conversation id ──────────────────────────────────────
function readActiveId() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try { return window.localStorage.getItem(ACTIVE_KEY) || null; } catch { return null; }
}
function writeActiveId(id) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, String(id));
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch { /* ignore */ }
}

let activeConversationId = readActiveId();

export function getActiveConversationId() { return activeConversationId; }

export function setActiveConversationId(id) {
  activeConversationId = id || null;
  writeActiveId(activeConversationId);
}

export function startNewConversation() {
  setActiveConversationId(null);
}

// ─── ensureActiveConversation — lazily create on first message ───
// Called every time a turn is about to be written. If we already have
// an active conversation we just return its id. Otherwise we create one
// on the backend (or in localStorage), title it from the first message,
// and remember it as active.
export async function ensureActiveConversation(firstMessageHint) {
  if (activeConversationId) return activeConversationId;
  const title = guestDeriveTitle(firstMessageHint);

  if (signedIn()) {
    try {
      const r = await fetch('/api/conversations', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ title }),
      });
      if (r.ok) {
        const data = await r.json();
        const id = data?.conversation?.id;
        if (id) {
          setActiveConversationId(String(id));
          return activeConversationId;
        }
      }
    } catch { /* fall through to guest path */ }
  }

  // Guest (or server create failed) — localStorage.
  const now = new Date().toISOString();
  const id  = guestNextId();
  const store = readGuestStore();
  store.conversations.unshift({
    id, title, created_at: now, updated_at: now, messages: [],
  });
  writeGuestStore(store);
  setActiveConversationId(id);
  return id;
}

// ─── appendMessage — save one turn to the active conversation ────
export async function appendMessage({ role, content }) {
  const cleanRole = String(role || 'user');
  const cleanContent = String(content || '').trim();
  if (!cleanContent) return;

  const id = await ensureActiveConversation(cleanRole === 'user' ? cleanContent : null);
  if (!id) return;

  if (signedIn() && !String(id).startsWith('g-')) {
    try {
      await fetch(`/api/conversations/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ role: cleanRole, content: cleanContent }),
      });
      return;
    } catch { /* fall through → mirror in guest store */ }
  }

  // Guest path (and auth fallback).
  const store = readGuestStore();
  const conv = store.conversations.find((c) => c.id === id);
  if (conv) {
    conv.messages.push({
      id: guestNextId(),
      role: cleanRole,
      content: cleanContent.slice(0, 16000),
      created_at: new Date().toISOString(),
    });
    if (conv.messages.length > GUEST_MAX_MSGS_CONV) {
      conv.messages = conv.messages.slice(-GUEST_MAX_MSGS_CONV);
    }
    if (!conv.title && cleanRole === 'user') conv.title = guestDeriveTitle(cleanContent);
    conv.updated_at = new Date().toISOString();
    writeGuestStore(store);
  }
}

// ─── listConversations — both paths, normalized shape ────────────
export async function listConversations() {
  if (signedIn()) {
    try {
      const r = await fetch('/api/conversations?limit=100', {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (r.ok) {
        const data = await r.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        return items.map((c) => ({
          id: String(c.id),
          title: c.title || null,
          updated_at: c.updated_at || c.created_at || null,
          message_count: Number(c.message_count || 0),
          origin: 'server',
        }));
      }
    } catch { /* fall through to guest local cache */ }
  }

  const store = readGuestStore();
  return store.conversations
    .slice()
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .map((c) => ({
      id: c.id,
      title: c.title || null,
      updated_at: c.updated_at,
      message_count: Array.isArray(c.messages) ? c.messages.length : 0,
      origin: 'guest',
    }));
}

// ─── loadConversation — full thread incl. messages ───────────────
export async function loadConversation(id) {
  if (!id) return null;
  if (signedIn() && !String(id).startsWith('g-')) {
    try {
      const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (r.ok) {
        const data = await r.json();
        const c = data?.conversation;
        if (c) {
          return {
            id: String(c.id),
            title: c.title || null,
            created_at: c.created_at,
            updated_at: c.updated_at,
            messages: Array.isArray(c.messages)
              ? c.messages.map((m) => ({ role: m.role, content: m.content }))
              : [],
          };
        }
      }
    } catch { /* fall through to guest */ }
  }

  const store = readGuestStore();
  const conv = store.conversations.find((c) => c.id === id);
  if (!conv) return null;
  return {
    id: conv.id,
    title: conv.title || null,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    messages: Array.isArray(conv.messages)
      ? conv.messages.map((m) => ({ role: m.role, content: m.content }))
      : [],
  };
}

// ─── deleteConversation ─────────────────────────────────────────
export async function deleteConversation(id) {
  if (!id) return false;
  let ok = false;

  if (signedIn() && !String(id).startsWith('g-')) {
    try {
      const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: authHeaders(),
      });
      ok = r.ok;
    } catch { ok = false; }
  }

  // Always mirror-delete from guest cache too (might have guest-only entry).
  const store = readGuestStore();
  const before = store.conversations.length;
  store.conversations = store.conversations.filter((c) => c.id !== id);
  if (store.conversations.length !== before) {
    writeGuestStore(store);
    ok = true;
  }

  if (activeConversationId === id) setActiveConversationId(null);
  return ok;
}
