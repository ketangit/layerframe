// LayerFrame — browser UI (single frame).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import ClipperLib from 'clipper-lib';
import JSZip from 'jszip';
import { TEMPLATES, SIZE_PRESETS, SCHEMA, defaultState, migrate, applyPatch, applyTemplate, layerCount, schemaEntries } from '../core/frame-core.ts';
import type { FieldSpec, Patch, State } from '../core/frame-core.ts';
import { frameSVG } from './thumb.ts';
import { buildFrame, effectiveParams, build3MF, geometryToSTL } from '../core/mesh.ts';
import type { Frame } from '../core/mesh.ts';
import { KERF_MAX, export2DFor, exportWarnings } from '../core/vector.ts';
import type { Format2D } from '../core/vector.ts';
import './styles.css';

declare global {
  interface Window {
    LayerFrame: { readonly state: State; change: typeof change; setCam: typeof setCam; rebuild: typeof rebuild };
  }
}

type Cam = 'iso' | 'top' | 'side';

const CLIENT = 'ui:' + Math.random().toString(36).slice(2, 8);

let state = defaultState();
let online = false;
let customOpen = false;               // Custom size chosen even if W×H matches a preset
const hidden = new Set<number>();     // hidden layer indices (view only)
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends HTMLElement = HTMLElement>(root: ParentNode, s: string) => root.querySelectorAll<T>(s);

// ---------------- three.js scene ----------------
const host = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
scene.background = new THREE.Color(css('--stage') || '#efebe5');
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8178, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-300, -500, 900); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(400, 300, 300); scene.add(fill);
const root = new THREE.Group(); scene.add(root);
const grid = new THREE.GridHelper(2000, 200, dark ? 0x2c2a30 : 0xd9d2c7, dark ? 0x1c1b20 : 0xe6e0d7);
grid.rotation.x = Math.PI / 2; grid.position.z = -0.05; scene.add(grid);

// render on demand: only when the camera moved or the model changed
let dirty = true;
function resize() {
  const r = host.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  dirty = true;
}
new ResizeObserver(resize).observe(host);
const redraw = () => { dirty = true; };
controls.addEventListener('change', redraw);
(function loop() {
  if (controls.update() || dirty) { renderer.render(scene, camera); dirty = false; }
  requestAnimationFrame(loop);
})();

// ---------------- build (cached by params) ----------------
const cache = new Map<string, Frame>();
function build(st = state): Frame {
  const p = effectiveParams(st);
  const key = JSON.stringify(p);
  let fb = cache.get(key);
  if (!fb) {
    if (cache.size > 24) cache.clear();
    fb = buildFrame(p, ClipperLib);
    cache.set(key, fb);
  }
  return fb;
}

const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 });
let firstFit = true, lastSize = '';
function rebuild() {
  const t0 = performance.now();
  // layer geometries are cached with the build; only the edge geometries are per-rebuild
  for (const c of root.children) {
    if (c instanceof THREE.Mesh) (c.material as THREE.Material).dispose();
    else if (c instanceof THREE.LineSegments) { c.material.dispose(); c.geometry.dispose(); }
  }
  root.clear();
  const fb = build();
  const b = fb.model.derived.bbox;
  const ox = -(b.minX + b.maxX) / 2, oy = -b.minY;
  const gap = state.view.exploded ? state.view.explode_gap : 0;
  fb.layers.forEach((L, i) => {
    if (hidden.has(i)) return;
    const m = new THREE.Mesh(L.geometry, new THREE.MeshStandardMaterial({ color: L.color, roughness: 0.62, metalness: 0.02 }));
    m.position.set(ox, oy, L.z0 + i * gap);
    root.add(m);
    // outline edges only on the plain terrace layers — patterned layers are too dense to be worth it
    if (L.regions.length <= 2) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(L.geometry, 30), edgeMat);
      e.position.copy(m.position);
      root.add(e);
    }
  });
  const size = `${b.maxX - b.minX}x${b.maxY - b.minY}`;
  if (firstFit || size !== lastSize) { setCam(currentCam); firstFit = false; lastSize = size; }
  dirty = true;
  renderPanel(fb);
  updateKerfWarn();
  scheduleThumbs();
  $('#status').textContent = `rebuilt in ${Math.round(performance.now() - t0)} ms`;
}

