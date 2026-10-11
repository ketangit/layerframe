// LayerFrame Studio — geometry core.
// Pure functions: parameters -> per-layer 2D regions (polygons with holes).
// Runs in the browser and in Node (server / MCP). ClipperLib is injected.
// All units are millimetres. Y is "up the frame", X is width.
import type * as ClipperNS from 'clipper-lib';

export type Clipper = typeof ClipperNS;
type CPath = ClipperNS.Path;
type CPaths = ClipperNS.Paths;

export type Pt = [number, number];
export type Ring = Pt[];
export interface Region { outer: Ring; holes: Ring[] }

const MOTIFS = ['daisy', 'round', 'pointed', 'star', 'heart', 'hexagon', 'dot', 'butterfly', 'mix'] as const;
export type Motif = (typeof MOTIFS)[number];
export type MotifName = Exclude<Motif, 'mix'>;
const MOTIF_NAMES = MOTIFS.filter((m): m is MotifName => m !== 'mix');
export type Shape = 'rect' | 'rounded' | 'scallop' | 'silhouette';
export type Layout = 'band' | 'garden' | 'tile' | 'corners' | 'none';

export interface Params {
  in_w: number; in_h: number;
  shape: Shape; border: number; arc: boolean; corner_r: number; scallop_d: number; band_w: number;
  layer_h: number; base_layers: number; step_w: number;
  layout: Layout; motif: Motif; motif_mix: MotifName[]; accent: MotifName;
  motif_d: number; motif_pitch: number; motif_rot: number; alt_rotate: boolean; petals: number; petal_ratio: number;
  rim_w: number; inner_rim_w: number; lace_w: number;
  colors: string[];
  template: string;
}

interface FieldBase { label: string; group: string }
export type FieldSpec =
  | (FieldBase & { type: 'number' | 'int'; unit?: string; min: number; max: number; step: number })
  | (FieldBase & { type: 'enum' | 'list'; options: readonly string[] })
  | (FieldBase & { type: 'bool' | 'colors' | 'string' });

export interface View { exploded: boolean; explode_gap: number }
export interface State { version: 3; params: Params; view: View }
// Partial state; nested objects are deep-merged, null deletes a key.
export type Patch = Record<string, unknown>;
export interface Template { note: string; params: Partial<Omit<Params, 'in_w' | 'in_h'>> }

export const schemaEntries = () => Object.entries(SCHEMA) as [keyof Params, FieldSpec][];

