---
name: pr-lens-review
description: Produce a local PR Lens diagram and evidence-backed supplemental review after application implementation and tests exist, only when the D switch features.prLensReview is ON.
user-invocable: false
---

# PR Lens assisted application review (supplemental)

Use only after `bun {{HARNESS_DIR}}/tools/d-acceleration/pr-lens-gate.ts` returned `"status":"ready"`, and only after application code and test evidence exist. This comprehension aid never replaces AI-DLC reviewers, sensors, approval gates, or test verdicts, and never decides a gate. Every command below re-checks the switch and the pinned install: OFF prints `skipped-by-config` and does nothing; a missing or mismatched install exits 2 with a one-line next step.

1. Resolve the approved comparison base from the active Intent. Run `bun {{HARNESS_DIR}}/tools/pr-lens-review.ts prepare --base <sha>`. If no application diff exists, record `no-app-diff` / review unavailable and do not claim success. `{{HARNESS_DIR}}/`, `.agents/`, `.vendor/`, `.pr-lens/`, and all `aidlc/` paths are excluded from the application diff. AI-DLC intent artifacts are supporting specification/test evidence only; never diagram them as implementation.
2. Read the pinned `.vendor/pr-lens/packages/agent-skill/manual.md`, `.vendor/pr-lens/packages/agent-skill/references/graph-document.md`, and `.vendor/pr-lens/packages/agent-skill/references/example.graph.json`. Author `.pr-lens/graph.json` from the prepared context and the affected source. Binary inputs are hash/metadata-only and need separate safe inspection. Do not use `analyze`, `comment`, `canvas`, `auth`, API keys, or any publication.
3. Run `bun {{HARNESS_DIR}}/tools/pr-lens-review.ts validate-render`. It runs only the pinned CLI's local `validate` and `render` (light theme, output under `.pr-lens/render/`). Treat any failure or diagram/source disagreement as an explicit limitation.
4. Write `<record>/construction/build-and-test/pr-lens-review.md` with `## Scope and provenance`, `## Findings`, `## Diagram cross-check`, and `## Tests and limits`. Findings need severity, source path/line, evidence, fix, and fact/inference labelling.
5. Write the adjacent `pr-lens-review.json` with schema 1; the pinned SHA; the context path/hash and prepared worktree hash; the exact reviewed paths; the graph path/hash; the render manifest path/hash; at least one existing test-evidence path/hash; and `semanticCrossCheck: {"performedBy":"ai-reviewer","disclaimer":"semantic source/requirements/test comparison is an AI judgment, not a machine guarantee"}`. Prepare/verify snapshots include supporting AI-DLC evidence but deliberately exclude the mutable `pr-lens-review.md` and `pr-lens-review.json` themselves, so writing the review cannot invalidate its own input snapshot.
6. Cross-check graph elements against source/requirements and claims against executed tests. Mechanical checks prove schema, provenance, and file integrity only, not semantic review quality.
7. Run `bun {{HARNESS_DIR}}/tools/pr-lens-review.ts verify-report --context .pr-lens/review-context.json --report <record>/construction/build-and-test/pr-lens-review.md --metadata <record>/construction/build-and-test/pr-lens-review.json`.

Pinned dependency: `coldteadotai/pr-lens@7a9115c8202da4db030be5954ada8862e6135dce`, MIT (`.vendor/pr-lens/LICENSE`). Local validate/render only.