let currentCam: Cam = 'iso';
function setCam(kind: Cam) {
  currentCam = kind;
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const d = Math.max(s.x, s.y) * 1.55 + 60;
  controls.target.copy(c);
  if (kind === 'top') camera.position.set(c.x, c.y - 0.01, c.z + d * 1.15);
  else if (kind === 'side') camera.position.set(c.x, c.y - d * 1.2, c.z + 8);
  else camera.position.set(c.x + d * 0.35, c.y - d * 0.75, c.z + d * 0.6);
  controls.update();
  dirty = true;
  $$(document, '[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === kind));
}

// ---------------- state changes ----------------
let rebuildT: ReturnType<typeof setTimeout> | undefined, pushT: ReturnType<typeof setTimeout> | undefined;
let pending: Patch = {};
function change(patch: Patch, { push = true } = {}) {
  state = applyPatch(state, patch);
  clearTimeout(rebuildT); rebuildT = setTimeout(rebuild, 40);
  if (push && online) {
    deepAssign(pending, patch);
    clearTimeout(pushT);
    pushT = setTimeout(async () => {
      const body = pending; pending = {};
      try {
        await fetch('./api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-source': CLIENT }, body: JSON.stringify({ patch: body }) });
      } catch { setOnline(false); }
    }, 250);
  }
}
function deepAssign(t: Record<string, any>, s: Record<string, unknown>) {
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { t[k] = t[k] && typeof t[k] === 'object' ? t[k] : {}; deepAssign(t[k], v as Record<string, unknown>); }
    else t[k] = v;
  }
}
const setParam = (key: string, value: unknown) => change({ params: { [key]: value } });

