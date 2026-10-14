import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo-name>/. Override with BASE_PATH if needed.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
