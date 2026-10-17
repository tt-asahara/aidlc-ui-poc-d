# Read-only speculative cross-stage analysis

Tracks #5 and the "Not implemented: cross-stage/task parallelism" section of #6.
Runtime: `cross-stage-speculation.ts`. Tests:
`tests/cross-stage-speculation.test.ts`. Evidence:
`evidence/cross-stage-parallel/`.

## What it does

While official stage **U** waits at its human gate, D may run independent
read-only analysis tasks for a later stage **S** (for example feasibility
pre-research while Market Research waits for approval). These tasks produce
D-private draft notes only. When the engine later issues S, the official stage
can read the drafts as evidence input. It still writes its own artifacts and
goes through its own review, sensors, and gate.

The official graph, directives, state, and approval contract are unchanged.
`stage-policy.json` keeps `crossStageParallelism: false`, because no two
official stages ever run at once. Only D-private read-only notes overlap a gate.

## Lifecycle

1. **Admission (deterministic).** `runSpeculation` resolves `parallel.enabled`
   once at entry. If it is `false`, the call returns `speculation-disabled`
   right away. It does not call `next`, write a file, or start a worker.
   Otherwise one fresh `orchestrate next` must return `present-gate` for U, and
   the Intent's Stage Progress must show U as `[?]` awaiting approval. Each task
   is admitted only if all of the following hold:
   - S is `implemented-read-only-fanout` in `stage-policy.json`, is not U, and
     is still `[ ]` pending.
   - Every `requires_stage` upstream of S other than U is completed or skipped.
   - Every input is a regular, non-symlink, project-relative file of at most
     192 KiB (512 KiB in total). Inputs inside the Intent must sit in a
     *settled* stage's record directory. Inputs in U's record directory are
     refused as `dependent-on-gated-stage`. Workflow state, engine-private
     files, and other `aidlc/` paths are refused.

   A refused task is listed under `deferred` and is never speculated. It runs
   later through the serial fallback.
2. **Input binding.** Each admitted task is bound to a Merkle root over:
   - every input file
   - the target stage file
   - the agent persona file
   - every file in the space memory layer (`aidlc/spaces/<space>/memory/**`,
     with an `absent` leaf when the layer is missing)
   - the canonical task contract: objective, inputs, tier, effort, and
     requested model

   Leaves are domain-separated, `sha256(role, path, content-hash)`, and sorted
   by `(role, path)`. Duplicate leaves are rejected. The root is the
   speculation's identity.
3. **Execution.** The worker is a no-tool Claude launch: `--tools ""` plus
   restricted mode, strict empty MCP config, no session persistence, no slash
   commands, and no permission prompts. File, shell, web, and agent tools are
   all disallowed. The prompt carries the persona and the exact hashed input
   bytes, so the hashes cover everything the worker sees. It cannot read or
   write anything else. The stage policy chooses the tier and effort; the
   caller supplies the model request. At most `maxParallel` workers run at once
   (default 3, maximum 4).
4. **Pre-land revalidation.** When a worker returns, the root is recomputed. A
   mismatch discards the result (`input-merkle-mismatch-at-land`). Otherwise
   the draft is written atomically (temporary file, `fsync`, rename) under
   `aidlc/.aidlc-engine/d-speculation/<space>/<intent>/<S>/<task>.draft.json`.
   After that, the existing `resume-ledger.ts` records success with the draft's
   SHA-256. The ledger's directive fingerprint is
   `{schema, intent, targetStage, task, merkleRoot}`.
5. **Consumption.** `consumeSpeculativeDrafts` calls a fresh `orchestrate next`.
   It returns `not-consumable` unless all of these hold:
   - The fresh directive is `run-stage` for S.
   - Every `requires_stage` upstream of S is completed or skipped, so its
     approval, review, and sensor receipts are already settled by the official
     host.
   - The draft's ledger fingerprint matches the recomputed root.
   - The draft bytes match the recorded hash.

   A draft that fails any check is deleted and its task moves to
   `serialFallback`. A valid draft is returned for lead integration with the
   flags `draftIsEvidenceInputOnly: true` and
   `officialStageWritesItsOwnArtifact: true`.
