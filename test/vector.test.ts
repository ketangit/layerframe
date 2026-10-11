import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';
import { TEMPLATES, buildLayers } from '../src/core/frame-core.ts';
import type { Layer, Region, Ring } from '../src/core/frame-core.ts';
import { cleanRegions, layerSVG, stackSVG } from '../src/core/vector.ts';

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

const ringCount = (regions: Region[]) => regions.reduce((n, r) => n + 1 + r.holes.length, 0);

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
          assert.match(stack, new RegExp(`<g id="${id}" inkscape:groupmode="layer" inkscape:label="${l.name}">`));
        }
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
    assertWellFormed(layerSVG(evil, m.derived.bbox));
    const stack = stackSVG({ ...m, layers: [evil] });
    assertWellFormed(stack);
    assert.ok(!stack.includes('<script'));
  });

  it('flips Y so the frame bottom edge (y = 0) sits at the bottom of the viewBox', () => {
    const b = { minX: -10, maxX: 10, minY: 0, maxY: 20 };
    const layer = { index: 0, name: 'L1 base', kind: 'base', z0: 0, z1: 0.2, color: '#000', area_mm2: 0, regions: [{ outer: [[-10, 0], [10, 0], [10, 20], [-10, 20]], holes: [] }] } as Layer;
    assert.match(layerSVG(layer, b), / d="M0,20L20,20L20,0L0,0Z"/);
  });
});
