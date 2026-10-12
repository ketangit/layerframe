# LayerFrame

A browser-only web app (live at https://layerframe.craftedbyk.com) that generates parametric multi-layer colour picture frames for Bambu Lab AMS printing. Each Z layer is one filament: a base, stepped terraces, a solid motif layer and a lace-outline top layer. It designs **one frame at a time**. It's an independent, LayerStudio-style implementation and must not copy LayerStudio code or artwork.

## Planning workflow (new features)

`PLAN.md` holds the product direction and the mandatory workflow. Read it before planning a feature.

`memory.md` tracks status, open issues, decisions and blockers. Read it on session start, and update it whenever an issue or PR changes state.

1. **Plan first.** Write an incremental plan in which each step is the smallest PR that still makes sense on its own.
2. **Draft one GitHub issue per step** with Goal, Technical approach, Acceptance criteria and Out of scope (see `.github/ISSUE_TEMPLATE/feature.md`). Use the repo labels: `epic`, `feature`, `geometry`, `export`, `ui`, `api-mcp`, `testing`, `chore`.
3. **STOP for review.** Create the issues with `gh issue create` only after Ketan approves the plan. Write no code until he says go.
4. **Implement one issue at a time.**
   - Branch: `feature/<issue#>-<slug>` off `main`.
   - Pass every Testing step below.
   - Open a PR into `main` with `gh pr create`, with `Closes #N` in the body.

Notes:
- PLAN.md's libraries (`@jscad/modeling`, Maker.js, three-mesh-bvh, Clipper2) are candidates, not mandates. Add a dependency only when an issue needs it, and justify it in that issue.
- PLAN.md says "LayerStudio", but this project is still **LayerFrame**, an independent implementation. The no-copy rule above still applies.

## Commands (Windows Terminal / PowerShell)

```powershell
npm install                 # once; node >= 24.17.0 (see .nvmrc)
npm start                   # Vite dev server (HMR) at http://localhost:5317 (127.0.0.1, strictPort)
npm run typecheck           # tsc (TypeScript 7), no emit
npm test                    # node:test (test/*.test.ts)
npm run build               # typecheck + vite build -> static dist/
npm run serve               # vite preview of dist/ at http://localhost:5317
npm run mcp                 # MCP stdio server + WebSocket bridge on ws://127.0.0.1:5318
```

There is no server: the browser tab owns the state (`localStorage`) and generates every export. To stop Vite, press `Ctrl+C` in its terminal.

Vite serves and bundles the UI. Edits to `src/ui/` and `src/core/` hot-reload. Node runs `mcp/server.ts` and the tests directly through native type stripping. Vite and Node only strip types and never type-check, so run `npm run typecheck` before handing back a change.

## Layout

```
mcp/server.ts             MCP stdio server; forwards tool calls over a 127.0.0.1 WebSocket bridge to the open tab
src/core/frame-core.ts    GEOMETRY CORE — types, schema, defaults, templates, motifs, placements, layers, state
src/core/mesh.ts          extrusion (three.js), binary STL + 3MF writers
src/core/vector.ts        2D export: prepareExport (clean + kerf), exportWarnings, SVG / DXF R12 writers, export2DFor
src/core/store.ts         client state store: localStorage (guarded, in-memory fallback), patch/replace/reset/template, design JSON
src/core/bridge.ts        MCP bridge protocol, Origin allowlist, handleCall (the tool implementations, run in the tab)
src/ui/index.html         UI shell; Vite root
src/ui/styles.css         CSS variables; light + dark via prefers-color-scheme (imported from app.ts)
src/ui/app.ts             three.js viewer, parameter panel, template gallery, store wiring, MCP bridge client
src/ui/thumb.ts           top-view SVG of a built frame (template thumbnails)
vercel.json               static Vercel config: build -> dist/, Git deploys off, security headers (CSP)
.github/workflows/ci.yml  PR check: npm ci, typecheck, npm test
.github/workflows/deploy.yml  Vercel CLI deploy: PR -> preview, main -> production
.github/vercel-cli/       pinned Vercel CLI (own package.json + lockfile) for deploy.yml
test/core.test.ts         core: templates x arc, applyPatch, migrate, colour validation
test/vector.test.ts       2D export: SVG + DXF structure
test/store.test.ts        store: persistence, blocked storage, migration, templates, design JSON, subscribe
test/bridge.test.ts       handleCall for every tool + mcp/server.ts Origin allowlist and busy-port takeover (spawns it)
vite.config.ts            root src/ui, outDir dist/, dev + preview on 127.0.0.1:5317
tsconfig.json             strict, noEmit, allowImportingTsExtensions, erasableSyntaxOnly
exports/, dist/, .vercel/     MCP exports / build output / Vercel CLI link (gitignored)
```

## How it works

- **State** is `{ version: 3, params: {...}, view: { exploded, explode_gap } }`, owned by the tab via `createStore()` (`store.ts`) and saved to `localStorage` under `layerframe.state`.
  - `migrate()` converts older multi-frame states (`shared`/`frames`/`active`).
  - `applyPatch()` deep-merges a patch: arrays are replaced and `null` deletes a key.
- **The pipeline** is `buildLayers(params, ClipperLib)` in `frame-core.ts`:
  1. Normalize the params against `SCHEMA`.
  2. Compute motif placements.
  3. Build the outline and the openings.
  4. Produce per-layer 2D regions as Clipper polygons with holes.

  `mesh.ts` then extrudes each layer to a height of `layer_h`.
- **Shared code:** everything in `src/core/` runs in both the browser and Node (tests, MCP). Keep them free of DOM, `window` and `fs`. ClipperLib and JSZip are passed in as arguments; both sides get them with `import X from 'clipper-lib'` / `'jszip'`. `build3MF` returns a `Uint8Array` in both runtimes.
- **Clipper scale:** Clipper works in integers at a scale of `S = 1000`. Always convert with `toC()`, and divide by `S` when reading results back.
- **Coordinates:** units are mm. X is the width, centred on 0. Y runs up the frame, with the bottom edge at 0. Z is the layer stack.
- **Sync:** every UI change goes through the store (`store.patch(..., source)`); subscribers rebuild the view. Other tabs follow via the `storage` event.
- **MCP bridge:** `mcp/server.ts` listens on `127.0.0.1:5318` and accepts only allowlisted Origins (`BRIDGE_ORIGINS` in `bridge.ts`). The tab connects when the user clicks the MCP badge (opt-in, remembered), runs each call with `handleCall()` and returns the result; exports come back base64 and the MCP server writes `./exports`. One tab at a time (newest wins). If the port is busy (another copy, e.g. `npm run mcp`), the server retries every 2 s and tool calls say so.
- **Untrusted input:** designs arrive from files and MCP. `normalize()` clamps numbers, checks enums and forces colours to `#rrggbb`. Never put an unvalidated state string into `innerHTML`.

## Extending

- **New parameter:** add it to the `Params` interface, `SCHEMA` and `DEFAULTS` in `frame-core.ts` (tsc flags any that are missing). The UI renders it automatically from the schema (types: `number`, `int`, `bool`, `enum`, `list`, `colors`; group `hidden` keeps it out of the panel), and MCP picks it up too.
- **New motif:** add a function to `MOTIF_LIBRARY` that returns polygons (`[[x, y], …]`) around the origin, about `d` mm across. Then add its name to `MOTIFS` (the `MotifName` type and `MOTIF_LIBRARY`'s `Record` type keep the two in sync). Each part gets its own lace outline on the top layer.
- **New template:** add an entry to `TEMPLATES` (`note` plus `params`). Templates must never set `in_w` or `in_h`, because applying a template keeps the user's opening size. The `Template` type enforces this.
- **New layout:** add a branch in `placements()`. Walk the border with `samplePath(framePath(p, inset), pitch)` so the pattern automatically follows the arched top.
- **New MCP tool:** add the method to `METHODS` and `handleCall()` in `bridge.ts` (with a test in `test/bridge.test.ts`), then register the tool in `mcp/server.ts` with `call('<method>', args)`.
- **Bridge origins / CSP:** a new page origin must be added to `BRIDGE_ORIGINS`; the bridge port is also in `vercel.json`'s CSP `connect-src`.

## Geometry rules to preserve

- The frame is defined by its **inner opening** (`in_w` × `in_h`) plus `border` on every side.
- **Arched top** (`arc`): the opening gets a half-disc exactly as wide as the opening, centred at `(0, H - border)`, and the frame top becomes a half-ring one border wide. Terraces, rims and patterns must follow the arch.
- **Terraces:** each one widens the opening by `step_w` per side. Layers at or above `base_layers` use the top terrace opening.
- **Pattern layers:** there are always 2 (`PATTERN_LAYERS`): first the solid motifs plus the rims, then the lace outlines plus the rims. With `layout: 'none'` there are no pattern layers.
- **Garden and corner accent motifs** use `clip: false`, which means they may grow the outline.
- **Printer bed:** don't limit sizes to any bed size. The user wants frames bigger than the X1C's 256 mm bed.

## Testing

Tests use `node:test` + `node:assert` (no framework dependency) and live in `test/*.test.ts`. CI (`.github/workflows/ci.yml`) runs `npm ci --ignore-scripts`, `npm run typecheck` and `npm test` on every PR, under Harden-Runner with blocked egress. Read the security notes at the top of that file before you edit it, and lint it with `uvx zizmor --persona=pedantic .github/workflows/ci.yml`. Before handing back a change:

1. Run `npm run typecheck`.
2. Run `npm test`. `test/core.test.ts` builds every template with `arc` both on and off and asserts that the layer count is right, no layer is empty, and `out_w`/`out_h` exceed the opening. It also covers `applyPatch` and `migrate`. When you add a template, it's covered automatically. Add cases for new core behavior.
3. Check MCP end to end: `npm start`, `npm run mcp` (or your MCP client), click the badge, then call a few tools (`set_params`, `export` 3mf / stl `layer: 0` / svg `split`) and confirm the tab updates and the files land in `./exports`.
4. Run `npm run build` and `npm run serve`, open the UI, click through the templates, size presets, exports and Save / Open design, and confirm the browser console shows no errors and the network panel shows no requests beyond the page's own assets.
   - The design lives in that browser's `localStorage`. Save it with **Save design** before a test click-through if you care about it, and reopen it afterward.
5. Lint any workflow change with `uvx zizmor --persona=pedantic .github/workflows/`.

## Conventions

- Strict TypeScript, ES modules, 2-space indent, single quotes, no framework.
- Node-runnable TS only: relative imports use the `.ts` extension, `import type` for type-only imports, and no enums, namespaces or parameter properties (`erasableSyntaxOnly`).
- Tooling is `typescript` + `vite` only. Keep the runtime dependencies to `three`, `clipper-lib` and `jszip` (plus the MCP SDK, `zod` and `ws` for `mcp/`). Pin `@types/three` to the same minor as `three`.
- Geometry functions stay pure: params in, polygons out.
- When you change behaviour, update `README.md` too: its templates table, MCP tool list and run / deploy notes.
