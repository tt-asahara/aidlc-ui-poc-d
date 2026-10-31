# Delegated low-risk stage questions

`ai-question-controller.ts` lets a judgment model answer ordinary stage
questions after the person explicitly delegated the stage
(`AI-DLC delegate-ai-approvals ...` → `ai-approval-controller.ts grant`). The
D settler `ai-question-answers.ts` rechecks every binding and appends the
answers to the Intent's D-owned ledger `decisions/ai-question-answers.jsonl`
(each row says `ledger: "d-acceleration (not the official AI-DLC audit)"`). It
never writes the official audit or engine state and never emits
`QUESTION_ANSWERED` or `HUMAN_TURN`. The answer is AI provenance and is never
treated as the person's answer. The replay check and the append run under one
exclusive `<ledger>.lock` (O_EXCL, a dead holder's or 30 s old lock is
retaken), and rows land in a single O_APPEND write, so concurrent settlers
neither lose rows nor record a decisionId twice. The controller's own
`ai-question-decisions.jsonl` and `ai-question-blocks.jsonl` use the same lock.

Before the core restore this settler lived in `core/tools/aidlc-ai-answers.ts`
and emitted a D-added `AI_QUESTION_ANSWERED` audit event. `core/` is now
byte-identical to upstream AI-DLC v2.11.0, which knows no such event, so the
record moved to the D ledger. The engine never needed that event: answered
questions files advance through the ordinary stage protocol either way.

## The grant is bound to the person's own turn

`ai-approval-controller.ts grant` mints the delegation only when the words in
`--user-message-file` equal the person's latest host-recorded turn, read
by D's read-only `person-turn.ts` from the official `HUMAN_TURN` row and the
message record its `Message Id` names (the record-human-turn hook is the only
writer of both). A missing turn, a later turn, or different words refuse with one
line: ask the person to type the exact `AI-DLC delegate-ai-approvals ...`
command, then rerun `grant`. The grant (`schemaVersion: 2`) records
`humanTurn: { at, session, wordsSha256 }` inside its request hash. The one
shared check `grantHumanTurnRefusal` runs in the controller precheck and again
in the settler: the schema, the request hash, the words hash, and a
`HUMAN_TURN` row with that exact Timestamp and Session in the active Intent's
official audit. A hand-written or schema-1 grant never reaches the model and
never settles.

## One owner for the file grammar and the target

`ai-question-answers.ts` (D-owned, projected to
`.claude/tools/d-acceleration/`) owns three things. The controller and
`question-wait.ts` import them.

- `questionSections` / `sectionEligibility`: the question-file grammar.
- `resolveAiQuestionTarget`: which questions file may be AI-answered now.
- `questionTemplate`: the hash of everything outside the answer slots.

Before this change, the controller and the settler each had their own copy of
these rules. Both copies also missed one engine fact: the engine writes
`Lifecycle Phase` in upper case (`IDEATION`), while record directories are lower
case. Because of that, every real installed Intent failed the canonical-path
check. The shared resolver lower-cases the phase.

### Accepted grammar (decided explicitly; no `\b`, no guessing)

| Input | Result |
| --- | --- |
| `## Q1`, `## Q1 — 表示`, `## Q1：表示`, `## Q1. 表示`, `## q1` | Question `Q1` |
| `## Q１` (full-width digit), `## Ｑ1`, `## Q1a`, `## Q1回答`, `### Q1`, `#Q1` | Not a heading |
| `[Answer]:` (ASCII colon) | Answer slot |
| `[Answer]：` (full-width colon) | Not a slot |
| `[AI-Autonomy]: low-risk-reversible` once, before the section's only slot | Eligible |
| No marker | `unmarked` |
| Full-width colon, other value, duplicate, or marker after the slot | `malformed` |
| Any protected term in the section | `protected` |

