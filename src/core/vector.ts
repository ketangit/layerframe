// LayerFrame Studio — 2D vector export (laser / CNC).
// Each layer's regions are already its exact cut footprint, so there's no slicing:
// clean the rings, then write them as mm-unit SVG. Runs in the browser and in Node.
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

function layerPaths(layer: Layer, b: Bounds): string {
  const attrs = `fill="none" fill-rule="evenodd" stroke="${esc(layer.color)}" stroke-width="${HAIRLINE}"`;
  return layer.regions.map((r) => `<path ${attrs} d="${regionPath(r, b)}"/>`).join('\n');
}

function svgOpen(b: Bounds, extraNs = ''): string {
  const w = num(b.maxX - b.minX), h = num(b.maxY - b.minY);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${extraNs} width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`;
}

// One layer as a standalone SVG. `bbox` is the whole frame's (model.derived.bbox), so every
// layer file shares one origin and the cut sheets line up.
export function layerSVG(layer: Layer, bbox: Bounds): string {
  return `${svgOpen(bbox)}\n${layerPaths(layer, bbox)}\n</svg>\n`;
}

// Every layer in one SVG, each in an Inkscape layer group (LightBurn and Inkscape split on these).
export function stackSVG(model: Pick<Model, 'layers' | 'derived'>): string {
  const b = model.derived.bbox;
  const groups = model.layers.map((L) => {
    const id = esc(L.name.replace(/\s+/g, '-')), label = esc(L.name);
    return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${label}">\n${layerPaths(L, b)}\n</g>`;
  });
  return `${svgOpen(b, ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"')}\n${groups.join('\n')}\n</svg>\n`;
}
