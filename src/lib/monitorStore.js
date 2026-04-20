// Simple pub/sub store for what the avatar's stage monitor should display.
// Gemini Live calls the `show_on_monitor` tool → kelionTools.js resolves the
// payload → sets the store → KelionStage.jsx (StageMonitor) subscribes and
// renders an iframe / image / video embed on the in-scene screen.
//
// Intentionally dependency-free so both runTool() (outside React) and
// React components (via a useSyncExternalStore hook below) can use it.

import { getLatestCoords } from './useClientGeo'

// Queries that mean "show the user's current location" — we treat them as
// a signal to drop the browser's last GPS fix into the Google Maps embed
// so "harta unde mă aflu" actually lands on the user's street, not on a
// generic world map. Covers RO / EN / ES / FR / IT / DE.
const HERE_QUERY_RE = /^(here|current|where\s*am\s*i|my\s*location|unde\s*m[\u0103a]?\s*aflu|aici|locatia\s*mea|locația\s*mea|mi\s*ubicaci[oó]n|donde\s*estoy|ma\s*position|o[ùu]\s*suis|dove\s*sono|wo\s*bin\s*ich)[\s.?!]*$/i

const state = {
  kind: null,        // 'map' | 'weather' | 'video' | 'image' | 'wiki' | 'web' | null
  src: null,         // string — final URL (iframe) or image URL
  title: null,       // short label shown above the frame
  embedType: 'iframe', // 'iframe' | 'image'
  updatedAt: 0,
};

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
      // "harta unde mă aflu" / "where am I" / empty — try to use the last
      // GPS fix we have for this tab. If we have no fix yet we fall back
      // to a generic map request so the iframe still loads (better than a
      // broken icon). When we DO have coords we pass them as `lat,lon` to
      // Google Maps' embed URL and ask for zoom 15 so the user sees their
      // neighborhood, not a country-level view.
      const isHere = !q || HERE_QUERY_RE.test(q);
      const coords = isHere ? getLatestCoords() : null;
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
        const ll = `${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}`;
        const src = `https://www.google.com/maps?q=${ll}&z=15&output=embed`;
        return { kind: 'map', src, title: `Map — your location`, embedType: 'iframe' };
      }
      if (!q) return null;
      // Google Maps embed without an API key — `?output=embed` works for
      // arbitrary queries, handles places, addresses, coords.
      const src = `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
      return { kind: 'map', src, title: `Map — ${q}`, embedType: 'iframe' };
    }

    case 'weather': {
      // "vremea aici" / "weather here" / empty → use the GPS fix so the
      // forecast matches where the user actually is, not a random city.
      // wttr.in accepts `lat,lon` directly.
      const isHere = !q || HERE_QUERY_RE.test(q);
      const coords = isHere ? getLatestCoords() : null;
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
        const ll = `${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`;
        const src = `https://wttr.in/${ll}?m`;
        return { kind: 'weather', src, title: `Weather — your location`, embedType: 'iframe' };
      }
      if (!q) return null;
      // wttr.in renders a styled forecast page, no key, iframe-friendly.
      // 0-flag = minimal today/tomorrow view; m = metric units.
      const src = `https://wttr.in/${encodeURIComponent(q)}?m`;
      return { kind: 'weather', src, title: `Weather — ${q}`, embedType: 'iframe' };
    }

    case 'video': {
      if (!q) return null;
      // If the user gave a full YouTube URL, extract the id; otherwise use
      // YouTube's "search results embed" which auto-plays the best match.
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
      // Fallback: YouTube query embed (plays first result).
      const src = `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(q)}`;
      return { kind: 'video', src, title: `Video — ${q}`, embedType: 'iframe' };
    }

    case 'image': {
      if (!q) return null;
      // Google Images result page renders in an iframe better than the
      // old source.unsplash.com shortcut (which was deprecated in 2024
      // and now returns a broken-image redirect). Using an iframe gives
      // the user a full grid of results and avoids stale <img> failures.
      const src = `https://www.google.com/search?igu=1&tbm=isch&q=${encodeURIComponent(q)}`;
      return { kind: 'image', src, title: `Images — ${q}`, embedType: 'iframe' };
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

// Manually reset the monitor to its idle state (no content). Used by
// the on-screen close button and on sign-out so stale content from a
// previous voice session (e.g. a broken image left over from an old
// tool call) doesn't persist into a fresh session.
export function clearMonitor() {
  setState({ kind: null, src: null, title: null, embedType: 'iframe' });
}
