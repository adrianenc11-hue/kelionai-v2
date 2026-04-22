// Simple pub/sub store for what the avatar's stage monitor should display.
// Gemini Live calls the `show_on_monitor` tool → kelionTools.js resolves the
// payload → sets the store → KelionStage.jsx (StageMonitor) subscribes and
// renders an iframe / image / video embed on the in-scene screen.
//
// Intentionally dependency-free so both runTool() (outside React) and
// React components (via a useSyncExternalStore hook below) can use it.
//
// State is persisted to localStorage so that whatever the user had open on
// the monitor (map, WebVM, wiki, video…) survives a hard refresh or tab
// restore. Entries older than MAX_AGE_MS are dropped on load so we never
// show a week-old embed.

const STORAGE_KEY = 'kelion.monitor.v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const state = {
  kind: null,        // 'map' | 'weather' | 'video' | 'image' | 'wiki' | 'web' | null
  src: null,         // string — final URL (iframe) or image URL
  title: null,       // short label shown above the frame
  embedType: 'iframe', // 'iframe' | 'image' | 'external'
  updatedAt: 0,
};

// Some providers (WebVM/CheerpX, JSLinux, v86) require a
// cross-origin-isolated document (COOP: same-origin + COEP: require-corp).
// kelionai.app is NOT isolated — adding the headers would break Google
// Maps/Wikipedia/LoremFlickr embeds which don't serve CORP. So we render
// these hosts as an external "Open in new tab" card instead of a broken
// iframe. The host list is a small allowlist updated as we learn.
const EXTERNAL_ONLY_HOSTS = new Set([
  'webvm.io',
  'www.webvm.io',
  'copy.sh',
  'www.copy.sh',
  'bellard.org',
  'www.bellard.org',
]);
function requiresExternalTab(url) {
  try { return EXTERNAL_ONLY_HOSTS.has(new URL(url).hostname.toLowerCase()); }
  catch { return false; }
}

// Fallback geolocation provider — lets the React tree register the
// current clientGeo so a voice command like "show me a map" without a
// place name can still render a useful map centered on the user. Set by
// KelionStage.jsx, read by resolveMonitor when kind='map' + empty query.
let geoProvider = null;
export function setMonitorGeoProvider(fn) {
  geoProvider = typeof fn === 'function' ? fn : null;
}

function loadPersisted() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (!parsed.src || !parsed.kind) return;
    const updatedAt = Number(parsed.updatedAt) || 0;
    if (!updatedAt || Date.now() - updatedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    state.kind = parsed.kind;
    state.src = parsed.src;
    state.title = parsed.title || null;
    state.embedType = parsed.embedType === 'image' ? 'image' : 'iframe';
    state.updatedAt = updatedAt;
  } catch {
    /* corrupt entry — ignore */
  }
}

function savePersisted() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!state.kind || !state.src) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      kind: state.kind,
      src: state.src,
      title: state.title,
      embedType: state.embedType,
      updatedAt: state.updatedAt,
    }));
  } catch {
    /* quota / private mode — ignore */
  }
}

loadPersisted();

const listeners = new Set();

function notify() {
  for (const l of listeners) {
    try { l(state); } catch { /* ignore */ }
  }
}

export function getMonitorState() {
  return state;
}

export function subscribeMonitor(fn) {
  listeners.add(fn);
  // Invoke immediately with current state so late subscribers (e.g. a React
  // component re-mounted after a Suspense fallback) don't miss whatever is
  // already being displayed. Wrapped in try/catch so a bad listener can't
  // break the subscribe path.
  try { fn(state); } catch { /* ignore */ }
  return () => listeners.delete(fn);
}

function setState(patch) {
  state.kind = patch.kind ?? null;
  state.src = patch.src ?? null;
  state.title = patch.title ?? null;
  state.embedType = patch.embedType || 'iframe';
  state.updatedAt = Date.now();
  savePersisted();
  notify();
}

function safeUrl(u) {
  if (!u || typeof u !== 'string') return null;
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try { new URL(s); return s; } catch { return null; }
}

