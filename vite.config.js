import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.VITE_API_BASE_URL || 'http://localhost:3001'

  return {
    plugins: [react()],
    build: {
      // Monaco workers are inherently large (~7 MB for TS alone) but only
      // load on the /studio route (React.lazy). We silence the warning
      // since they're already code-split and not on the critical path.
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
              return 'react-vendor'
            }
            if (id.includes('node_modules/three') || id.includes('node_modules/@react-three')) {
              return 'three-vendor'
            }
            if (id.includes('node_modules/react-router')) {
              return 'router'
            }
            // Group all Monaco editor code into a dedicated chunk so it
            // never leaks into the main KelionStage bundle.
            if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
              return 'monaco-vendor'
            }
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: 'all',
      port: 5173,
      proxy: {
        '/api':    { target: backendTarget, changeOrigin: true },
        '/auth':   { target: backendTarget, changeOrigin: true },
        '/health': { target: backendTarget, changeOrigin: true },
        '/ping':   { target: backendTarget, changeOrigin: true },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api':    { target: backendTarget, changeOrigin: true },
        '/auth':   { target: backendTarget, changeOrigin: true },
        '/health': { target: backendTarget, changeOrigin: true },
        '/ping':   { target: backendTarget, changeOrigin: true },
      },
    },
  }
})
