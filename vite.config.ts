import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Single source of truth for import aliases (@shared/*, @client/*): tsconfig.base.json.
    tsconfigPaths: true,
  },
  server: {
    port: 5173,
  },
  build: {
    // The Three.js WebGPU build (with its WebGL 2 fallback and TSL) is ~0.9 MB minified (~240 kB gzip).
    // It is split into its own long-cached chunk so game code updates stay small.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
