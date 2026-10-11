import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';
import { PATTERN_LAYERS, SCHEMA, TEMPLATES, buildLayers } from '../src/core/frame-core.ts';
import type { Layer, Region, Ring } from '../src/core/frame-core.ts';
import { CUT_ACI, CUT_COLORS, cleanRegions, exportWarnings, layerDXF, layerSVG, prepareExport, stackDXF, stackSVG } from '../src/core/vector.ts';

const TOL = 0.01;

// Minimal well-formedness check: balanced tags, quoted attributes, no stray '<' or '&'.
function assertWellFormed(xml: string) {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/y;
  let i = 0;
  while (i < body.length) {
    const lt = body.indexOf('<', i);
    const text = body.slice(i, lt === -1 ? body.length : lt);
    assert.ok(!/&(?!#\d+;|amp;|lt;|gt;|quot;|apos;)/.test(text), `bad entity near: ${text.slice(0, 40)}`);
    if (lt === -1) break;
    tag.lastIndex = lt;
    const m = tag.exec(body);
    assert.ok(m, `malformed tag at ${lt}: ${body.slice(lt, lt + 60)}`);
    const [, close, name, , self] = m;
    if (close) assert.equal(stack.pop(), name, `unbalanced </${name}>`);
    else if (!self) stack.push(name);
    i = tag.lastIndex;
  }
  assert.deepEqual(stack, [], 'unclosed tags');
}

const subpaths = (svg: string) =>
  [...svg.matchAll(/ d="([^"]*)"/g)].flatMap((m) => m[1].split('M').filter(Boolean));

const strokes = (svg: string) => new Set([...svg.matchAll(/ stroke="([^"]*)"/g)].map((m) => m[1]));

const ringCount =(regions: Region[]) => regions.reduce((n, r) => n + 1 + r.holes.length, 0);

function assertCleanRing(ring: Ring, where: string) {
  assert.ok(ring.length >= 3, `${where}: ring has ${ring.length} points`);
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, by - ay);
    assert.ok(len > 0, `${where}: duplicate point at ${i}`);
    assert.ok(len >= TOL, `${where}: segment ${i} is ${len} mm`);
  }
}

const cleaned = (layers: Layer[]) => layers.map((l) => ({ ...l, regions: cleanRegions(l.regions, ClipperLib, TOL) }));

describe('2D export: every template', () => {
  for (const [name, t] of Object.entries(TEMPLATES)) {
    for (const arc of [true, false]) {
      it(`${name} (arc: ${arc})`, () => {
        const m = buildLayers({ ...t.params, arc }, ClipperLib);
        const layers = cleaned(m.layers);
        const { out_w, out_h, bbox } = m.derived;

        for (const l of layers) {
          assert.ok(l.regions.length > 0, `${l.name}: cleaning removed every region`);
          for (const r of l.regions) [r.outer, ...r.holes].forEach((ring) => assertCleanRing(ring, l.name));

          const svg = layerSVG(l, bbox);
          assertWellFormed(svg);
          const [, vw, vh] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? [];
          assert.ok(Math.abs(+vw - out_w) <= 0.01 && Math.abs(+vh - out_h) <= 0.01, `viewBox ${vw}x${vh} vs ${out_w}x${out_h}`);
          assert.match(svg, new RegExp(`width="${vw}mm" height="${vh}mm"`));

          const subs = subpaths(svg);
          assert.equal(subs.length, ringCount(l.regions), `${l.name}: subpath count`);
          for (const s of subs) assert.ok(s.endsWith('Z'), `${l.name}: open subpath`);
        }

        const stack = stackSVG({ ...m, layers });
        assertWellFormed(stack);
        assert.equal(subpaths(stack).length, layers.reduce((n, l) => n + ringCount(l.regions), 0));
        for (const l of layers) {
          const id = l.name.replace(/\s+/g, '-');
          assert.ok(stack.includes(`<g id="${id}" inkscape:groupmode="layer" inkscape:label="${l.name} (${l.color})">`), `${l.name}: layer group`);
        }
        // 'cut' mode: one distinct stroke per layer, whatever the filament colours are.
        assert.equal(strokes(stack).size, layers.length);
      });
    }
  }
});

describe('cleanRegions', () => {
  const square = (x: number, y: number, s: number): Ring => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

  it('removes duplicate, near-duplicate and collinear points', () => {
    const noisy: Ring = [[0, 0], [0, 0], [5, 0], [10, 0], [10, 0.004], [10, 10], [0, 10]];
    const [r] = cleanRegions([{ outer: noisy, holes: [] }], ClipperLib, TOL);
    assert.equal(r.outer.length, 4);
    assertCleanRing(r.outer, 'outer');
  });

  it('drops sliver holes but keeps real ones', () => {
    const regions = cleanRegions([{ outer: square(0, 0, 20), holes: [square(2, 2, 5), square(10, 10, 0.05)] }], ClipperLib, TOL);
    assert.equal(regions.length, 1);
    assert.equal(regions[0].holes.length, 1);
  });

  it('drops a region whose outer ring is a sliver, holes included', () => {
    const regions = cleanRegions([{ outer: square(0, 0, 0.05), holes: [] }, { outer: square(5, 5, 3), holes: [] }], ClipperLib, TOL);
    assert.equal(regions.length, 1);
  });
});

describe('SVG output', () => {
  it('escapes layer colour and name so a hostile value cannot break the markup', () => {
    const m = buildLayers({}, ClipperLib);
    const evil = { ...m.layers[0], color: '"/><script>alert(1)</script>', name: 'L1 <b>&' };
    for (const stroke of ['cut', 'filament'] as const) {
      assertWellFormed(layerSVG(evil, m.derived.bbox, { stroke }));
      const stack = stackSVG({ ...m, layers: [evil] }, { stroke });
      assertWellFormed(stack);
      assert.ok(!stack.includes('<script'));
    }
  });

  it("'cut' strokes stay distinct when layers share a filament colour; 'filament' uses the filament colour", () => {
    const m = buildLayers({ base_layers: 10, colors: Array(12).fill('#f4a7c8') }, ClipperLib);
    assert.equal(m.layers.length, 12);
    assert.equal(strokes(stackSVG(m)).size, 12);
    assert.deepEqual([...strokes(stackSVG(m, { stroke: 'filament' }))], ['#f4a7c8']);
    assert.ok(layerSVG(m.layers[2], m.derived.bbox).includes(`stroke="${CUT_COLORS[2]}"`));
    assert.ok(layerSVG(m.layers[2], m.derived.bbox, { stroke: 'filament' }).includes('stroke="#f4a7c8"'));
  });

  it('has a distinct cut colour for every layer a frame can have', () => {
    const s = SCHEMA.base_layers;
    assert.ok(s.type === 'int');
    assert.ok(CUT_COLORS.length >= s.max + PATTERN_LAYERS);
    assert.equal(new Set(CUT_COLORS).size, CUT_COLORS.length);
  });

  it('flips Y so the frame bottom edge (y = 0) sits at the bottom of the viewBox', () => {
    const b = { minX: -10, maxX: 10, minY: 0, maxY: 20 };
    const layer = { index: 0, name: 'L1 base', kind: 'base', z0: 0, z1: 0.2, color: '#000', area_mm2: 0, regions: [{ outer: [[-10, 0], [10, 0], [10, 20], [-10, 20]], holes: [] }] } as Layer;
    assert.match(layerSVG(layer, b), / d="M0,20L20,20L20,0L0,0Z"/);
  });
});

// ---------- DXF ----------
type Pair = [number, string];
function dxfPairs(dxf: string): Pair[] {
  assert.ok(dxf.endsWith('\r\n'), 'DXF ends with CRLF');
  const lines = dxf.slice(0, -2).split('\r\n');
  assert.equal(lines.length % 2, 0, 'odd number of lines');
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]);
    assert.ok(Number.isInteger(code), `bad group code "${lines[i]}" at line ${i + 1}`);
    pairs.push([code, lines[i + 1]]);
  }
  return pairs;
}

