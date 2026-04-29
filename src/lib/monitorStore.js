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
  kind: null,        // 'map' | 'weather' | 'image' | 'wiki' | 'web' | 'audio' | 'html' | null
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
  // youtube.com removed (2026-04-28) — YouTube integration dropped.
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
    // Only truly cross-origin-isolated sites need a real tab;
    // everything else we can proxy through /api/proxy.
    if (EXTERNAL_ONLY_HOSTS.has(host)) return true;
    return false;
  } catch { return false; }
}

// Wrap a URL through our server-side proxy that strips X-Frame-Options/CSP.
// Used for any external URL that normally blocks iframes.
function proxyUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return `/api/proxy?url=${encodeURIComponent(url)}`;
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
    state.embedType = ['image', 'external', 'audio', 'html'].includes(parsed.embedType)
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
  const allowedEmbed = new Set(['iframe', 'image', 'external', 'audio', 'html', 'video', 'cad']);

  state.embedType = allowedEmbed.has(patch.embedType) ? patch.embedType : 'iframe';
  state.updatedAt = Date.now();
  savePersisted();
  notify();
}

// Build a Google Maps Embed API URL for a real lat/lon.
// The Embed API is free (no billing required), iframe-friendly (no
// X-Frame-Options blocking), and renders a full interactive Google
// Map with satellite/terrain toggle. Requires GOOGLE_API_KEY passed
// at build time via VITE_GOOGLE_MAPS_KEY (or falls back to OSM).
function googleMapEmbed(lat, lon, query) {
  const key = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_MAPS_KEY)
    || '';
  if (key && !key.includes('PLACEHOLDER')) {
    if (query) {
      return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${encodeURIComponent(query)}&center=${lat},${lon}&zoom=14`;
    }
    return `https://www.google.com/maps/embed/v1/view?key=${key}&center=${lat},${lon}&zoom=14&maptype=roadmap`;
  }
  // OpenStreetMap embed — always works, no key needed, no iframe blocking
  const span = 0.04;
  const bbox = `${(lon - span).toFixed(5)},${(lat - span).toFixed(5)},${(lon + span).toFixed(5)},${(lat + span).toFixed(5)}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)},${lon.toFixed(5)}`;
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
        src: googleMapEmbed(lat, lon, hit.display_name || q),
        title: hit.display_name ? `Hartă — ${hit.display_name}` : `Hartă — ${q}`,
        embedType: 'iframe',
      });
    } else if (kind === 'weather') {
      // Route Windy through proxy so X-Frame-Options is stripped
      setState({
        kind: 'weather',
        src: proxyUrl(windyWeatherEmbed(lat, lon)),
        title: hit.display_name ? `Vreme — ${hit.display_name}` : `Vreme — ${q}`,
        embedType: 'iframe',
      });
    }
  } catch {
    /* Network / abort — placeholder card stays, user still has a fallback. */
  }
}

// YouTube integration removed (2026-04-28).

function safeUrl(u) {
  if (!u || typeof u !== 'string') return null;
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try { new URL(s); return s; } catch { return null; }
}

