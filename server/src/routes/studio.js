'use strict';

// Dev Studio (DS-1) — per-user Python project workspace CRUD + file I/O.
//
// These endpoints power the voice-driven IDE Kelion will expose in the
// 50vw monitor overlay (DS-2 lands the editor UI). Every route requires
// a signed-in user — `requireAuth` is applied in server/src/index.js
// where the router is mounted under `/api/studio`.
//
// Ownership: the DB helpers in server/src/db/index.js filter every read
// and mutation by `user_id`, so user B can never touch user A's
// workspace even if they guess the id. 404 is returned for both
// not-found AND not-owned so callers can't probe other users' ids.
//
// Quota enforcement is done DB-side (writeStudioFile / deleteStudioFile)
// via structured `RangeError` with a `studioQuota` tag. This layer maps
// those into 413 responses with a stable `{ error, code }` shape so the
// UI (DS-2) can show precise banners ("project full", "file > 5 MB").

const { Router } = require('express');
const {
  listStudioWorkspaces,
  createStudioWorkspace,
  getStudioWorkspace,
  renameStudioWorkspace,
  deleteStudioWorkspace,
  getUserStudioUsage,
  writeStudioFile,
  deleteStudioFile,
  readStudioFile,
  listStudioFiles,
  sanitizeStudioPath,
  MAX_STUDIO_FILE_BYTES,
  MAX_STUDIO_WORKSPACE_BYTES,
  MAX_STUDIO_USER_BYTES,
  MAX_STUDIO_FILES_PER_WS,
} = require('../db');
const { runWorkspace } = require('../services/studioSandbox');

// Package names in pip's own spec: letters, digits, `.-_`, plus the
// version / extras modifiers we actually want to accept on the wire
// (==, >=, <=, ~=, !=, [extras], ,). Intentionally NO whitespace, so
// a user can't slip in `requests ; rm -rf /` via a crafted request.
// Length cap is 200 chars — longest real-world PyPI package I could
// find is ~40 chars (`google-cloud-bigquery-storage`), so 200 is
// plenty of headroom without inviting abuse.
const PIP_PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._\-\[\]=<>~!,]{0,199}$/;

const router = Router();

// 4xx helpers. The DB layer raises `RangeError` with a `studioQuota`
// tag for quota / validation violations; map them to a stable wire
// shape so the client can render actionable banners instead of
// opaque 500s.
function mapQuotaError(err, res) {
  if (!err || !err.studioQuota) return false;
  const code = err.studioQuota;
  const status = (code === 'NAME_INVALID' || code === 'PATH_INVALID' || code === 'CONTENT_INVALID')
    ? 400
    : (code === 'NAME_DUP' ? 409 : 413);
  res.status(status).json({
    error: err.message || 'studio quota',
    code,
    // Surface numeric limits so the UI can show "4.8 MB / 5 MB" banners.
    limit: Number.isFinite(err.limit) ? err.limit : undefined,
    size: Number.isFinite(err.size) ? err.size : undefined,
  });
  return true;
}

// GET /api/studio/usage — total bytes / quota info across all workspaces.
router.get('/usage', async (req, res) => {
  try {
    const usage = await getUserStudioUsage(req.user.id);
    res.json({
      ...usage,
      limits: {
        file_bytes:       MAX_STUDIO_FILE_BYTES,
        workspace_bytes:  MAX_STUDIO_WORKSPACE_BYTES,
        user_bytes:       MAX_STUDIO_USER_BYTES,
        files_per_ws:     MAX_STUDIO_FILES_PER_WS,
      },
    });
  } catch (err) {
    console.error('[studio/usage]', err);
    res.status(500).json({ error: 'Failed to read usage' });
  }
});

