import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local development only; the public site runs on the server (scripts/deploy.sh).
const host = '127.0.0.1'

// base './' lets the built site run from any folder or sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  // The Go backend (backend/) serves the built site on port 80 in production.
  // During `npm run dev` the API and videos are proxied to it.
  server: {
    host,
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8080', '/media': 'http://127.0.0.1:8080' },
  },
  build: { sourcemap: false },
})