interface ParsedDXF {
  version?: string; sections: string[]; layers: Map<string, number>;
  polylines: { layer: string; flags: number; vertices: [number, number][] }[];
}
// Walks the pair stream the way an R12 reader does; asserts entity framing as it goes.
function parseDXF(dxf: string): ParsedDXF {
  const p = dxfPairs(dxf);
  const out: ParsedDXF = { sections: [], layers: new Map(), polylines: [] };
  const fields = (i: number) => { const f = new Map<number, string>(); for (i++; p[i][0] !== 0; i++) f.set(p[i][0], p[i][1]); return { f, next: i }; };
  let i = 0;
  while (i < p.length) {
    const [code, v] = p[i];
    assert.equal(code, 0, `expected group 0 at pair ${i}, got ${code}`);
    if (v === 'EOF') { assert.equal(i, p.length - 1, 'data after EOF'); return out; }
    const { f, next } = fields(i);
    if (v === 'SECTION') out.sections.push(f.get(2)!);
    else if (v === 'LAYER' && f.has(62)) out.layers.set(f.get(2)!, Number(f.get(62)));
    else if (v === 'POLYLINE') {
      assert.equal(f.get(66), '1', 'POLYLINE without 66=1');
      const pl = { layer: f.get(8)!, flags: Number(f.get(70)), vertices: [] as [number, number][] };
      i = next;
      while (p[i][1] === 'VERTEX') {
        const vx = fields(i);
        assert.equal(vx.f.get(8), pl.layer, 'VERTEX on a different layer');
        pl.vertices.push([Number(vx.f.get(10)), Number(vx.f.get(20))]);
        i = vx.next;
      }
      assert.equal(p[i][1], 'SEQEND', 'POLYLINE not terminated by SEQEND');
      out.polylines.push(pl);
      i = fields(i).next;
      continue;
    }
    i = next;
  }
  assert.fail('no EOF');
}
const acadver = (dxf: string) => dxf.match(/\$ACADVER\r\n {2}1\r\n(\S+)/)?.[1];

