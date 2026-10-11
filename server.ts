// LayerFrame Studio — local server (no dependencies beyond the geometry libs).
// Serves the web app and a JSON API that the UI and the MCP server both use.
// Runs directly on Node >= 24 (native type stripping). Dev: Vite as middleware with HMR.
// Prod (--prod or NODE_ENV=production): serves the built dist/.
//
//   GET    /api/state                 full state
//   PATCH  /api/state   {patch}       deep-merge (POST also accepted)
//   PUT    /api/state   {state}       replace
//   POST   /api/reset                 restore defaults
//   GET    /api/schema                parameter schema, defaults, presets
//   GET    /api/templates             template catalogue      POST /api/template {name}  apply one (sizes kept)
//   GET    /api/model                 derived sizes + per-layer summary
//   GET    /api/export?format=3mf|stl[&layer=0][&save=1]
//          save=1 writes into ./exports and returns JSON {path}
//   GET    /api/events                server-sent events: "state" on every change
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import ClipperLib from 'clipper-lib';
import JSZip from 'jszip';
import { SCHEMA, DEFAULTS, SIZE_PRESETS, TEMPLATES, defaultState, migrate, applyPatch, applyTemplate, buildLayers } from './src/core/frame-core.ts';
import type { State } from './src/core/frame-core.ts';
import { export3MFFor, exportSTLFor } from './src/core/mesh.ts';

const ROOT = import.meta.dirname;
const DIST = path.join(ROOT, 'dist');
const STATE_FILE = path.join(ROOT, 'state.json');
const EXPORTS = path.join(ROOT, 'exports');
const PORT = Number(process.env.PORT || 5317);
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

let state = defaultState();
try { state = migrate(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch {}

const clients = new Set<http.ServerResponse>();
let rev = 0;
function setState(next: State, source = 'api') {
  state = next; rev++;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  const msg = `event: state\ndata: ${JSON.stringify({ rev, source, state })}\n\n`;
  for (const c of clients) c.write(msg);
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function send(res: http.ServerResponse, code: number, body: unknown, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2));
}

// Request bodies are untrusted JSON; routes pick out the fields they need.
function readBody(req: http.IncomingMessage): Promise<Record<string, any>> {
  return new Promise((ok, bad) => {
    let s = '';
    req.on('data', (d: Buffer) => (s += d));
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
  });
}

function summary() {
  const m = buildLayers(state.params, ClipperLib);
  return { params: m.params, derived: m.derived, layers: m.layers.map(({ regions, ...L }) => ({ ...L, regions: regions.length })) };
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');
const sourceOf = (req: http.IncomingMessage) => String(req.headers['x-source'] || 'api');

let vite: ViteDevServer | undefined;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, { rev, state });
    if (p === '/api/state' && (req.method === 'PATCH' || req.method === 'POST')) {
      const body = await readBody(req);
      setState(applyPatch(state, body.patch ?? body), sourceOf(req));
      return send(res, 200, { rev, state });
    }
    if (p === '/api/state' && req.method === 'PUT') {
      const body = await readBody(req);
      setState(migrate(body.state ?? body), sourceOf(req));
      return send(res, 200, { rev, state });
    }
    if (p === '/api/reset' && req.method === 'POST') { setState(defaultState(), 'reset'); return send(res, 200, { rev, state }); }
    if (p === '/api/schema') return send(res, 200, { schema: SCHEMA, defaults: DEFAULTS, sizes: SIZE_PRESETS });
    if (p === '/api/templates') return send(res, 200, Object.fromEntries(Object.entries(TEMPLATES).map(([n, t]) => [n, { note: t.note, params: t.params }])));
    if (p === '/api/template' && req.method === 'POST') {
      const body = await readBody(req);
      if (!TEMPLATES[body.name]) return send(res, 404, { error: `unknown template ${body.name}`, available: Object.keys(TEMPLATES) });
      setState(applyTemplate(state, body.name), sourceOf(req));
      return send(res, 200, { rev, template: body.name, state });
    }
    if (p === '/api/model') return send(res, 200, summary());
    if (p === '/api/export') {
      const fmt = (url.searchParams.get('format') || '3mf').toLowerCase();
      const layer = url.searchParams.has('layer') ? Number(url.searchParams.get('layer')) : null;
      const base = safe(url.searchParams.get('name') || state.params.template || 'frame');
      let data: Uint8Array, fname: string;
      if (fmt === '3mf') { data = await export3MFFor(state, ClipperLib, JSZip); fname = `${base}.3mf`; }
      else if (fmt === 'stl') { data = Buffer.from(exportSTLFor(state, ClipperLib, layer)); fname = `${base}${layer === null ? '' : `_L${layer + 1}`}.stl`; }
      else return send(res, 400, { error: 'format must be 3mf or stl' });
      if (url.searchParams.get('save') === '1') {
        fs.mkdirSync(EXPORTS, { recursive: true });
        const out = path.join(EXPORTS, fname);
        fs.writeFileSync(out, data);
        return send(res, 200, { path: out, bytes: data.length });
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${fname}"` });
      return res.end(data);
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify({ rev, source: 'init', state })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    // UI: Vite middleware in dev, the built dist/ in prod
    if (vite) return vite.middlewares(req, res);
    const f = path.normalize(path.join(DIST, p === '/' ? 'index.html' : p));
    if (!f.startsWith(DIST)) return send(res, 403, 'forbidden', 'text/plain');
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found (run `npm run build` first?)', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    send(res, 500, { error: String(e instanceof Error ? e.message : e) });
  }
});

if (!PROD) {
  const { createServer } = await import('vite');
  vite = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
}

server.listen(PORT, '127.0.0.1', () => console.log(`LayerFrame Studio${PROD ? '' : ' (dev)'} → http://localhost:${PORT}`));
