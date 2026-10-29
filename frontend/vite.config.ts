import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The frontend talks to the backend only through the relative path `/api`.
// In dev, Vite proxies it to the FastAPI server; in prod the two are served
// from the same origin. Override the target with SEMA_API_URL.
const API_TARGET = process.env.SEMA_API_URL ?? 'http://localhost:8123'

// A static build hosted under a sub-path (GitHub Pages: SEMA_BASE=/sema/).
// The router strips the prefix, so routes stay root-relative in the code.
export default defineConfig({
  base: process.env.SEMA_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.SEMA_WEB_PORT ?? 5173),
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/omics': { target: API_TARGET, changeOrigin: true },
    },
  },
})
