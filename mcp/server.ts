// LayerFrame — MCP server (stdio).
// The app is browser-only, so this server can't compute anything itself: it opens a WebSocket bridge on
// 127.0.0.1 and forwards each tool call to the open LayerFrame tab, which runs it against its own state.
// Every tweak an AI makes therefore shows up live in that tab. Exports come back as bytes and are written to ./exports.
// Use: register this file with your MCP client (see README), open the app, click the "MCP" badge to connect.
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { BRIDGE_PORT, BRIDGE_ORIGINS, fromBase64 } from '../src/core/bridge.ts';
import type { BridgeCall, BridgeReply, ExportResult, Method } from '../src/core/bridge.ts';

const PORT = Number(process.env.LAYERFRAME_BRIDGE_PORT || BRIDGE_PORT);
const ORIGINS = process.env.LAYERFRAME_ORIGINS ? process.env.LAYERFRAME_ORIGINS.split(',').map((s) => s.trim()) : BRIDGE_ORIGINS;
const EXPORTS = path.join(import.meta.dirname, '..', 'exports');
const TIMEOUT_MS = 30_000;
// stdout carries the MCP protocol; diagnostics go to stderr.
const log = (...a: unknown[]) => console.error('[layerframe-bridge]', ...a);

// ---------------- bridge: one attached tab at a time (the newest wins) ----------------
let tab: WebSocket | undefined;
let nextId = 1;
const pending = new Map<number, { ok: (v: unknown) => void; bad: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: PORT,
  maxPayload: 64 * 1024 * 1024,
  verifyClient: ({ origin }: { origin: string }) => {
    const allowed = ORIGINS.includes(origin);
    if (!allowed) log(`rejected connection from origin ${origin || '(none)'}`);
    return allowed;
  },
});
wss.on('listening', () => log(`listening on ws://127.0.0.1:${PORT} for ${ORIGINS.join(', ')}`));
wss.on('error', (e) => log(`bridge unavailable: ${e.message}`));
wss.on('connection', (ws, req) => {
  if (tab && tab !== ws) tab.close(4000, 'replaced by a newer tab');
  tab = ws;
  log(`tab attached from ${req.headers.origin}`);
  ws.on('message', (raw) => {
    let msg: BridgeReply;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id); clearTimeout(p.timer);
    if ('error' in msg) p.bad(new Error(msg.error)); else p.ok(msg.result);
  });
  ws.on('close', () => { if (tab === ws) tab = undefined; });
});

function call<T = unknown>(method: Method, args: Record<string, unknown> = {}): Promise<T> {
  const ws = tab;
  if (!ws || ws.readyState !== ws.OPEN) {
    return Promise.reject(new Error(`No LayerFrame tab attached. Open the app (npm start → http://localhost:5317, or https://layerframe.craftedbyk.com) and click the "MCP" badge to connect to ws://127.0.0.1:${PORT}.`));
  }
  const id = nextId++;
  return new Promise<T>((ok, bad) => {
    const timer = setTimeout(() => { pending.delete(id); bad(new Error(`${method}: the tab did not answer within ${TIMEOUT_MS / 1000}s`)); }, TIMEOUT_MS);
    pending.set(id, { ok: ok as (v: unknown) => void, bad, timer });
    ws.send(JSON.stringify({ id, method, args } satisfies BridgeCall));
  });
}

// ---------------- MCP tools (names and arguments unchanged from the HTTP-API version) ----------------
const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });
const server = new McpServer({ name: 'layerframe', version: '2.0.0' });

server.tool('get_schema', 'List every tweakable parameter with type, unit, range and defaults.', {},
  async () => ok(await call('get_schema')));

server.tool('get_state', 'Current frame parameters and view settings.', {},
  async () => ok(await call('get_state')));

server.tool('get_model', 'Derived sizes (outer W×H, thickness, filaments) and per-layer summary.', {},
  async () => ok(await call('get_model')));

server.tool('set_params', 'Change frame parameters (keys from get_schema), e.g. {"in_w":150,"arc":false,"motif":"star"}.',
  { params: z.record(z.string(), z.any()) },
  async ({ params }) => ok(await call('set_params', { params })));

server.tool('set_layer_colors', 'Set filament colours per layer, bottom to top, as hex strings.',
  { colors: z.array(z.string()) },
  async ({ colors }) => ok(await call('set_layer_colors', { colors })));

server.tool('set_view', 'Exploded view on/off and layer gap in the browser.',
  { exploded: z.boolean().optional(), explode_gap: z.number().optional() },
  async (view) => ok(await call('set_view', view)));

server.tool('export',
  'Export the frame to ./exports. 3MF = one object with one part per layer (Bambu Studio). STL = merged, or one layer. ' +
  'SVG / DXF (R12) = 2D cut files for laser / CNC: the whole stack (one SVG group / DXF layer per frame layer), one layer, ' +
  'or split into a zip with one file per layer. kerf (mm) grows each part by kerf/2 so it cuts at true size; ' +
  'the result lists warnings for features too thin to survive that kerf.',
  {
    format: z.enum(['3mf', 'stl', 'svg', 'dxf']).default('3mf'),
    layer: z.number().int().min(0).optional().describe('0-based layer index (STL, SVG, DXF)'),
    split: z.boolean().optional().describe('SVG / DXF only: zip with one file per layer (not with layer)'),
    kerf: z.number().min(0).max(1).optional().describe('SVG / DXF only: laser kerf in mm, 0-1'),
    name: z.string().optional(),
  },
  async (args) => {
    const r = await call<ExportResult>('export', args);
    fs.mkdirSync(EXPORTS, { recursive: true });
    // The filename comes from the tab; keep only its base name so it can't escape ./exports.
    const out = path.join(EXPORTS, path.basename(r.filename));
    fs.writeFileSync(out, fromBase64(r.data));
    return ok({ path: out, bytes: r.bytes, ...(r.warnings && { warnings: r.warnings }) });
  });

server.tool('list_templates', 'List the built-in looks (shape, motif, layout, colours) that can be applied.', {},
  async () => ok(await call('list_templates')));

server.tool('apply_template', 'Apply a template. The opening size is kept; other params are replaced by the template.',
  { name: z.string() },
  async ({ name }) => ok(await call('apply_template', { name })));

server.tool('reset', 'Restore all defaults.', {}, async () => ok(await call('reset')));

await server.connect(new StdioServerTransport());
