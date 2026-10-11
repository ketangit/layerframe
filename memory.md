# Memory — LayerFrame Studio

> Project status, decisions and blockers. Read on session start; update in place as work progresses. Keep entries terse.

**Last updated:** 2026-10-11

---

## Status

- **Project:** in-progress
- **Current epic:** #7 — 2D layer export for laser / CNC (SVG + DXF)
- **Workflow:** PLAN.md (plan → one issue per step → review gate → one PR per issue, `Closes #N`)

## Issues in flight

| # | Title | Status |
|---|-------|--------|
| 4 | Kerf compensation + thin-feature warnings | in progress (`feature/4-kerf-warnings`) |
| 5 | API + MCP: `/api/export format=svg\|dxf` | planning |
| 6 | UI: laser / CNC export buttons | planning |

## Done

- **2026-10-11** — PR #9 merged: adopted PLAN.md planning workflow.
- **2026-10-11** — PR #11 merged (closes #1): `npm test` with `node:test`, 22 core tests.
- **2026-10-11** — PR #12 merged (closes #10): hardened CI, green.
- **2026-10-11** — PR #13 merged (closes #2): `cleanRegions` + SVG writer. GitHub hadn't synced the PR head yet, so the merge used `dc843b3` and left out the stroke-mode commit `03b1e64`. That commit is being re-landed in a follow-up PR.
- **2026-10-11** — PR #14 merged: re-landed the `'cut'` stroke mode (`18216b2`). It was the first PR under the required check. Afterward, auto-delete of head branches was turned on and all merged local and remote branches were deleted.
- **2026-10-11** — PR #15 merged (closes #3): DXF R12 writer (`4dc6232`).

---

## Decisions Log (append-only)

- **2026-10-11** — Tests use `node:test` + `node:assert` with Node's native type stripping. No test framework dependency.
- **2026-10-11** — `npm test` script is `node --test "test/**/*.test.ts"`. `node --test test/` fails on Node 24 (it resolves a directory as a module path).
- **2026-10-11** — CI (#10) runs only after #1 lands, rather than using `npm test --if-present`, so CI never passes while running zero tests.
- **2026-10-11** — CI: one `ubuntu-latest` job on `pull_request`, Node from `.nvmrc`, `actions/checkout` v7.0.1 + `actions/setup-node` v7.1.0. No build step or OS matrix for now.
- **2026-10-11** — Third-party actions are pinned to full-length commit SHAs with a `# vX.Y.Z` comment, never to tags. Bump them deliberately.
- **2026-10-11** — CI hardening:
  - `pull_request` only, never `pull_request_target` or `workflow_run`.
  - No `github.event.*` in `run:`.
  - Top-level `permissions: {}`, job-level `contents: read`.
  - `persist-credentials: false`.
  - `npm ci --ignore-scripts`. The only install script is `fsevents`, which is macOS-only.
  - 10-minute timeout.
  - Lint with `uvx zizmor --persona=pedantic` and actionlint.
- **2026-10-11** — Harden-Runner v2.22.1 (StepSecurity Community tier, free for public repos on GitHub-hosted Linux runners) runs with `egress-policy: block`, an endpoint allowlist and sudo/containers disabled. Telemetry stays on so the insights page works.
- **2026-10-11** — Egress allowlist verified on PR #12 run 38111853482: Node 24.17.0 download, `npm ci` and the npm cache save all succeeded with block on, and nothing was blocked.
- **2026-10-11** — Repo Actions settings (applied via `gh api`, then read back to confirm):
  - Default `GITHUB_TOKEN` is `read` and can't approve PRs. This was already the case.
  - `allowed_actions: selected`: GitHub-owned actions plus `step-security/harden-runner@*`. Not `verified_allowed`. A new third-party action has to be added to this allowlist first.
  - `sha_pinning_required: true`.
  - Fork PR runs need approval for all external contributors.
- **2026-10-11** — `main` branch protection now requires `Typecheck + tests` with strict (up to date), plus the existing signed commits, linear history, admins enforced and conversation resolution. Ketan applied it with a full protection PUT (the Claude Code classifier blocked it for Claude). Read back afterward: signatures still on.
- **2026-10-11** — #2: `cleanRegions` uses Clipper `CleanPolygon` (tol 0.01 mm) and drops rings under 0.01 mm². Across all templates × arc it removes 4.4% of points and 2 of 5,630 rings, and changes any layer's area by at most 0.028%. Cleaning applies to 2D export only; 3MF keeps the raw regions. Colors and layer names are XML-escaped in the SVG.
- **2026-10-11** — SVG stroke modes:
  - `'cut'` (default): a fixed 12-color high-contrast palette, one color per layer index. 12 is the maximum layer count. Laser software like LightBurn assigns cut layers by stroke color, and filament colors repeat across layers (the default palette reuses 2), so stroking by filament color would merge layers.
  - `'filament'`: strokes in the layer's filament color, for previews that match the print.
  - In both modes the layer label carries the filament color.
  - The hairline stays 0.01 mm, so it looks faint in Inkscape's normal view. Use Outline view to inspect it.
- **2026-10-11** — #3 DXF writer:
  - R12 (AC1009), hand-written, CRLF line endings.
  - `HEADER` (`$ACADVER`, `$INSUNITS 4`, `$EXTMIN`/`$EXTMAX`), `TABLES` (`LTYPE CONTINUOUS` plus a `LAYER` table with `0` and one layer per frame layer), `ENTITIES` (closed `POLYLINE`/`VERTEX`/`SEQEND` only).
  - Y up, with the bbox minimum at (0, 0). The SVG flips Y; DXF doesn't need to.
  - `CUT_ACI` is the DXF counterpart of `CUT_COLORS`, because R12 has no true color.
  - Layer names are sanitized to `[A-Za-z0-9_-]`, max 31 characters.
  - Verified: `uvx ezdxf audit` reports no errors on 16 sample files. An `ezdxf` read gives units 4 (mm), all polylines closed, and extents of 141.600 × 243.200 mm. Inkscape 1.3.2 imports it at the right mm size with one color per layer.
  - LibreCAD isn't installed, so it hasn't been checked.
- **2026-10-11** — #4 kerf:
  - Kerf is applied in `prepareExport(model, ClipperLib, { kerf, tol })`, not as a writer option as the issue said. Kerf needs Clipper and changes the bbox, and the writers have neither. The writers stay pure formatting.
  - Steps: clean, then `ops.offset(+kerf/2, round)`, `toRegions`, clean again, then recompute bbox/out_w/out_h.
  - kerf 0 keeps `model.derived`, so the output is byte-identical (tested).
  - kerf range 0–1 mm; anything else throws a `RangeError`.
- **2026-10-11** — #4 warnings: `exportWarnings(model, kerf)` uses the design params, as specified: rims on the motif and lace layers, `lace_w` on the lace layer. It flags any width ≤ 2 × kerf and skips features set to 0.
  - The daisy "lens" shapes turned out to be **holes** (432 on the default L6 lace, all narrower than 0.2 mm), not islands. No template has vanishing islands.
  - Kerf ≥ 0.1 closes all 432 (lace holes go from 686 to 254), the same as on the machine, so they aren't warned about.
  - At kerf 0 they stay. A possible geometry fix is to drop sub-kerf lace slivers in `buildLayers`.
- **2026-10-11** — Sample-SVG review in Inkscape 1.3.2 found tiny lens-shaped islands in the daisy lace, where neighboring petal outlines overlap (about 0.5 mm). These are for #4's thin-feature warnings.

## Open Questions / Blockers

- Dependabot for `github-actions`, to keep the pinned SHAs current: candidate `chore` issue.