// GET /api/studio/workspaces — list all of the caller's projects (meta only).
router.get('/workspaces', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '50', 10)));
    const items = await listStudioWorkspaces(req.user.id, limit);
    res.json({ items });
  } catch (err) {
    console.error('[studio/list]', err);
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

// POST /api/studio/workspaces — create a new empty project.
// Body: { name: string }
router.post('/workspaces', async (req, res) => {
  try {
    const name = req.body?.name;
    const ws = await createStudioWorkspace(req.user.id, name);
    // Return meta only on create — the files map is always empty here.
    res.status(201).json({
      workspace: {
        id: ws.id,
        name: ws.name,
        size_bytes: ws.size_bytes,
        created_at: ws.created_at,
        updated_at: ws.updated_at,
        files: [],
      },
    });
  } catch (err) {
    if (mapQuotaError(err, res)) return;
    console.error('[studio/create]', err);
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

// GET /api/studio/workspaces/:id — full workspace with file list (no content).
router.get('/workspaces/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const ws = await getStudioWorkspace(req.user.id, id);
    if (!ws) return res.status(404).json({ error: 'not found' });
    res.json({
      workspace: {
        id: ws.id,
        name: ws.name,
        size_bytes: ws.size_bytes,
        created_at: ws.created_at,
        updated_at: ws.updated_at,
        files: listStudioFiles(ws),
      },
    });
  } catch (err) {
    console.error('[studio/get]', err);
    res.status(500).json({ error: 'Failed to load workspace' });
  }
});

// PATCH /api/studio/workspaces/:id — rename a project.
// Body: { name: string }
router.patch('/workspaces/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const ok = await renameStudioWorkspace(req.user.id, id, req.body?.name || '');
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    if (mapQuotaError(err, res)) return;
    console.error('[studio/rename]', err);
    res.status(500).json({ error: 'Failed to rename workspace' });
  }
});

// DELETE /api/studio/workspaces/:id — forget a project (CASCADE not needed,
// files live inline as JSON in the same row).
router.delete('/workspaces/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const ok = await deleteStudioWorkspace(req.user.id, id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[studio/delete]', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// GET /api/studio/workspaces/:id/file — read one file's content.
// Query: ?path=<repo-style path>
// We use a query param (not a wildcard segment) so the path can contain
// forward slashes without being URL-rewritten by intermediaries.
router.get('/workspaces/:id/file', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const p = req.query.path;
    const entry = await readStudioFile(req.user.id, id, p);
    if (!entry) return res.status(404).json({ error: 'not found' });
    res.json({ file: entry });
  } catch (err) {
    console.error('[studio/read]', err);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// PUT /api/studio/workspaces/:id/file — write / overwrite a file.
// Body: { path: string, content: string }
// Idempotent upsert — autosave calls this every 2s with the same path.
router.put('/workspaces/:id/file', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const body = req.body || {};
    const written = await writeStudioFile(req.user.id, id, body.path, body.content);
    if (!written) return res.status(404).json({ error: 'not found' });
    res.json({ file: written });
  } catch (err) {
    if (mapQuotaError(err, res)) return;
    console.error('[studio/write]', err);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// DELETE /api/studio/workspaces/:id/file — remove a file.
// Body: { path: string }
router.delete('/workspaces/:id/file', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const body = req.body || {};
    const result = await deleteStudioFile(req.user.id, id, body.path);
    if (!result) return res.status(404).json({ error: 'not found' });
    res.json(result);
  } catch (err) {
    if (mapQuotaError(err, res)) return;
    console.error('[studio/delete-file]', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// -------------------------------------------------------------------
// DS-3 — Sandbox execution
// -------------------------------------------------------------------
// `runWorkspace` in services/studioSandbox.js encapsulates the full
// sandbox lifecycle (create → hydrate → pip install → python → kill).
// These routes are thin auth+validation wrappers around it.
// Ownership is enforced by `getStudioWorkspace(userId, id)` returning
// `null` for anyone else's id, which we map to 404 (not 403) to match
// the non-owner behaviour of the DS-1 endpoints above.

function readEntry(body, fallback = 'main.py') {
  const raw = typeof body?.entry === 'string' && body.entry.trim()
    ? body.entry.trim()
    : fallback;
  return sanitizeStudioPath(raw);
}

function mapSandboxError(err, res) {
  if (err && err.studioSandbox === 'UNAVAILABLE') {
    return res.status(503).json({
      error: 'Code sandbox is not configured on this server. Set E2B_API_KEY.',
      code: 'SANDBOX_UNAVAILABLE',
    });
  }
  if (err && err.studioSandbox === 'CREATE_FAILED') {
    return res.status(502).json({
      error: err.message || 'Failed to start sandbox',
      code: 'SANDBOX_CREATE_FAILED',
    });
  }
  return res.status(500).json({ error: 'sandbox error', code: 'SANDBOX_ERROR' });
}

// POST /api/studio/workspaces/:id/run — install deps (if requirements.txt
// exists) and run `python <entry>`. Default entry = main.py.
// Body: { entry?: string, install_first?: boolean, timeout_ms?: number }
router.post('/workspaces/:id/run', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'Code sandbox is not configured on this server. Set E2B_API_KEY.',
        code: 'SANDBOX_UNAVAILABLE',
      });
    }
    const ws = await getStudioWorkspace(req.user.id, id);
    if (!ws) return res.status(404).json({ error: 'not found' });

    const entry = readEntry(req.body);
    if (!entry) {
      return res.status(400).json({ error: 'invalid entry path', code: 'ENTRY_INVALID' });
    }
    if (!ws.files || !ws.files[entry]) {
      return res.status(400).json({
        error: `entry file not found in workspace: ${entry}`,
        code: 'ENTRY_MISSING',
      });
    }
    const installFirst = req.body?.install_first !== false;
    const timeoutMs = Number(req.body?.timeout_ms);

    const out = await runWorkspace({
      files: ws.files,
      entry,
      installFirst,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
      apiKey,
    });
    res.json({ ok: true, entry, ...out });
  } catch (err) {
    if (err && (err.studioSandbox === 'UNAVAILABLE' || err.studioSandbox === 'CREATE_FAILED')) {
      return mapSandboxError(err, res);
    }
    console.error('[studio/run]', err);
    res.status(500).json({ error: 'sandbox error', code: 'SANDBOX_ERROR' });
  }
});