A heading check that uses `\p{L}\p{N}` instead of `\b` keeps Japanese text
from being mis-split (reference repo B pitfall #237). Inputs that are not
recognised are never repaired. They change the heading or slot counts, and
the count checks then fail closed.

A set is answered only when **every** section is `eligible`, every slot is
blank, and no protected term appears anywhere in the file. A mixed set is
stopped as a whole. The block result carries a per-question `classification`,
so the person can see which questions need them. We decided against partial
settlement for four reasons:

- The stage protocol collects and analyses the whole answer set at once
  (ambiguity and contradiction checks, then the summary confirmation).
- A file where some slots are AI-filled and some are human-filled makes the
  answer source of each slot harder to read.
- The person still has to answer the remaining questions, so pre-filling saves
  little.
- Pre-filled answers could anchor the person's own answers.

## Per-Unit Construction questions

The official layout comes from the stage files
`functional-design`/`nfr-requirements`/`nfr-design`/`infrastructure-design`.
Each one writes
`<record>/construction/{unit-name}/<stage>/<stage>-questions.md`. The engine
writes `code-generation-questions.md` itself (Plan Approval), so it is never
AI-answered.

`--unit <name>` on both the controller and the settler binds the decision to
that Unit. `unit` is part of the receipt payload, so it is covered by the
decision ID, and each audit row carries `Unit`. A per-Unit target is accepted
only when all of these hold:

- `Lifecycle Phase` is Construction and the stage is one of the four design
  stages.
- `Unit Ownership` is solo. Team-owned Unit gates and worktrees stop.
- The runtime mirror that `aidlc-state.ts` writes on `unit start` names this
  Unit: `Active Unit` is the Unit, `Unit Stage` is the stage, and `Unit State`
  is `in-progress`.
- `Construction Iteration` is `stage-major` (and the stage is the current
  `[-]` stage) or `unit-major` (and the stage line is still `[-]` or `[ ]`;
  Current Stage stays on the first block stage in that walk).

The following stop:

- A per-Unit stage with an active Unit but no `--unit`.
- A wrong or paused Unit.
- An unknown iteration.
- A stage-level path used for a Unit.
- An invalid Unit name.
- Any other layout.

The receipt also goes stale when the Unit moves to another stage, because the
state hash changes.

## The `[AI-Autonomy]: low-risk-reversible` marker: decision

**Who writes it.** The conductor that writes the questions file (the stage's
lead agent in the orchestrator session). Today only `harness/claude` `SKILL.md`
tells it to. No core stage file mentions the marker, so a normal run never
produces it, and the feature stays inert unless the conductor follows the
SKILL rule. That is intended: D is opt-in and core stays neutral.

**Correctness.** The marker is a self-classification by the same agent that
benefits from a delegated answer. On its own it is not a safety boundary. It
is one of four independent conditions, and all four must hold:

1. The person's exact, hash-bound delegation for this stage.
2. The marker on every question.
3. The deterministic protected-term guard over the whole file.
4. The judgment model's own `answer` with calibrated confidence above
   `max(config, grant)`.

The real-model run shows that condition 4 catches a mislabelled question (case
B below). The lexical guard is deliberately coarse:

- It over-blocks. A harmless "個人情報なし" note stops a set (pinned by a
  test).
- It under-detects. "利用者のメモを開発元サーバーへ同期" contains none of the
  terms; the model blocked it.

**Burden.** The marker costs one line per question. It is only written when a
grant for the stage exists, so ordinary runs are unaffected.

**Decision.** Keep the explicit per-question marker. Do **not** add
deterministic defaulting, such as treating unmarked questions as eligible or
deriving eligibility from the question text. That would make the coarse
lexical guard the only pre-model barrier, and it weakens safety. The low-risk
improvements below were implemented:

- Exact marker grammar (exactly once, before the slot; full-width and other
  values are `malformed`).
- Per-question classification in block results.
- Wider Japanese and English protected terms: `対象ユーザ`, `ターゲット`,
  `価格`/`料金`/`課金`, `個人情報`, `契約`, `リリース`/`デプロイ`, `release`,
  `pricing`, `personal data`, `target user`.
- A calibrated definition of confidence in the prompt.
- One-line answers only.
- One wrapping Markdown code fence is unwrapped. This is a syntax
  normalization; every field is still validated.

**Operational consequence.** With honest calibration, preference questions
without evidence come back below a 0.85 threshold. The observed confidences
were 0.82, 0.75 and 0.74 for display label, date format, sort order, sample
count and tone. Only `threshold-block/` (0.82) has a saved receipt; 0.75 and
0.74 were manual reruns with the calibrated prompt, and their output was not
kept.

The same questions pass at 0.93 when the record contains a convention or NFR
note that the model can cite as `researched-fact`. Delegated question
answering is therefore effective mainly for **evidence-backed** low-risk
details. That is the intended behaviour, not a defect to tune away.

## Real-model evidence (`evidence/delegated-questions/`)

Requested model: `claude-opus-5-5` (`models.judgment`). The runtime-reported
model was `claude-opus-5-5` on every call. It is read from Claude Code's
`modelUsage`. After the merge with develop, `worker-adapters.ts`
`parseWorkerOutput`/`classifyModelIdentity` is the only parser that does this.
The receipt binds `model.identityStatus` (`verified-match`, `alias-resolved`,
`mismatch` or `unverified`), and block and answer results carry
`telemetry.modelIdentity` and `telemetry.usage`.

**Historical record.** The files in `e2e-installed/`, `per-unit/` and
`threshold-block/` were recorded before the merge and before the core restore.
In them the telemetry uses the earlier field names (`runtimeReportedModel`,
`totalCostUsd`, `usage`), the flow used the removed typed intent-create and an
unbound grant, and settlement used the removed core settler
(`core/tools/aidlc-ai-answers.ts`, `AI_QUESTION_ANSWERED` audit rows). The
bullets below describe what those runs recorded, not today's behavior.

**Current drivers.** `run-e2e.ts` and `run-per-unit.ts` now use today's
interfaces: the official print's `intent create` command is run exactly as
printed (only `--label` filled), `bootstrap` takes no directive and binds only
to the Intent created since `start`, the person's delegation words are
recorded by the record-human-turn hook immediately before `grant`, and
settlement is `d-acceleration/ai-question-answers.ts`, which appends to
`decisions/ai-question-answers.jsonl` (no audit event; the drivers also copy
that ledger into their output). They were not re-run with a real model. A
no-model interface smoke (no `claude` on PATH, so the assessor stops) is
recorded in `interface-smoke-no-model.json` (scope print → `intent create` →
`bootstrap` → `run-stage intent-capture` → three ceremony turns → hook-bound
`grant`, then `block` at executable resolution) and
`interface-smoke-per-unit-no-model.json` (hook-bound grants pass the precheck;
case C still blocks without `--unit`). The settlement path is re-verified
offline by `tests/ai-question-controller.test.ts`.

- `e2e-installed/` (`run-e2e.ts`): a fresh synthetic project using the
  generated Claude package.
  - Flow (historical): official scope confirmation → typed intent-create →
    bootstrap → the `run-stage intent-capture` directive.
  - The person's turns go through the record-human-turn hook: three ceremony
    choices, then the exact delegation command.
  - `grant` → canonical Japanese five-question file → real model `answer`
    (confidence 0.93, all `researched-fact`, 7.6 s, $0.017).
  - Inline `[Answer Source]` / `[AI Decision ID]` are written into the file.
    The then-core `aidlc-ai-answers.ts` emitted 5 `AI_QUESTION_ANSWERED` rows
    (historical; today: 5 D-ledger rows); the replay returned `reused`.
  - The audit holds 0 `QUESTION_ANSWERED` rows. The 5 `HUMAN_TURN` rows are
    exactly the person's 5 hook turns: 4 before the AI answers, plus the gate
    Approve.
  - The stage then advances: `report awaiting-approval`, the person approves,
    and official `next` returns `run-stage requirements-analysis`.
- `per-unit/` (`run-per-unit.ts`): seeded unit-major state, installed tools.
  - Case A: the `notes-core` `nfr-requirements` answers settle only with
    `--unit notes-core`. Settling without it is refused with "Unit does not
    match". Each (then-)audit row carried `Unit: notes-core`; today each D-ledger
    row carries `unit: "notes-core"`.
  - Case B: a question about silently syncing notes to the vendor's server was
    marked low-risk and passed the lexical guard. The model **blocked** it.
  - Case C: running without `--unit` stops before any model call.
- `threshold-block/`: an earlier run with no convention evidence. The real
  model answered with confidence 0.82, below 0.85, so the run failed closed.

## Known gaps (not closed here)

- Delegated AI stage-gate approval was dropped with the core restore: the
  upstream engine accepts a stage approval only from the person, so every gate
  (including the E2E gate above) is approved by the person.
- Summary confirmation, the advisory reviewer, and learnings were switched off
  by the synthetic person's own recorded requests (the official `config set`
  setters refuse without a human turn). With summary confirmation on, the
  stage still needs the person's `Looks correct`. That stays a human
  checkpoint by design.
- The per-Unit run seeds the state instead of walking every earlier stage. A
  full Construction walk belongs to the generic-auto E2E work.
