import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy keeps the browser on one origin, so SSE and fetch need no CORS handling in dev.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } }
  }
});
