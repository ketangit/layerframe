import { defineConfig } from 'vite';

// The UI lives in src/ui. In dev, server.ts mounts Vite as middleware (one port, HMR).
// `npm run build` writes dist/, which `npm run serve` serves statically.
export default defineConfig({
  root: 'src/ui',
  publicDir: false,
  // lets the Docker Desktop Playwright MCP reach the dev server; the server still binds 127.0.0.1
  server: { allowedHosts: ['host.docker.internal'] },
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2023', chunkSizeWarningLimit: 1500 },
});
