import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The client lives in client/ and builds to one self-contained dist/index.html.
export default defineConfig({
  root: 'client',
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    // npm run dev + npm run server: the dev page talks to the local game server through the same origin.
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
      '/status': 'http://127.0.0.1:8080',
    },
  },
});
