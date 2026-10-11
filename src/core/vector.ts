// LayerFrame — 2D vector export (laser / CNC).
// Each layer's regions are already its exact cut footprint, so there's no slicing:
// clean the rings, then write them as mm-unit SVG or DXF R12. Runs in the browser and in Node.
import type { Bounds, Clipper, Layer, Model, Params, Region, Ring } from './frame-core.ts';
import type JSZipType from 'jszip';
import { S, buildLayers, makeOps, toC } from './frame-core.ts';

type JSZipCtor = typeof JSZipType; // injected, as in mesh.ts

const HAIRLINE = 0.01; // mm; laser software treats this as a cut line

// Drops micro-segments, duplicate and near-collinear points (within `tol` mm), then any ring
// smaller than `minArea` mm². A region whose outer ring is dropped is dropped with its holes.
// 2D export only: the 3D/3MF geometry keeps the uncleaned regions.
export function cleanRegions(regions: Region[], ClipperLib: Clipper, tol = 0.01, minArea = 0.01): Region[] {
  const clean = (ring: Ring): Ring | null => {
    const path = ClipperLib.Clipper.CleanPolygon(toC(ring), tol * S);
    if (path.length < 3 || Math.abs(ClipperLib.Clipper.Area(path)) / (S * S) < minArea) return null;
    return path.map((q) => [q.X / S, q.Y / S]);
  };
  const out: Region[] = [];
  for (const r of regions) {
    const outer = clean(r.outer);
    if (!outer) continue;
    out.push({ outer, holes: r.holes.map(clean).filter((h): h is Ring => h !== null) });
  }
  return out;
}

// ---------- export prep: clean + kerf ----------
// Kerf is a machine setting, not a design param, so it lives here rather than in SCHEMA.
export const KERF_MAX = 1; // mm
export interface ExportOptions { kerf?: number; tol?: number }
export type ExportModel = Pick<Model, 'layers' | 'derived'>;

const regionPaths = (regions: Region[]) => regions.flatMap((r) => [toC(r.outer), ...r.holes.map(toC)]);

// Cleans every layer and, with kerf > 0, offsets each layer outward by kerf/2 so cut parts come out
// at true size: outer edges grow and holes shrink (holes narrower than the kerf close, as they would
// on the machine). bbox/out_w/out_h are recomputed for the grown outline; with kerf 0 the model's
// derived values are kept, so the output is byte-identical to writing cleaned layers directly.
export function prepareExport(model: Pick<Model, 'layers' | 'derived'>, ClipperLib: Clipper, { kerf = 0, tol = 0.01 }: ExportOptions = {}): ExportModel {
  if (!(kerf >= 0 && kerf <= KERF_MAX)) throw new RangeError(`kerf must be between 0 and ${KERF_MAX} mm, got ${kerf}`);
  const ops = makeOps(ClipperLib);
  const layers = model.layers.map((l) => {
    let regions = cleanRegions(l.regions, ClipperLib, tol);
    if (kerf > 0) regions = cleanRegions(ops.toRegions(ops.offset(regionPaths(regions), kerf / 2, true)), ClipperLib, tol);
    return { ...l, regions };
  });
  if (kerf === 0) return { layers, derived: model.derived };
  const bbox = ops.bounds(layers.flatMap((l) => regionPaths(l.regions)));
  return {
    layers,
    derived: { ...model.derived, bbox, out_w: +(bbox.maxX - bbox.minX).toFixed(2), out_h: +(bbox.maxY - bbox.minY).toFixed(2) },
  };
}

// ---------- thin-feature warnings ----------
export interface ExportWarning { layer: string; feature: string; width: number; message: string }

