# LayerFrame

A browser-based, parametric generator for multi-layer colour frames, built for Bambu Lab AMS printing. It works like LayerStudio's "Layered Art" mode: stepped terraces, a raised motif and a lace top layer, each layer its own filament. This is an independent implementation and contains no LayerStudio code.

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
| 4×6 in (default) | 101.6 × 152.4 |
| 5×7 in | 127 × 177.8 |
| 8×10 in | 203.2 × 254 |
| Custom | type W × H in mm |

**Custom** shows width and height fields (mm) next to the buttons; it's highlighted whenever the opening doesn't match a preset. Sizes are not limited to any printer bed.

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

Live at **https://layerframe.craftedbyk.com**. The app runs entirely in the browser: the open tab holds the design and generates every export. There is no server.

Locally (Node >= 24.17.0):

```bash
npm install
npm start            # Vite dev server (HMR) on http://localhost:5317
npm run build        # type-check (tsc) + Vite production build into dist/ (static)
npm run serve        # preview dist/ on http://localhost:5317
npm run typecheck    # tsc only
npm test             # core, store, bridge and export tests (node:test)
```

Open the URL. You can:

- pick a size preset or template, then edit any parameter
- change layer colours
- toggle **Exploded view**
- export:
  - **3MF**: one object with one part per layer. In Bambu Studio, answer "Yes" to "load as a single object with multiple parts", then assign a filament to each part.
  - **STL**: merged, or one file per layer (zip).
  - **Laser / CNC**: **SVG** or **DXF** (R12) of the whole stack, in mm, with one SVG group / DXF layer and one colour per frame layer, or **SVG per layer** (zip). Set **Kerf (mm)** to grow each part by half the kerf so it cuts at true size. The panel warns when a rim or the lace outline is no wider than 2 × kerf. The kerf is remembered in your browser and isn't part of the frame state.
- **Save design** / **Open design**: the whole design (params + view) as a `.layerframe.json` file, to keep or move to another browser. Opening a file replaces the current design. Colours that aren't `#rrggbb` / `#rgb` fall back to the layer default.

Files are named after the template, for example `Lace_Daisies.3mf`.

The design is saved in the browser (`localStorage`, key `layerframe.state`) and survives reloads. If storage is blocked (some private modes), the app still works but forgets the design on reload. Tabs of the same browser stay in sync. Older multi-frame designs, including the `state.json` written by earlier versions, are converted automatically: load an old `state.json` with **Open design**.

## MCP server

`mcp/server.ts` is a stdio MCP server. The app has no server-side API, so it forwards every tool call over a WebSocket bridge on `ws://127.0.0.1:5318` to the open LayerFrame tab, which runs it against its own design. Changes an AI makes show up live in that tab. Tools:

- `get_schema`
- `get_state`
- `get_model`
- `set_params`
- `set_layer_colors`
- `set_view`
- `export` (3MF, STL, and SVG / DXF with `layer`, `split`, `kerf`): the tab builds the file, the MCP server writes it to `./exports` and returns the path
- `list_templates`
- `apply_template`
- `reset`

Setup:

1. Register the server with your MCP client. Example for Claude Desktop (`claude_desktop_config.json`), using your own absolute path:

   ```json
   {
     "mcpServers": {
       "layerframe": {
         "command": "node",
         "args": ["E:/ketan/ClaudeCoWork/layerframe/mcp/server.ts"]
       }
     }
   }
   ```

2. Open the app and click the **MCP off** badge next to the title. It turns to **MCP live** once the MCP server is running; the choice is remembered. One tab is attached at a time; the newest one wins.

Notes:

- **Local tab (`npm start`)**: fully supported.
- **Live site (https://layerframe.craftedbyk.com)**: best-effort. Chrome asks once for permission to reach local network devices; Safari may block an https page from connecting to `ws://127.0.0.1` at all. Use the local tab if it won't connect.
- Run only one copy of the MCP server. Your MCP client starts its own, so don't also run `npm run mcp` in a terminal: the first copy holds port 5318 and gets the tab. A second copy reports that in its tool errors and takes the port over within 2 s once the first one exits; the tab reconnects by itself.
- The bridge only listens on 127.0.0.1 and only accepts pages from `http://localhost:5317`, `http://127.0.0.1:5317` and `https://layerframe.craftedbyk.com` (WebSocket `Origin` check). Env vars: `LAYERFRAME_BRIDGE_PORT` (default 5318), `LAYERFRAME_ORIGINS` (comma-separated allowlist).

## Deploy

The production site is static `dist/` on Vercel Hobby (no Functions). `.github/workflows/deploy.yml` deploys with the Vercel CLI (pinned in `.github/vercel-cli/`): a same-repo PR gets a preview URL, a push to `main` goes to production. Vercel's own Git integration is off (`vercel.json`), which also sets the security headers (CSP, `nosniff`, etc.). Repo secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

## Code layout

```
mcp/server.ts             MCP stdio server + WebSocket bridge to the open tab
src/core/frame-core.ts    geometry core: schema, types, defaults, layer polygons (Clipper), state patching
src/core/mesh.ts          extrusion (three.js), STL + 3MF writers
src/core/vector.ts        2D export: SVG / DXF, kerf, thin-feature warnings
src/core/store.ts         client state store (localStorage, migrate, patch, templates, design JSON)
src/core/bridge.ts        MCP bridge protocol + tool handler (runs in the tab)
src/ui/index.html         UI shell (Vite root)
src/ui/styles.css
src/ui/app.ts             three.js viewer + parameter panel + MCP bridge client
src/ui/thumb.ts           top-view SVG thumbnails
vercel.json               static deploy config + security headers
vite.config.ts, tsconfig.json
```

To add a new motif:

1. Add a function to `MOTIF_LIBRARY` in `frame-core.ts` that returns the motif's parts as polygons around the origin.
2. Add its name to the `MOTIFS` list.

The UI and MCP pick it up automatically.
