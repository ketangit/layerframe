---
name: Feature step
about: One incremental, PR-sized step of a planned feature (see PLAN.md)
labels: feature
---

## Goal
What this specific step achieves, and which epic it belongs to (`Part of #N`).

## Technical approach
- Modules/files to touch:
- Libraries used (justify any new dependency):
- Geometry/export risks (unprintable geometry, broken cut paths) and how they're handled:

## Acceptance criteria
- [ ] Verifiable condition (e.g. "every SVG path is closed; no segment shorter than 0.01 mm")
- [ ] `npm run typecheck` and `npm test` pass
- [ ] README / CLAUDE.md updated if behaviour, API or MCP tools changed

## Out of scope
What this step deliberately does not do.