describe('DXF export: every template', () => {
  for (const [name, t] of Object.entries(TEMPLATES)) {
    for (const arc of [true, false]) {
      it(`${name} (arc: ${arc})`, () => {
        const m = buildLayers({ ...t.params, arc }, ClipperLib);
        const layers = cleaned(m.layers);
        const { out_w, out_h, bbox } = m.derived;
        const d = parseDXF(stackDXF({ ...m, layers }));

        assert.equal(acadver(stackDXF({ ...m, layers })), 'AC1009');
        assert.deepEqual(d.sections, ['HEADER', 'TABLES', 'ENTITIES']);
        assert.equal(d.polylines.length, layers.reduce((n, l) => n + ringCount(l.regions), 0), 'POLYLINE count');
        for (const pl of d.polylines) {
          assert.equal(pl.flags & 1, 1, 'POLYLINE not closed (70 & 1)');
          assert.ok(pl.vertices.length >= 3, 'POLYLINE with < 3 vertices');
          assert.ok(d.layers.has(pl.layer), `POLYLINE on undeclared layer ${pl.layer}`);
        }
        // One DXF layer per frame layer (plus "0"), each with its own colour.
        assert.equal(d.layers.size, layers.length + 1);
        assert.equal(new Set([...d.layers].filter(([n]) => n !== '0').map(([, c]) => c)).size, layers.length);
        for (const l of layers) assert.ok(d.layers.has(l.name.replace(' ', '_')), `missing layer ${l.name}`);

        const vs = d.polylines.flatMap((pl) => pl.vertices);
        const xs = vs.map(([x]) => x), ys = vs.map(([, y]) => y);
        assert.ok(Math.abs(Math.min(...xs)) <= 0.01 && Math.abs(Math.min(...ys)) <= 0.01, 'bbox min not at origin');
        assert.ok(Math.abs(Math.max(...xs) - out_w) <= 0.01, `vertex width ${Math.max(...xs)} vs ${out_w}`);
        assert.ok(Math.abs(Math.max(...ys) - out_h) <= 0.01, `vertex height ${Math.max(...ys)} vs ${out_h}`);

        // Per-layer files: same origin as the stack, one layer each.
        for (const l of layers) {
          const one = parseDXF(layerDXF(l, bbox));
          assert.equal(one.polylines.length, ringCount(l.regions));
          assert.deepEqual([...one.layers.keys()], ['0', l.name.replace(' ', '_')]);
        }
      });
    }
  }
});

