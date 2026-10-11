# LayerFrame Studio

A local, parametric generator for multi-layer colour frames, built for Bambu Lab AMS printing. It works like LayerStudio's "Layered Art" mode: stepped terraces, a raised motif and a lace top layer, each layer its own filament. This is an independent implementation and contains no LayerStudio code.

Default setup: 6 layers × 1.5 mm = 9 mm, 4 filaments, stacked bottom to top:

| Layer | Role | Default colour |
|---|---|---|
| L1 | base ring (opening at the exact inner size) | pink |
| L2 | terrace (opening +1 step) | black |
| L3 | terrace (opening +2 steps) | pink |
| L4 | terrace (+3 steps) — background of the pattern band | white |
| L5 | outer/inner rims + solid flowers | green |
| L6 | outer/inner rims + petal lace outlines | black |

The app designs **one frame** at a time. The frame is sized from its inner opening plus the border. Quick size buttons:

| Button | Opening (mm) |
|---|---|
| A · 134×184 | 134 × 184 |
| B · 184×210 | 184 × 210 |
| 4×6 in | 101.6 × 152.4 |
| 5×7 in | 127 × 177.8 |
| 8×10 in | 203.2 × 254 |

You can also type any opening size. Sizes are not limited to any printer bed.

## Templates

The Templates gallery has one-click looks. Thumbnails are drawn at the current opening size. Loading a template keeps the opening size and replaces the rest of the settings, which you can then tweak.

| Template | Shape | Layout | Motif |
|---|---|---|---|
| Lace Daisies | arched top | band | daisies all round, including the arch |
| Flower Garden | silhouette (the flowers form the outline) | garden | mix: round, pointed, star, daisy |
| Hexagon Mosaic | rectangle | tile | hexagon honeycomb |
| Scalloped Dots | scalloped edge | band | dots |
| Rounded Stars | rounded bottom corners + arched top | band | 5-point stars, alternating tilt |
| Butterfly Corners | rounded corners | corners | butterflies at the corners, dots between |
| Hearts Arch | arched top | band | hearts all round |
| Pointed Petals | arched top | band | 8 long pointed petals |
| Plain Terraces | rounded corners | none | 5 stepped terraces only |

Building blocks you can mix yourself:

- **Shape**: `rect`, `rounded` (`corner_r`), `scallop` (`scallop_d`), `silhouette` (`band_w` around the opening). Any shape can have the arched top.
- **Arched top** (`arc`, on/off): when on, the opening gets a half-round top exactly as wide as the opening. The frame's top becomes a half-ring the same width as the border, carrying the same terraces, rims and motif pattern as the sides. This works with every shape and layout.
- **Layout**: `band` (row along the border), `garden` (large overlapping motifs that grow the outline), `tile` (hex lattice across the border), `corners` (accent motif on each corner plus a band), `none`.
- **Motifs**: `daisy`, `round`, `pointed`, `star`, `heart`, `hexagon`, `dot`, `butterfly`, or `mix` (cycles through `motif_mix`).
- **Accent**: the motif used for the corners (with the arch on: the two bottom corners and the arch apex).

To add your own template, add an entry to `TEMPLATES` in `src/core/frame-core.ts`.

## Run

Requires Node >= 24.17.0, which runs the `.ts` server files directly via native type stripping.

```bash
npm install
npm start            # dev: API + Vite (HMR) on http://localhost:5317
npm run build        # type-check (tsc) + Vite production build into dist/
npm run serve        # serve dist/ + API on http://localhost:5317
npm run typecheck    # tsc only
npm test             # core tests (node:test)
```

Open the URL. You can:

- pick a size preset or template, then edit any parameter
- change layer colours
- toggle **Exploded view**
- export:
  - **3MF**: one object with one part per layer. In Bambu Studio, answer "Yes" to "load as a single object with multiple parts", then assign a filament to each part.
  - **STL**: merged, or one file per layer (zip).
  - **Laser / CNC**: **SVG** or **DXF** (R12) of the whole stack, in mm, with one SVG group / DXF layer and one colour per frame layer, or **SVG per layer** (zip). Set **Kerf (mm)** to grow each part by half the kerf so it cuts at true size. The panel warns when a rim or the lace outline is no wider than 2 × kerf. The kerf is remembered in your browser and isn't part of the frame state.

