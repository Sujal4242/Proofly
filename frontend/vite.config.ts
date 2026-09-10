import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

export default defineConfig({
  plugins: [react(), viteCommonjs(), wasm(), nodePolyfills({ include: ['crypto', 'buffer', 'process', 'stream', 'util'] })],

  optimizeDeps: {
    include: ['@midnight-ntwrk/compact-runtime'],
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