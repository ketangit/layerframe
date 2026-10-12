import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import ClipperLib from 'clipper-lib';
import JSZip from 'jszip';
import { WebSocket } from 'ws';
import { createStore } from '../src/core/store.ts';
import { handleCall, toBase64, fromBase64, METHODS, BRIDGE_ORIGINS } from '../src/core/bridge.ts';
import { TEMPLATES, defaultState, layerCount, normalize } from '../src/core/frame-core.ts';

const run = (store: ReturnType<typeof createStore>, method: string, args: Record<string, unknown> = {}) =>
  handleCall(store, method, args, ClipperLib, JSZip) as Promise<any>;

describe('bridge handleCall (runs in the tab)', () => {
  it('base64 round-trips binary data, including large buffers', () => {
    const data = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) & 255);
    assert.deepEqual(fromBase64(toBase64(data)), data);
  });

  it('get_schema / get_state / get_model / list_templates', async () => {
    const s = createStore(null);
    assert.ok('in_w' in (await run(s, 'get_schema')).schema);
    assert.deepEqual(await run(s, 'get_state'), defaultState());
    const m = await run(s, 'get_model');
    assert.equal(m.layers.length, layerCount(normalize(s.get().params)));
    assert.equal(typeof m.layers[0].regions, 'number');
    assert.deepEqual(Object.keys(await run(s, 'list_templates')), Object.keys(TEMPLATES));
  });

  it('set_params / set_layer_colors / set_view / apply_template / reset change the store', async () => {
    const s = createStore(null);
    const seen: string[] = [];
    s.subscribe((_, src) => seen.push(src));
    await run(s, 'set_params', { params: { in_w: 160 } });
    assert.equal(s.get().params.in_w, 160);
    assert.deepEqual(await run(s, 'set_layer_colors', { colors: ['#010101'] }), ['#010101']);
    assert.equal((await run(s, 'set_view', { exploded: false })).exploded, false);
    const name = Object.keys(TEMPLATES)[1];
    assert.deepEqual(await run(s, 'apply_template', { name }), { applied: name });
    assert.equal(s.get().params.in_w, 160);
    await run(s, 'reset');
    assert.deepEqual(s.get(), defaultState());
    assert.ok(seen.every((src) => src === 'mcp'));
  });

  it('rejects unknown templates and methods', async () => {
    const s = createStore(null);
    await assert.rejects(run(s, 'apply_template', { name: 'nope' }), /unknown template/);
    await assert.rejects(run(s, 'drop_tables'), /unknown method/);
    await assert.rejects(run(s, 'export', { format: 'pdf' }), RangeError);
  });

  it('export: 3MF, STL (whole + layer), SVG, DXF and split zip', async () => {
    const s = createStore(null);
    const n = layerCount(normalize(s.get().params));
    const r3 = await run(s, 'export', { format: '3mf' });
    assert.match(r3.filename, /\.3mf$/);
    assert.deepEqual([...fromBase64(r3.data).subarray(0, 2)], [0x50, 0x4b], '3MF is a zip');
    const stl = await run(s, 'export', { format: 'stl' });
    const one = await run(s, 'export', { format: 'stl', layer: 0 });
    assert.ok(one.bytes < stl.bytes);
    assert.match(one.filename, /_L1\.stl$/);
    const svg = new TextDecoder().decode(fromBase64((await run(s, 'export', { format: 'svg', kerf: 0.1 })).data));
    assert.match(svg, /<svg[\s>]/);
    const dxf = new TextDecoder().decode(fromBase64((await run(s, 'export', { format: 'dxf', name: 'my frame' })).data));
    assert.match(dxf, /EOF\s*$/);
    const zip = await JSZip.loadAsync(fromBase64((await run(s, 'export', { format: 'svg', split: true })).data));
    assert.equal(Object.keys(zip.files).length, n);
  });

  it('covers every method the MCP server forwards', () => {
    assert.equal(new Set(METHODS).size, 10);
  });
});

describe('mcp/server.ts bridge (Origin allowlist)', () => {
  const PORT = 15318 + Math.floor(Math.random() * 1000);
  let child: ChildProcess;
  before(async () => {
    child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'mcp', 'server.ts')], {
      env: { ...process.env, LAYERFRAME_BRIDGE_PORT: String(PORT) },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    await new Promise<void>((ok, bad) => {
      const t = setTimeout(() => bad(new Error('bridge did not start')), 15000);
      child.stderr!.on('data', (d: Buffer) => { if (String(d).includes('listening')) { clearTimeout(t); ok(); } });
    });
  });
  after(() => { child.kill(); });

  const attempt = (origin?: string) => new Promise<string>((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, origin ? { origin } : {});
    ws.on('open', () => { ws.close(); ok('open'); });
    ws.on('unexpected-response', (_req, res) => ok(`http ${res.statusCode}`));
    ws.on('error', (e) => ok(`error ${e.message}`));
  });

  it('accepts the allowlisted origins', async () => {
    for (const o of BRIDGE_ORIGINS) assert.equal(await attempt(o), 'open', o);
  });

  it('rejects other origins and missing Origin', async () => {
    assert.equal(await attempt('https://evil.example'), 'http 401');
    assert.equal(await attempt('http://localhost:9999'), 'http 401');
    assert.equal(await attempt(), 'http 401');
  });
});