// Resolve a (kind, query) pair to a concrete embeddable URL. Centralized so
// the AI can always trust that "map Cluj" produces a working Google Maps
// embed, not just a hope-for-the-best fetch.
function resolveMonitor(kind, query) {
  const q = (query || '').toString().trim();
  switch (kind) {
    case 'clear':
      return { kind: null, src: null, title: null, embedType: 'iframe' };

    case 'map': {
      let label = q;
      let mapQ = q;
      // Empty query → center on the user's current coordinates if the
      // React tree registered a geo provider. Lets voice commands like
      // "arată-mi harta" (no place mentioned) resolve to the user's own
      // location instead of a blank card. IP-geo coarse coords are a fine
      // last resort since Google Maps still renders a usable city view.
      if (!mapQ && geoProvider) {
        try {
          const g = geoProvider();
          if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
            mapQ = `${g.latitude},${g.longitude}`;
            label = 'current location';
          }
        } catch { /* ignore */ }
      }
      if (!mapQ) return null;
      // Google Maps embed without an API key — `?output=embed` works for
      // arbitrary queries, handles places, addresses, coords.
      const src = `https://www.google.com/maps?q=${encodeURIComponent(mapQ)}&output=embed`;
      return { kind: 'map', src, title: `Map — ${label}`, embedType: 'iframe' };
    }

    case 'weather': {
      if (!q) return null;
      // wttr.in renders a styled forecast page, no key, iframe-friendly.
      // 0-flag = minimal today/tomorrow view; m = metric units.
      const src = `https://wttr.in/${encodeURIComponent(q)}?m`;
      return { kind: 'weather', src, title: `Weather — ${q}`, embedType: 'iframe' };
    }

    case 'video': {
      if (!q) return null;
      // If the user gave a full YouTube URL, extract the id and embed it.
      // Many uploaders disable embedding; nothing we can do about individual
      // refusals, but this path still works for the vast majority of videos.
      const ytMatch = q.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{6,})/);
      if (ytMatch) {
        const id = ytMatch[1];
        return {
          kind: 'video',
          src: `https://www.youtube.com/embed/${id}?autoplay=1&mute=0`,
          title: `Video`,
          embedType: 'iframe',
        };
      }
      // If a YouTube playlist id is present (`list=PLxxxx`), embed the
      // playlist directly — that embed still works (unlike listType=search).
      const plMatch = q.match(/[?&]list=([A-Za-z0-9_-]{10,})/);
      if (plMatch) {
        const listId = plMatch[1];
        return {
          kind: 'video',
          src: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}&autoplay=1`,
          title: `Playlist`,
          embedType: 'iframe',
        };
      }
      // Fallback: YouTube deprecated `listType=search&list=…` years ago and
      // embedding that URL now returns "Error 153 — player configuration
      // error" (the empty-screen failure the user kept seeing for queries
      // like "country music playlist"). Render a search card that opens a
      // new YouTube results tab instead — the user sees real, playable
      // results and picks one rather than staring at a broken iframe.
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      return { kind: 'video', src: url, title: `Video — ${q}`, embedType: 'external' };
    }

    case 'image': {
      if (!q) return null;
      // LoremFlickr returns a topic-matching Flickr image directly, no key,
      // CORS-friendly. Replaces source.unsplash.com which was retired by
      // Unsplash in 2024 and now returns 503 for every request.
      const src = `https://loremflickr.com/1280/720/${encodeURIComponent(q)}`;
      return { kind: 'image', src, title: `Image — ${q}`, embedType: 'image' };
    }

    case 'wiki': {
      if (!q) return null;
      // Mobile Wikipedia embeds cleanly in iframes (desktop Wikipedia sets
      // frame-ancestors 'self' since 2025). Use the user's language if the
      // query is obviously ASCII English; otherwise default English too and
      // let Wikipedia interwiki redirect.
      const title = q.replace(/\s+/g, '_');
      const src = `https://en.m.wikipedia.org/wiki/${encodeURIComponent(title)}`;
      return { kind: 'wiki', src, title: `Wikipedia — ${q}`, embedType: 'iframe' };
    }

    case 'web': {
      const src = safeUrl(q);
      if (!src) return null;
      let label = src;
      try { label = new URL(src).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
      // Hosts that need cross-origin isolation (WebVM/CheerpX, JSLinux,
      // v86) cannot render inside our iframe — the browser blocks
      // SharedArrayBuffer without COOP+COEP and the page shows a broken
      // file icon. Serve a friendly launcher card the user can click to
      // open in a dedicated tab.
      if (requiresExternalTab(src)) {
        return { kind: 'web', src, title: label, embedType: 'external' };
      }
      return { kind: 'web', src, title: label, embedType: 'iframe' };
    }

    default:
      return null;
  }
}

// Called by runTool('show_on_monitor', ...). Returns a short string the AI
// will hear back as the tool response — lets it acknowledge naturally.
export function handleShowOnMonitor(args = {}) {
  const resolved = resolveMonitor(args.kind, args.query);
  if (!resolved) {
    return 'Monitor update skipped (invalid kind or missing query).';
  }
  setState(resolved);
  if (resolved.kind === null) return 'Monitor cleared.';
  return `Monitor now showing: ${resolved.title || resolved.kind}.`;
}