// ---------------- panel ----------------
function renderPanel(fb: Frame) {
  const p = fb.model.params, dv = fb.model.derived;

  // size presets
  const sizes = $('#sizes');
  if (!sizes.dataset.ready) {
    sizes.dataset.ready = '1';
    const dim = (k: 'in_w' | 'in_h', label: string) => {
      const s = SCHEMA[k] as { min: number; max: number; step: number };
      return `<label>${label}<input type="number" data-custom="${k}" min="${s.min}" max="${s.max}" step="${s.step}"></label>`;
    };
    sizes.innerHTML = Object.keys(SIZE_PRESETS).map((n) => `<button data-size="${n}">${n}</button>`).join('')
      + '<button data-size-custom>Custom</button>'
      + `<div class="custom-size" hidden>${dim('in_w', 'W')}<span>×</span>${dim('in_h', 'H')}<span>mm</span></div>`;
    $$(sizes, '[data-size]').forEach((b) => (b.onclick = () => { customOpen = false; change({ params: SIZE_PRESETS[b.dataset.size!] }); }));
    sizes.querySelector<HTMLElement>('[data-size-custom]')!.onclick = () => { customOpen = true; renderPanel(fb); };
    $$<HTMLInputElement>(sizes, '[data-custom]').forEach((el) => (el.onchange = () => {
      const v = parseFloat(el.value);
      if (Number.isFinite(v)) setParam(el.dataset.custom!, v);
    }));
  }
  let preset = false;
  $$(sizes, '[data-size]').forEach((b) => {
    const s = SIZE_PRESETS[b.dataset.size!];
    const on = !customOpen && s.in_w === p.in_w && s.in_h === p.in_h;
    b.classList.toggle('on', on);
    preset ||= on;
  });
  sizes.querySelector('[data-size-custom]')!.classList.toggle('on', !preset);
  sizes.querySelector<HTMLElement>('.custom-size')!.hidden = preset;
  $$<HTMLInputElement>(sizes, '[data-custom]').forEach((el) => {
    if (document.activeElement !== el) el.value = String(p[el.dataset.custom as 'in_w' | 'in_h']);
  });

  $('#stats').innerHTML = [
    [`${+dv.out_w.toFixed(1)} × ${+dv.out_h.toFixed(1)}`, 'outer W × H (mm)'],
    [`${p.in_w} × ${p.in_h}`, 'opening (mm)'],
    [`${(layerCount(p) * p.layer_h).toFixed(2)} mm`, `${layerCount(p)} layers × ${p.layer_h} mm`],
    [`${dv.filaments}`, 'filaments'],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');

  const groups = $('#groups');
  if (!groups.dataset.ready) buildGroups(groups);
  for (const [k, s] of schemaEntries()) {
    const el = groups.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-k="${k}"]`);
    if (!el) continue;
    const v = p[k];
    if (s.type === 'bool') (el as HTMLInputElement).checked = !!v;
    else if (s.type === 'list') { if (document.activeElement !== el) el.value = (v as string[]).join(', '); }
    else if (document.activeElement !== el) el.value = String(v);
    const rng = groups.querySelector<HTMLInputElement>(`[data-r="${k}"]`);
    if (rng && document.activeElement !== rng) rng.value = String(v);
  }

  const stack = $('#stack');
  stack.innerHTML = '';
  fb.layers.forEach((L, i) => {
    const li = document.createElement('li');
    li.className = hidden.has(i) ? 'off' : '';
    li.innerHTML = `<input type="color" value="${L.color}" aria-label="Layer ${i + 1} colour">
      <span class="nm">${L.name}</span><span class="z">${L.z0.toFixed(2)}–${L.z1.toFixed(2)}</span>
      <button class="eye" title="Show / hide">${hidden.has(i) ? '◌' : '●'}</button>`;
    const color = li.querySelector('input')!;
    color.oninput = () => { const colors = p.colors.slice(); colors[i] = color.value; setParam('colors', colors); };
    li.querySelector<HTMLButtonElement>('.eye')!.onclick = () => { if (hidden.has(i)) hidden.delete(i); else hidden.add(i); rebuild(); };
    stack.appendChild(li);
  });

  const uniq = [...new Set(p.colors.map((c) => c.toLowerCase()))];
  $('#legend').innerHTML = `<strong>${uniq.length} filaments</strong>` + uniq.map((c, i) => {
    const ls = p.colors.map((x, j) => (x.toLowerCase() === c ? `L${j + 1}` : null)).filter(Boolean).join(', ');
    return `<div><i style="background:${c}"></i>F${i + 1} · ${ls}</div>`;
  }).join('');

  $<HTMLInputElement>('#exploded').checked = state.view.exploded;
  $<HTMLInputElement>('#gap').value = String(state.view.explode_gap);
  $('#gapWrap').style.opacity = state.view.exploded ? '1' : '0.4';
  renderTemplateSelection();
}

function buildGroups(container: HTMLElement) {
  container.dataset.ready = '1';
  const byGroup: Record<string, [string, FieldSpec][]> = {};
  for (const [k, s] of schemaEntries()) if (s.type !== 'colors' && s.group !== 'hidden') (byGroup[s.group] ||= []).push([k, s]);
  for (const [g, items] of Object.entries(byGroup)) {
    const sec = document.createElement('section');
    sec.className = 'group';
    sec.innerHTML = `<h2>${g}</h2>`;
    for (const [k, s] of items) {
      const f = document.createElement('div');
      const id = 'p_' + k;
      if (s.type === 'bool') {
        f.className = 'field check';
        f.innerHTML = `<label for="${id}">${s.label}</label><input id="${id}" type="checkbox" data-k="${k}">`;
        const input = f.querySelector('input')!;
        input.onchange = () => setParam(k, input.checked);
      } else if (s.type === 'list') {
        f.className = 'field wide';
        f.innerHTML = `<label for="${id}">${s.label}</label><input id="${id}" type="text" data-k="${k}" title="${s.options.join(', ')}">`;
        const input = f.querySelector('input')!;
        input.onchange = () => setParam(k, input.value.split(/[\s,]+/).filter(Boolean));
      } else if (s.type === 'enum') {
        f.className = 'field';
        f.innerHTML = `<label for="${id}">${s.label}</label><select id="${id}" data-k="${k}">${s.options.map((o) => `<option>${o}</option>`).join('')}</select>`;
        const select = f.querySelector('select')!;
        select.onchange = () => setParam(k, select.value);
      } else if (s.type === 'number' || s.type === 'int') {
        f.className = 'field';
        const unit = s.unit ? ` <span style="color:var(--muted)">${s.unit}</span>` : '';
        f.innerHTML = `<label for="${id}">${s.label}${unit}</label>
          <input id="${id}" type="number" data-k="${k}" min="${s.min}" max="${s.max}" step="${s.step}">
          <input type="range" data-r="${k}" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${s.label}">`;
        const num = f.querySelector<HTMLInputElement>('input[type=number]')!, rng = f.querySelector<HTMLInputElement>('input[type=range]')!;
        num.onchange = () => setParam(k, Number(num.value));
        rng.oninput = () => { num.value = rng.value; setParam(k, Number(rng.value)); };
      }
      sec.appendChild(f);
    }
    container.appendChild(sec);
  }
}