// POST /api/studio/workspaces/:id/pip-install — validate packages by
// running `pip install` in a fresh sandbox, then (on success) append
// them to `requirements.txt` in the workspace. Failure leaves the
// workspace untouched — the user sees stderr from pip and knows why.
// Body: { packages: string[] }
router.post('/workspaces/:id/pip-install', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'Code sandbox is not configured on this server. Set E2B_API_KEY.',
        code: 'SANDBOX_UNAVAILABLE',
      });
    }
    const raw = Array.isArray(req.body?.packages) ? req.body.packages : null;
    if (!raw || !raw.length) {
      return res.status(400).json({ error: 'packages[] required', code: 'PACKAGES_MISSING' });
    }
    if (raw.length > 50) {
      return res.status(400).json({ error: 'too many packages (max 50)', code: 'PACKAGES_TOO_MANY' });
    }
    const validated = [];
    for (const p of raw) {
      if (typeof p !== 'string') {
        return res.status(400).json({ error: 'invalid package', code: 'PACKAGE_INVALID' });
      }
      const clean = p.trim();
      if (!PIP_PACKAGE_RE.test(clean)) {
        return res.status(400).json({
          error: `invalid package name: ${JSON.stringify(p)}`,
          code: 'PACKAGE_INVALID',
        });
      }
      validated.push(clean);
    }

    const ws = await getStudioWorkspace(req.user.id, id);
    if (!ws) return res.status(404).json({ error: 'not found' });

    // Merge into requirements.txt — preserve existing lines, add new
    // ones at the end in the order the user requested. Dedup case-
    // sensitively because `Flask` and `flask` are the same package to
    // pip but a user might care about the spelling in their file.
    const existing = ws.files?.['requirements.txt']?.content || '';
    const existingLines = existing.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const seen = new Set(existingLines);
    const finalLines = [...existingLines];
    for (const pkg of validated) {
      if (!seen.has(pkg)) {
        finalLines.push(pkg);
        seen.add(pkg);
      }
    }
    const nextRequirements = finalLines.join('\n') + '\n';

    // Build an overlay so we validate the FUTURE requirements.txt
    // without mutating the workspace row until we know pip succeeded.
    const overlayFiles = {
      ...(ws.files || {}),
      'requirements.txt': {
        content: nextRequirements,
        size: Buffer.byteLength(nextRequirements, 'utf8'),
        updated_at: new Date().toISOString(),
      },
    };

    const timeoutMs = Number(req.body?.timeout_ms);
    const out = await runWorkspace({
      files: overlayFiles,
      entry: null, // install-only — no python run
      installFirst: true,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 90_000,
      apiKey,
    });

    const installed = out.pip && out.pip.exit_code === 0;
    if (installed) {
      try {
        await writeStudioFile(req.user.id, id, 'requirements.txt', nextRequirements);
      } catch (err) {
        // If we couldn't persist (quota, etc.), tell the client pip
        // succeeded but the workspace wasn't updated — they can
        // clean up manually and try again.
        if (mapQuotaError(err, res)) return;
        throw err;
      }
    }

    res.status(installed ? 200 : 422).json({
      ok: installed,
      added: validated,
      requirements_preview: nextRequirements,
      pip: out.pip,
      duration_ms: out.duration_ms,
    });
  } catch (err) {
    if (err && (err.studioSandbox === 'UNAVAILABLE' || err.studioSandbox === 'CREATE_FAILED')) {
      return mapSandboxError(err, res);
    }
    console.error('[studio/pip-install]', err);
    res.status(500).json({ error: 'sandbox error', code: 'SANDBOX_ERROR' });
  }
});

module.exports = router;
