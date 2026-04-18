// Stage 3 — memory client.

export async function fetchMemory(limit = 200) {
  const r = await fetch(`/api/memory?limit=${encodeURIComponent(limit)}`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`memory list failed (${r.status})`);
  return r.json();
}

export async function extractAndStore(turns) {
  const r = await fetch('/api/memory/extract-and-store', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turns }),
  });
  if (!r.ok) throw new Error(`extract failed (${r.status})`);
  return r.json();
}

export async function forgetMemoryItem(id) {
  const r = await fetch(`/api/memory/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`forget ${id} failed (${r.status})`);
  return r.json();
}

export async function forgetAllMemory() {
  const r = await fetch('/api/memory', {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`clear failed (${r.status})`);
  return r.json();
}
