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
conservative fallback was used. No route claims Clef was used unless
`used: true` and `outcome: selected`.
