// LayerFrame Studio — 2D vector export (laser / CNC).
// Each layer's regions are already its exact cut footprint, so there's no slicing:
// clean the rings, then write them as mm-unit SVG or DXF R12. Runs in the browser and in Node.
import type { Bounds, Clipper, Layer, Model, Region, Ring } from './frame-core.ts';
import { S, toC } from './frame-core.ts';

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
