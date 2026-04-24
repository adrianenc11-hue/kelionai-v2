/* eslint-env node */
'use strict';

// ---------------------------------------------------------------------------
// Kelion Desktop — preload script.
//
// Runs in the renderer's isolated world (sandbox: true). Exposes a small,
// audited API under `window.kelion` using `contextBridge` so the web app
// can detect that it's running inside the desktop shell and hook into the
// native menus / deep-links.
//
// Never expose `require`, `ipcRenderer` or any node globals directly.
// ---------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron');

/** @type {Record<string, Array<(...args: any[]) => void>>} */
const listeners = {};

function emit(channel, ...args) {
  const arr = listeners[channel];
  if (!arr) return;
  for (const fn of arr.slice()) {
    try { fn(...args); } catch { /* listener errors must not kill the preload */ }
  }
}

// Forward main → renderer events through a small event bus so the web app
// can subscribe without needing raw ipcRenderer.
ipcRenderer.on('kelion:deep-link', (_e, url) => emit('deep-link', url));
ipcRenderer.on('kelion:new-session', () => emit('new-session'));

contextBridge.exposeInMainWorld('kelion', {
  /** Static marker the web app uses to branch UX (install button, native
   *  menus, etc.). */
  isDesktop: true,

  /** Package version, synchronously cached here — the web app can render
   *  it in Settings without an IPC round-trip. Populated below. */
  version: null,

  /** Platform details. */
  getPlatform: () => ipcRenderer.invoke('kelion:platform'),

  /** Subscribe to a named event (`deep-link`, `new-session`). */
  on(channel, handler) {
    if (typeof handler !== 'function') return () => {};
    const arr = listeners[channel] || (listeners[channel] = []);
    arr.push(handler);
    return () => {
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    };
  },
});

// Populate the static version field after load. We can't use `await` at
// the top level of a preload script.
ipcRenderer.invoke('kelion:version').then((v) => {
  try {
    // eslint-disable-next-line no-undef
    Object.defineProperty(window.kelion, 'version', { value: v, configurable: false });
  } catch {
    /* already frozen or missing — harmless */
  }
});