export const SCHEMA: Record<keyof Params, FieldSpec> = {
  // ---- size (per frame) ----
  in_w:          { type: 'number', unit: 'mm', min: 20,  max: 1000, step: 0.1,  label: 'Opening width',  group: 'Size' },
  in_h:          { type: 'number', unit: 'mm', min: 20,  max: 1000, step: 0.1,  label: 'Opening height', group: 'Size' },
  // ---- shape ----
  shape:         { type: 'enum', options: ['rect', 'rounded', 'scallop', 'silhouette'], label: 'Outline shape', group: 'Shape' },
  border:        { type: 'number', unit: 'mm', min: 8,   max: 80,   step: 0.5,  label: 'Border width',   group: 'Shape' },
  arc:           { type: 'bool', label: 'Arched top (arch as wide as the opening)', group: 'Shape' },
  corner_r:      { type: 'number', unit: 'mm', min: 0,   max: 60,   step: 0.5,  label: 'Corner radius (rounded)', group: 'Shape' },
  scallop_d:     { type: 'number', unit: 'mm', min: 4,   max: 60,   step: 0.5,  label: 'Scallop size (scallop)', group: 'Shape' },
  band_w:        { type: 'number', unit: 'mm', min: 2,   max: 40,   step: 0.5,  label: 'Solid band round opening (silhouette)', group: 'Shape' },
  // ---- layers ----
  layer_h:       { type: 'number', unit: 'mm', min: 0.2, max: 5,    step: 0.1,  label: 'Layer thickness', group: 'Layers' },
  base_layers:   { type: 'int',    min: 1,   max: 10,   step: 1,    label: 'Terrace layers (below pattern)', group: 'Layers' },
  step_w:        { type: 'number', unit: 'mm', min: 0,   max: 10,   step: 0.1,  label: 'Terrace step width', group: 'Layers' },
  // ---- pattern ----
  layout:        { type: 'enum', options: ['band', 'garden', 'tile', 'corners', 'none'], label: 'Pattern layout', group: 'Pattern' },
  motif:         { type: 'enum', options: MOTIFS, label: 'Motif', group: 'Pattern' },
  motif_mix:     { type: 'list', options: MOTIF_NAMES, label: 'Mix order (motif = mix)', group: 'Pattern' },
  accent:        { type: 'enum', options: MOTIF_NAMES, label: 'Accent motif (corners)', group: 'Pattern' },
  motif_d:       { type: 'number', unit: 'mm', min: 2,   max: 80,   step: 0.5,  label: 'Motif size (0 = fit)', group: 'Pattern' },
  motif_pitch:   { type: 'number', unit: 'mm', min: 3,   max: 120,  step: 0.5,  label: 'Motif spacing', group: 'Pattern' },
  motif_rot:     { type: 'number', unit: '°',  min: -180, max: 180, step: 1,    label: 'Motif rotation', group: 'Pattern' },
  alt_rotate:    { type: 'bool',   label: 'Alternate rotation', group: 'Pattern' },
  petals:        { type: 'int',    min: 3,   max: 12,   step: 1,    label: 'Petals / points', group: 'Pattern' },
  petal_ratio:   { type: 'number', min: 0.2, max: 0.6,  step: 0.01, label: 'Petal size ratio', group: 'Pattern' },
  rim_w:         { type: 'number', unit: 'mm', min: 0,   max: 10,   step: 0.1,  label: 'Outer rim width', group: 'Pattern' },
  inner_rim_w:   { type: 'number', unit: 'mm', min: 0,   max: 10,   step: 0.1,  label: 'Inner rim width', group: 'Pattern' },
  lace_w:        { type: 'number', unit: 'mm', min: 0.3, max: 3,    step: 0.05, label: 'Lace outline width (top layer)', group: 'Pattern' },
  // ---- colours ----
  colors:        { type: 'colors', label: 'Layer filament colours (bottom → top)', group: 'Colours' },
  template:      { type: 'string', label: 'Template', group: 'hidden' },
};

export const DEFAULTS: Params = {
  in_w: 134, in_h: 184,
  shape: 'rect', border: 20, arc: true, corner_r: 12, scallop_d: 14, band_w: 8,
  layer_h: 1.5, base_layers: 4, step_w: 1.5,
  layout: 'band', motif: 'daisy', motif_mix: ['round', 'pointed', 'star'], accent: 'daisy',
  motif_d: 12, motif_pitch: 23, motif_rot: 0, alt_rotate: true, petals: 6, petal_ratio: 0.42,
  rim_w: 1.5, inner_rim_w: 1.5, lace_w: 0.7,
  // LayerStudio-style exploded stack: pink, black, pink, white, green, black
  colors: ['#f4a7c8', '#1d1d1f', '#f4a7c8', '#f5f5f2', '#5fd38d', '#1d1d1f'],
  template: 'Lace Daisies',
};

// Quick opening sizes (the frame is always built from the inner opening + border)
export const SIZE_PRESETS: Record<string, Pick<Params, 'in_w' | 'in_h'>> = {
  'A · 134×184': { in_w: 134, in_h: 184 },
  'B · 184×210': { in_w: 184, in_h: 210 },
  '4×6 in': { in_w: 101.6, in_h: 152.4 },
  '5×7 in': { in_w: 127, in_h: 177.8 },
  '8×10 in': { in_w: 203.2, in_h: 254 },
};

