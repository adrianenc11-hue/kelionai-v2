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
  MAX_STUDIO_FILE_BYTES,
  MAX_STUDIO_WORKSPACE_BYTES,
  MAX_STUDIO_USER_BYTES,
  MAX_STUDIO_FILES_PER_WS,
} = require('../db');

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

module.exports = router;
