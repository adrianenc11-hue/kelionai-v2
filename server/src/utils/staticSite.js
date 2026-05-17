'use strict';

function mountStaticSite(app, express, path, distPath, opts = {}) {
  const {
    logger = console,
    hasDist = false,
  } = opts;

  if (!hasDist) {
    logger.warn(`[kelion-api] Production mode: dist folder missing at ${distPath}; API-only mode enabled`);
    return false;
  }

  logger.log(`[kelion-api] Production mode: serving from ${distPath}`);

  // ── Caching strategy ────────────────────────────────────────────────────
  // 1. Hashed assets (JS/CSS with content hash in filename) → immutable 1yr.
  //    Vite always changes the hash when content changes, so this is safe.
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    immutable: true,
    maxAge: '1y',
    etag: false,
    lastModified: false,
  }));

  // 2. GLB / 3D models → 7-day cache (large files, rarely change).
  app.use(express.static(distPath, {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      const f = filePath.toLowerCase();
      if (f.endsWith('.glb') || f.endsWith('.gltf')) {
        res.setHeader('Cache-Control', 'public, max-age=604800'); // 7d
      } else if (f.endsWith('.webmanifest')) {
        // 3a. PWA manifest → correct MIME type + never cache.
        res.setHeader('Content-Type', 'application/manifest+json');
        res.setHeader('Cache-Control', 'no-store');
      } else if (
        f.endsWith('sw.js') ||
        f.endsWith('index.html')
      ) {
        // 3b. HTML shell, service worker → never cache.
        //    Browser MUST always get the latest index.html so it loads
        //    the correct hashed JS bundles after every deploy.
        //    Without this, a cached index.html referencing old bundle
        //    hashes causes 404s → "Ceva nu a mers bine" crash.
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }));

  // SPA fallback — all non-API routes serve index.html with no-store.
  app.get('*', (req, res, next) => {
    if (/^\/api(\/|$)/.test(req.path) || req.path === '/health' || req.path === '/ping') {
      return next();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  return true;
}

module.exports = { mountStaticSite };