Files are named after the template, for example `Lace_Daisies.3mf`.

State is saved to `state.json`. An older multi-frame `state.json` is converted automatically; the frame that was selected is kept. Every change, whether from the UI, the API or MCP, is pushed live to any open browser tab.

## JSON API (what MCP uses)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/schema` | all parameters with type, unit, range, defaults, size presets |
| GET | `/api/state` | full state `{params, view}` |
| PATCH | `/api/state` `{"patch":{…}}` | deep merge (`null` deletes a key) |
| PUT | `/api/state` | replace |
| POST | `/api/reset` | defaults |
| GET | `/api/templates` | template catalogue |
| POST | `/api/template` `{"name":"Flower Garden"}` | apply a template (opening size kept) |
| GET | `/api/model` | derived sizes + per-layer z / colour / area |
| GET | `/api/export?format=3mf` | download (`format=stl&layer=5` for one layer; `name=` sets the file name; `save=1` writes to `./exports` and returns the path) |
| GET | `/api/export?format=svg` / `format=dxf` | 2D cut files for laser / CNC (SVG, or DXF R12, in mm). Default: the whole stack, with one SVG group / DXF layer per frame layer. `layer=N` (0-based) for one layer; `split=1` for a zip of one file per layer; `kerf=0.1` (mm, 0–1) grows each part by kerf/2 so it cuts at true size. With `save=1` the JSON also lists `warnings` for features no wider than 2 × kerf. Bad `kerf` / `layer` returns 400. |
| GET | `/api/events` | server-sent events stream of state changes |

Examples:

```bash
curl -X PATCH localhost:5317/api/state -H "Content-Type: application/json" \
  -d '{"patch":{"params":{"in_w":150,"in_h":200,"motif":"star","petals":5}}}'
curl -X PATCH localhost:5317/api/state -H "Content-Type: application/json" \
  -d '{"patch":{"params":{"arc":false}}}'
curl "localhost:5317/api/export?format=3mf&save=1"
curl "localhost:5317/api/export?format=svg&split=1" -o layers.zip     # one SVG per layer
curl "localhost:5317/api/export?format=dxf&kerf=0.1&save=1"         # DXF, kerf-compensated, + warnings
```

## MCP server

`mcp/server.ts` is a stdio MCP server that wraps the API. It provides these tools:

- `get_schema`
- `get_state`
- `get_model`
- `set_params`
- `set_layer_colors`
- `set_view`
- `export` (3MF, STL, and SVG / DXF with `layer`, `split`, `kerf`)
- `list_templates`
- `apply_template`
- `reset`

Keep `npm start` running, then register the MCP server with your client. Example for Claude Desktop (`claude_desktop_config.json`), using your own absolute path:

```json
{
  "mcpServers": {
    "layerframe-studio": {
      "command": "node",
      "args": ["E:/ketan/ClaudeCoWork/layerframe-studio/mcp/server.ts"],
      "env": { "LAYERFRAME_URL": "http://localhost:5317" }
    }
  }
}
```

## Code layout

```
server.ts                 HTTP server: JSON API + SSE; Vite middleware in dev, dist/ in prod
mcp/server.ts             MCP stdio server
src/core/frame-core.ts    geometry core: schema, types, defaults, layer polygons (Clipper), state patching
src/core/mesh.ts          extrusion (three.js), STL + 3MF writers — shared by browser and Node
src/ui/index.html         UI shell (Vite root)
src/ui/styles.css
src/ui/app.ts             three.js viewer + parameter panel + live sync
src/ui/thumb.ts           top-view SVG thumbnails
vite.config.ts, tsconfig.json
```

To add a new motif:

1. Add a function to `MOTIF_LIBRARY` in `frame-core.ts` that returns the motif's parts as polygons around the origin.
2. Add its name to the `MOTIFS` list.

The UI, API and MCP pick it up automatically.
