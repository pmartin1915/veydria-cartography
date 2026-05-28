import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  // Sub-path base for GitHub Pages production builds; root in dev for clean localhost URLs.
  base: command === 'build' ? '/veydria-cartography/' : '/',
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
