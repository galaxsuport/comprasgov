import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  plugins: [react()],
  envPrefix: 'VITE_PUBLIC_',
  server: {
    port: 4173,
    proxy: {
      '/api/pregoes': 'http://127.0.0.1:4174',
      '/api/auth': 'http://127.0.0.1:4174',
      '/api/discarded': 'http://127.0.0.1:4174',
      '/api/registered': 'http://127.0.0.1:4174',
      '/api/settings': 'http://127.0.0.1:4174',
      '/api': 'http://127.0.0.1:4174'
    }
  }
}));
