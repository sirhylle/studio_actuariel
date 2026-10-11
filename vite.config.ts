import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Garantit l'usage de chemins relatifs pour l'hébergement intranet ou local
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'esnext'
  },
  worker: {
    format: 'es'
  },
  server: {
    port: 8080,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