describe('DXF output', () => {
  it('keeps Y up and puts the bbox minimum at (0, 0)', () => {
    const b = { minX: -10, maxX: 10, minY: 5, maxY: 25 };
    const layer = { index: 0, name: 'L1 base', kind: 'base', z0: 0, z1: 0.2, color: '#000', area_mm2: 0, regions: [{ outer: [[-10, 5], [10, 5], [10, 25], [-10, 25]], holes: [] }] } as Layer;
    assert.deepEqual(parseDXF(layerDXF(layer, b)).polylines[0].vertices, [[0, 0], [20, 0], [20, 20], [0, 20]]);
  });

  it('sanitizes layer names to R12 characters', () => {
    const m = buildLayers({}, ClipperLib);
    const odd = { ...m.layers[0], name: 'L1 <base>\r\n  0\r\nEOF' };
    const d = parseDXF(layerDXF(odd, m.derived.bbox));
    assert.deepEqual([...d.layers.keys()], ['0', 'L1_base_0_EOF']);
  });

  it('has a distinct ACI colour for every layer a frame can have', () => {
    const s = SCHEMA.base_layers;
    assert.ok(s.type === 'int');
    assert.ok(CUT_ACI.length >= s.max + PATTERN_LAYERS);
    assert.equal(new Set(CUT_ACI).size, CUT_ACI.length);
  });
});

