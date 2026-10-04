import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // the API runs on :4000 in development; same-origin /api keeps CORS out of the way
    proxy: { '/api': 'http://localhost:4000' },
  },
});
