// LayerFrame Studio — meshing + export (STL / 3MF). Works in browser and Node.
import * as THREE from 'three';
import type JSZipType from 'jszip';
import { buildLayers, normalize } from './frame-core.ts';
import type { Clipper, Layer, Model, Params, Region, State } from './frame-core.ts';

export type JSZipCtor = typeof JSZipType;
export interface MeshLayer extends Layer { geometry: THREE.BufferGeometry }
export interface Frame { model: Model; layers: MeshLayer[] }
type Vec3 = [number, number, number];

export function effectiveParams(state: State): Params {
  return normalize(state.params);
}

export function regionsToGeometry(regions: Region[], depth: number): THREE.BufferGeometry {
  const shapes = regions.map((r) => {
    const s = new THREE.Shape(r.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    s.holes = r.holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    return s;
  });
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1 });
  g.computeVertexNormals();
  return g;
}

// Build every layer of one frame. Returns { model, layers:[{geometry, z0, color, name}] }
export function buildFrame(params: Partial<Params>, ClipperLib: Clipper): Frame {
  const model = buildLayers(params, ClipperLib);
  const h = model.params.layer_h;
  const layers = model.layers.map((L): MeshLayer => {
    const geometry = regionsToGeometry(L.regions, h);
    return { ...L, geometry };
  });
  return { model, layers };
}

// ---------------- STL ----------------
export function geometryToSTL(parts: { geometry: THREE.BufferGeometry; offset?: Vec3 }[]): ArrayBuffer {
  // parts: [{geometry, offset:[x,y,z]}] -> ArrayBuffer (binary STL)
  let tri = 0;
  for (const p of parts) tri += (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3;
  const buf = new ArrayBuffer(84 + tri * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tri, true);
  let o = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  for (const p of parts) {
    const pos = p.geometry.attributes.position, idx = p.geometry.index;
    const [ox, oy, oz] = p.offset || [0, 0, 0];
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).add(t.set(ox, oy, oz));
      b.fromBufferAttribute(pos, i1).add(t);
      c.fromBufferAttribute(pos, i2).add(t);
      n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
      for (const v of [n, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return buf;
}

// ---------------- 3MF ----------------
function meshXML(geometry: THREE.BufferGeometry, offset: Vec3): string {
  const pos = geometry.attributes.position, idx = geometry.index;
  const map = new Map<string, number>(), verts: string[] = [], tris: string[] = [];
  const [ox, oy, oz] = offset;
  const key = (i: number) => {
    const x = (pos.getX(i) + ox).toFixed(4), y = (pos.getY(i) + oy).toFixed(4), z = (pos.getZ(i) + oz).toFixed(4);
    const k = x + ',' + y + ',' + z;
    let id = map.get(k);
    if (id === undefined) { id = verts.length; map.set(k, id); verts.push(`<vertex x="${x}" y="${y}" z="${z}"/>`); }
    return id;
  };
  const count = idx ? idx.count : pos.count;
  for (let i = 0; i < count; i += 3) {
    const v1 = key(idx ? idx.getX(i) : i), v2 = key(idx ? idx.getX(i + 1) : i + 1), v3 = key(idx ? idx.getX(i + 2) : i + 2);
    if (v1 !== v2 && v2 !== v3 && v1 !== v3) tris.push(`<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`);
  }
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>`;
}

// objects: [{ name, x, layers:[{geometry, z0, color, name}] }] — each frame = one object, each layer = a part
export interface Object3MF { name: string; x?: number; y?: number; layers: MeshLayer[] }

export async function build3MF(objects: Object3MF[], JSZip: JSZipCtor): Promise<Uint8Array> {
  const colors: string[] = [];
  const colorIndex = (c: string) => { const k = c.toUpperCase(); let i = colors.indexOf(k); if (i < 0) { colors.push(k); i = colors.length - 1; } return i; };
  let id = 2;
  const res: string[] = [], build: string[] = [];
  for (const obj of objects) {
    const comps: string[] = [];
    for (const L of obj.layers) {
      const oid = id++;
      res.push(`<object id="${oid}" name="${obj.name} ${L.name}" type="model" pid="1" pindex="${colorIndex(L.color)}">${meshXML(L.geometry, [obj.x || 0, obj.y || 0, L.z0])}</object>`);
      comps.push(`<component objectid="${oid}"/>`);
    }
    const pid = id++;
    res.push(`<object id="${pid}" name="${obj.name}" type="model"><components>${comps.join('')}</components></object>`);
    build.push(`<item objectid="${pid}"/>`);
  }
  const mats = `<basematerials id="1">${colors.map((c, i) => `<base name="Filament ${i + 1}" displaycolor="${c}"/>`).join('')}</basematerials>`;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">LayerFrame Studio</metadata>
<resources>${mats}${res.join('')}</resources>
<build>${build.join('')}</build>
</model>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);
  zip.file('3D/3dmodel.model', model);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// High-level helpers used by UI, server and MCP
export async function export3MFFor(state: State, ClipperLib: Clipper, JSZip: JSZipCtor): Promise<Uint8Array> {
  const { layers } = buildFrame(effectiveParams(state), ClipperLib);
  return build3MF([{ name: 'Frame', x: 0, y: 0, layers }], JSZip);
}

export function exportSTLFor(state: State, ClipperLib: Clipper, layerIndex: number | null = null): ArrayBuffer {
  const { layers } = buildFrame(effectiveParams(state), ClipperLib);
  const pick = layers.filter((L) => layerIndex === null || L.index === layerIndex);
  return geometryToSTL(pick.map((L) => ({ geometry: L.geometry, offset: [0, 0, L.z0] })));
}
