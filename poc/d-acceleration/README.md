# D acceleration proof of concept

This proof of concept accelerates routing decisions without weakening AI-DLC's
approval, review, audit, or Testing Contract boundaries. It is deliberately
outside `core/`: an install must opt in and call the planner before dispatching
work through the existing engine directives.

See [`stage-coverage.md`](stage-coverage.md) for supported and unsupported
surfaces and [`clef-local-contract.md`](clef-local-contract.md) for the observed
local service contract.

## Safety contract

- Deterministic rules win. Clef is consulted only for ambiguous, low-risk task
  classification. Security, compliance, approval, and review decisions never
  go to Clef.
- Clef is optional and local-only (`127.0.0.1`). Timeout, transport failure,
  malformed output, an unknown choice, or confidence below the configured
  threshold falls back to the conservative `judgment` tier.
- Parallel output is limited to official execution seams: `official-wave` for
  engine-emitted design-stage waves, and `official-swarm` for isolated
  Code-Generation worktrees. `unit-major`, approval barriers, reviewers, and
  overlapping write sets remain serial.
- Model IDs are never invented. A plan may select only an ID supplied in the
  runtime model catalog. Without a catalog it emits an abstract tier and leaves
  the session model unchanged.
- The executable harness currently supports issued per-Unit design waves only.
  Code Generation swarm execution is intentionally unsupported until the
  official worktree preparation, referee merge, source landing, and settlement
  receipts can be consumed and verified rather than asserted by input.
- A failed fast/balanced attempt escalates to the next tier; a judgment failure
  stops for human review. The planner does not execute models itself.

## Run

```bash
bun poc/d-acceleration/aidlc-acceleration-plan.ts \
  --input poc/d-acceleration/fixtures/synthetic-plan.json \
  --output /tmp/d-plan.json

bun test poc/d-acceleration/tests

bun poc/d-acceleration/scheduler.ts \
  --input poc/d-acceleration/fixtures/synthetic-plan.json \
  --project-dir "$PWD" --worker fake \
  --ledger /tmp/d-resume.json --output /tmp/d-scheduler.json
```

Set `clef.enabled` in the input only when the existing local service is already
running. The planner never starts or stops it. See `schema.md` for the input and
output contract.

The scheduler requires an explicit, existing absolute project directory and
checks output paths against its real path, including symlink ancestors. It
never accepts a local approval override: an approval task returns
`awaiting-official-approval`. It can select `--worker fake` or `--worker
claude`; Claude accepts an explicit `--claude-model` request, records the model
actually returned when available, and stops without retrying login when
authentication or availability is missing. Worker exit zero is candidate
evidence only: the official single writer must accept `unit complete` before
recording engine acceptance in the ledger.

Claude model requests are configured separately with `--claude-fast`,
`--claude-balanced`, and `--claude-judgment`. They are requests, not availability
claims; the result records the requested and runtime-reported identities.
Synthetic artifact writing requires the explicit `--disposable-test-mode` and
must only be used with a throwaway fixture project.

## Evidence, not claims

`benchmark.ts` compares the same synthetic task durations under serial order and
the generated dependency waves. Those durations are fixture estimates, not
measured LLM latency or cost. The output separately reports planner wall time,
Clef routing time, retries, model/cost observability, critical-path estimate,
and safety/quality invariants. Real-model evidence requires the procedure in
`verification.md` with runtime-reported model IDs and usage records.
