// LayerFrame — client state store. The open tab owns the state; this persists it and notifies listeners.
// Pure: storage is injected (localStorage in the browser, a Map or null in tests). No DOM.
import { defaultState, migrate, applyPatch, applyTemplate } from './frame-core.ts';
import type { Patch, State, View } from './frame-core.ts';

export interface KV { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type Listener = (state: State, source: string) => void;
export const STATE_KEY = 'layerframe.state';

export interface Store {
  get(): State;
  patch(patch: Patch, source?: string): State;
  replace(state: unknown, source?: string): State;
  reset(source?: string): State;
  applyTemplate(name: string, source?: string): State;
  setColors(colors: string[], source?: string): State;
  setView(view: Partial<View>, source?: string): State;
  exportJSON(): string;
  importJSON(text: string, source?: string): State;
  subscribe(fn: Listener): () => void;
}

// Every storage access is guarded: blocked or full storage leaves the store working in memory.
export function createStore(storage: KV | null, key = STATE_KEY): Store {
  let state = defaultState();
  try {
    const saved = storage?.getItem(key);
    if (saved) state = migrate(JSON.parse(saved));
  } catch {}
  const listeners = new Set<Listener>();
  const set = (next: State, source: string) => {
    state = next;
    try { storage?.setItem(key, JSON.stringify(state)); } catch {}
    for (const fn of listeners) fn(state, source);
    return state;
  };
  return {
    get: () => state,
    patch: (p, source = 'api') => set(applyPatch(state, p), source),
    replace: (s, source = 'api') => set(migrate(s), source),
    reset: (source = 'reset') => set(defaultState(), source),
    applyTemplate: (name, source = 'template') => set(applyTemplate(state, name), source),
    setColors: (colors, source = 'api') => set(applyPatch(state, { params: { colors } }), source),
    setView: (view, source = 'api') => set(applyPatch(state, { view }), source),
    exportJSON: () => JSON.stringify(state, null, 2),
    importJSON: (text, source = 'import') => {
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new Error('not a LayerFrame design (invalid JSON)'); }
      if (!data || typeof data !== 'object' || !('params' in data || 'frames' in data)) throw new Error('not a LayerFrame design (no params)');
      return set(migrate(data), source);
    },
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
