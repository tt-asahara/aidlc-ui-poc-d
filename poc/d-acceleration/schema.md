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
requires a separate `runtimeCatalog` carrying a retained runtime response;
without it the scheduler stops with `unverified-model-catalog`. The
planner never validates availability by making a paid model call.

Output contains per-task `route`, ordered `waves`, routing metrics, and enforced
constraints. A wave contains only entries from one issued directive: the official engine
still owns directive issuance, approvals, audit events, review scope, and swarm
settlement. Code Generation swarm execution remains unsupported by the
executable harness until those official worktree and settlement records can be
verified.
