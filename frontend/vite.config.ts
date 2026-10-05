import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// the config runs in Node; the app's tsconfig only has browser types
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // the API runs on :4000 in development; same-origin /api keeps CORS out of the way
    // set API_URL when the API runs elsewhere (e.g. another app already uses port 4000)
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:4000' },
  },
});
