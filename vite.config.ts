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
  },
});
