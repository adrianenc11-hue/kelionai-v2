import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.VITE_API_BASE_URL || 'http://localhost:3001'

  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 1400,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor':  ['react', 'react-dom'],
            'three-vendor':  ['three', '@react-three/fiber', '@react-three/drei'],
            'router':        ['react-router-dom'],
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: 'all',
      port: 5173,
      proxy: {
        '/api':  { target: backendTarget, changeOrigin: true },
        '/auth': { target: backendTarget, changeOrigin: true },
      },
    },
  }
})
