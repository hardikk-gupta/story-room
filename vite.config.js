import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022', // top-level await in main.js
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true },
});
