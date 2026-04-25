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
  kind: null,        // 'map' | 'weather' | 'video' | 'image' | 'wiki' | 'web' | 'audio' | null
  src: null,         // string — final URL (iframe), image URL, or audio stream URL
  title: null,       // short label shown above the frame
  embedType: 'iframe', // 'iframe' | 'image' | 'external' | 'audio'
  updatedAt: 0,
};

// Some providers (WebVM/CheerpX, JSLinux, v86) require a
// cross-origin-isolated document (COOP: same-origin + COEP: require-corp).
// kelionai.app is NOT isolated — adding the headers would break Google
// Maps/Wikipedia/LoremFlickr embeds which don't serve CORP. So we render
// these hosts as an external "Open in new tab" card instead of a broken
// iframe. The host list is a small allowlist updated as we learn.
// Exported so the renderer (`externalCardCopy` in KelionStage.jsx) can pick
// the cross-origin-isolation card copy for the same hosts we route through
// the external card. Keeping the list in one place avoids a silent drift
// between routing and display when a new WebVM-style host is added.
export const EXTERNAL_ONLY_HOSTS = new Set([
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
    state.embedType = ['image', 'external', 'audio'].includes(parsed.embedType)
      ? parsed.embedType
      : 'iframe';
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
    // Don't persist mermaid schematics — `src` holds the raw mermaid
    // source (often >1 KB, sometimes much more) and reconstituting it
    // on a future page load isn't useful: the user asked for it in the
    // context of a specific conversation. The other embed kinds save a
    // short URL that's safe to revive across sessions.
    if (state.embedType === 'mermaid') {
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
  // Pin valid embed types only — anything else collapses to 'iframe'
  // so a stale persisted record doesn't render the wrong renderer.
  const allowedEmbed = new Set(['iframe', 'image', 'external', 'audio', 'mermaid']);
  state.embedType = allowedEmbed.has(patch.embedType) ? patch.embedType : 'iframe';
  state.updatedAt = Date.now();
  savePersisted();
  notify();
}

// Build an OpenStreetMap "export embed" URL for a real lat/lon.
// OSM's embed.html is iframe-friendly (no X-Frame-Options blocking)
// and renders a Mapnik tile view with a marker. Adrian (2026-04-25)
// had Google Maps refuse the embed for "Witney, Oxfordshire, Regatul
// Unit" — switching to OSM gives us a reliably embeddable map.
function osmMapEmbed(lat, lon) {
  // ~5 km bbox window — small enough to actually see the marker, big
  // enough that the user can pan if they want to.
  const span = 0.04;
  const minLon = (lon - span).toFixed(5);
  const maxLon = (lon + span).toFixed(5);
  const minLat = (lat - span).toFixed(5);
  const maxLat = (lat + span).toFixed(5);
  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
  const marker = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
}

// Build a Windy.com weather embed for a real lat/lon. Windy is the
// industry-standard weather visualization (radar, wind, precipitation,
// clouds, temperature, pressure, waves). Iframe-friendly with no key.
// Default layer is `wind` which is the most visually striking; users
// can switch via Windy's own UI inside the iframe.
function windyWeatherEmbed(lat, lon, opts = {}) {
  const overlay = (opts && opts.overlay) || 'wind';
  const zoom = (opts && opts.zoom) || 8;
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    zoom: String(zoom),
    overlay,
    level: 'surface',
    type: 'map',
    location: 'coordinates',
    metricWind: 'default',
    metricTemp: 'default',
    detailLat: lat.toFixed(4),
    detailLon: lon.toFixed(4),
    pressure: 'true',
    message: 'true',
    marker: 'true',
  });
  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

// `lat,lon` literal coordinate strings (e.g. "46.7712,23.6236") get
// recognized so we can skip geocoding when the model already has GPS
// figures from get_geolocation / the client-provided coords.
function parseLatLon(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number.parseFloat(m[1]);
  const lon = Number.parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// Fire-and-forget Nominatim geocode → swap the placeholder map / weather
// card for the real embed when the lookup lands. Same shape as
// queueYouTubeUpgrade: the most-recent call wins, all earlier ones are
// no-ops if the user has moved on. Direct browser fetch is fine here —
// Nominatim sends `Access-Control-Allow-Origin: *`, and the polite
// rate limit (1 req/s) is met by user-driven request frequency.
let lastGeocodeQuery = 0;
async function queueGeocodeUpgrade(kind, query) {
  if (typeof window === 'undefined' || !window.fetch) return;
  const q = (query || '').toString().trim();
  if (!q) return;
  const token = ++lastGeocodeQuery;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const r = await fetch(url, { credentials: 'omit' });
    if (token !== lastGeocodeQuery) return; // superseded
    if (!r.ok) return;
    const data = await r.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit || hit.lat == null || hit.lon == null) return;
    const lat = Number.parseFloat(hit.lat);
    const lon = Number.parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (token !== lastGeocodeQuery) return;
    if (state.kind !== kind) return; // user opened something else
    if (kind === 'map') {
      setState({
        kind: 'map',
        src: osmMapEmbed(lat, lon),
        title: hit.display_name ? `Hartă — ${hit.display_name}` : `Hartă — ${q}`,
        embedType: 'iframe',
      });
    } else if (kind === 'weather') {
      setState({
        kind: 'weather',
        src: windyWeatherEmbed(lat, lon),
        title: hit.display_name ? `Vreme — ${hit.display_name}` : `Vreme — ${q}`,
        embedType: 'iframe',
      });
    }
  } catch {
    /* Network / abort — placeholder card stays, user still has a fallback. */
  }
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
      src: buildYouTubeEmbedUrl(data.videoId),
      title: data.title ? `Video — ${data.title}` : `Video`,
      embedType: 'iframe',
    });
  } catch {
    /* Network hiccup / AbortError — external card stays, user still gets
       a playable fallback. Not worth surfacing an error. */
  }
}

