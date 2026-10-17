# D grounding integration contract

Feature 27 (`sourceGrounding`) and feature 28 (`specGrounding`) are independent,
default-off semantic checks. The caller passes already-resolved configuration to
`runGrounding`; this module deliberately does not own project/local precedence.

- Source grounding applies after `domain-design` and compares design claims with
  configured source roots.
- Spec grounding applies after `domain-design`, and per construction unit after
  `functional-design` and `code-generation`, comparing artifacts with configured
  specification roots.
- Both workers are read-only and limited to `Read`, `Grep`, and `Glob`. Results are
  returned to the official stage lead as structured findings; this module writes no
  artifacts, review receipts, workflow state, or approval records.
- `grounding-unavailable` is required where evidence cannot be verified. A grounding
  result is evidence for the lead and human, never evidence of approval.
- An empty result is NOT-READY. Every `confirmed` or `refuted` finding must cite at
  least one existing file inside the configured evidence roots; a model assertion
  without bounded evidence cannot make a stage READY.
- When disabled, the result is `disabled` before path resolution or worker dispatch:
  no model call, document, review, or receipt is produced.

## Roots, snapshot, and fail-closed evidence

- Enabled with no valid roots (none configured, missing, outside the project, a
  symlink, or reached through a symlinked ancestor) returns `off-no-valid-roots`:
  `verdict: "NOT-READY"`, `compliance: "not-claimed"`, `workerCalls: 0`, with every
  rejected root and its reason. One invalid root invalidates the lane; partial
  coverage is never reported as grounded.
- `grounding.ts` owns one deterministic snapshot of the stage artifacts and every
  file under the roots: any symlink or special file, more than 200 evidence files,
  or more than 1,000,000 bytes in total fails closed before any model call. Each
  entry carries its canonical path, SHA-256, and size. The production worker
  (`grounding-runtime.ts`) renders only that snapshot and refuses a file whose
  bytes no longer match its hash.
- A cited path must resolve, without any symlink component, to a regular file in
  the snapshot. Missing, traversing (`..`, absolute, NUL), out-of-root, or
  symlinked citations fail closed.
- After the worker returns, cited evidence and stage artifacts are re-hashed; a
  change during the run fails closed as stale. A `grounding-findings` result
  records `citedEvidence` and `artifacts` (path, SHA-256, bytes) plus read-only git
  provenance (`git.head`, `uncommittedCitedPaths`). `compliance` is `grounded`
  only when the verdict is READY.
- The installed entry `d-feature-checks.ts` records any such failure as
  `grounding-failed` (NOT-READY, `compliance: "not-claimed"`, exit 2) in the
  evidence JSON instead of crashing without evidence.
- Before the official reviewer relies on persisted evidence, run
  `bun d-feature-checks.ts --project-dir <abs> --recheck-evidence <evidence.json>`.
  It re-hashes every cited file and artifact (read-only) and exits 2 with
  `hash-changed`, `missing`, or `not-regular-file` per stale path; a later commit
  that changes a cited file is stale, while a mtime-only touch is not (the content
  hash is the authority; a moved HEAD is reported as `headMoved` provenance only).
  OFF or failed lanes have no citation and are never `fresh`.
- Real brownfield checkouts usually need narrowly scoped roots: a read-only plan
  against the reference KDDI repository failed closed on `core/tools`,
  `harness/kddi/tools`, `docs/reference` (bytes), and `.`/`node_modules` (file
  count) within 1-16 ms each (`evidence/grounding-brownfield/`).

The official host remains responsible for deciding whether and where to persist the
findings and for every normal engine transition. Grounding must run after the stage
body and before the existing official reviewer/approval protocol; it does not replace
either protocol.
