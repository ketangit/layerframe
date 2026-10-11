import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';
import { TEMPLATES, buildLayers, layerCount, normalize, defaultState, applyPatch, migrate } from '../src/core/frame-core.ts';

describe('buildLayers: every template', () => {
  for (const [name, t] of Object.entries(TEMPLATES)) {
    for (const arc of [true, false]) {
      it(`${name} (arc: ${arc})`, () => {
        const params = { ...t.params, arc };
        const p = normalize(params);
        const m = buildLayers(params, ClipperLib);
        assert.equal(m.layers.length, layerCount(p));
        for (const l of m.layers) assert.ok(l.regions.length > 0, `${l.name} has no regions`);
        assert.ok(m.derived.out_w > p.in_w, `out_w ${m.derived.out_w} <= in_w ${p.in_w}`);
        assert.ok(m.derived.out_h > p.in_h, `out_h ${m.derived.out_h} <= in_h ${p.in_h}`);
      });
    }
  }
});

describe('applyPatch', () => {
  it('null deletes a key', () => {
    const s = applyPatch(defaultState(), { params: { template: null } });
    assert.ok(!('template' in s.params));
  });

  it('replaces arrays instead of merging them', () => {
    const s = applyPatch(defaultState(), { params: { colors: ['#000000'] } });
    assert.deepEqual(s.params.colors, ['#000000']);
  });

  it('deep-merges nested objects', () => {
    const base = defaultState();
    const s = applyPatch(base, { params: { in_w: 150 }, view: { exploded: false } });
    assert.equal(s.params.in_w, 150);
    assert.equal(s.params.in_h, base.params.in_h);
    assert.equal(s.params.border, base.params.border);
    assert.equal(s.view.exploded, false);
    assert.equal(s.view.explode_gap, base.view.explode_gap);
  });
});

describe('migrate', () => {
  it('folds a legacy {shared, frames, active} state and keeps the active frame', () => {
    const s = migrate({
      shared: { border: 30, arc_mode: 'full' },
      frames: { first: { in_w: 100 }, second: { in_w: 222, layout: 'tile' } },
      active: 'second',
      view: { exploded: false },
    });
    assert.equal(s.version, 3);
    assert.equal(s.params.in_w, 222);
    assert.equal(s.params.layout, 'tile');
    assert.equal(s.params.border, 30);
    assert.ok(!('arc_mode' in s.params));
    assert.deepEqual(s.view, { exploded: false, explode_gap: 8 });
  });
});
