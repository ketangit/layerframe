// LayerFrame — MCP server (stdio).
// Thin wrapper over the local HTTP API, so every tweak an AI makes shows up live in the open browser UI.
// Start the app first:  npm start      then register this file with your MCP client (see README).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Patch, State, Template } from '../src/core/frame-core.ts';

const BASE = process.env.LAYERFRAME_URL || 'http://localhost:5317';

type StateResponse = { rev: number; state: State };

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-source': 'mcp', ...(opts.headers as Record<string, string> | undefined) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return JSON.parse(t) as T;
}
const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });
const patch = (p: Patch) => api<StateResponse>('/api/state', { method: 'PATCH', body: JSON.stringify({ patch: p }) });

const server = new McpServer({ name: 'layerframe', version: '1.0.0' });

server.tool('get_schema', 'List every tweakable parameter with type, unit, range and defaults.', {},
  async () => ok(await api('/api/schema')));

server.tool('get_state', 'Current frame parameters and view settings.', {},
  async () => ok(await api('/api/state')));

server.tool('get_model', 'Derived sizes (outer W×H, thickness, filaments) and per-layer summary.', {},
  async () => ok(await api('/api/model')));

server.tool('set_params', 'Change frame parameters (keys from get_schema), e.g. {"in_w":150,"arc":false,"motif":"star"}.',
  { params: z.record(z.string(), z.any()) },
  async ({ params }) => ok({ applied: params, rev: (await patch({ params })).rev }));

server.tool('set_layer_colors', 'Set filament colours per layer, bottom to top, as hex strings.',
  { colors: z.array(z.string()) },
  async ({ colors }) => ok((await patch({ params: { colors } })).state.params.colors));

server.tool('set_view', 'Exploded view on/off and layer gap in the browser.',
  { exploded: z.boolean().optional(), explode_gap: z.number().optional() },
  async (view) => ok((await patch({ view })).state.view));

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
  async ({ format, layer, split, kerf, name }) => {
    const q = new URLSearchParams({ format, save: '1' });
    if (layer !== undefined) q.set('layer', String(layer));
    if (split) q.set('split', '1');
    if (kerf !== undefined) q.set('kerf', String(kerf));
    if (name) q.set('name', name);
    return ok(await api('/api/export?' + q));
  });

server.tool('list_templates', 'List the built-in looks (shape, motif, layout, colours) that can be applied.', {},
  async () => ok(Object.fromEntries(Object.entries(await api<Record<string, Template>>('/api/templates')).map(([n, t]) => [n, t.note]))));

server.tool('apply_template', 'Apply a template. The opening size is kept; other params are replaced by the template.',
  { name: z.string() },
  async ({ name }) => ok({ applied: (await api<{ template: string }>('/api/template', { method: 'POST', body: JSON.stringify({ name }) })).template }));

server.tool('reset', 'Restore all defaults.', {}, async () => ok((await api<StateResponse>('/api/reset', { method: 'POST' })).rev));

await server.connect(new StdioServerTransport());