// ---------- templates: named looks (sizes are kept when one is loaded) ----------
export const TEMPLATES: Record<string, Template> = {
  'Lace Daisies': {
    note: 'Daisy band with lace outlines under a full-width arch — the default set.',
    params: {},
  },
  'Flower Garden': {
    note: 'Large mixed flowers ring the opening and form the outline itself.',
    params: {
      shape: 'silhouette', arc: false, band_w: 7, layout: 'garden', motif: 'mix', motif_mix: ['round', 'pointed', 'star', 'round', 'daisy'],
      motif_d: 33, motif_pitch: 31, petals: 8, petal_ratio: 0.36, rim_w: 0, inner_rim_w: 2, lace_w: 0.9, alt_rotate: true,
      colors: ['#f6c2d4', '#2b2b2e', '#f6c2d4', '#fbf7ef', '#ffd166', '#2b2b2e'],
    },
  },
  'Hexagon Mosaic': {
    note: 'Honeycomb tiles across the border, straight edges.',
    params: {
      shape: 'rect', arc: false, layout: 'tile', motif: 'hexagon', motif_d: 7, motif_pitch: 8, motif_rot: 30, alt_rotate: false,
      rim_w: 1.6, inner_rim_w: 1.6, lace_w: 0.6,
      colors: ['#26324a', '#e9e4d8', '#26324a', '#e9e4d8', '#3fa7d6', '#f2b134'],
    },
  },
  'Scalloped Dots': {
    note: 'Scalloped outer edge with a band of polka dots.',
    params: {
      shape: 'scallop', scallop_d: 14, arc: false, layout: 'band', motif: 'dot', motif_d: 6, motif_pitch: 11, rim_w: 1.2, inner_rim_w: 1.2,
      lace_w: 0.6,
      colors: ['#bfe3f2', '#3b4a6b', '#bfe3f2', '#ffffff', '#ff8fab', '#3b4a6b'],
    },
  },
  'Rounded Stars': {
    note: 'Rounded bottom corners, arched top, five-point stars with alternating tilt.',
    params: {
      shape: 'rounded', corner_r: 14, arc: true, layout: 'band', motif: 'star', petals: 5, motif_d: 11, motif_pitch: 18, alt_rotate: true,
      accent: 'star',
      colors: ['#1f2a44', '#f4f1e8', '#1f2a44', '#f4f1e8', '#f2c14e', '#1f2a44'],
    },
  },
  'Butterfly Corners': {
    note: 'Symmetric butterflies on each corner, small dots between them (with the arch: bottom corners + apex).',
    params: {
      shape: 'rounded', corner_r: 10, arc: false, layout: 'corners', motif: 'dot', accent: 'butterfly', motif_d: 4.5, motif_pitch: 10,
      rim_w: 1.2, inner_rim_w: 1.2, lace_w: 0.7,
      colors: ['#e8f1e4', '#2d3a2e', '#e8f1e4', '#ffffff', '#9b7fd1', '#2d3a2e'],
    },
  },
  'Hearts Arch': {
    note: 'Arched top with a row of hearts all the way round.',
    params: {
      shape: 'rect', arc: true, layout: 'band', motif: 'heart', accent: 'heart', motif_d: 11, motif_pitch: 17, alt_rotate: false,
      colors: ['#ffe3ea', '#8c1c3a', '#ffe3ea', '#ffffff', '#ef476f', '#8c1c3a'],
    },
  },
  'Pointed Petals': {
    note: 'Eight-petal flowers with long pointed petals, arched top.',
    params: {
      shape: 'rect', arc: true, layout: 'band', motif: 'pointed', accent: 'pointed', petals: 8, motif_d: 13, motif_pitch: 20, alt_rotate: true,
      colors: ['#f7d6b4', '#3d2b1f', '#f7d6b4', '#fffaf2', '#e76f51', '#3d2b1f'],
    },
  },
  'Plain Terraces': {
    note: 'No pattern — just stepped terraces, one colour per step.',
    params: {
      shape: 'rounded', corner_r: 6, arc: false, layout: 'none', base_layers: 5, step_w: 2,
      colors: ['#2e3440', '#5e81ac', '#88c0d0', '#d8dee9', '#eceff4'],
    },
  },
};

export const PATTERN_LAYERS = 2; // solid motif layer + lace layer

export function normalize(p: Partial<Params>): Params {
  const out: Record<string, unknown> = { ...DEFAULTS, ...p };
  const def = DEFAULTS as unknown as Record<string, unknown>;
  for (const [k, s] of schemaEntries()) {
    if (s.type === 'number' || s.type === 'int') {
      let v = Number(out[k]);
      if (!Number.isFinite(v)) v = def[k] as number;
      if (s.min !== undefined) v = Math.max(s.min, v);
      if (s.max !== undefined) v = Math.min(s.max, v);
      if (s.type === 'int') v = Math.round(v);
      out[k] = v;
    } else if (s.type === 'bool') out[k] = !!out[k];
    else if (s.type === 'enum' && !s.options.includes(out[k] as string)) out[k] = def[k];
    else if (s.type === 'list') {
      const arr: unknown[] = Array.isArray(out[k]) ? out[k] : String(out[k] || '').split(/[\s,]+/);
      const clean = arr.map((x) => String(x).trim()).filter((x) => s.options.includes(x));
      out[k] = clean.length ? clean : (def[k] as string[]).slice();
    }
  }
  const r = out as unknown as Params;
  const n = layerCount(r);
  const c = Array.isArray(r.colors) ? r.colors.slice(0, n) : [];
  while (c.length < n) c.push(DEFAULTS.colors[c.length % DEFAULTS.colors.length]);
  r.colors = c;
  return r;
}

