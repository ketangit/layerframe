# LayerFrame Studio

A local web app that generates parametric multi-layer colour picture frames for Bambu Lab AMS printing. Each Z layer is one filament: a base, stepped terraces, a solid motif layer and a lace-outline top layer. It designs **one frame at a time**. It's an independent, LayerStudio-style implementation and must not copy LayerStudio code or artwork.

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
- PLAN.md says "LayerStudio", but this project is still **LayerFrame Studio**, an independent implementation. The no-copy rule above still applies.

## Commands (Windows Terminal / PowerShell)

```powershell
npm install                 # once; node >= 24.17.0 (see .nvmrc)
npm start                   # dev: API + Vite middleware (HMR) at http://localhost:5317  (PORT env var to change)
npm run typecheck           # tsc (TypeScript 7), no emit
npm test                    # node:test core tests (test/*.test.ts)
npm run build               # typecheck + vite build -> dist/
npm run serve               # prod: API + static dist/ (node server.ts --prod)
npm run mcp                 # MCP stdio server; needs `npm start` running

# quick API checks (use curl.exe, not the PowerShell curl alias)
curl.exe -s localhost:5317/api/model
curl.exe -s -X PATCH localhost:5317/api/state -H "Content-Type: application/json" -d "{\"patch\":{\"params\":{\"in_w\":150}}}"
curl.exe -s "localhost:5317/api/export?format=3mf&save=1"     # writes .\exports\<template>.3mf
```

To stop a running server: press `Ctrl+C` in its terminal. If the port is stuck, run `Get-Process node | Stop-Process`, which stops every Node process.

Node runs the `.ts` files directly through native type stripping, so the server has no compile step. Vite serves and bundles the UI only. In dev, edits to `src/ui/` and `src/core/` hot-reload in the browser. After editing `server.ts` or the core it imports (`frame-core.ts`, `mesh.ts`), restart `npm start`. Vite and Node only strip types and never type-check, so run `npm run typecheck` before handing back a change.

## Layout

```
server.ts                 HTTP server: JSON API + SSE; mounts Vite middleware in dev, serves dist/ in prod
mcp/server.ts             MCP stdio server — thin wrapper over the HTTP API
src/core/frame-core.ts    GEOMETRY CORE — types, schema, defaults, templates, motifs, placements, layers, state
src/core/mesh.ts          extrusion (three.js), binary STL + 3MF writers
src/ui/index.html         UI shell; Vite root
src/ui/styles.css         CSS variables; light + dark via prefers-color-scheme (imported from app.ts)
src/ui/app.ts             three.js viewer, parameter panel, template gallery, live sync
src/ui/thumb.ts           top-view SVG of a built frame (template thumbnails)
test/core.test.ts         node:test suite for the core (templates x arc, applyPatch, migrate)
vite.config.ts            root src/ui, outDir dist/
tsconfig.json             strict, noEmit, allowImportingTsExtensions, erasableSyntaxOnly
state.json, exports/, dist/   runtime / build output (gitignored)
```

## How it works

- **State** is `{ version: 3, params: {...}, view: { exploded, explode_gap } }`.
  - `migrate()` converts older multi-frame states (`shared`/`frames`/`active`).
  - `applyPatch()` deep-merges a patch: arrays are replaced and `null` deletes a key.
- **The pipeline** is `buildLayers(params, ClipperLib)` in `frame-core.ts`:
  1. Normalize the params against `SCHEMA`.
  2. Compute motif placements.
  3. Build the outline and the openings.
  4. Produce per-layer 2D regions as Clipper polygons with holes.

  `mesh.ts` then extrudes each layer to a height of `layer_h`.
