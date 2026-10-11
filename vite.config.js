import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The WebLLM worker is an ES module worker (it lazy-loads the model runtime)
  worker: { format: 'es' },
  // WebLLM's runtime (~6 MB) is a lazy chunk loaded only when the AI assistant starts
  build: { chunkSizeWarningLimit: 7000 },
  // `npm run server` hosts the NAV cache API on :8787; the app falls back to mfapi.in without it
  server: { proxy: { '/api': 'http://localhost:8787' } },
  preview: { proxy: { '/api': 'http://localhost:8787' } },
})