export function layerCount(p: Pick<Params, 'base_layers' | 'layout'>): number {
  return p.base_layers + (p.layout === 'none' ? 0 : PATTERN_LAYERS);
}

// ---------- polygon helpers (Clipper works in integer space) ----------
const S = 1000;
const toC = (pts: Ring): CPath => pts.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));

function circle(cx: number, cy: number, r: number, seg?: number): Ring {
  const n = seg || Math.max(24, Math.min(96, Math.round(r * 6)));
  const pts: Ring = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
function ellipse(cx: number, cy: number, a: number, b: number, rot = 0, seg = 40): Ring {
  const pts: Ring = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < seg; i++) {
    const t = (2 * Math.PI * i) / seg, x = a * Math.cos(t), y = b * Math.sin(t);
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return pts;
}
function regular(cx: number, cy: number, r: number, n: number, rot = 0): Ring {
  const pts: Ring = [];
  for (let i = 0; i < n; i++) { const a = rot + (2 * Math.PI * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
function rect(x0: number, y0: number, x1: number, y1: number): Ring { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
function xform(pts: Ring, cx: number, cy: number, rot: number): Ring {
  const c = Math.cos(rot), s = Math.sin(rot);
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }
export type Ops = ReturnType<typeof makeOps>;

export function makeOps(ClipperLib: Clipper) {
  const CL = ClipperLib;
  const run = (type: ClipperNS.ClipType, subj: CPaths, clip: CPaths): CPaths => {
    const c = new CL.Clipper();
    c.AddPaths(subj, CL.PolyType.ptSubject, true);
    if (clip && clip.length) c.AddPaths(clip, CL.PolyType.ptClip, true);
    const sol: CPaths = [];
    c.Execute(type, sol, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return sol;
  };
  return {
    union: (a: CPaths, b: CPaths = []) => run(CL.ClipType.ctUnion, a.concat(b), []),
    diff: (a: CPaths, b: CPaths) => run(CL.ClipType.ctDifference, a, b),
    inter: (a: CPaths, b: CPaths) => run(CL.ClipType.ctIntersection, a, b),
    offset: (paths: CPaths, d: number, round = false): CPaths => {
      const co = new CL.ClipperOffset(2, 0.08 * S);
      co.AddPaths(paths, round ? CL.JoinType.jtRound : CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
      const sol: CPaths = [];
      co.Execute(sol, d * S);
      return sol;
    },
    toRegions: (paths: CPaths): Region[] => {
      const c = new CL.Clipper();
      c.AddPaths(paths, CL.PolyType.ptSubject, true);
      const tree = new CL.PolyTree();
      c.Execute(CL.ClipType.ctUnion, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
      const ex = CL.JS.PolyTreeToExPolygons(tree);
      const back = (path: CPath): Ring => path.map((q) => [q.X / S, q.Y / S]);
      return ex.map((e) => ({ outer: back(e.outer), holes: e.holes.map(back) }));
    },
    area: (paths: CPaths) => paths.reduce((s, pth) => s + CL.Clipper.Area(pth), 0) / (S * S),
    bounds: (paths: CPaths): Bounds => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pth of paths) for (const q of pth) {
        if (q.X < minX) minX = q.X; if (q.X > maxX) maxX = q.X; if (q.Y < minY) minY = q.Y; if (q.Y > maxY) maxY = q.Y;
      }
      return { minX: minX / S, maxX: maxX / S, minY: minY / S, maxY: maxY / S };
    },
  };
}

// ---------- motif library: each returns parts (closed polygons) at the origin, overall size ≈ d ----------
// Parts are outlined individually on the lace layer, so each part reads as one "stroke" in the design.
export const MOTIF_LIBRARY: Record<MotifName, (d: number, p: Params) => Ring[]> = {
  daisy(d, p) {
    const pr = (d / 2) * p.petal_ratio, ring = d / 2 - pr;
    const parts = [circle(0, 0, Math.max(pr * 0.85, ring * 0.7))];
    for (let k = 0; k < p.petals; k++) { const a = (2 * Math.PI * k) / p.petals; parts.push(circle(ring * Math.cos(a), ring * Math.sin(a), pr)); }
    return parts;
  },
  round(d) {
    // five fat rounded lobes + a centre disc
    const n = 5, pr = d * 0.24, ring = d / 2 - pr;
    const parts: Ring[] = [];
    for (let k = 0; k < n; k++) { const a = Math.PI / 2 + (2 * Math.PI * k) / n; parts.push(circle(ring * Math.cos(a), ring * Math.sin(a), pr)); }
    parts.push(circle(0, 0, d * 0.17));
    return parts;
  },
  pointed(d, p) {
    // long elliptical petals + centre disc
    const n = Math.max(5, p.petals), len = d / 4, wid = Math.max(d * 0.07, (Math.PI * d) / (4.6 * n));
    const parts: Ring[] = [];
    for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; parts.push(ellipse((d / 4 + d * 0.02) * Math.cos(a), (d / 4 + d * 0.02) * Math.sin(a), len, wid, a)); }
    parts.push(circle(0, 0, d * 0.13));
    return parts;
  },
  star(d, p) {
    const n = Math.max(4, Math.min(p.petals, 10)), R = d / 2, r = R * (n >= 7 ? 0.62 : 0.48);
    const pts: Ring = [];
    for (let i = 0; i < n * 2; i++) { const a = Math.PI / 2 + (Math.PI * i) / n, rr = i % 2 ? r : R; pts.push([rr * Math.cos(a), rr * Math.sin(a)]); }
    return [pts, circle(0, 0, r * 0.38)];
  },
  heart(d) {
    const pts: Ring = [];
    for (let i = 0; i < 64; i++) {
      const t = (2 * Math.PI * i) / 64;
      const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([(x / 34) * d, (y / 34) * d + d * 0.06]);
    }
    return [pts];
  },
  hexagon(d) { return [regular(0, 0, d / 2, 6)]; },
  dot(d) { return [circle(0, 0, d / 2)]; },
  butterfly(d) {
    const w = d / 2;
    return [
      ellipse(-w * 0.48, w * 0.28, w * 0.5, w * 0.36, -0.5), ellipse(w * 0.48, w * 0.28, w * 0.5, w * 0.36, 0.5),
      ellipse(-w * 0.38, -w * 0.38, w * 0.34, w * 0.25, 0.45), ellipse(w * 0.38, -w * 0.38, w * 0.34, w * 0.25, -0.45),
      ellipse(0, 0, w * 0.09, w * 0.62), circle(0, w * 0.66, w * 0.1),
    ];
  },
};

function motifParts(name: MotifName, d: number, p: Params, cx: number, cy: number, rot: number): CPaths {
  const fn = MOTIF_LIBRARY[name] || MOTIF_LIBRARY.dot;
  return fn(d, p).map((pts) => toC(xform(pts, cx, cy, rot)));
}

// ---------- frame geometry: closed centre-line paths (rectangle, or rectangle with arched top) ----------
// With the arch on, the opening is a rectangle topped by a half-disc as wide as the opening, and the
// frame's top is a half-ring of the same border width: arch centre = (0, H - border).
const dims = (p: Params) => {
  const W = p.in_w + 2 * p.border, H = p.in_h + 2 * p.border;
  return { W, H, yc: H - p.border };
};

// Path inset by `c` from the outer edge (c = 0 is the outer edge). Segments: lines and the top arc.
type Seg =
  | { t: 'L'; a: Pt; b: Pt }
  | { t: 'A'; cx: number; cy: number; r: number; a0: number; a1: number };

function framePath(p: Params, c: number): Seg[] {
  const { W, H, yc } = dims(p);
  const x0 = -W / 2 + c, x1 = W / 2 - c;
  if (!p.arc) {
    return [
      { t: 'L', a: [x0, c], b: [x1, c] }, { t: 'L', a: [x1, c], b: [x1, H - c] },
      { t: 'L', a: [x1, H - c], b: [x0, H - c] }, { t: 'L', a: [x0, H - c], b: [x0, c] },
    ];
  }
  const r = W / 2 - c;
  return [
    { t: 'L', a: [x0, c], b: [x1, c] }, { t: 'L', a: [x1, c], b: [x1, yc] },
    { t: 'A', cx: 0, cy: yc, r, a0: 0, a1: Math.PI },
    { t: 'L', a: [x0, yc], b: [x0, c] },
  ];
}
const segLen = (s: Seg) => (s.t === 'L' ? Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) : s.r * (s.a1 - s.a0));
const segAt = (s: Seg, u: number): Pt => (s.t === 'L'
  ? [s.a[0] + (s.b[0] - s.a[0]) * u, s.a[1] + (s.b[1] - s.a[1]) * u]
  : [s.cx + s.r * Math.cos(s.a0 + (s.a1 - s.a0) * u), s.cy + s.r * Math.sin(s.a0 + (s.a1 - s.a0) * u)]);
// Evenly spaced points per segment; segment start points are always included (corners / arch feet).
function samplePath(path: Seg[], pitch: number): Pt[] {
  const pts: Pt[] = [];
  for (const s of path) {
    const n = Math.max(1, Math.round(segLen(s) / pitch));
    for (let i = 0; i < n; i++) pts.push(segAt(s, i / n));
  }
  return pts;
}

// ---------- placements ----------
const motifAt = (p: Params, i: number): MotifName => (p.motif === 'mix' ? p.motif_mix[i % p.motif_mix.length] : p.motif);
const deg = (a: number) => (a * Math.PI) / 180;

export interface Placement { x: number; y: number; d: number; rot: number; motif: MotifName; clip?: false; tile?: true }

export function placements(p: Params): { motifs: Placement[]; fieldW: number } {
  const { W, H, yc } = dims(p);
  const terr = (p.base_layers - 1) * p.step_w;
  const fieldW = Math.max(1, p.border - terr - p.rim_w - p.inner_rim_w);
  const out: Placement[] = [];
  const base = deg(p.motif_rot);
  const altRot = (i: number, name: MotifName) => (p.alt_rotate && i % 2 ? Math.PI / (name === 'round' ? 5 : Math.max(3, p.petals)) : 0);

  if (p.layout === 'band' || p.layout === 'corners') {
    const d = Math.max(1, Math.min(p.motif_d || fieldW, fieldW - 0.4));
    const c = p.rim_w + fieldW / 2;
    const pts = samplePath(framePath(p, c), Math.max(p.motif_pitch, d * 0.6));
    const cornerD = Math.min(p.border * 1.5, Math.min(W, H) * 0.3);
    // accent spots: the 4 corners, or with the arch the 2 bottom corners + the arch apex
    const spots: [number, number, number, number][] = p.arc
      ? [[-W / 2 + p.border / 2, p.border / 2, -1, -1], [W / 2 - p.border / 2, p.border / 2, 1, -1], [0, yc + W / 2 - p.border / 2, 0, 1]]
      : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]): [number, number, number, number] => [sx * (W / 2 - p.border / 2), sy < 0 ? p.border / 2 : H - p.border / 2, sx, sy]);
    pts.forEach(([x, y], i) => {
      if (p.layout === 'corners' && spots.some(([sx, sy]) => Math.hypot(x - sx, y - sy) < cornerD * 0.8)) return;
      const name = motifAt(p, i);
      out.push({ x, y, d, rot: base + altRot(i, name), motif: name });
    });
    if (p.layout === 'corners') {
      for (const [x, y, sx, sy] of spots) out.push({ x, y, d: cornerD, rot: Math.atan2(sy, sx) - Math.PI / 2, motif: p.accent, clip: false });
    }
  } else if (p.layout === 'garden') {
    // big motifs centred on the border line, overlapping each other and the opening
    const d = p.motif_d || p.border * 1.5;
    const pts = samplePath(framePath(p, p.border / 2), Math.max(p.motif_pitch, d * 0.5));
    pts.forEach(([x, y], i) => {
      const name = motifAt(p, i);
      out.push({ x, y, d, rot: base + altRot(i, name), motif: name, clip: false });
    });
  } else if (p.layout === 'tile') {
    const d = p.motif_d || p.motif_pitch * 0.85, a = p.motif_pitch;
    const rowH = (a * Math.sqrt(3)) / 2;
    const top = p.arc ? yc + W / 2 : H;
    let row = 0;
    for (let y = -a; y < top + a; y += rowH, row++) {
      for (let x = -W / 2 - a + (row % 2 ? a / 2 : 0); x < W / 2 + a; x += a) {
        out.push({ x, y, d, rot: base, motif: p.motif === 'mix' ? p.motif_mix[(row + Math.round(x / a)) % p.motif_mix.length] : p.motif, tile: true });
      }
    }
  }
  return { motifs: out, fieldW };
}

// ---------- outline ----------
function halfDisc(cx: number, cy: number, r: number, drop = 0.01): CPath {
  const seg = Math.max(48, Math.round(r * 2));
  const pts: Ring = [[r, cy - drop]];
  for (let i = 0; i <= seg; i++) { const a = (Math.PI * i) / seg; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  pts.push([-r, cy - drop]);
  return toC(pts);
}

function outlinePaths(p: Params, ops: Ops, motifs: Placement[]): CPaths {
  const { W, H, yc } = dims(p);
  const top = p.arc ? yc : H;                       // straight sides run up to here
  let o: CPaths;
  if (p.shape === 'silhouette') {
    const band = ops.offset(openPaths(p, 0, ops), p.band_w, true);
    let solid: CPaths = [];
    for (const m of motifs) solid = solid.concat(motifParts(m.motif, m.d, p, m.x, m.y, m.rot));
    o = ops.union(band, ops.union(solid));
  } else {
    o = [toC(rect(-W / 2, 0, W / 2, top))];
    if (p.shape === 'rounded' && p.corner_r > 0) {
      const r = Math.min(p.corner_r, p.border - 0.5, W / 2 - 1, top / 2 - 1);
      o = ops.offset(ops.offset(o, -r, true), r, true);
      // with the arch, keep the top corners square so the sides meet the arch cleanly
      if (p.arc) o = ops.union(o, [toC(rect(-W / 2, top - r - 1, W / 2, top))]);
    }
    if (p.arc) o = ops.union(o, [halfDisc(0, yc, W / 2)]);
    if (p.shape === 'scallop') {
      const sd = p.scallop_d;
      const bumps = samplePath(framePath(p, 0), sd * 0.9).map(([x, y]) => toC(circle(x, y, sd / 2)));
      o = ops.union(o, bumps);
    }
  }
  return o;
}

// Opening for terrace step k: rectangle, plus a half-disc as wide as the opening when the arch is on.
function openPaths(p: Params, k: number, ops: Ops): CPaths {
  const { H, yc } = dims(p);
  const w = p.in_w + 2 * k * p.step_w, y0 = p.border - k * p.step_w;
  if (!p.arc) return [toC(rect(-w / 2, y0, w / 2, H - p.border + k * p.step_w))];
  return ops.union([toC(rect(-w / 2, y0, w / 2, yc))], [halfDisc(0, yc, w / 2)]);
}

// ---------- main: build layers ----------
export type LayerKind = 'base' | 'terrace' | 'motif' | 'lace';
export interface Layer {
  index: number; name: string; kind: LayerKind; z0: number; z1: number; color: string; area_mm2: number; regions: Region[];
}
export type Model = ReturnType<typeof buildLayers>;

export function buildLayers(params: Partial<Params>, ClipperLib: Clipper) {
  const p = normalize(params);
  const ops = makeOps(ClipperLib);
  const { motifs } = placements(p);
  let outline = outlinePaths(p, ops, p.shape === 'silhouette' ? motifs.filter((m) => !m.tile) : []);
  // motifs flagged clip:false may grow the outline (corner butterflies, garden flowers)
  let expand: CPaths = [];
  for (const m of motifs) if (m.clip === false) expand = expand.concat(motifParts(m.motif, m.d, p, m.x, m.y, m.rot));
  expand = expand.length ? ops.union(expand) : [];
  if (expand.length && p.shape !== 'silhouette') outline = ops.union(outline, expand);
  const nL = layerCount(p);
  const topOpen = openPaths(p, p.base_layers - 1, ops);
  const layers: { kind: LayerKind; paths: CPaths }[] = [];

  for (let k = 0; k < p.base_layers; k++) {
    layers.push({ kind: k === 0 ? 'base' : 'terrace', paths: ops.diff(outline, openPaths(p, k, ops)) });
  }

  if (p.layout !== 'none') {
    const ring = ops.diff(outline, topOpen);
    const inset = p.rim_w > 0 ? ops.offset(outline, -p.rim_w, true) : outline;
    const field = ops.diff(expand.length ? ops.union(inset, expand) : inset, p.inner_rim_w > 0 ? ops.offset(topOpen, p.inner_rim_w) : topOpen);
    const rims = ops.diff(ring, field);
    let solid: CPaths = [], lace: CPaths = [];
    for (const m of motifs) {
      const parts = motifParts(m.motif, m.d, p, m.x, m.y, m.rot);
      solid = solid.concat(parts);
      for (const part of parts) lace = lace.concat(ops.diff([part], ops.offset([part], -p.lace_w)));
    }
    const solidU = ops.inter(ops.union(solid), field);
    const laceU = ops.inter(ops.union(lace), solidU);
    layers.push({ kind: 'motif', paths: ops.union(rims, solidU) });
    layers.push({ kind: 'lace', paths: ops.union(rims, laceU) });
  }

  const b = ops.bounds(outline);
  const W = b.maxX - b.minX, Ht = b.maxY - b.minY;
  return {
    params: p,
    derived: {
      out_w: +W.toFixed(2), out_h: +Ht.toFixed(2), bbox: b,
      rect_w: p.in_w + 2 * p.border, rect_h: p.in_h + 2 * p.border,
      thickness: +(nL * p.layer_h).toFixed(3), layers: nL, motifs: motifs.length,
      filaments: new Set(p.colors.map((c) => c.toLowerCase())).size,
    },
    layers: layers.map((L, i): Layer => ({
      index: i,
      name: `L${i + 1} ${L.kind}`,
      kind: L.kind,
      z0: +(i * p.layer_h).toFixed(4),
      z1: +((i + 1) * p.layer_h).toFixed(4),
      color: p.colors[i],
      area_mm2: +ops.area(L.paths).toFixed(1),
      regions: ops.toRegions(L.paths),
    })),
    layerTotal: nL,
  };
}

// App state: one frame's params + view prefs.
export function defaultState(): State {
  return { version: 3, params: JSON.parse(JSON.stringify(DEFAULTS)), view: { exploded: true, explode_gap: 8 } };
}

// Older multi-frame shape: { shared, frames: { name: params }, active }.
interface LegacyState {
  params?: Params; view?: Partial<View>;
  shared?: Record<string, unknown>; frames?: Record<string, Record<string, unknown>>; active?: string;
}

// Accepts older multi-frame states ({shared, frames, active}) and folds them into one frame.
export function migrate(input: unknown): State {
  if (!input || typeof input !== 'object') return defaultState();
  const st = input as LegacyState;
  if (st.params) return { ...defaultState(), ...st, view: { ...defaultState().view, ...(st.view || {}) } } as State;
  const active = st.frames && (st.frames[st.active ?? ''] || Object.values(st.frames)[0]);
  const params: Record<string, unknown> = { ...DEFAULTS, ...(st.shared || {}), ...(active || {}) };
  delete params.arc_r; delete params.arc_mode; delete params.medallion; delete params.medallion_scale;
  return { version: 3, params: params as unknown as Params, view: { exploded: st.view?.exploded ?? true, explode_gap: st.view?.explode_gap ?? 8 } };
}

// Deep-merge a patch into state (arrays replaced, null deletes).
export function applyPatch(state: State, patch: Patch): State {
  const out = JSON.parse(JSON.stringify(state));
  const merge = (t: Record<string, any>, s: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(s || {})) {
      if (v === null) { delete t[k]; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) { t[k] = t[k] && typeof t[k] === 'object' ? t[k] : {}; merge(t[k], v as Record<string, unknown>); }
      else t[k] = v;
    }
  };
  merge(out, patch);
  return migrate(out);
}

// Template = defaults + template params; the opening size is kept.
export function applyTemplate(state: State, name: string): State {
  const t = TEMPLATES[name];
  if (!t) throw new Error(`unknown template ${name}`);
  const out: State = JSON.parse(JSON.stringify(state));
  out.params = { ...JSON.parse(JSON.stringify(DEFAULTS)), ...JSON.parse(JSON.stringify(t.params)),
    template: name, in_w: state.params.in_w, in_h: state.params.in_h };
  return out;
}
