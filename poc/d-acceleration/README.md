# D acceleration proof of concept

Arm D is the complete pinned Arm C UI baseline plus this opt-in acceleration
layer. The C plugin, Matt bounded adapters, historical Impeccable context and
WCAG correction, HTML evidence contracts, blocking sensor, native approvals,
and downstream handoffs remain active when acceleration is disabled and must
not be bypassed when it is enabled. See `../ui-poc/` for that baseline.

This proof of concept accelerates routing decisions without weakening AI-DLC's
review, audit, or Testing Contract boundaries. Most of it remains outside
`core/`; the delegated-AI stage-gate mode adds one explicit core settlement
seam so AI decisions cannot masquerade as human replies. An install must opt in
before dispatching work through the existing engine directives.

A separate clean target (install, receipt-proven update, package parity,
headless real-host turns, and an evidence manifest) follows
[`clean-target.md`](clean-target.md).

See [`stage-coverage.md`](stage-coverage.md) for supported and unsupported
surfaces and [`clef-local-contract.md`](clef-local-contract.md) for the observed
local service contract.

The Claude package exposes a default-off `/aidlc-issue-autopilot` surface for
exactly one GitHub Issue per invocation, plus `/aidlc --next-intent --from-issue`
routing. Claude Code's standard `/loop` is not overwritten; it may schedule the
dedicated command. The fixed-argv GitHub adapter, durable claim, and
assumption ledger live in `issue-autopilot-runtime.ts`; the bounded no-tool
Claude ambiguity assessor lives in `issue-ambiguity-assessor.ts`; policy and
lifecycle stops live in `issue-autopilot.ts`. It delegates every workflow transition,
review, sensor, and approval to ordinary `/aidlc`. See `configuration.md` for
JSONC settings. Setup never enables autopilot without an explicit user request.

For a narrowly delegated PoC, `aiApproval.mode: "stage-gates"` can evaluate
ordinary stage gates only after their existing review and sensor checks pass.
Its versioned Intent-local JSONL is the decision source of truth and binds the
AI actor, reason, delegation, official directive, workflow state, and artifact
hashes. Scope/routing and Plan Approval remain human stops, as do failed or
unverified checks and operation, credential, publishing, external, or
destructive work. The optional GitHub seam generates one summary payload per
Intent and is default-off; publication requires a fresh host-recorded permission
binding repository, Intent, and payload hash, and it never replaces the repository record.

Four independent checks are also default off: requirement/UI ID validation,
functional-design document discipline, source grounding, and specification
grounding. Their lifecycle positions and non-authority contract are documented
in `feature-21-22.md` and `grounding-integration.md`.

## Approved-transition Git persistence

The Claude projection includes a host-only PostToolUse coordinator that runs
after a successful official `orchestrate report`. It remains disabled by
default. Opt in through `.claude/d-acceleration.jsonc`, with an optional
`.claude/d-acceleration.local.jsonc` override. Legacy `.json` names remain readable,
but a `.jsonc`/`.json` pair in the same layer is rejected as ambiguous:

```json
{
  "gitPersistence": {
    "enabled": true,
    "push": false,
    "remote": "origin",
    "branch": "main"
  }
}
```

Local values override project values; omitted values resolve to `enabled:
false`, `push: false`, and remote `origin`. Approval is not Git authorization:
teams must explicitly enable commit and push independently. The coordinator
accepts only completed, skipped, or workflow-completed report crossings; uses
an exact artifact manifest; refuses worktrees, an occupied index, in-progress
Git operations, protected paths, and high-confidence secrets; and leaves
unrelated worktree changes untouched. Normal Git hooks still run. A hook that
adds an external path causes the checkpoint commit to be rolled back without
changing worktree bytes.

Push uses a journaled immutable commit OID, remote, branch, and refspec. A push
failure never rolls back official stage state and a later invocation retries
the same pending refspec rather than creating another commit. Parallel workers
do not run this coordinator; official swarm publish, land, and merge contracts
remain authoritative.

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

`run.ts --preflight` reports parent-session and D-worker model identity
separately. D can request Opus for its own workers, but it cannot silently
change an already-running parent Claude session; when the parent model is not
observable, preflight gives the exact session action instead of claiming the
worker request applies to inline stages. It likewise reports that safe
Construction parallelism remains `stage-major/swarm` only after the official
Unit DAG proves independent ready Units with disjoint writes and the person's
recorded request authorizes the policy change.

Project-wide defaults for newly bootstrapped generic-auto Intents live only in
`.claude/d-acceleration.jsonc` under `constructionDefaults` (a local file wins
over the project file). AI-DLC 2.11.0 has official per-Intent state setters and
project memory, but no project setting that initializes those two Construction
fields; memory remains guidance rather than a policy setter. D therefore calls
the official setters once, immediately after creating a new Intent, and only
when that scope contains both Units Generation and Code Generation. Existing
Intents are never changed by these defaults (only `parallel.enabled=false`
moves an existing swarm Intent to serial, see below). A later explicit per-Intent setter wins because a
bootstrap replay never reapplies the defaults. `swarm` requires `stage-major`;
a single Unit runs as the serial-equivalent case, while multiple Units still
parallelize only where the official DAG and isolated-worktree checks allow it.
Set either value to `official` to retain the AI-DLC default.