// Flags pattern-layer features (rims, lace outline) no wider than 2 × kerf: after the beam takes
// kerf/2 off each side there's little or nothing left. Widths come from the design params, which
// set those features exactly; 0 means the feature is off.
export function exportWarnings(model: Pick<Model, 'layers' | 'params'>, kerf: number): ExportWarning[] {
  if (!(kerf > 0)) return [];
  const p = model.params, limit = 2 * kerf;
  const features: { kinds: Layer['kind'][]; feature: string; width: number }[] = [
    { kinds: ['motif', 'lace'], feature: 'outer rim', width: p.rim_w },
    { kinds: ['motif', 'lace'], feature: 'inner rim', width: p.inner_rim_w },
    { kinds: ['lace'], feature: 'lace outline', width: p.lace_w },
  ];
  const out: ExportWarning[] = [];
  for (const l of model.layers) for (const f of features) {
    if (!f.kinds.includes(l.kind) || f.width <= 0 || f.width > limit) continue;
    out.push({
      layer: l.name, feature: f.feature, width: f.width,
      message: `${l.name}: ${f.feature} is ${f.width} mm, at most 2 × kerf (${+limit.toFixed(3)} mm); it may burn away or break.`,
    });
  }
  return out;
}

const num = (v: number) => String(+v.toFixed(3) || 0); // 3 dp = Clipper precision; avoids "-0"
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// One subpath per ring, Y flipped so the frame's bottom edge sits at the bottom of the drawing.
function regionPath(r: Region, b: Bounds): string {
  return [r.outer, ...r.holes]
    .map((ring) => 'M' + ring.map(([x, y]) => `${num(x - b.minX)},${num(b.maxY - y)}`).join('L') + 'Z')
    .join('');
}

// Stroke colour per layer:
// - 'cut' (default): a fixed high-contrast colour per layer index. Laser software such as LightBurn
//   assigns cut layers by stroke colour, so layers that share a filament colour would otherwise merge.
//   12 colours = the most layers a frame can have (10 terraces + 2 pattern layers).
// - 'filament': the layer's filament colour, for a preview that matches the print.
export type StrokeMode = 'cut' | 'filament';
export interface SVGOptions { stroke?: StrokeMode }
export const CUT_COLORS = [
  '#000000', '#0000ff', '#ff0000', '#00a000', '#ff8000', '#00c0c0',
  '#ff00ff', '#808000', '#000080', '#800000', '#008080', '#800080',
] as const;

const strokeOf = (layer: Layer, mode: StrokeMode) =>
  mode === 'filament' ? layer.color : CUT_COLORS[layer.index % CUT_COLORS.length];

function layerPaths(layer: Layer, b: Bounds, mode: StrokeMode): string {
  const attrs = `fill="none" fill-rule="evenodd" stroke="${esc(strokeOf(layer, mode))}" stroke-width="${HAIRLINE}"`;
  return layer.regions.map((r) => `<path ${attrs} d="${regionPath(r, b)}"/>`).join('\n');
}

function svgOpen(b: Bounds, extraNs = ''): string {
  const w = num(b.maxX - b.minX), h = num(b.maxY - b.minY);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${extraNs} width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`;
}

// One layer as a standalone SVG. `bbox` is the whole frame's (model.derived.bbox), so every
// layer file shares one origin and the cut sheets line up.
export function layerSVG(layer: Layer, bbox: Bounds, { stroke = 'cut' }: SVGOptions = {}): string {
  return `${svgOpen(bbox)}\n${layerPaths(layer, bbox, stroke)}\n</svg>\n`;
}

// Every layer in one SVG, each in an Inkscape layer group. The label carries the filament colour,
// so it's still visible in 'cut' mode.
export function stackSVG(model: Pick<Model, 'layers' | 'derived'>, { stroke = 'cut' }: SVGOptions = {}): string {
  const b = model.derived.bbox;
  const groups = model.layers.map((L) => {
    const id = esc(L.name.replace(/\s+/g, '-')), label = esc(`${L.name} (${L.color})`);
    return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${label}">\n${layerPaths(L, b, stroke)}\n</g>`;
  });
  return `${svgOpen(b, ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"')}\n${groups.join('\n')}\n</svg>\n`;
}

// ---------- DXF R12 (AC1009): the widest compatibility (LightBurn, Fusion 360, LibreCAD, Inkscape) ----------
// mm, Y up, translated so the frame bbox minimum is (0, 0). Closed POLYLINEs only; there are no arcs.
// R12 has no true colour, so each layer gets an ACI index: the DXF counterpart of CUT_COLORS.
export const CUT_ACI = [7, 5, 1, 3, 30, 4, 6, 2, 150, 14, 94, 214] as const;

