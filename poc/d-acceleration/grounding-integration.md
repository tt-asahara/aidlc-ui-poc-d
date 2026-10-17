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
  file under the roots: any symlink or special file, more evidence files than
  `maxEvidenceFiles`, or more total bytes than `maxInputBytes` fails closed before
  any model call. Each entry carries its canonical path, SHA-256, and size. The
  production worker (`grounding-runtime.ts`) renders only that snapshot and
  refuses a file whose bytes no longer match its hash. It passes fixed argv
  (`-p --allowedTools "" --permission-mode dontAsk`) and sends the prompt with the
  whole snapshot on stdin, because a snapshot near the byte cap overflows argv
  (macOS `ARG_MAX` is 1 MiB; Linux caps one argument at 128 KiB).

## Snapshot caps (`featureInputs.groundingLimits`)

The caps apply per lane and are configurable in `.claude/d-acceleration.jsonc`,
with `.claude/d-acceleration.local.jsonc` overriding field by field
(`d-config.ts` owns the precedence; `grounding.ts` owns the single validity rule,
`groundingLimitError`).

| Key | Default (unset) | Allowed |
| --- | --- | --- |
| `maxEvidenceFiles` | 200 | integer 1..5000 |
| `maxInputBytes` (stage artifacts + evidence) | 1,000,000 | integer 1..4,000,000 |

- Invalid values (zero, negative, fractional, string, unknown key) and values above
  the ceiling are never clamped: the D entry exits 2 with one line naming the key
  and the allowed range, for example
  `D configuration invalid: invalid featureInputs.groundingLimits.maxInputBytes: 20000000 (allowed: integer 1..4000000) in <path>`.
  `run.ts --preflight` fails the same way.
- Why these ceilings: the hashed snapshot is embedded in a single worker prompt, so
  bytes bound prompt size and cost. 4,000,000 bytes is roughly the 1,000,000-token
  context window of the largest worker model at about 4 bytes per token; a larger
  snapshot cannot fit one prompt and would only fail after spending the call. 5,000
  files bounds the deterministic walk and hash time (about 0.2 s for 5,000 files of
  reference repo B) and the per-file prompt headers well inside that byte budget.
  Raising a cap raises the cost of every grounded stage; narrow roots first.
- A cap breach records `grounding-failed` whose error names the key and ceiling,
  e.g. `grounding evidence exceeds 200 files (featureInputs.groundingLimits.maxEvidenceFiles; ceiling 5000)`.
- The effective caps are recorded as `limits` on every lane result in the evidence
  JSON (`grounding-findings`, `grounding-failed`, `off-no-valid-roots`) and shown
  under `optional.featureInputs.groundingLimits` in `run.ts --preflight`.
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
  count) within 1-16 ms each under the default caps (`evidence/grounding-brownfield/`).
  With raised caps (1,000 files / 2,000,000 bytes) `harness/kddi/tools` (32 files,
  1.16 MB) and `docs/reference` (49 files, 1.64 MB) plan successfully; `core/tools`
  still exceeds even the 4,000,000-byte ceiling and `.`/`node_modules` exceed 5,000
  files, so they need narrower roots (`evidence/grounding-caps/`, no worker calls).

The official host remains responsible for deciding whether and where to persist the
findings and for every normal engine transition. Grounding must run after the stage
body and before the existing official reviewer/approval protocol; it does not replace
either protocol.