// ---------- kerf + thin-feature warnings ----------
const ringBounds = (rings: Ring[]) => {
  const xs = rings.flatMap((r) => r.map(([x]) => x)), ys = rings.flatMap((r) => r.map(([, y]) => y));
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const ringArea = (r: Ring) => Math.abs(r.reduce((a, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + x * y2 - x2 * y; }, 0)) / 2;

describe('prepareExport: kerf', () => {
  it('kerf 0.2 grows the outer bbox by 0.2 mm and shrinks the opening by 0.2 mm on each axis', () => {
    for (const arc of [true, false]) {
      const m = buildLayers({ arc }, ClipperLib);
      const k0 = prepareExport(m, ClipperLib), k2 = prepareExport(m, ClipperLib, { kerf: 0.2 });
      assert.ok(Math.abs(k2.derived.out_w - k0.derived.out_w - 0.2) <= 0.01, `arc ${arc}: out_w ${k0.derived.out_w} -> ${k2.derived.out_w}`);
      assert.ok(Math.abs(k2.derived.out_h - k0.derived.out_h - 0.2) <= 0.01, `arc ${arc}: out_h ${k0.derived.out_h} -> ${k2.derived.out_h}`);
      const opening = (e: typeof k0) => e.layers[0].regions[0].holes.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
      const o0 = ringBounds([opening(k0)]), o2 = ringBounds([opening(k2)]);
      assert.ok(Math.abs(o0.w - o2.w - 0.2) <= 0.01, `arc ${arc}: opening w ${o0.w} -> ${o2.w}`);
      assert.ok(Math.abs(o0.h - o2.h - 0.2) <= 0.01, `arc ${arc}: opening h ${o0.h} -> ${o2.h}`);
    }
  });

  it('kerf 0 is byte-identical to writing the cleaned layers directly', () => {
    for (const [name, t] of Object.entries(TEMPLATES)) {
      const m = buildLayers({ ...t.params }, ClipperLib);
      const direct = { ...m, layers: cleaned(m.layers) }, prepared = prepareExport(m, ClipperLib, { kerf: 0 });
      assert.equal(stackSVG(prepared), stackSVG(direct), `${name}: SVG`);
      assert.equal(stackDXF(prepared), stackDXF(direct), `${name}: DXF`);
    }
  });

  it('rejects kerf outside 0..1 mm', () => {
    const m = buildLayers({}, ClipperLib);
    for (const kerf of [-0.1, 1.01, NaN]) assert.throws(() => prepareExport(m, ClipperLib, { kerf }), RangeError);
  });

  for (const [name, t] of Object.entries(TEMPLATES)) {
    for (const arc of [true, false]) {
      it(`kerf 0.2 output stays valid: ${name} (arc: ${arc})`, () => {
        const e = prepareExport(buildLayers({ ...t.params, arc }, ClipperLib), ClipperLib, { kerf: 0.2 });
        for (const l of e.layers) {
          assert.ok(l.regions.length > 0, `${l.name}: empty after kerf`);
          for (const r of l.regions) [r.outer, ...r.holes].forEach((ring) => assertCleanRing(ring, l.name));
        }
        const svg = stackSVG(e);
        assertWellFormed(svg);
        const [, vw, vh] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? [];
        assert.ok(Math.abs(+vw - e.derived.out_w) <= 0.01 && Math.abs(+vh - e.derived.out_h) <= 0.01, `viewBox ${vw}x${vh}`);
        const d = parseDXF(stackDXF(e));
        const vs = d.polylines.flatMap((pl) => pl.vertices);
        assert.ok(Math.min(...vs.map(([x]) => x)) >= -0.01 && Math.min(...vs.map(([, y]) => y)) >= -0.01, 'DXF vertex below origin');
        assert.ok(Math.abs(Math.max(...vs.map(([x]) => x)) - e.derived.out_w) <= 0.01, 'DXF width');
        assert.ok(Math.abs(Math.max(...vs.map(([, y]) => y)) - e.derived.out_h) <= 0.01, 'DXF height');
      });
    }
  }
});

describe('exportWarnings', () => {
  it('warns for lace_w 0.3 with kerf 0.2', () => {
    const w = exportWarnings(buildLayers({ lace_w: 0.3 }, ClipperLib), 0.2);
    assert.deepEqual(w.map((x) => [x.layer, x.feature]), [['L6 lace', 'lace outline']]);
    assert.match(w[0].message, /0\.3 mm.*0\.4 mm/);
  });

  it('is silent for the defaults with kerf 0.1, and for any design with kerf 0', () => {
    assert.deepEqual(exportWarnings(buildLayers({}, ClipperLib), 0.1), []);
    for (const t of Object.values(TEMPLATES)) assert.deepEqual(exportWarnings(buildLayers({ ...t.params, lace_w: 0.3 }, ClipperLib), 0), []);
  });

  it('flags rims on both pattern layers, skips features that are off, and ignores layout none', () => {
    const w = exportWarnings(buildLayers({ rim_w: 0, inner_rim_w: 1 }, ClipperLib), 0.5);
    assert.deepEqual(w.map((x) => `${x.layer}/${x.feature}`), ['L5 motif/inner rim', 'L6 lace/inner rim', 'L6 lace/lace outline']);
    assert.deepEqual(exportWarnings(buildLayers({ ...TEMPLATES['Plain Terraces'].params }, ClipperLib), 1), []);
  });
});
