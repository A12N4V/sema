import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The frontend talks to the backend only through the relative path `/api`.
// In dev, Vite proxies it to the FastAPI server; in prod the two are served
// from the same origin. Override the target with SEMA_API_URL.
const API_TARGET = process.env.SEMA_API_URL ?? 'http://localhost:8123'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
