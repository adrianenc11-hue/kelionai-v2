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
  // Require cross-origin isolation (SAB)
  'webvm.io',
  'www.webvm.io',
  'copy.sh',
  'www.copy.sh',
  'bellard.org',
  'www.bellard.org',
]);

// F10 — Hosts that send `X-Frame-Options: DENY` (or a strict
// `Content-Security-Policy: frame-ancestors`) and therefore render
// as an empty gray box inside our monitor iframe (user screenshot
// 2026-04-22 showed google.com as a broken icon). Matched by suffix
// so `mail.google.com`, `accounts.google.com`, etc. all qualify.
// The renderer already handles `embedType: 'external'` — the user
// sees a friendly "open in new tab" card instead of a dead frame.
const NON_EMBEDDABLE_HOST_SUFFIXES = [
  'google.com',
  'google.co.uk',
  'youtube.com',   // main site (our /embed/... path still works separately)
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'amazon.com',
  'amazon.co.uk',
  'reddit.com',
  'netflix.com',
  'github.com',
  'gitlab.com',
  'paypal.com',
  'stripe.com',
  'dropbox.com',
  'apple.com',
  'microsoft.com',
  'office.com',
  'live.com',
];
function isNonEmbeddableHost(host) {
  const h = (host || '').toLowerCase();
  return NON_EMBEDDABLE_HOST_SUFFIXES.some(
    (sfx) => h === sfx || h.endsWith('.' + sfx),
  );
}

function requiresExternalTab(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (EXTERNAL_ONLY_HOSTS.has(host)) return true;
    if (isNonEmbeddableHost(host)) return true;
    return false;
  } catch { return false; }
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

// F10 — Async YouTube search upgrade. Called fire-and-forget from the
// sync resolveMonitor('video', query) branch. When the server has
// YOUTUBE_API_KEY set, `/api/youtube/search` returns a videoId that's
// guaranteed embeddable; we then swap the external search card for a
// real inline /embed/<id> iframe so the avatar plays the video for
// real. We track the most recent query so a fast double-call ("show me
// jazz" → "show me rock") doesn't let a late reply from the earlier
// query overwrite the latest state. Silent on 404 (key not set) — the
// external card stays.
let lastYouTubeQuery = 0;
async function queueYouTubeUpgrade(query) {
  if (typeof window === 'undefined' || !window.fetch) return;
  const q = (query || '').toString().trim();
  if (!q) return;
  const token = ++lastYouTubeQuery;
  try {
    const url = `/api/youtube/search?q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { credentials: 'same-origin' });
    if (token !== lastYouTubeQuery) return; // superseded by a newer call
    if (r.status === 404) return;            // key not configured
    if (r.status === 204) return;            // no embeddable results
    if (!r.ok) return;
    const data = await r.json();
    if (!data || !data.videoId) return;
    if (token !== lastYouTubeQuery) return;
    if (state.kind !== 'video') return;      // user opened something else
    setState({
      kind: 'video',
      src: `https://www.youtube.com/embed/${data.videoId}?autoplay=1&mute=0`,
      title: data.title ? `Video — ${data.title}` : `Video`,
      embedType: 'iframe',
    });
  } catch {
    /* Network hiccup / AbortError — external card stays, user still gets
       a playable fallback. Not worth surfacing an error. */
  }
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
      // "harta unde mă aflu" / "where am I" / empty — first try the last
      // precise GPS fix we have for this tab (watchPosition). When present,
      // pass `lat,lon` to Google Maps' embed URL at zoom 15 so the user
      // sees their neighborhood, not a country-level view. Falls through
      // to the registered geo provider (IP-geo coarse coords) and finally
      // to the raw text query.
      let label = q;
      let mapQ = q;
      const isHere = !q || HERE_QUERY_RE.test(q);
      const coords = isHere ? getLatestCoords() : null;
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
        const ll = `${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}`;
        const src = `https://www.google.com/maps?q=${ll}&z=15&output=embed`;
        return { kind: 'map', src, title: `Map — your location`, embedType: 'iframe' };
      }
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
      // We now render a server-side HTML dashboard driven by Open-Meteo
      // (ICON-D2 ~2.2 km resolution over Central Europe vs ~10 km for
      // OpenWeather/wttr.in). Free, no API key, CORS-open. Two paths:
      //   (a) "vremea aici" / empty query → use latest GPS fix directly
      //   (b) explicit city/place → geocode via Open-Meteo's free
      //       geocoding API at render time on the server (we pass the
      //       raw query through ?name= and let /api/weather/embed look
      //       up the coords). For now we only implement (a); (b) falls
      //       back to wttr.in until the server-side geocoder lands.
      const isHere = !q || HERE_QUERY_RE.test(q);
      const coords = isHere ? getLatestCoords() : null;
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
        const params = new URLSearchParams({
          lat: coords.lat.toFixed(4),
          lon: coords.lon.toFixed(4),
          name: 'Your location',
        });
        const src = `/api/weather/embed?${params.toString()}`;
        return { kind: 'weather', src, title: `Weather — your location`, embedType: 'iframe' };
      }
      if (!q) return null;
      // Explicit city / place — pass it through ?q= and let the server
      // resolve it to lat/lon via Open-Meteo's free geocoding API.
      const params = new URLSearchParams({ q, name: q });
      const src = `/api/weather/embed?${params.toString()}`;
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
      // Free-text query fallback. YouTube deprecated the
      // `embed?listType=search&list=…` API years ago — that URL now
      // returns player Error 153. We render an external search card
      // synchronously so the user always gets something clickable, and
      // in parallel kick off `/api/youtube/search` which (when
      // YOUTUBE_API_KEY is set) upgrades the state in-place to a real
      // inline `/embed/<videoId>` iframe so the avatar genuinely plays
      // the video on its stage monitor instead of showing a link.
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      // Fire-and-forget upgrade — safe inside `getMonitorState` because
      // setState() publishes to listeners via notify() and the UI
      // re-renders with the inline iframe the moment the server replies.
      queueYouTubeUpgrade(q);
      return { kind: 'video', src: url, title: `Video — ${q}`, embedType: 'external' };
    }

    case 'image': {
      if (!q) return null;
      // Google Images result page renders in an iframe better than the
      // old source.unsplash.com shortcut (which was retired in 2024
      // and now returns 503 for every request). An iframe gives the
      // user a full grid of results and avoids stale <img> failures.
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

// Manually reset the monitor to its idle state (no content). Used by
// the on-screen close button and on sign-out so stale content from a
// previous voice session (e.g. a broken image left over from an old
// tool call) doesn't persist into a fresh session.
export function clearMonitor() {
  setState({ kind: null, src: null, title: null, embedType: 'iframe' });
}

// F11 — direct image-display entrypoint used by the `generate_image` tool.
// Unlike `handleShowOnMonitor` this takes an already-resolved URL (produced
// server-side by OpenAI Images → cached PNG) and skips the query→URL
// mapping table. The monitor renderer already handles `embedType:'image'`
// via the existing `kind:'image'` case, so all we do here is publish state.
export function showImageOnMonitor({ src, title } = {}) {
  if (!src || typeof src !== 'string') return 'No image to display.';
  setState({
    kind: 'image',
    src,
    title: title || 'Generated image',
    embedType: 'image',
  });
  return `Monitor now showing: ${title || 'generated image'}.`;
}
