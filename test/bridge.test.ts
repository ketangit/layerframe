import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import ClipperLib from 'clipper-lib';
import JSZip from 'jszip';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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

describe('mcp/server.ts bridge (port held by another copy)', () => {
  const PORT = 16318 + Math.floor(Math.random() * 1000);
  const server = path.join(import.meta.dirname, '..', 'mcp', 'server.ts');
  const env = { ...process.env, LAYERFRAME_BRIDGE_PORT: String(PORT) } as Record<string, string>;
  let first: ChildProcess;
  let client: Client;
  const second: { log: string } = { log: '' };
  const until = async (cond: () => boolean, ms = 15000) => {
    for (const t0 = Date.now(); !cond(); await new Promise((r) => setTimeout(r, 100))) {
      if (Date.now() - t0 > ms) throw new Error('timed out');
    }
  };

  before(async () => {
    let firstLog = '';
    first = spawn(process.execPath, [server], { env, stdio: ['pipe', 'ignore', 'pipe'] });
    first.stderr!.on('data', (d: Buffer) => (firstLog += d));
    await until(() => firstLog.includes('listening'));
    const transport = new StdioClientTransport({ command: process.execPath, args: [server], env, stderr: 'pipe' });
    transport.stderr!.on('data', (d: Buffer) => (second.log += d));
    client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
  });
  after(async () => { first.kill(); await client.close(); });

  it('reports the busy port in tool errors, then takes the port over when the other copy exits', async () => {
    await until(() => second.log.includes('is in use'));
    const r = await client.callTool({ name: 'get_state', arguments: {} }) as { isError?: boolean; content: { text: string }[] };
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /held by another LayerFrame MCP server/);

    first.kill();
    await until(() => second.log.includes('listening'));
    const store = createStore(null);
    const tab = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: BRIDGE_ORIGINS[0] });
    tab.on('message', async (raw: Buffer) => {
      const m = JSON.parse(String(raw));
      tab.send(JSON.stringify({ id: m.id, result: await handleCall(store, m.method, m.args ?? {}, ClipperLib, JSZip) }));
    });
    await new Promise((ok) => tab.on('open', ok));
    const ok = await client.callTool({ name: 'set_params', arguments: { params: { in_w: 140 } } }) as { isError?: boolean };
    assert.ok(!ok.isError);
    assert.equal(store.get().params.in_w, 140);
    tab.close();
  });
});
