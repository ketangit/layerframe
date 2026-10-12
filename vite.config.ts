import { defineConfig } from 'vite';

// The app is browser-only: src/ui is the root, `npm start` is the Vite dev server (HMR),
// `npm run build` writes static dist/ (deployed to Vercel), `npm run serve` previews it.
// Port 5317 on 127.0.0.1 for both, so the page origin matches the MCP bridge allowlist (src/core/bridge.ts).
export default defineConfig({
  root: 'src/ui',
  publicDir: false,
  // allowedHosts lets the Docker Desktop Playwright MCP reach the dev server
  server: { host: '127.0.0.1', port: 5317, strictPort: true, allowedHosts: ['host.docker.internal'] },
  preview: { host: '127.0.0.1', port: 5317, strictPort: true, allowedHosts: ['host.docker.internal'] },
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2023', chunkSizeWarningLimit: 1500 },
});