6. **Stable serial fallback.** `runSerialFallback` runs deferred, discarded,
   failed, and OFF-mode tasks one at a time, and only inside a fresh official
   `run-stage` for S. This is the same work an OFF run does, so ON and OFF reach
   the same end state; ON only moves independent work earlier.

## Guarantees and their tests

| Requirement | Mechanism | Test |
| --- | --- | --- |
| Immutable input hashing | Merkle root over inputs, stage file, persona, memory, and task contract | `Merkle input binding` |
| Invalidation on any input change | Root is recomputed at resume, at land, and at consumption | `any input change invalidates…`, `pre-land revalidation` |
| Discard on mismatch | Ledger and draft are deleted, and the task moves to `serialFallback` | same |
| No human-gate bypass | Only `next` is ever invoked. No state, audit, or approval write. Intent tree bytes are unchanged. | `speculation is read-only…` |
| Consumption only after a fresh directive and settled upstream | `run-stage` for S plus completed/skipped `requires_stage` | `drafts are consumable only after…` |
| Crash-safe resume | Atomic draft write, then resume-ledger record. A draft without a ledger entry, a missing draft, or a draft with a hash mismatch is discarded and re-run. | `crash-safe resume…` |
| `parallel.enabled=false` means zero speculative work | Early return with no engine call and no D-private state. Consumption ignores existing drafts. | `OFF performs no engine call…` |
| Overlap only for independent tasks | Timing: independent tasks overlap each other and the open gate. The dependent task starts after approval and overlaps nothing. | `timing evidence` ON |
| Zero overlap when OFF | Timing: nothing starts before approval, and maximum concurrency is 1 | `timing evidence` OFF |

`D_SPECULATION_EVIDENCE_DIR=<dir> bun test
poc/d-acceleration/tests/cross-stage-speculation.test.ts` writes the timing
timelines. The committed copies are `evidence/cross-stage-parallel/timing-parallel-{on,off}.json`.
`evidence/cross-stage-parallel/real-model-run-haiku.json` records one real
no-tool Claude run (requested `haiku`) against a synthetic fixture whose fake
engine emits `present-gate`. In that run the two independent tasks ran
concurrently (maximum concurrency 2), the dependent task was deferred, and
after simulated approval both drafts were consumed. The runtime-reported model
was not extracted (`null`), because the shared `worker-adapters.ts` does not
parse it from Claude JSON yet. That gap belongs to the model-routing work.

## Configuration semantics

`parallel.enabled` is read once per `runSpeculation` call; that call is the
snapshot. Changing the file during a call does not affect that call. If the
switch is `false` at consumption time, existing drafts are ignored (not
deleted), so an OFF run behaves exactly like serial. No new config key exists.
Speculation is invoked explicitly by the host and is never automatic.

## Out of scope, and why

- **True concurrent official stages.** Examples: running `market-research` and
  `feasibility` as two live official stages, or approving them as one wave.
  `feasibility` has a hard `requires_stage: market-research` edge, and it also
  optionally consumes market outputs. Every Ideation and Inception stage has
  its own human gate, and the engine is the single state writer with one active
  stage per Intent. Concurrency here would need all of the following:
  - an official cross-stage directive and receipt
  - per-stage isolated worktrees
  - canonical output ownership
  - descendant invalidation when an upstream gate is rejected or revised
  - a single host integrator
  - semantic integration review

  All of that belongs in the core graph and authority contract, which this
  PoC must not change.
- **Writing or approving downstream official artifacts early.** Drafts never
  land in a stage record directory, and the official stage never skips its
  own work, review, sensors, or gate.
- **Speculation on outputs of the gated stage.** Work that reads U's
  unapproved outputs could be invalidated by the person's decision at U. It is
  deferred, never guessed.
- **Automatic triggering.** No hook or conductor starts speculation. A host
  must call it explicitly. Wiring it into generic-auto is a follow-up and needs
  an operational cost decision, because speculative model spend can be wasted
  when a gate is rejected.
- **Construction and Operation stages.** Only stages the policy already marks
  `implemented-read-only-fanout` are targets. Construction parallelism stays
  with the official Unit DAG and swarm contract.
- **Semantic integration review of drafts.** The official stage lead decides
  what, if anything, to adopt. A draft is evidence, not a decision.