- **Shared code:** `frame-core.ts` and `mesh.ts` run in both the browser and Node. Keep them free of DOM, `window` and `fs`. ClipperLib and JSZip are passed in as arguments; both sides get them with `import X from 'clipper-lib'` / `'jszip'`. `build3MF` returns a `Uint8Array` in both runtimes.
- **Clipper scale:** Clipper works in integers at a scale of `S = 1000`. Always convert with `toC()`, and divide by `S` when reading results back.
- **Coordinates:** units are mm. X is the width, centred on 0. Y runs up the frame, with the bottom edge at 0. Z is the layer stack.
- **Sync:** every change (UI, API or MCP) goes through `PATCH /api/state`. The server persists `state.json` and broadcasts an SSE `state` event. The UI ignores events tagged with its own `x-source`.

## Extending

- **New parameter:** add it to the `Params` interface, `SCHEMA` and `DEFAULTS` in `frame-core.ts` (tsc flags any that are missing). The UI renders it automatically from the schema (types: `number`, `int`, `bool`, `enum`, `list`, `colors`; group `hidden` keeps it out of the panel), and the API and MCP pick it up too.
- **New motif:** add a function to `MOTIF_LIBRARY` that returns polygons (`[[x, y], …]`) around the origin, about `d` mm across. Then add its name to `MOTIFS` (the `MotifName` type and `MOTIF_LIBRARY`'s `Record` type keep the two in sync). Each part gets its own lace outline on the top layer.
- **New template:** add an entry to `TEMPLATES` (`note` plus `params`). Templates must never set `in_w` or `in_h`, because applying a template keeps the user's opening size. The `Template` type enforces this.
- **New layout:** add a branch in `placements()`. Walk the border with `samplePath(framePath(p, inset), pitch)` so the pattern automatically follows the arched top.
- **New API route:** add it in `server.ts`. Expose it in `mcp/server.ts` as a tool if an AI should be able to use it.

## Geometry rules to preserve

- The frame is defined by its **inner opening** (`in_w` × `in_h`) plus `border` on every side.
- **Arched top** (`arc`): the opening gets a half-disc exactly as wide as the opening, centred at `(0, H - border)`, and the frame top becomes a half-ring one border wide. Terraces, rims and patterns must follow the arch.
- **Terraces:** each one widens the opening by `step_w` per side. Layers at or above `base_layers` use the top terrace opening.
- **Pattern layers:** there are always 2 (`PATTERN_LAYERS`): first the solid motifs plus the rims, then the lace outlines plus the rims. With `layout: 'none'` there are no pattern layers.
- **Garden and corner accent motifs** use `clip: false`, which means they may grow the outline.
- **Printer bed:** don't limit sizes to any bed size. The user wants frames bigger than the X1C's 256 mm bed.

## Testing

Tests use `node:test` + `node:assert` (no framework dependency) and live in `test/*.test.ts`. Before handing back a change:

1. Run `npm run typecheck`.
2. Run `npm test`. `test/core.test.ts` builds every template with `arc` both on and off and asserts that the layer count is right, no layer is empty, and `out_w`/`out_h` exceed the opening. It also covers `applyPatch` and `migrate`. When you add a template, it's covered automatically. Add cases for new core behavior.
3. Check the API: `/api/model`, then `/api/export?format=3mf&save=1` and `format=stl&layer=0`.
4. Run `npm run build`, open the UI, click through the templates and size presets, and confirm the browser console shows no errors.
   - Test servers on another `PORT` still read and write the real `state.json`. Back it up before driving the UI, and restore it afterward.

## Conventions

- Strict TypeScript, ES modules, 2-space indent, single quotes, no framework.
- Node-runnable TS only: relative imports use the `.ts` extension, `import type` for type-only imports, and no enums, namespaces or parameter properties (`erasableSyntaxOnly`).
- Tooling is `typescript` + `vite` only. Keep the runtime dependencies to `three`, `clipper-lib` and `jszip` (plus the MCP SDK and `zod` for `mcp/`). Pin `@types/three` to the same minor as `three`.
- Geometry functions stay pure: params in, polygons out.
- When you change behaviour, update `README.md` too: its templates table, API table and MCP tool list.
