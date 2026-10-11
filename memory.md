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
| 1 | Test harness: `npm test` with `node:test` | in review — PR #11 (`feature/1-test-harness`) |
| 10 | CI: GitHub Actions runs typecheck + `npm test` on every PR | planning — blocked on #1 |
| 2 | Core: region cleanup + SVG writer | planning |
| 3 | Core: DXF R12 writer | planning |
| 4 | Kerf compensation + thin-feature warnings | planning |
| 5 | API + MCP: `/api/export format=svg\|dxf` | planning |
| 6 | UI: laser / CNC export buttons | planning |

## Done

- **2026-10-11** — PR #9 merged: adopted PLAN.md planning workflow.

---

## Decisions Log (append-only)

- **2026-10-11** — Tests use `node:test` + `node:assert` with Node's native type stripping. No test framework dependency.
- **2026-10-11** — `npm test` script is `node --test "test/**/*.test.ts"`. `node --test test/` fails on Node 24 (it resolves a directory as a module path).
- **2026-10-11** — CI (#10) runs only after #1 lands, rather than using `npm test --if-present`, so CI never passes while running zero tests.

## Open Questions / Blockers

- #10 is blocked until #11 (#1) merges.
