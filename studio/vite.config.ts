import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  plugins: [svelte()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5176,
    proxy: {
      '/studio-api': {
        target: 'http://localhost:5175',
        changeOrigin: true,
      },
    },
  },
});
