# AI-DLC all-stage acceleration policy

The executable policy is [`stage-policy.json`](stage-policy.json). Its test compares the matrix with every stage file in pinned v2.11.0. Cross-stage concurrency is always false; official directives, approvals, reviews, and the shared-state writer remain authoritative.

`implemented` means D executes an official Unit wave. `implemented-read-only-fanout` means isolated evidence tasks run inside one active stage and return text to its lead. `official-delegation` returns the complete directive to the existing host. `candidate-not-enabled` is an opportunity, not a measured or enabled feature.

| Phase | Stage | Status | Parallelism | Tier / effort | Clef |
|---|---|---|---|---|---|
| initialization | workspace-detection | official-delegation | deterministic-only | fast / low | never |
| initialization | workspace-scaffold | official-delegation | serial-host | fast / low | never |
| initialization | state-init | official-delegation | serial-host | fast / low | never |
| ideation | intent-capture | official-delegation | serial-host | balanced / medium | never |
| ideation | feasibility | implemented-read-only-fanout | read-only-fanout | judgment / high | never |
| ideation | market-research | implemented-read-only-fanout | read-only-fanout | balanced / medium | never |
| ideation | team-formation | official-delegation | serial-host | balanced / medium | never |
| ideation | rough-mockups | candidate-not-enabled | read-only-fanout | balanced / medium | never |
| ideation | scope-definition | official-delegation | serial-host | judgment / high | never |
| ideation | approval-handoff | official-delegation | serial-host | judgment / high | never |
| inception | reverse-engineering | official-delegation | official-pipeline | judgment / high | never |
| inception | requirements-analysis | official-delegation | serial-host | judgment / high | never |
| inception | user-stories | official-delegation | official-mob | judgment / high | never |
| inception | domain-design | official-delegation | serial-host | judgment / high | never |
| inception | refined-mockups | candidate-not-enabled | read-only-fanout | balanced / medium | never |
| inception | units-generation | official-delegation | serial-host | judgment / high | never |
| inception | contract-design | official-delegation | serial-host | judgment / high | never |
| inception | practices-discovery | official-delegation | official-ensemble | balanced / medium | never |
| inception | delivery-planning | official-delegation | serial-host | balanced / medium | never |
| construction | functional-design | implemented | official-wave | balanced / medium | explicit low-risk escalation only |
| construction | nfr-requirements | implemented | official-wave | balanced / medium | explicit low-risk escalation only |
| construction | nfr-design | implemented | official-wave | balanced / medium | explicit low-risk escalation only |
| construction | infrastructure-design | implemented | official-wave | balanced / medium | explicit low-risk escalation only |
| construction | code-generation | official-delegation | official-swarm | judgment / high | never |
| construction | build-and-test | official-delegation | serial-host | judgment / high | never |
| construction | ci-pipeline | official-delegation | serial-host | judgment / high | never |
| operation | environment-provisioning | official-delegation | serial-host | judgment / high | never |
| operation | deployment-pipeline | official-delegation | serial-host | judgment / high | never |
| operation | deployment-execution | official-delegation | serial-host | judgment / high | never |
| operation | observability-setup | official-delegation | serial-host | balanced / medium | never |
| operation | performance-validation | implemented-read-only-fanout | read-only-fanout | judgment / high | never |
| operation | feedback-optimization | official-delegation | serial-host | judgment / high | never |
| operation | incident-response | official-delegation | serial-host | judgment / high | never |

## Safe handoff boundary

The conductor executes only the four official `run-stage.wave` directives. A mob, ensemble, ordered pipeline, swarm, gate, review, question, or unknown directive returns `official-host-action-required` with the unmodified directive and completed worker records. D does not reimplement code-generation worktree preparation, referee merge, landing, or receipts.

`read-only-fanout.ts` is a separate official-host entry point for the three enabled analysis stages. It accepts the current `run-stage` directive and two or more independent evidence tasks, projects personas from `core/agents`, and constructs bounded Claude calls with only `Read`, `Grep`, and `Glob`. `--restricted`, an empty strict MCP configuration, disabled slash commands, no session persistence, `dontAsk`, and no permission prompt handler are the runtime-requested restrictions. Each response remains separate; only the lead may integrate selected findings into official artifacts. Existing official `mob`, `subagent`, and `pipeline` modes are returned to the host unchanged.

Before execution, caller and freshly emitted `orchestrate next` directives are validated by the official `validateDirective`. Both must describe the same active inline stage and record with `gate: false`; questions, approvals, another stage/record, invalid JSON, and failed `next` calls stop before Claude launch. `maxParallel` is restricted to an integer from 1 through 4.

Evidence paths are checked with `realpath`, so a symlink cannot escape the project. This does not sandbox `Read`, `Grep`, and `Glob` to only the enumerated paths; the CLI's restricted working directory remains their broader boundary. Tier and effort come from `stage-policy.json`, and the corresponding runtime-confirmed model ID comes from the caller's tiered catalog; the route is included in output. Help/argv verification demonstrates that this installed CLI exposes the requested controls, not that an unauthenticated test has exercised their enforcement.

## Evidence boundary

The functional-design fixture proves raw official `next` → adapter → bounded workers → official Unit completion → partial resume → gate. The other three design stages share the adapter contract but lack equivalent native fixtures. Fake workers and synthetic fixtures prove local orchestration only; they are not real-model speed, quality, or cost evidence. Authenticated benchmarking must record identical inputs and quality checks, routing time, worker time, retries, requested/launched/runtime-reported model IDs, and usage.
