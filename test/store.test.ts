import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, STATE_KEY } from '../src/core/store.ts';
import type { KV } from '../src/core/store.ts';
import { TEMPLATES, defaultState } from '../src/core/frame-core.ts';

const memKV = (init: Record<string, string> = {}): KV & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};
const throwingKV: KV = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

describe('store', () => {
  it('starts from defaults and persists every change', () => {
    const kv = memKV();
    const s = createStore(kv);
    assert.deepEqual(s.get(), defaultState());
    s.patch({ params: { in_w: 150 } });
    assert.equal(JSON.parse(kv.data.get(STATE_KEY)!).params.in_w, 150);
    assert.equal(createStore(kv).get().params.in_w, 150, 'a new store reloads the saved state');
  });

  it('keeps working in memory when storage throws or is missing', () => {
    for (const kv of [throwingKV, null]) {
      const s = createStore(kv);
      s.patch({ params: { in_w: 123 } });
      assert.equal(s.get().params.in_w, 123);
    }
  });

  it('ignores corrupt saved state', () => {
    assert.deepEqual(createStore(memKV({ [STATE_KEY]: '{nope' })).get(), defaultState());
  });

  it('migrates a saved legacy multi-frame state', () => {
    const legacy = { shared: { border: 30 }, frames: { a: { in_w: 111 } }, active: 'a' };
    const st = createStore(memKV({ [STATE_KEY]: JSON.stringify(legacy) })).get();
    assert.equal(st.version, 3);
    assert.equal(st.params.in_w, 111);
    assert.equal(st.params.border, 30);
  });

  it('patch: null deletes a key', () => {
    const s = createStore(null);
    s.applyTemplate(Object.keys(TEMPLATES)[0]);
    assert.ok('template' in s.get().params);
    s.patch({ params: { template: null } });
    assert.ok(!('template' in s.get().params));
  });

  it('applyTemplate keeps the opening size and rejects unknown names', () => {
    const s = createStore(null);
    s.patch({ params: { in_w: 140, in_h: 190 } });
    for (const name of Object.keys(TEMPLATES)) {
      s.applyTemplate(name);
      assert.equal(s.get().params.template, name);
      assert.equal(s.get().params.in_w, 140);
      assert.equal(s.get().params.in_h, 190);
    }
    assert.throws(() => s.applyTemplate('no-such-template'), /unknown template/);
  });

  it('setColors replaces the array; setView merges; reset restores defaults', () => {
    const s = createStore(null);
    s.setColors(['#111111', '#222222']);
    assert.deepEqual(s.get().params.colors, ['#111111', '#222222']);
    s.setView({ exploded: false });
    assert.deepEqual(s.get().view, { exploded: false, explode_gap: defaultState().view.explode_gap });
    s.reset();
    assert.deepEqual(s.get(), defaultState());
  });

  it('replace migrates its input', () => {
    const s = createStore(null);
    s.replace({ frames: { x: { in_w: 99 } } });
    assert.equal(s.get().params.in_w, 99);
  });

  it('exportJSON / importJSON round-trip; bad files are rejected without changing state', () => {
    const a = createStore(null);
    a.patch({ params: { in_w: 175, colors: ['#abcdef'] }, view: { explode_gap: 12 } });
    const b = createStore(null);
    b.importJSON(a.exportJSON());
    assert.deepEqual(b.get(), a.get());
    const before = b.get();
    assert.throws(() => b.importJSON('not json'), /invalid JSON/);
    assert.throws(() => b.importJSON('{"hello":1}'), /no params/);
    assert.equal(b.get(), before);
  });

  it('notifies subscribers with the source, and unsubscribe stops it', () => {
    const s = createStore(null);
    const seen: string[] = [];
    const off = s.subscribe((st, src) => seen.push(`${src}:${st.params.in_w}`));
    s.patch({ params: { in_w: 101 } }, 'ui');
    s.reset();
    off();
    s.patch({ params: { in_w: 102 } });
    assert.deepEqual(seen, ['ui:101', `reset:${defaultState().params.in_w}`]);
  });
});
