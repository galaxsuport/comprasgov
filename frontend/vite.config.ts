import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const webhookUrl = env.VITE_API_BASE_URL;
  const webhook = webhookUrl ? new URL(webhookUrl) : null;

  return {
    plugins: [react()],
    server: {
      port: 4173,
      proxy: webhook ? {
        '/api/pregoes': {
          target: webhook.origin,
          changeOrigin: true,
          rewrite: (path) => path.replace('/api/pregoes', webhook.pathname)
        }
      } : undefined
    }
  };
});