// Build a YouTube /embed/<id> URL with the params needed for reliable
// cross-browser inline autoplay. `autoplay=1` alone is silently blocked
// by Chrome / Safari for cross-origin iframes without prior media
// engagement on youtube.com — the player loads but sits on the thumbnail
// with a manual play button, which was the user-reported "player defect
// nu ruleaza youtube". Browsers DO allow autoplay when `mute=1` is
// present, so we default to muted autoplay; the user taps the player
// (or its unmute control) to bring sound on. `playsinline=1` keeps
// mobile Safari from forcing fullscreen, `rel=0` and `modestbranding=1`
// trim the end-screen clutter so the avatar's stage stays clean.
function buildYouTubeEmbedUrl(videoId) {
  const id = encodeURIComponent(String(videoId || ''));
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
  });
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
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
      // Switched off Google Maps' `?output=embed` — Adrian (2026-04-25)
      // had it refused with "Acest site a refuzat să încorporeze"
      // (X-Frame-Options). OpenStreetMap's export embed is iframe-
      // friendly and renders a real Mapnik tile view with a marker.
      // Free-text queries are geocoded async via Nominatim; in the
      // meantime we render an "Open in Maps" placeholder so the user
      // always has something clickable instead of a blank pane.
      let label = q;

      // Already a coordinate string? Render directly without geocoding.
      const direct = parseLatLon(q);
      if (direct) {
        return {
          kind: 'map',
          src: osmMapEmbed(direct.lat, direct.lon),
          title: `Hartă — ${q}`,
          embedType: 'iframe',
        };
      }

      // Empty query → center on the user's current coordinates if the
      // React tree registered a geo provider. Lets voice commands like
      // "arată-mi harta" (no place mentioned) resolve to the user's own
      // location instead of a blank card.
      if (!q && geoProvider) {
        try {
          const g = geoProvider();
          if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
            return {
              kind: 'map',
              src: osmMapEmbed(g.latitude, g.longitude),
              title: 'Hartă — locația ta',
              embedType: 'iframe',
            };
          }
        } catch { /* ignore */ }
      }
      if (!q) return null;

      // Free-text place name → fire async Nominatim geocode; once it
      // lands, queueGeocodeUpgrade swaps the placeholder for the real
      // OSM embed centered on the resolved lat/lon.
      queueGeocodeUpgrade('map', q);
      return {
        kind: 'map',
        src: `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`,
        title: `Hartă — ${label}`,
        embedType: 'external',
      };
    }

    case 'weather': {
      // Switched off the wttr.in text page — Adrian (2026-04-25)
      // wanted "ceva profesional cu coordonatele reale GPS". Windy.com
      // is the industry standard: live radar, wind, precipitation,
      // clouds, temperature, pressure layers, all keyless and iframe-
      // friendly. We center it on real GPS coords (client geo for "what's
      // the weather?", or Nominatim-resolved lat/lon for "weather in X").

      // Already a coordinate string? Render directly.
      const direct = parseLatLon(q);
      if (direct) {
        return {
          kind: 'weather',
          src: windyWeatherEmbed(direct.lat, direct.lon),
          title: `Vreme — ${q}`,
          embedType: 'iframe',
        };
      }

      // Empty query → center on the user's current GPS if available.
      if (!q && geoProvider) {
        try {
          const g = geoProvider();
          if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
            return {
              kind: 'weather',
              src: windyWeatherEmbed(g.latitude, g.longitude),
              title: 'Vreme — locația ta',
              embedType: 'iframe',
            };
          }
        } catch { /* ignore */ }
      }
      if (!q) return null;

      // Free-text place name → fire async Nominatim geocode and render
      // an external "Open in Windy" card in the meantime so the user
      // can still get there in one click.
      queueGeocodeUpgrade('weather', q);
      return {
        kind: 'weather',
        src: `https://www.windy.com/?${encodeURIComponent(q)}`,
        title: `Vreme — ${q}`,
        embedType: 'external',
      };
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
          src: buildYouTubeEmbedUrl(id),
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
          // Playlists use the same autoplay-muted params — Chrome /
          // Safari block unmuted cross-origin autoplay just like they
          // do for single videos. User taps the player to unmute.
          src: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}&autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`,
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

    case 'audio': {
      // Faza A — global radio / live audio stream playback.
      // The server-side `play_radio` tool returns a directly-playable
      // HTTP(S) stream URL (radio-browser.info). We render it through
      // an HTML5 <audio> element on the monitor — bypasses YouTube
      // embed restrictions entirely. Accepts a tile-friendly title so
      // the avatar can show "Now playing: BBC Radio 1".
      const src = safeUrl(q);
      if (!src) return null;
      // `title` is passed through resolveMonitor's caller chain (see
      // handleShowOnMonitor below) — preserve when explicitly given,
      // otherwise derive from the host so we never show a blank label.
      let label;
      try { label = new URL(src).hostname.replace(/^www\./, ''); } catch { label = 'Live audio'; }
      return { kind: 'audio', src, title: label, embedType: 'audio' };
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
  // The model may pass an explicit `title` (e.g. station name from
  // play_radio). Honor it so the audio card / iframe header shows
  // human-friendly text instead of a hostname or hash.
  if (typeof args.title === 'string' && args.title.trim()) {
    resolved.title = args.title.trim().slice(0, 120);
  }
  setState(resolved);
  if (resolved.kind === null) return 'Monitor cleared.';
  return `Monitor now showing: ${resolved.title || resolved.kind}.`;
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

// Project a Mermaid block / wiring / state diagram onto the avatar's
// stage monitor. Adrian (2026-04-25): "nu stie sa genereze scheme
// electronice, cablaje, lista de componente". This is the schematics-
// generation entry point — the model emits Mermaid source, the
// MonitorOverlay (KelionStage.jsx) lazy-loads the mermaid library and
// renders the SVG inline. `src` holds the raw Mermaid source (NOT a
// URL) — the renderer recognises this via embedType:'mermaid'.
//
// Renders block diagrams ("Source 220V → Transformer → Rectifier → …"),
// wiring graphs ("Arduino D2 → LED1 + R220Ω → GND"), and state machines.
// For real symbol-level schematics (resistor zigzag, op-amp triangle, IC
// pin-outs) we'd need a KiCad CLI pipeline server-side — Adrian flagged
// that as a separate, larger follow-up.
export function showSchematicOnMonitor({ code, title } = {}) {
  if (!code || typeof code !== 'string') return 'No schematic to display.';
  setState({
    kind: 'schematic',
    src: code,
    title: title || 'Schematic',
    embedType: 'mermaid',
  });
  return `Monitor now showing schematic: ${title || 'diagram'}.`;
}