`parallel.enabled` is D's single master switch and defaults to `true`. It does
not relax dependencies: enabled mode still uses only policy-approved read-only
fanout or the official independent-Unit DAG with disjoint writes and a wave
barrier. `false` holds every D dispatch to one worker at a time and keeps work
away from the official parallel swarm (`parallel-guard.ts` owns this rule):

- D design-wave workers already issued by the official engine, their retries
  and tier escalations, and read-only fanout workers run strictly one at a
  time. The scheduler result reports `parallel.maxConcurrentWorkers`.
- New generic-auto Intents get no D swarm default (`constructionDefaults` is
  ignored while OFF).
- An existing Intent whose official `Construction Execution` is `swarm` is
  moved to `serial` only through the official
  `aidlc-state.ts set-construction-execution serial` setter, at the next D
  boundary (run.ts/conductor step, generic-auto or issue-autopilot checkpoint,
  or the `invoke-swarm` guard). The setter's own guards stay authoritative:
  before Construction it applies; inside Construction an unattended run is
  refused and an interactive run needs the person to have asked. While it is
  refused, D still runs its own work serially, returns the one-line `recovery`,
  and refuses every official `invoke-swarm` hand-off
  (`parallel-off-action-required` from run.ts/conductor, `stop` from the host
  checkpoint and from `parallel-guard.ts`). After the setter succeeds the host
  gets `refresh` and obtains a fresh official directive.
- `AIDLC_USE_SWARM` and `flags.swarm` (env, then local, project, machine
  settings) only choose the driver for an `invoke-swarm` the engine already
  issued. They never re-enable a swarm while D is OFF.

Timing: OFF applies immediately. Every D boundary re-reads the configuration,
and the scheduler re-reads it before every worker launch, so switching to OFF
during a wave serializes every later launch of that wave (workers already
running finish). ON never widens work already in progress: a run or wave that
started under OFF stays at one worker, and ON applies from the next D
invocation. An unreadable configuration counts as OFF at those boundaries. D
never moves an Intent back to `swarm` when ON returns; use the official setter.
The generic-auto bootstrap journal keeps the value seen at bootstrap as
evidence only.

The conductor accepts `--clef-url http://127.0.0.1:18742` and an explicit
comma-separated `--clef-low-risk-units`. Only those Unit summaries are sent to
Clef. Design waves retain `balanced` as their minimum and failure fallback, so
Clef can escalate uncertain work to `judgment` but cannot downgrade design to
`fast`. This PoC therefore does not claim universal fast-tier coverage across
all AI-DLC stages.

`stage-policy.json` is the machine-readable, test-enforced classification of
all 33 official stages. Only official design waves are executable here;
pipeline, mob, ensemble, and swarm directives are handed back intact to the
official host.

For an enabled inline analysis stage, the official host can invoke
`read-only-fanout.ts --input <plan.json> --project-dir <project> --framework-dir
<installed-core>`. The input includes the current unmodified directive,
caller-supplied tier-to-model request catalog, and independent evidence-path tasks. The
stage policy selects both tier and effort; the chosen tier, effort, and requested
model are retained in the result. Use
`--dry-run` to inspect the projected official agents and enforced Claude CLI
permissions without making a model call; dry-run output is explicitly marked
`verifiedAgainstFreshNext: false`. A real run validates both directives with
the official schema and invokes a fresh official `orchestrate next`; stage,
phase, mode, gate, memory/record path, and stage file must still match before
any worker starts. Worker responses are returned
separately for lead integration; workers never write official artifacts.
Start from `fixtures/read-only-fanout.json`, replace its directive with the
latest official `orchestrate next` result and its model placeholder with the
model request configured on the user's authenticated terminal. This is only a
request: availability and runtime-reported identity are determined from each
execution result. Never reuse the example directive as authority.

Evidence paths are realpath-checked against the project, including symlinks.
They scope the assignment, not the Claude file tools: `Read`, `Grep`, and
`Glob` may inspect other files inside the restricted working directory. CLI
help capability checks and argv tests prove configuration construction only;
without an authenticated model run they do not prove runtime enforcement,
model quality, or speed.

## Evidence, not claims

`benchmark.ts` compares the same synthetic task durations under serial order and
the generated dependency waves. Those durations are fixture estimates, not
measured LLM latency or cost. The output separately reports planner wall time,
Clef routing time, retries, model/cost observability, critical-path estimate,
and safety/quality invariants. Real-model evidence requires the procedure in
`verification.md` with runtime-reported model IDs and usage records.
