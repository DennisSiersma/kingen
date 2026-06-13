import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // De gedeelde engine (@kingen/shared) wordt als TS-bron geïmporteerd.
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
    // WebSocket-verkeer naar de dev-server (Fase 1: poort 8080) proxyen, zodat de
    // client in dev én productie dezelfde same-origin URL (/ws) kan gebruiken.
    proxy: {
      '/ws': {
        target: process.env.KINGEN_SERVER ?? 'http://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
      // Stats-endpoint naar de game-server proxyen (zodat /stats.html in dev werkt).
      '/api': {
        target: process.env.KINGEN_SERVER ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
