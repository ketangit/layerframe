// LayerFrame — MCP bridge protocol. The MCP server (mcp/server.ts) sends calls over a localhost WebSocket;
// the open tab runs them against its store with this handler and sends the result back.
// Shared by browser and Node (tests): no DOM, ClipperLib / JSZip passed in.
import { SCHEMA, DEFAULTS, SIZE_PRESETS, TEMPLATES, buildLayers } from './frame-core.ts';
import type { Clipper, Patch, View } from './frame-core.ts';
import { export3MFFor, exportSTLFor } from './mesh.ts';
import type { JSZipCtor } from './mesh.ts';
import { export2DFor } from './vector.ts';
import type { ExportWarning } from './vector.ts';
import type { Store } from './store.ts';

export const BRIDGE_PORT = 5318;
// Pages allowed to attach to the bridge (checked against the WebSocket Origin header).
export const BRIDGE_ORIGINS = ['http://localhost:5317', 'http://127.0.0.1:5317', 'https://layerframe.craftedbyk.com'];

export interface BridgeCall { id: number; method: string; args?: Record<string, any> }
export type BridgeReply = { id: number; result: unknown } | { id: number; error: string };
export interface ExportResult { filename: string; bytes: number; data: string; warnings?: ExportWarning[] }

export const METHODS = ['get_schema', 'get_state', 'get_model', 'set_params', 'set_layer_colors', 'set_view',
  'export', 'list_templates', 'apply_template', 'reset'] as const;
export type Method = typeof METHODS[number];

const SOURCE = 'mcp';
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');

export function toBase64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Runs one tool call. Bad arguments throw (RangeError / Error); the caller turns that into { error }.
export async function handleCall(store: Store, method: string, args: Record<string, any>, ClipperLib: Clipper, JSZip: JSZipCtor): Promise<unknown> {
  switch (method as Method) {
    case 'get_schema': return { schema: SCHEMA, defaults: DEFAULTS, sizes: SIZE_PRESETS };
    case 'get_state': return store.get();
    case 'get_model': {
      const m = buildLayers(store.get().params, ClipperLib);
      return { params: m.params, derived: m.derived, layers: m.layers.map(({ regions, ...L }) => ({ ...L, regions: regions.length })) };
    }
    case 'set_params': return { applied: args.params, params: store.patch({ params: args.params as Patch }, SOURCE).params };
    case 'set_layer_colors': return store.setColors(args.colors, SOURCE).params.colors;
    case 'set_view': return store.setView(args as Partial<View>, SOURCE).view;
    case 'list_templates': return Object.fromEntries(Object.entries(TEMPLATES).map(([n, t]) => [n, t.note]));
    case 'apply_template':
      if (!TEMPLATES[args.name]) throw new Error(`unknown template ${args.name}; available: ${Object.keys(TEMPLATES).join(', ')}`);
      store.applyTemplate(args.name, SOURCE);
      return { applied: args.name };
    case 'reset': store.reset(SOURCE); return { reset: true };
    case 'export': return exportFor(store, args, ClipperLib, JSZip);
  }
  throw new Error(`unknown method ${method}`);
}

async function exportFor(store: Store, a: Record<string, any>, ClipperLib: Clipper, JSZip: JSZipCtor): Promise<ExportResult> {
  const state = store.get();
  const fmt = String(a.format ?? '3mf').toLowerCase();
  const layer: number | null = a.layer ?? null;
  const base = safe(a.name || state.params.template || 'frame');
  let data: Uint8Array, filename: string, warnings: ExportWarning[] | undefined;
  if (fmt === '3mf') { data = await export3MFFor(state, ClipperLib, JSZip); filename = `${base}.3mf`; }
  else if (fmt === 'stl') { data = new Uint8Array(exportSTLFor(state, ClipperLib, layer)); filename = `${base}${layer === null ? '' : `_L${layer + 1}`}.stl`; }
  else if (fmt === 'svg' || fmt === 'dxf') {
    ({ data, filename, warnings } = await export2DFor(state.params, ClipperLib, JSZip, { format: fmt, base, kerf: a.kerf ?? 0, layer, split: !!a.split }));
  }
  else throw new RangeError('format must be 3mf, stl, svg or dxf');
  return { filename, bytes: data.length, data: toBase64(data), ...(warnings && { warnings }) };
}
