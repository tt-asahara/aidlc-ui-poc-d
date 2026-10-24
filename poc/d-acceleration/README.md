# D acceleration proof of concept

Arm D is the complete pinned Arm C UI baseline plus this opt-in acceleration
layer. The C plugin, Matt bounded adapters, historical Impeccable context and
WCAG correction, HTML evidence contracts, blocking sensor, native approvals,
and downstream handoffs remain active when acceleration is disabled and must
not be bypassed when it is enabled. See `../ui-poc/` for that baseline.

This proof of concept accelerates routing decisions without weakening AI-DLC's
review, audit, or Testing Contract boundaries. It lives entirely outside
`core/`, which stays byte-identical to upstream AI-DLC v2.11.0 (`6a378b53`;
guarded by `tests/core-pristine.test.ts`). D extends AI-DLC only through the
Claude harness projection, the ui-poc plugin, and D-owned tools and ledgers; it
never writes engine state or the official audit itself. D hook registrations use the existing `engine hook` dispatcher and four D-owned `hooks/aidlc-d-*.ts` adapters. Copy-channel commands retain the quoted project root; native commands load the installed runtime through the self-contained `aidlc` executable. The adapters and their modules are projected from `poc/d-acceleration/`, and no core file is edited. An install must opt in
before dispatching work through the existing engine directives. What the core
restore re-homed and what it dropped is listed under "Core restore" below.

A separate clean target (install, receipt-proven update, package parity,
headless real-host turns, and an evidence manifest) follows
[`clean-target.md`](clean-target.md).

The source/native hook boundary and baseline CI comparison are documented in
[`native-hook-dispatch.md`](native-hook-dispatch.md).

See [`stage-coverage.md`](stage-coverage.md) for supported and unsupported
surfaces.

A Japanese command and option reference for this repository (`/aidlc`
commands by stage, automatic events, D settings, scopes, GitHub, and the
differences from the KDDI distribution) is [`../aidlc-commands.html`](../aidlc-commands.html).

The Claude package exposes a default-off `/aidlc-issue-autopilot` surface for
exactly one GitHub Issue per invocation, plus `/aidlc --next-intent --from-issue`
routing. Claude Code's standard `/loop` is not overwritten; it may schedule the
dedicated command. The fixed-argv GitHub adapter, durable claim, and
assumption ledger live in `issue-autopilot-runtime.ts`; the bounded no-tool
Claude ambiguity assessor lives in `issue-ambiguity-assessor.ts`; policy and
lifecycle stops live in `issue-autopilot.ts`. It delegates every workflow transition,
review, sensor, and approval to ordinary `/aidlc`. See `configuration.md` for
JSONC settings. Setup never enables autopilot without an explicit user request.