// CAD / EDA / 3D engineering file viewer resolver.
// Maps file extension to the best free browser-based viewer.
function resolveCadUrl(src, ext, label) {
  // 3D/CAD model formats → 3dviewer.net (free, no key, iframe-friendly, 50+ formats)
  const viewer3d = ['dxf','step','stp','iges','igs','stl','obj','3dm','3ds','fbx','glb','gltf','off','ply','brep','bim'];
  if (viewer3d.includes(ext)) {
    return {
      kind: 'cad',
      src: `https://3dviewer.net/#model=${encodeURIComponent(src)}`,
      title: label || `3D — ${ext.toUpperCase()}`,
      embedType: 'iframe',
    };
  }
  // KiCad PCB/schematic → KiCanvas (open-source KiCad web viewer)
  if (['kicad_pcb','kicad_sch','kicad_pro'].includes(ext)) {
    return {
      kind: 'cad',
      src: `https://kicanvas.org/?github=${encodeURIComponent(src)}`,
      title: label || `KiCad — ${ext}`,
      embedType: 'iframe',
    };
  }
  // DWG (AutoCAD binary) → needs upload, open in new tab
  if (ext === 'dwg') {
    return { kind: 'cad', src, title: label || 'AutoCAD DWG', embedType: 'external' };
  }
  return null;
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
          src: googleMapEmbed(direct.lat, direct.lon, q),
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
              src: googleMapEmbed(g.latitude, g.longitude, null),
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
      // Show OSM search in proxy while geocode runs
      const osmSearch = `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
      return {
        kind: 'map',
        src: proxyUrl(osmSearch),
        title: `Hartă — ${label}`,
        embedType: 'iframe',
      };
    }

    // ROUTE — point-to-point directions using OpenStreetMap / OSRM.
    // No API key needed. Works in iframe. Supports driving, cycling, walking.
    // query format: 'From City -> To City' or 'Origin | Destination'
    case 'route': {
      // Parse 'origin -> destination' or 'origin | destination'
      const sep = q.includes('->') ? '->' : q.includes('|') ? '|' : null;
      let origin = q, destination = '';
      if (sep) {
        [origin, destination] = q.split(sep).map(s => s.trim());
      }
      const osmDir = destination
        ? `https://www.openstreetmap.org/directions?engine=osrm_car&route=${encodeURIComponent(origin)}%3B${encodeURIComponent(destination)}`
        : `https://www.openstreetmap.org/directions?engine=osrm_car&route=${encodeURIComponent(origin)}`;
      return {
        kind: 'route',
        src: proxyUrl(osmDir),
        title: destination ? `Rută: ${origin} → ${destination}` : `Direcții: ${origin}`,
        embedType: 'iframe',
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
          src: proxyUrl(windyWeatherEmbed(direct.lat, direct.lon)),
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
              src: proxyUrl(windyWeatherEmbed(g.latitude, g.longitude)),
              title: 'Vreme — locația ta',
              embedType: 'iframe',
            };
          }
        } catch { /* ignore */ }
      }
      if (!q) return null;

      // Free-text place name → geocode async; in the meantime proxy Windy for the query
      queueGeocodeUpgrade('weather', q);
      return {
        kind: 'weather',
        src: proxyUrl(`https://www.windy.com/?${encodeURIComponent(q)}`),
        title: `Vreme — ${q}`,
        embedType: 'iframe',
      };
    }

    // case 'video' removed (2026-04-28) — YouTube integration dropped.

    // VIDEO — restored with full format support (2026-04-29).
    // Supports: MP4, WebM, OGG (native player), YouTube, Vimeo (iframe embed),
    // and any other video URL (proxied through server to strip X-Frame-Options).
    case 'video': {
      const src = safeUrl(q);
      if (!src) return null;
      let label = src;
      try { label = new URL(src).hostname.replace(/^www\./, ''); } catch { /* ignore */ }

      // Direct video file → native HTML5 player
      const ext = src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
      if (['mp4', 'webm', 'ogg', 'mov', 'm4v', 'mkv'].includes(ext)) {
        return { kind: 'video', src, title: m?.title || label, embedType: 'video' };
      }

      // YouTube → use the /embed/ path (no X-Frame-Options blocking)
      try {
        const u = new URL(src);
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'youtube.com' || host === 'youtu.be') {
          let videoId = u.searchParams.get('v');
          if (!videoId && host === 'youtu.be') videoId = u.pathname.slice(1);
          if (!videoId) {
            const m2 = u.pathname.match(/\/(?:embed|v|shorts)\/([a-zA-Z0-9_-]{11})/);
            if (m2) videoId = m2[1];
          }
          if (videoId) {
            const embedSrc = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
            return { kind: 'video', src: embedSrc, title: label, embedType: 'iframe' };
          }
        }
        // Vimeo → use /video/ embed path
        if (host === 'vimeo.com') {
          const vid = u.pathname.replace(/^\//, '').split('/')[0];
          if (vid && /^\d+$/.test(vid)) {
            const embedSrc = `https://player.vimeo.com/video/${vid}?autoplay=1`;
            return { kind: 'video', src: embedSrc, title: label, embedType: 'iframe' };
          }
        }
      } catch { /* ignore */ }

      // Any other video URL → proxy to strip X-Frame-Options
      return { kind: 'video', src: proxyUrl(src), title: label, embedType: 'iframe' };
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

    case 'document': {
      const src = safeUrl(q);
      if (!src) return null;
      let label;
      try { label = decodeURIComponent(src.split('/').pop().split('?')[0]) || 'Document'; } catch { label = 'Document'; }

      const ext2 = src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();

      // CAD formats — route to appropriate viewer
      const cadResult = resolveCadUrl(src, ext2, label);
      if (cadResult) return cadResult;

      // PDF → browser renders natively inside iframe
      if (ext2 === 'pdf') {
        return { kind: 'document', src: proxyUrl(src), title: label, embedType: 'iframe' };
      }

      // Office / OpenDocument formats → Google Docs Viewer
      const officeExts = ['doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','csv'];
      if (officeExts.includes(ext2)) {
        const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(src)}&embedded=true`;
        return { kind: 'document', src: viewerUrl, title: label, embedType: 'iframe' };
      }

      // TXT or unknown → proxy directly
      return { kind: 'document', src: proxyUrl(src), title: label, embedType: 'iframe' };
    }

    // CAD / EDA / 3D engineering formats
    case 'cad': {
      const src = safeUrl(q);
      if (!src) return null;
      let label;
      try { label = decodeURIComponent(src.split('/').pop().split('?')[0]) || 'CAD File'; } catch { label = 'CAD File'; }
      const ext3 = src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
      const result = resolveCadUrl(src, ext3, label);
      return result || { kind: 'cad', src, title: label, embedType: 'external' };
    }

    case 'web': {
      const src = safeUrl(q);
      if (!src) return null;
      let label = src;
      try { label = new URL(src).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
      // Only truly cross-origin-isolated sites need a real tab;
      // everything else goes through the proxy to strip X-Frame-Options.
      if (requiresExternalTab(src)) {
        return { kind: 'web', src, title: label, embedType: 'external' };
      }
      // Auto-detect document URLs even when kind='web'
      const extW = src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
      const docExts = ['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf'];
      if (docExts.includes(extW)) {
        return resolveMonitor('document', q);
      }
      // Route through server-side proxy — strips X-Frame-Options/CSP
      return { kind: 'web', src: proxyUrl(src), title: label, embedType: 'iframe' };
    }

    case 'html': {
      // Render raw HTML content directly on the monitor — used for math
      // solutions, step-by-step demonstrations, formatted text, etc.
      if (!q) return null;
      return { kind: 'html', src: q, title: args?.title || 'Kelion — Demonstrație', embedType: 'html' };
    }

    case 'html': {
      // Render raw HTML content directly on the monitor — used for math
      // solutions, step-by-step demonstrations, formatted text, etc.
      if (!q) return null;
      return { kind: 'html', src: q, title: args?.title || 'Kelion — Demonstrație', embedType: 'html' };
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
