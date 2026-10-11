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
| 10 | CI: GitHub Actions runs typecheck + `npm test` on every PR | in review (`chore/10-ci-workflow`) |
| 2 | Core: region cleanup + SVG writer | planning |
| 3 | Core: DXF R12 writer | planning |
| 4 | Kerf compensation + thin-feature warnings | planning |
| 5 | API + MCP: `/api/export format=svg\|dxf` | planning |
| 6 | UI: laser / CNC export buttons | planning |

## Done

- **2026-10-11** — PR #9 merged: adopted PLAN.md planning workflow.
- **2026-10-11** — PR #11 merged (closes #1): `npm test` with `node:test`, 22 core tests.

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
- **2026-10-11** — Repo Actions settings (applied via `gh api`, then read back to confirm):
  - Default `GITHUB_TOKEN` is `read` and can't approve PRs. This was already the case.
  - `allowed_actions: selected`: GitHub-owned actions plus `step-security/harden-runner@*`. Not `verified_allowed`. A new third-party action has to be added to this allowlist first.
  - `sha_pinning_required: true`.
  - Fork PR runs need approval for all external contributors.

## Open Questions / Blockers

- The egress allowlist hasn't been run on GitHub yet. Check the first PR run's Harden-Runner insights for blocked calls and adjust the list.
- After #10 merges: optionally make `CI / Typecheck + tests` a required status check (manual, in repo settings).
- Dependabot for `github-actions`, to keep the pinned SHAs current: candidate `chore` issue.
