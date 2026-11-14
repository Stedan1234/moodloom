import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// In development the web app runs on :5173 and the API on :3001. Proxying
// /api and /uploads means the browser only ever talks to one origin, exactly
// as it does in production where the API serves the built app itself.
const backend = process.env.VITE_BACKEND || 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/uploads': { target: backend, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/uploads': { target: backend, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdf'
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor'
        },
      },
    },
  },
})
