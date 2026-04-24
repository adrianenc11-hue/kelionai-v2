// Configure @monaco-editor/react to use the LOCAL npm monaco-editor
// bundle rather than loading it from the default CDN (jsdelivr).
//
// Why: kelionai.app's CSP restricts script-src to 'self' + 'blob:' +
// 'wasm-unsafe-eval' (server/src/index.js). The default loader fetches
// Monaco's ~4 MB of JS from cdn.jsdelivr.net which would be blocked
// and break the editor. Bundling the ESM build locally + wiring Vite's
// `?worker` imports keeps every Monaco asset on the same origin.
//
// Called once, idempotently, before any <Editor /> is rendered.

import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

// Vite's `?worker` suffix produces a self-contained Worker constructor
// that Vite bundles separately. Each Worker is instantiated from a
// blob: URL at runtime, which CSP `workerSrc 'self' blob:` allows.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

let installed = false

export function ensureMonaco() {
  if (installed) return
  installed = true

  // Tell Monaco which Worker to spawn for each language. `label` is
  // 'editor' for the base worker and the language id for specialised
  // workers (json/css/html/typescript). Python falls through to the
  // base editor worker — we don't ship a python language service,
  // syntax highlighting is enough for v1.
  if (typeof self !== 'undefined') {
    self.MonacoEnvironment = {
      getWorker(_workerId, label) {
        if (label === 'json')                                  return new JsonWorker()
        if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
        if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
        if (label === 'typescript' || label === 'javascript')  return new TsWorker()
        return new EditorWorker()
      },
    }
  }

  // Hand the loader the in-bundle monaco module so it never touches the
  // CDN. This also silences the "paths.vs not found" warning in the
  // browser console.
  loader.config({ monaco })
}

export default ensureMonaco
