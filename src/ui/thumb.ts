// Top-view SVG of a built frame (layers painted bottom -> top). Used for template thumbnails.
import type { Model, Region } from '../core/frame-core.ts';

export function frameSVG(model: Model, { size = 160, stroke = false } = {}): string {
  const b = model.derived.bbox, pad = 2;
  const w = b.maxX - b.minX + pad * 2, h = b.maxY - b.minY + pad * 2;
  const path = (r: Region) => [r.outer, ...r.holes].map((ring) => 'M' + ring.map(([x, y]) => `${(x - b.minX + pad).toFixed(2)},${(b.maxY - y + pad).toFixed(2)}`).join('L') + 'Z').join('');
  const body = model.layers.map((L) => `<path fill="${L.color}" fill-rule="evenodd"${stroke ? ' stroke="rgba(0,0,0,.25)" stroke-width="0.3"' : ''} d="${L.regions.map(path).join('')}"/>`).join('');
  const s = size / Math.max(w, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" width="${(w * s).toFixed(0)}" height="${(h * s).toFixed(0)}">${body}</svg>`;
}
