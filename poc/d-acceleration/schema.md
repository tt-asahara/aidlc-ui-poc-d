# Planner contract

Input is JSON with `tasks`, engine-issued `directives`, and optional
`modelCatalog`, `clef`, and `maxParallel`. Task identity is separate from its
official stage and Unit:

- `id`, `stage`, optional `unit`, `dependsOn`, `estimatedMs`
- `taskType`: `templated`, `implementation`, `review`, `design`, `security`,
  `compliance`, `approval`, or `ambiguous`
- `difficulty`: `low`, `medium`, or `high`
- `risk`: `low`, `medium`, or `high`
- `execution`: `serial`, `official-wave`, or `official-swarm`
- `writeSet`: paths or artifact IDs that the task can mutate
- `isolatedWorktree`: required for `official-swarm`

`modelCatalog` is used only by the synthetic fake worker. Claude execution
uses caller overrides when supplied and otherwise requests the locally
supported `opus` CLI alias for every tier. A request is not proof of the exact
served model: worker records keep `requestedModel` separate from
`runtimeReportedModel`. The planner never validates availability by making a
paid model call.

Claude CLI 2.1.302 JSON results carry no top-level `model`; the served model
is the key of `modelUsage`. Every worker result (design-wave worker, read-only
fanout worker, Issue ambiguity assessor, delegated question and approval
assessors) carries `modelIdentity` with `requested`, `runtimeReported`,
`runtimeReportedModels`, `source`, and `status`: `verified-match` (exact ID),
`alias-resolved` (a family alias such as `opus` served by one model of that
family), `mismatch`, or `unverified` (no identity reported; never inferred from
the request). Usage tokens and the CLI's list-price `costUSD` are kept in
`usage` when reported. The question decision stores `model.identityStatus`.
The approval CLI result carries `modelIdentity` outside the ledger record,
because core validates that record's exact keys. Assumption-ledger
entries carry the assessor's `modelIdentity`.

Each route records `tier`, `effort` (fast=low, balanced=medium,
judgment=high), `reason`, and `source`. Scheduler records repeat the route
reason, or the escalation reason on retries. The planner owns two
safeguards that callers cannot override. Official design-wave stages and
`design` tasks never route below `balanced`, even when Clef answers `fast` or
a caller supplies `fallbackTier: "fast"`. `approval`/`security`/`compliance`
tasks and every stage whose policy says `clef: "never"` are never sent to Clef.

Output contains per-task `route`, ordered `waves`, routing metrics, and enforced
constraints. A wave contains only entries from one issued directive: the official engine
still owns directive issuance, approvals, audit events, review scope, and swarm
settlement. Code Generation swarm execution remains unsupported by the
executable harness until those official worktree and settlement records can be
verified.

Each route also contains bounded Clef evidence. `attempted: false` means the
task was not eligible or Clef was disabled. `available: false` means the local
transport or HTTP endpoint failed. `available: true, used: false` means a
response arrived but was invalid or below the confidence threshold, so the
conservative fallback was used. `outcome: "timeout"` (with `available: null`)
means the request was aborted at `timeoutMs`. No route claims Clef was used unless
`used: true` and `outcome: selected`.