Every stage gate stays the person's: delegated AI stage-gate approval was
dropped (see "Core restore"). With `aiApproval.mode: "stage-gates"` and the
person's exact `AI-DLC delegate-ai-approvals ...` grant (minted only when those
words are the person's latest host-recorded turn), D may answer
explicitly marked low-risk stage questions, including per-Unit Construction
design questions (`--unit`), through `ai-question-controller.ts` and the D
settler `ai-question-answers.ts`. Settled answers carry `[Answer Source]` /
`[AI Decision ID]` provenance in the questions file and are recorded in the
Intent's D-owned `decisions/ai-question-answers.jsonl`, which is not the
official audit. The file grammar, per-Unit binding, marker decision, and
real-model evidence are in `delegated-questions.md`. The optional GitHub seam
generates one summary payload per Intent from the D question-answer ledger
`decisions/ai-question-answers.jsonl` (missing or empty → `nothing-to-publish`)
and is default-off; publication requires
the person's exact permission words as the latest host-recorded human turn
(read through the engine's own read-only `latestPersonTurn`), binding
repository, Intent, and payload hash, and it never replaces the repository record.

## Core restore (re-homed and dropped)

The repository owner requires `core/` to equal upstream `6a378b53`. Every
earlier D/C core change was reverted and re-implemented only through supported
extension surfaces:

| Feature | Outcome |
| --- | --- |
| UI concurrency proposal at Delivery Planning | Re-homed: ui-poc contribution fragment `before-step:6` spliced by compose, so it precedes Step 6's Construction iteration choice. |
| UI scope routing | Partly re-homed: plugin scope keywords route short ASCII requests. UI-specific high-specificity keywords, CJK keyword boundaries, and Japanese negation needed core and were dropped; long or Japanese prose gets the stock proposal and the person picks `ui-poc-application` at the official scope confirmation. |
| Generic `/aidlc --auto` bootstrap | Re-homed: the host runs the official print's `intent-create` command as for any print; `generic-auto-cli.ts bootstrap` binds only to an Intent proven created since `start` (absent from the Intent inventory `start` recorded, with its own `WORKFLOW_STARTED` audit row at or after `startedAt`); a switched-to or resumed Intent is refused in one line and its Construction policy is never touched. The typed `machine_action` field was core-only and is gone. |
| Delegated low-risk question answers | Re-homed: D-owned grammar/settler `ai-question-answers.ts` and the D ledger `decisions/ai-question-answers.jsonl`; the `AI_QUESTION_ANSWERED` audit event was core-only and is gone. |
| Decision summary permission and `HOST/owner/name` check | Re-homed into `decision-issue-summary.ts` (the `aidlc-state.ts verify-decision-summary-permission` verb was core-only). |
| Delegated AI stage-gate approval | Dropped: the upstream engine accepts a stage approval only from the person, and an extension cannot add an approval authority or authenticated `present-gate` receipt. `ai-approval-controller.ts` keeps only `grant`; `evaluate`/`verify` fail closed with one line. |

Four independent checks are also default off: requirement/UI ID validation
(official `AC1.1.1` acceptance-criteria IDs parsed from `stories.md`),
functional-design document discipline, source grounding, and specification
grounding. Their lifecycle positions and non-authority contract are documented
in `feature-21-22.md` and `grounding-integration.md`.

## Design document (`/aidlc --doc`)

Ported from the KDDI harness. `/aidlc --doc` merges a product-level design
document spanning every intent into the space-level
`aidlc/spaces/<space>/design-document/`; `/aidlc --doc --full` regenerates it
after `design-document.ts doc-snapshot` keeps one previous generation under the
already-ignored `aidlc/spaces/<space>/intents/.aidlc-d-doc-snapshot/`. The LLM
writes the document following `design-document-guide.md`; `design-document.ts
doc-manifest --json` owns the deterministic input set. It is read-only with
respect to workflow state. The KDDI critic loop (`docCriticLoop`, design-doc
audit and reviewer agent) is not ported.

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

## Reviewer dispatch cleanup

The official reviewer protocol leaves `.aidlc-engine/reviewer-dispatch.json`
for the conductor to delete after a per-unit review; a leftover record keeps
the official reviewer-scope hook refusing the next Unit's reviewer for up to
six hours. The Claude projection adds a PostToolUse Bash hook,
`reviewer-dispatch-cleanup-hook.ts`, that closes that window without changing
the official engine:

- a recorded verdict (`engine log review ... --verdict`, answered with
  `reviewRecord`) removes the record for that same stage and Unit;
- a new review request removes a record that names a different stage or Unit;
- a re-request for the same review, a refused or failed call, and an
  unreadable record leave the file alone.

The hook never blocks and never writes anything else.

## Blocking sensor override guidance

The official engine accepts a blocking-sensor override only when its exact
decision row (`Blocking gate sensor failure`, options
`Fix findings,Override blocking sensors`) is recorded before the person's reply
and the answer after it. A decision or answer recorded after the reply is
refused with "no fresh authorization receipt", and recording again cannot
repair that reply. The Claude projection adds a PostToolUse Bash hook,
`blocking-sensor-override-hook.ts`: when an engine command surfaces a blocking
sensor failure or that refusal, it adds one context line with the exact ordered
commands for that stage (decision, the two choices, the person's reply, answer,
report with `--override-blocking-sensors`). It reads the wording from the
official constants, records nothing, and decides nothing.

## PR Lens supplemental review (optional, default OFF)

The optional plugin [`../pr-lens-review/`](../pr-lens-review/README.md) can add
a pinned [PR Lens](https://github.com/coldteadotai/pr-lens) diagram and an
evidence-backed review to Build and Test. It runs only when application code
exists. The pin is `coldteadotai/pr-lens@7a9115c8`, MIT. One run takes minutes
and extra model use, so the switch `features.prLensReview` defaults to `false`.
The local `.claude/d-acceleration.local.jsonc` overrides the project
`.claude/d-acceleration.jsonc`.

Its composed fragment first runs `pr-lens-gate.ts`, which works as follows:

- **OFF:** returns `skipped-by-config`. Nothing PR Lens related runs and no
  review file is written. The skip is recorded only in D's evidence,
  `aidlc/.aidlc-engine/d-evidence/build-and-test-pr-lens-review.json`.
- **ON, but the pinned install, the setup receipt, or the composed fragment is
  missing or different:** exits 2 with a one-line next step (run
  `poc/pr-lens-review/scripts/setup-pr-lens.ts`, or switch OFF). It never
  passes silently.

The review is supplemental. It never changes reviews, sensors, test verdicts,
approvals, or gates, and it never decides a gate.

`run.ts --preflight` shows the effective value
(`optional.features.prLensReview`) and the gate status
(`supplementalReview.prLensReview`). When the switch is ON, it adds two
`features.prLensReview` prerequisite rows: the pinned install and the composed
plugin.

## Safety contract

- Deterministic rules decide every tier, and routing makes no network call.
  The planner owns a quality floor: security, compliance, and approval stay at
  `judgment`, and design-wave stages and design tasks stay at `balanced` or
  above, whatever a caller's `minimumTier`/`fallbackTier` says. Ambiguous work
  falls back to the conservative `judgment` tier.
- Clef routing was evaluated and then declined on 2026-10-17 (see
  `evidence/model-routing/README.md`). A leftover `clef` config key, planner
  input key, or `--clef-*` flag fails closed with a one-line removal notice.
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

## Bounded-run deadline (`auto.deadlineMs`)

`host-session.ts` is the single owner of deadline accounting for the generic
`/aidlc --auto` session (`activeElapsedMs`, `enterHumanWait`,
`leaveHumanWait`). The deadline measures D's working time, not the person's
think time. An unclaimed session pauses the clock while it waits for the
person, in two cases:

- `official-ask`: a checkpoint received an official `ask` (human gate).
- `stage-question`: `action-finish` found that the current stage's canonical
  `<stage>-questions.md` (or the active Unit's per-Unit file) has a blank
  `[Answer]:` slot that the delegated AI path cannot answer
  (`question-wait.ts`). That holds when there is no `stage-gates` question grant for the
  stage, when the deterministic precheck shared with `ai-question-controller.ts`
  refuses the set, or when the Intent's `decisions/ai-question-blocks.jsonl`
  records a delegated-path stop on those exact bytes. A set the delegated path
  may still answer is D work, so the clock keeps running.

Both waits are decided from recorded files, never from prose. Each wait is
persisted in the session journal (`waitingSince`, `waitKind`, and a
`humanWaits[]` entry with `startedAt` and evidence). The next checkpoint or
`action-start` closes the entry (`endedAt`, `creditedMs`) and adds the credit
to `pausedMs` in the same atomic save. A crash or restart mid-wait therefore
neither loses the pause nor counts it twice. Active time keeps counting, so
runaway work still stops with `deadline-exceeded`. There is no separate
wall-clock ceiling for unclaimed sessions. `maxSteps`, the `through` boundary,
and no-progress detection remain the other hard stops. No-progress means
the same official directive came back with neither a finished host action
(`action-finish`) nor the person's reply to a wait since the last checkpoint: a
gated `run-stage` legitimately repeats across turns while one stage attempt runs
before it reports awaiting-approval. `MAX_IDENTICAL_REPEATS` (8) consecutive
identical directives still stop a loop that keeps acting without the engine
moving. After a scope change the person asked for, `host-session-cli.ts rescope`
(or `generic-auto-cli.ts rescope`) re-binds the running session to the new
stage list and re-resolves `through`; the change is kept in `scopeChanges`. A claimed Issue session
keeps wall-clock semantics, because the claim lease must not outlive the
deadline: its official-ask waits are journaled with `creditedMs: 0`, and it
does not detect stage-question waits. A wait is detected only
at `action-finish`, so the host runs `ai-question-controller.ts` inside an
`action-start`/`action-finish` bracket like every other host action.

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

See `schema.md` for the input and output contract.

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
worker request applies to inline stages. The parent model comes only from a
caller's `AIDLC_PARENT_MODEL` report, labelled `unverified-caller-report`.
`modelContract.dWorkers` lists the requested worker models with their sources
(`cli`/`local`/`project`/`default`) and the per-tier effort. Every D worker
passes an explicit `--model`, so a parent default such as `ANTHROPIC_MODEL` or
`CLAUDE_CODE_SUBAGENT_MODEL` never selects a worker model. Each worker result
carries its own `modelIdentity` (see `schema.md`). It likewise reports that safe
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
Intents are never changed by these defaults: bootstrap refuses an active
Intent that was in `start`'s Intent inventory or whose `WORKFLOW_STARTED` row
predates `start` (only `parallel.enabled=false`
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

Design waves route at `balanced`. Escalation after a worker failure can raise
them to `judgment`, but nothing lowers design to `fast`. This PoC therefore
does not claim universal fast-tier coverage across all AI-DLC stages.

While an official stage waits at its human gate, `cross-stage-speculation.ts`
can run independent, no-tool, read-only pre-research for a later analysis stage.
It writes only D-private drafts that are bound by a Merkle root, and does
nothing when `parallel.enabled` is `false`. Drafts are discarded when any input
changes. They are consumed as evidence only after a fresh official `run-stage`
for that stage, with every upstream settled. Official stages stay serial. See
[`cross-stage-speculation.md`](cross-stage-speculation.md) for the contract
and what remains out of scope.

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
retries, model/cost observability, critical-path estimate,
and safety/quality invariants. Real-model evidence requires the procedure in
`verification.md` with runtime-reported model IDs and usage records.
`model-routing-probe.ts` produces that evidence. The
2026-10-17 results are in `evidence/model-routing/README.md`.

The A/B/C/D lineage, the adopted-number ledger (items 7, 9–17, 21, 22, 27,
28), stage-to-skill invocation evidence, and the pr-lens record are in
[`audit/`](audit/README.md). Reproduce the lineage comparison with
`bash poc/d-acceleration/audit/lineage.sh`.
