import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    viteCommonjs(),
    wasm(),
    nodePolyfills({
      include: ['crypto', 'buffer', 'process', 'stream', 'util'],
    }),
  ],

  resolve: {
    alias: {
      'isomorphic-ws': fileURLToPath(new URL('./src/shims/isomorphic-ws.ts', import.meta.url)),
      'cross-fetch': fileURLToPath(new URL('./src/shims/cross-fetch.ts', import.meta.url)),
    },
  },

  optimizeDeps: {
    include: ['@midnight-ntwrk/compact-js', '@midnight-ntwrk/compact-runtime'],
  },

  build: {
    target: 'es2022',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },

  server: {
    port: 5173,
  },
});