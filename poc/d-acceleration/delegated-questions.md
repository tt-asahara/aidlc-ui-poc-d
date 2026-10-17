# Delegated low-risk stage questions

`ai-question-controller.ts` lets a judgment model answer ordinary stage
questions after the person explicitly delegated the stage
(`AI-DLC delegate-ai-approvals ...` → `ai-approval-controller.ts grant`). The
core settler `core/tools/aidlc-ai-answers.ts` rechecks every binding and emits
`AI_QUESTION_ANSWERED`, never `QUESTION_ANSWERED` or `HUMAN_TURN`. The answer is
AI provenance and is never treated as the person's answer.

## One owner for the file grammar and the target

`core/tools/aidlc-ai-answers.ts` owns three things. The PoC controller imports
them, and the package projection rewrites that import to `../aidlc-ai-answers.ts`.

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
model is read from Claude Code's `modelUsage` key (`worker-adapters.ts`; it is
set only when exactly one model reports). It was `claude-opus-5-5` on every
call.

- `e2e-installed/` (`run-e2e.ts`): a fresh synthetic project using the
  generated Claude package.
  - Flow: official scope confirmation → typed intent-create → bootstrap → the
    `run-stage intent-capture` directive.
  - The person's turns go through the record-human-turn hook: three ceremony
    choices, then the exact delegation command.
  - `grant` → canonical Japanese five-question file → real model `answer`
    (confidence 0.93, all `researched-fact`, 7.6 s, $0.017).
  - Inline `[Answer Source]` / `[AI Decision ID]` are written into the file.
    `aidlc-ai-answers.ts` emits 5 `AI_QUESTION_ANSWERED` rows; the replay
    returns `reused`.
  - The audit holds 0 `QUESTION_ANSWERED` rows. The 5 `HUMAN_TURN` rows are
    exactly the person's 5 hook turns: 4 before the AI answers, plus the gate
    Approve.
  - The stage then advances: `report awaiting-approval`, the person approves,
    and official `next` returns `run-stage requirements-analysis`.
- `per-unit/` (`run-per-unit.ts`): seeded unit-major state, installed tools.
  - Case A: the `notes-core` `nfr-requirements` answers settle only with
    `--unit notes-core`. Settling without it is refused with "Unit does not
    match". Each audit row carries `Unit: notes-core`.
  - Case B: a question about silently syncing notes to the vendor's server was
    marked low-risk and passed the lexical guard. The model **blocked** it.
  - Case C: running without `--unit` stops before any model call.
- `threshold-block/`: an earlier run with no convention evidence. The real
  model answered with confidence 0.82, below 0.85, so the run failed closed.

## Known gaps (not closed here)

- The ordinary engine never issues a `present-gate` directive. See
  `aidlc-orchestrate.ts`: "present-gate ... arrive in later waves". As a
  result, `ai-approval-controller.ts` has no official directive to bind to in
  a real installed flow, and the E2E gate was approved by the person. This
  belongs to the AI stage-approval work, not to question answering.
- Summary confirmation, the advisory reviewer, and learnings were switched off
  by the synthetic person's own recorded requests (the official `config set`
  setters refuse without a human turn). With summary confirmation on, the
  stage still needs the person's `Looks correct`. That stays a human
  checkpoint by design.
- The per-Unit run seeds the state instead of walking every earlier stage. A
  full Construction walk belongs to the generic-auto E2E work.
