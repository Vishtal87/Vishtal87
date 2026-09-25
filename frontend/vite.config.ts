import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = process.env.GEONEWS_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/tiles': { target: API, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/tiles': { target: API, changeOrigin: true },
    },
  },
  worker: { format: 'es' },   // MapLibre creates its worker with { type: 'module' }
  build: { chunkSizeWarningLimit: 1500 },
})