// ---------------- templates gallery ----------------
const thumbCache = new Map<string, string>();
function renderTemplateSelection() {
  const tpl = $('#templates');
  if (!tpl.dataset.ready) {
    tpl.dataset.ready = '1';
    tpl.innerHTML = Object.entries(TEMPLATES).map(([name, t]) => `
      <button class="tpl" data-t="${name}" title="${t.note}">
        <span class="thumb" data-thumb="${name}"></span>
        <span class="tname">${name}</span>
      </button>`).join('');
    $$(tpl, '[data-t]').forEach((b) => (b.onclick = () => loadTemplate(b.dataset.t!)));
  }
  const cur = state.params.template;
  $$(tpl, '[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === cur));
  $('#tplNote').textContent = TEMPLATES[cur] ? TEMPLATES[cur].note : 'Custom settings';
}
// Thumbnails follow the opening size; drawn idle-time, one per tick, after edits settle.
let thumbT: ReturnType<typeof setTimeout> | undefined;
function scheduleThumbs() {
  clearTimeout(thumbT);
  thumbT = setTimeout(() => {
    const key = `${state.params.in_w}x${state.params.in_h}`;
    const names = Object.keys(TEMPLATES);
    let i = 0;
    const next = () => {
      if (i >= names.length) return;
      const name = names[i++], ck = name + '@' + key;
      const el = document.querySelector<HTMLElement>(`[data-thumb="${CSS.escape(name)}"]`);
      if (el && el.dataset.key !== ck) {
        let svg = thumbCache.get(ck);
        if (!svg) {
          svg = frameSVG(buildFrame(effectiveParams(applyTemplate(state, name)), ClipperLib).model, { size: 120 });
          thumbCache.set(ck, svg);
        }
        el.innerHTML = svg; el.dataset.key = ck;
      }
      setTimeout(next, 0);
    };
    next();
  }, 400);
}

async function loadTemplate(name: string) {
  if (online) {
    await fetch('./api/template', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-source': 'ui-template' }, body: JSON.stringify({ name }) });
  } else {
    state = applyTemplate(state, name);
    rebuild();
  }
}

// ---------------- toolbar + exports ----------------
$$(document, '[data-cam]').forEach((b) => (b.onclick = () => setCam(b.dataset.cam as Cam)));
const exploded = $<HTMLInputElement>('#exploded'), gapInput = $<HTMLInputElement>('#gap');
exploded.onchange = () => change({ view: { exploded: exploded.checked } });
gapInput.oninput = () => change({ view: { explode_gap: Number(gapInput.value) } });

function download(data: Blob | ArrayBuffer | Uint8Array, name: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const baseName = () => (state.params.template || 'frame').replace(/[^\w.-]+/g, '_');
$('#exp3mf').onclick = async () => download(await build3MF([{ name: 'Frame', x: 0, y: 0, layers: build().layers }], JSZip), `${baseName()}.3mf`);
$('#expStl').onclick = () => download(geometryToSTL(build().layers.map((L) => ({ geometry: L.geometry, offset: [0, 0, L.z0] }))), `${baseName()}.stl`);
$('#expLayers').onclick = async () => {
  const zip = new JSZip();
  build().layers.forEach((L, i) => zip.file(`${baseName()}_L${i + 1}_${L.kind}.stl`, geometryToSTL([{ geometry: L.geometry, offset: [0, 0, L.z0] }])));
  download(await zip.generateAsync({ type: 'blob' }), `${baseName()}_layers.zip`);
};
// Laser / CNC: same writers as /api/export, run client-side (works offline too).
// Kerf is a machine setting, so it's remembered per browser rather than stored in the frame state.
const KERF_KEY = 'layerframe.kerf';
const kerfInput = $<HTMLInputElement>('#kerf');
const kerf = () => {
  const v = Number(kerfInput.value);
  return Number.isFinite(v) ? Math.min(KERF_MAX, Math.max(0, v)) : 0;
};
try { const saved = localStorage.getItem(KERF_KEY); if (saved !== null) kerfInput.value = String(Number(saved) || 0); } catch {}
function updateKerfWarn() {
  const w = exportWarnings(build().model, kerf()), el = $('#kerfWarn');
  el.hidden = w.length === 0;
  el.textContent = w.map((x) => x.message).join(' ');
}
kerfInput.oninput = () => updateKerfWarn();
kerfInput.onchange = () => {
  kerfInput.value = String(kerf());
  try { localStorage.setItem(KERF_KEY, kerfInput.value); } catch {}
  updateKerfWarn();
};
async function export2D(format: Format2D, split = false) {
  const r = await export2DFor(effectiveParams(state), ClipperLib, JSZip, { format, base: baseName(), kerf: kerf(), split });
  download(r.data, r.filename);
  $('#status').textContent = r.warnings.length ? `${r.filename}: ${r.warnings.map((w) => w.message).join(' ')}` : `exported ${r.filename}`;
}
$('#expSvg').onclick = () => export2D('svg');
$('#expDxf').onclick = () => export2D('dxf');
$('#expSvgLayers').onclick = () => export2D('svg', true);

$('#copyJson').onclick =() => navigator.clipboard.writeText(JSON.stringify(state, null, 2));
$('#reset').onclick = async () => {
  if (online) await fetch('./api/reset', { method: 'POST' });
  else { state = defaultState(); rebuild(); }
};

// ---------------- server sync (also how MCP tweaks show up live) ----------------
function setOnline(v: boolean) { online = v; const s = $('#sync'); s.textContent = v ? 'live' : 'offline'; s.classList.toggle('on', v); }
function connect() {
  let es: EventSource;
  try { es = new EventSource('./api/events'); } catch { return; }
  es.addEventListener('state', (e) => {
    const msg = JSON.parse((e as MessageEvent<string>).data);
    setOnline(true);
    if (msg.source === CLIENT) return;
    state = migrate(msg.state);
    rebuild();
  });
  es.onerror = () => setOnline(false);
}

rebuild();
connect();
window.LayerFrame = { get state() { return state; }, change, setCam, rebuild };
