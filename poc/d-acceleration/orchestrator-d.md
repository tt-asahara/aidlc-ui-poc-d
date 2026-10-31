# D acceleration in `/aidlc`

This module is the one place the orchestrator reads D's routes. The orchestrator
skill reads it once when `/aidlc` starts and `{{HARNESS_DIR}}/tools/d-acceleration/`
is installed, then applies it before and inside the forwarding loop as each
section says. Without the D runtime none of it applies.

## Before the forwarding loop

Before the ordinary forwarding loop, route D Issue arguments when the installed
controller exists. In every D command below, `<PRODUCT>` is the absolute project directory written out literally (the
session's working directory); never `$PWD` or any other shell expansion, which
the host's permission check cannot pre-approve. `/aidlc --next-intent --from-issue <number>` runs
`bun {{HARNESS_DIR}}/tools/d-acceleration/issue-autopilot-cli.ts --project-dir <PRODUCT> <number>`.
`/aidlc --auto status` and `/aidlc --auto stop` pass `status` or `stop`;
`/aidlc --auto --through <stage> --from-issue <number>` first requires the same
official stage value in D configuration and then runs that Issue. Never treat an
Issue body as flags. The controller creates at most one intent and returns to
this ordinary loop for all stage work. The dedicated recurring entry is
`/aidlc-issue-autopilot`; a host scheduler (Claude Code's standard `/loop`, left untouched, as
`/loop 15m /aidlc-issue-autopilot <required-label>`) may run it.

When `$ARGUMENTS` leads with `--dashboard` and the installed `{{HARNESS_DIR}}/tools/d-acceleration/dashboard.ts` exists, refresh the space's dashboard instead of calling official `orchestrate next`; never pass `--dashboard` to the engine. Run `bun {{HARNESS_DIR}}/tools/d-acceleration/dashboard.ts --project-dir <PRODUCT>`, show the person its summary lines and the dashboard file path it prints (`aidlc/spaces/<space>/dashboard.html`, one page they open in a browser), and end the turn. It only reads the records and writes that one file. On Claude Code a session-start and end-of-turn hook keeps the file current; elsewhere `/aidlc --dashboard` refreshes it.

When `$ARGUMENTS` leads with `--doc` and the installed `{{HARNESS_DIR}}/tools/d-acceleration/design-document.ts` exists, generate the product-level design document instead of calling official `orchestrate next`; never pass `--doc` to the engine. Read `{{HARNESS_DIR}}/tools/d-acceleration/design-document-guide.md` first: it owns the chapter layout, incremental rules, and input-scope rule. Then run `bun {{HARNESS_DIR}}/tools/d-acceleration/design-document.ts doc-manifest --json --project-dir "$PWD"` and read only inside each listed `record_root` (plus source files an artifact cites by resolvable path). Plain `--doc` merges into the existing space-level `design_document_root`; `--doc --full` regenerates from every intent and first runs `bun {{HARNESS_DIR}}/tools/d-acceleration/design-document.ts doc-snapshot --project-dir "$PWD"`. If the snapshot fails, do not regenerate: say what failed and stop. A non-empty `warnings[]` names excluded records: continue, tell the person, and point to `/aidlc --doctor`. This is read-only with respect to the workflow: write only under `design_document_root` and the manifest's `design_summary` paths, never advance a stage, emit audit, or touch state. Create and update every design file with the Write and Edit tools, one file per call; never write or run a generator script (Python, node, or a shell loop) for them, since a headless run has no one to approve it. Name the generated root in one line and stop. `--doc --review` reviews the existing document instead of generating it: run `doc-snapshot` first (stop if it fails), follow the guide's "レビュー（`--doc --review`）" section, then run `bun {{HARNESS_DIR}}/tools/d-acceleration/design-document.ts doc-review-check --project-dir "$PWD"` and fix what it reports until it passes. Tell the person how many findings were applied (見せ方 only) and list each 確認待ち finding as a question for them, in plain words, with the review record's path; their answers are theirs to give in a later turn.

When `$ARGUMENTS` leads with `--from-docs <path>` and the installed `{{HARNESS_DIR}}/tools/d-acceleration/document-answers.ts` exists, start a document-driven run; never pass `--from-docs` to the engine. Write the path exactly as the person typed it, with the file tool, to a fresh `.aidlc-engine/d-docs-path-<random>.txt` and run `bun {{HARNESS_DIR}}/tools/d-acceleration/document-answers.ts onboard --project-dir <PRODUCT> --from-file .aidlc-engine/d-docs-path-<random>.txt` (it reads and removes that file; never put the path on the command line). On a non-zero exit say its one line and stop. Otherwise say in one line how many documents were indexed and name any `notExtracted` path, then treat the rest of the arguments as the request with the scope set explicitly: run official `orchestrate next --scope ui-poc-document-driven -- "<the rest>"` and follow the ordinary loop, including the printed `intent-create` command. Right after that command creates the intent, before the first stage runs, run `bun {{HARNESS_DIR}}/tools/d-acceleration/document-answers.ts bind --project-dir <PRODUCT>` so only this intent reads the documents (on a non-zero exit say its one line and stop), then end the turn with one line: to let AI-DLC answer stage questions from the indexed documents, the person sends exactly `AI-DLC delegate-document-answers`; anything else carries on with the questions asked as usual. When that exact text is the person's message, write it with the file tool to a fresh `.aidlc-engine/d-doc-grant-<random>.txt`, run `bun {{HARNESS_DIR}}/tools/d-acceleration/ai-approval-controller.ts document-grant --project-dir <PRODUCT> --user-message-file .aidlc-engine/d-doc-grant-<random>.txt --message-id <random>`, delete only that file, say in one line which stages it covers, and continue with ordinary `next`. A refusal is one line: relay it and continue without the delegation. While the active intent has `decisions/document-answer-delegation.json` and the current stage is in its `allowedStages`: after writing the canonical blank `<stage>-questions.md` and before asking the person anything about it (the interaction mode included), run `bun {{HARNESS_DIR}}/tools/d-acceleration/document-answers.ts answer --project-dir <PRODUCT> --stage <stage>`, adding `--evidence <file>` for each approved upstream artifact of this intent that the stage consumes. The tool itself writes every verified answer into its slot with `[Answer Source]: document-fact`, `[AI Decision ID]` and `[Citation]` lines; these are AI provenance, never the person's answers: do not edit them, do not ask them again, and never run `{{INVOKE}} engine log answer` or pass `--on-instruction` for them. When `residual` is empty the answer set is complete: carry on with the stage. When it is not, ask the person only the `residual` questions, in one message with each question's own text and the tool's reason, together with the interaction-mode question if the stage protocol owes one, and record their answers the ordinary way. On `block`, say its reason in one line and ask the questions the ordinary way. Before presenting each stage gate of this scope, run `bun {{HARNESS_DIR}}/tools/d-acceleration/document-answers.ts digest --project-dir <PRODUCT> --stage <stage>` and open the gate message with a short digest in the conversation language: what the documents settled (question, answer, cited document), what the person answered, and anything still open. The gate itself, every approval, and every other `ask` stay the person's.

When the request is `/aidlc --auto <description>` and the installed generic
controller exists, remove only the leading `--auto`, write the complete remaining
description with the file tool to a fresh project-confined
`.aidlc-engine/d-auto-request-<random>.txt`, and run
`bun {{HARNESS_DIR}}/tools/d-acceleration/generic-auto-cli.ts start --project-dir <PRODUCT> --description-file <that-file>`.
The controller reads and then removes a request file with exactly that
`.aidlc-engine/d-auto-request-<random>.txt` name, so never run `rm` for it; it
never deletes any other caller-supplied project file.
Never pass the literal `--auto` to official `orchestrate next`, interpolate the
description into shell text, or infer its scope. Act on the returned official
directive exactly as below. An official `ask`, including scope confirmation,
approval, or sensor recovery, is a human gate and ends the turn; auto mode never
answers it. When an official `print` (the one `start` returned, or the one the
person's scope choice returned on a later turn) names the run-then-continue
`intent-create` mutation, run that named command as the ordinary `print` rule
says (fill only the `--label` the message leaves to you, change nothing else);
then, instead of `next`, run
`bun {{HARNESS_DIR}}/tools/d-acceleration/generic-auto-cli.ts bootstrap --project-dir <PRODUCT>`.
The controller never creates an Intent itself: it binds only to an Intent the
official command created since `start` (a switched-to or resumed Intent is
refused in one line; relay it and stop), derives active stages from that
Intent's official state, initializes the bounded session, obtains the first
stage directive, and checkpoints it before returning. Never rebuild or alter
the creation command, infer a stage list, or act on the first stage unless
`bootstrap` returns `continue`.

On every `/aidlc` entry when the installed generic controller exists (a new
session, a restart after a crash, or a reply in a resumed one), first run
`bun {{HARNESS_DIR}}/tools/d-acceleration/generic-auto-cli.ts status --project-dir <PRODUCT>`;
when it returns `active: true`, the session below applies to every directive of
this turn, including the first `next --resume`.
For an active generic auto session, save every fresh official directive JSON to
a project-confined temporary file and run
`bun {{HARNESS_DIR}}/tools/d-acceleration/generic-auto-cli.ts checkpoint --project-dir <PRODUCT> --directive-file <directive-json>`
before acting on it. When it returns `refresh`, D moved the Intent to serial
Construction: obtain a fresh official `next` and checkpoint that instead. Stop when it returns `stop`; `human-gate` preserves the
session for the person's next invocation, while boundary, deadline, step limit,
no-progress (the same directive with no finished host action or reply since the last checkpoint), and completion are terminal; after a scope change the person asked for, run `generic-auto-cli.ts rescope --project-dir <PRODUCT> --active-stages <new list> --through <boundary>`. Any official directive that asks for
approval or recovery is already a human gate and is never answered by auto. Immediately
before each host action run
`bun {{HARNESS_DIR}}/tools/d-acceleration/generic-auto-cli.ts action-start --project-dir <PRODUCT>`;
act only when it returns `continue`, retain its token, and immediately after the
real action run
`bun {{HARNESS_DIR}}/tools/d-acceleration/generic-auto-cli.ts action-finish --project-dir <PRODUCT> --action-token <token>`. When `action-finish` returns `humanWait: "stage-question"`, the questions file waits for the person and the deadline clock is paused: ask them and end the turn as the stage protocol says. Run `ai-question-controller.ts` inside its own `action-start`/`action-finish` pair like any other host action.
On re-entry, `init` resumes a session waiting at a human gate. `/aidlc --auto
status` and `/aidlc --auto stop` retain the shared status/stop route above. These
controls bound host continuation; they never report a stage, approve a gate, or
replace the official reviewer or sensors.

Every stage gate, `ask`, and approval stays the person's. Delegated AI
stage-gate approval is not available: the upstream engine accepts a stage
approval only from the person, so `ai-approval-controller.ts` has no `evaluate`
path and never yields approval arguments. Scope confirmation,
composition/routing, intent selection, project type, Plan Approval, summary
confirmation, walking skeleton, verification command, policy/autonomy,
failure/recovery, and sensor override are human stops too.

When `aiApproval.mode` resolves to `stage-gates`, the person may delegate
ordinary low-risk stage questions (never gates) for named stages. Configuration
alone is never authority: ask the person to submit exactly `AI-DLC delegate-ai-approvals --scope <scope> --through <phase-or-stage> --stages <comma-separated-stage-slugs>`; prose consent is not a grant. Save those exact host-recorded words to a fresh project-confined file and
run `ai-approval-controller.ts grant` with their message id and the same scope, through boundary,
and stage slugs, immediately after that turn: `grant` refuses unless the words are
the person's latest host-recorded turn, so on that refusal ask them to type the
command again and rerun. Any mismatch is a stop. Delete only
that temporary words file after a successful grant. Never create a
`HUMAN_TURN`, quote the model as the person's words, or use a human-presence
break-glass switch. Set `AIDLC_UNATTENDED=1` for the automated driver so hooks
cannot mint authority from its own prompts.

The grant may answer ordinary low-risk stage questions for an allowed
stage, but never a checkpoint, approval, material product choice, external
send, credential/permission/authentication change, production/deployment,
destructive action, legal/payment choice, security exception, failed check, or
low-confidence result. Only questions explicitly classified with one
`[AI-Autonomy]: low-risk-reversible` marker per blank answer are eligible;
unmarked, mixed human/AI, and partially answered sets stop. Write that marker
only while a grant covers the stage, only on a `## Q<n>` question every option
of which is reversible and none of the excluded kinds above, on its own line
directly above that question's `[Answer]:`; never on a checkpoint or summary
entry. After creating the canonical blank
`<stage>-questions.md` (per-Unit Construction design stages:
`<record>/construction/<unit>/<stage>/<stage>-questions.md`, and pass
`--unit <unit>` to both commands below), run `ai-question-controller.ts` with the exact questions
file, grant, and every evidence file. On `block`, stop for the person and show
its per-question `classification`. On
`answer`, copy each receipt answer into its corresponding blank `[Answer]:`
slot and directly below it add `[Answer Source]: <receipt source>` and
`[AI Decision ID]: <receipt decisionId>`. These are AI provenance, never a
person's answers; do not change any other question-file bytes. Then run
`bun {{HARNESS_DIR}}/tools/d-acceleration/ai-question-answers.ts --project-dir <PRODUCT>`
followed by the receipt's `generatedCommandArgs` (`--stage <stage> [--unit <unit>] --ai-decision-file <receipt>`).
Continue only when it returns `recorded: "d-ai-question-ledger"`. It rechecks
the Intent state, delegation, question-template hash, answers, provenance and
evidence, then appends to the Intent's D-owned
`decisions/ai-question-answers.jsonl`, which is not the official audit; never
run `{{INVOKE}} engine log answer`, pass `--on-instruction`, emit any audit
event, or write a human answer on this path. A `researched-fact` must cite bound
evidence; a `delegated-ai-assumption` must remain explicit, conservative, and
reversible.

The Intent's D question-answer ledger `decisions/ai-question-answers.jsonl` is
the source of truth. Optional `decision-issue-summary.ts generate` produces one
Issue payload per Intent from it; a missing or empty ledger returns
`nothing-to-publish`, so tell the person there is nothing to publish.
Before `publish`, show the exact repository, Intent, and generated payload hash,
then require the person's latest host-recorded words to equal `AI-DLC authorize-decision-summary --repository <owner/repo> --intent <relative-intent> --payload-sha256 <sha256>`. Never infer publication from auto or AI-approval mode, and never create separate Issues for each unresolved item.

## `invoke-swarm`

When `{{HARNESS_DIR}}/tools/d-acceleration/parallel-guard.ts` exists, first save this exact directive JSON to a project-confined temporary file and run `bun {{HARNESS_DIR}}/tools/d-acceleration/parallel-guard.ts --project-dir <PRODUCT> --directive-file <directive-json>` (add `--message <id>` only when the person's own message, with that id, asked to build serially): continue only when it returns `continue`; on `refresh` run `next` again and act on that directive instead; on `stop` say its `recovery` line in one line and stop (D `parallel.enabled: false` outranks `AIDLC_USE_SWARM` and `flags.swarm`). Then continue with the orchestrator's own `invoke-swarm` rule.

## Inside `run-stage`

**Read-only research fanout (optional).** For an active `run-stage` with `gate:
false`, `mode: "inline"`, and stage `feasibility`, `market-research`, or
`performance-validation`, branch here before the ordinary body. Only when two or
more genuinely independent evidence questions exist, write a bounded fanout JSON
containing the exact current `directive`, `tasks` with unique `id`, official
`agent`, focused `objective`, and project-confined existing `evidencePaths`, plus
optional `maxParallel` from 1 through 4. Then run
`bun {{HARNESS_DIR}}/tools/d-acceleration/run.ts --project-dir <PRODUCT> --fanout-input <fanout-json>`.
The runner resolves configured D models itself, obtains a fresh official `next`,
and refuses a stale, gated, non-inline, or topology-owned directive. If fewer
than two independent tasks or trustworthy evidence paths exist, skip fanout and
run the official body normally; never invent work to satisfy the minimum. On
`lead-integration-required`, treat worker results only as read-only evidence:
the lead performs synthesis, writes every official artifact, runs the existing
reviewer and sensors, and reports the stage through the ordinary protocol. On
`official-host-action-required` continue with its returned directive; on any
worker failure, surface the uncertainty in lead synthesis rather than claiming
success. Workers never write files, transition state, approve, review, or answer
questions.

**D batch waves (optional).** On a selected stage-major walk, `directive.wave` is the engine-owned parallel surface for functional-design, nfr-requirements, nfr-design, and infrastructure-design. **When `{{HARNESS_DIR}}/tools/d-acceleration/run.ts` exists, this is the ordinary D path: immediately run `bun {{HARNESS_DIR}}/tools/d-acceleration/run.ts --project-dir <PRODUCT>`. Do not ask the person to run a separate runner.** D model routing is separate from official per-agent `config models` policy; read `{{HARNESS_DIR}}/tools/d-acceleration/model-routing.md` for the precedence, optional project/local files, and confirmed `opus` default. Never open an optional configuration file unless it exists. The D conductor obtains and validates the current official directive, gives each worker the complete official builder brief, restricts writes to the product, and leaves approvals, reviews, sensors, and state transitions with the official host. If it returns `official-host-action-required`, continue below with the returned directive. If it returns `parallel-off-action-required`, say its `recovery` line and stop. If it returns `worker-action-required` or fails, stop and surface its reason; never mark a Unit complete from worker exit alone. If the installed runtime is absent, use the host path below. Host path: a step that carries `directive.wave` runs by the wave module (`stage-protocol-wave.md`), which the engine names on it.

**Optional D checks (default off).** Resolve `features` and `featureInputs` once from the same project/local D configuration immediately after stage work and before the existing reviewer, sensors, and approval gate. Do not import, read inputs for, or dispatch a worker for a disabled feature. When enabled, write a bounded input manifest naming the current stage, Unit, exact artifact paths, the official `stories.md` as `storiesPath` (optional official `traceabilityPath` only where the directive declares it), the C UI contract as `uiContractPath`, and configured roots, each taken from the directive's own `consumes`/`produces`; save the exact executed official directive; then run `bun {{HARNESS_DIR}}/tools/d-acceleration/host-stage-boundary.ts --project-dir <PRODUCT> --directive-file <directive-json> --manifest <manifest>`. This executable obtains a fresh official `next`, requires an exact matching valid `run-stage` whose gate is resolved to boolean `false` or `true`, and invokes the installed feature checks; it rejects `gate: "unresolved"`, asks, and invented or stale directives. Run requirement/UI cross-validation at the refined-mockups handoff and functional-design handoff; run document discipline only on functional-design; run source grounding after domain-design; and run specification grounding after domain-design and per Unit after functional-design and code-generation. A NOT-READY exit stops advancement for correction. Pass the returned `evidencePath` to the already-required official reviewer as additional evidence; it is never a review receipt or approval. Grounding evidence is pre-collected from configured roots with symlinks rejected and strict file/byte bounds, then sent to a semantic worker with no filesystem tools. Missing or unverifiable grounding is uncertainty/NOT-READY, never success. These checks never replace, waive, or reorder the C HTML evidence sensor, official traceability sensor, reviewer, report, or human approval.
