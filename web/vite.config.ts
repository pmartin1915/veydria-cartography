import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => ({
  // GitHub Pages serves from a sub-path; Tauri and dev serve from root. The
  // `tauri` mode (npm run build:tauri) forces root so bundled asset/data URLs
  // resolve under Tauri's custom protocol. All runtime fetches go through
  // import.meta.env.BASE_URL, so this single switch covers web vs desktop.
  base: command === 'build' && mode !== 'tauri' ? '/veydria-cartography/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist2',
    rollupOptions: {
      output: {
        manualChunks: {
          // Split the three biggest deps so the main bundle stops
          // tripping vite's 500 kB chunk-size warning. Each chunk is
          // cacheable independently — when app code changes, the
          // browser doesn't re-download leaflet/d3.
          leaflet: ['leaflet', 'react-leaflet'],
          d3: ['d3'],
          'html-to-image': ['html-to-image'],
        },
      },
    },
  },
}))
