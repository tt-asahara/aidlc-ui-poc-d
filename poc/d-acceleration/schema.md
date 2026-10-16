# Planner contract

Input is JSON with `tasks` and optional `modelCatalog`, `clef`, and
`maxParallel`. Each task has:

- `id`, `dependsOn`, `estimatedMs`
- `taskType`: `templated`, `implementation`, `review`, `design`, `security`,
  `compliance`, `approval`, or `ambiguous`
- `difficulty`: `low`, `medium`, or `high`
- `risk`: `low`, `medium`, or `high`
- `execution`: `serial`, `official-wave`, or `official-swarm`
- `writeSet`: paths or artifact IDs that the task can mutate
- `isolatedWorktree`: required for `official-swarm`

`modelCatalog` maps the abstract `fast`, `balanced`, and `judgment` tiers to
runtime-confirmed IDs. Missing entries mean inherit the session model. The
planner never validates availability by making a paid model call.

Output contains per-task `route`, ordered `waves`, `routingMetrics`, and
`qualityContract`. A wave is a dispatch proposal only: the official engine
still owns directive issuance, approvals, audit events, review scope, and swarm
settlement.