// R12 layer names: letters, digits, '_' and '-', at most 31 characters.
const dxfLayerName = (L: Layer) => L.name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 31);

function dxf(layers: Layer[], b: Bounds): string {
  const lines: string[] = [];
  const g = (code: number, value: string | number) => lines.push(String(code).padStart(3), String(value));
  const xy = (x: number, y: number) => { g(10, num(x)); g(20, num(y)); g(30, 0); };

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4); // mm (read by modern importers; R12-only readers skip it)
  g(9, '$EXTMIN'); xy(0, 0);
  g(9, '$EXTMAX'); xy(b.maxX - b.minX, b.maxY - b.minY);
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length + 1);
  g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
  for (const L of layers) {
    g(0, 'LAYER'); g(2, dxfLayerName(L)); g(70, 0); g(62, CUT_ACI[L.index % CUT_ACI.length]); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const L of layers) {
    const name = dxfLayerName(L);
    for (const r of L.regions) for (const ring of [r.outer, ...r.holes]) {
      g(0, 'POLYLINE'); g(8, name); g(66, 1); xy(0, 0); g(70, 1); // 66: vertices follow; 70 = 1: closed
      for (const [x, y] of ring) { g(0, 'VERTEX'); g(8, name); xy(x - b.minX, y - b.minY); }
      g(0, 'SEQEND'); g(8, name);
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return lines.join('\r\n') + '\r\n';
}

// One layer as a standalone DXF. `bbox` is the whole frame's, so every layer file shares one origin.
export function layerDXF(layer: Layer, bbox: Bounds): string {
  return dxf([layer], bbox);
}

// Every layer in one DXF, one DXF layer per frame layer (L1_base, L2_terrace, ...).
export function stackDXF(model: Pick<Model, 'layers' | 'derived'>): string {
  return dxf(model.layers, model.derived.bbox);
}

// ---------- one call for the API / MCP / UI: format + layer | split + kerf -> file ----------
export type Format2D = 'svg' | 'dxf';
export interface Export2DOptions {
  format: Format2D; base: string; kerf?: number;
  layer?: number | null; // one layer (0-based); otherwise the combined stack
  split?: boolean;       // zip of one file per layer
}
export interface Export2DResult { data: Uint8Array; filename: string; warnings: ExportWarning[] }

const layerFileName = (base: string, L: Layer) => `${base}_${L.name.replace(/[^\w.-]+/g, '_')}`;

// Builds the frame, applies kerf and writes SVG/DXF. Bad options throw RangeError (the API maps it to 400).
export async function export2DFor(params: Partial<Params>, ClipperLib: Clipper, JSZip: JSZipCtor, o: Export2DOptions): Promise<Export2DResult> {
  const { format, base, kerf = 0, layer = null, split = false } = o;
  if (format !== 'svg' && format !== 'dxf') throw new RangeError(`2D format must be svg or dxf, got ${format}`);
  if (layer !== null && split) throw new RangeError('layer and split cannot be combined');
  const model = buildLayers(params, ClipperLib);
  const e = prepareExport(model, ClipperLib, { kerf });
  if (layer !== null && !(Number.isInteger(layer) && layer >= 0 && layer < e.layers.length)) {
    throw new RangeError(`layer must be an integer from 0 to ${e.layers.length - 1}, got ${layer}`);
  }
  const one = (L: Layer) => (format === 'svg' ? layerSVG(L, e.derived.bbox) : layerDXF(L, e.derived.bbox));
  const tag = kerf > 0 ? `_kerf${kerf}` : '';
  const enc = (s: string) => new TextEncoder().encode(s);
  const warnings = exportWarnings(model, kerf);
  if (split) {
    const zip = new JSZip();
    for (const L of e.layers) zip.file(`${layerFileName(base, L)}${tag}.${format}`, one(L));
    return { data: await zip.generateAsync({ type: 'uint8array' }), filename: `${base}${tag}_${format}_layers.zip`, warnings };
  }
  if (layer !== null) return { data: enc(one(e.layers[layer])), filename: `${layerFileName(base, e.layers[layer])}${tag}.${format}`, warnings };
  return { data: enc(format === 'svg' ? stackSVG(e) : stackDXF(e)), filename: `${base}${tag}.${format}`, warnings };
}
