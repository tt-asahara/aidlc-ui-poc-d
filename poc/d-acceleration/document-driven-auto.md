# Document-driven auto mode (design study)

Status: design study on `feat/d-document-driven-auto`, with the person's
decisions recorded under "Decisions" (they override the general study where
they differ, notably the boundary). Implementation is in progress.

## As built

Where this section and the study below differ, this section is current.

- **Entry: `/aidlc --from-docs <path> <description>`** (Claude `SKILL.md`). It
  does not use the generic `--auto` session: the ordinary loop already runs on
  until the next `ask`, and the stops are the gates and questions.
  1. The conductor writes the person's path to
     `.aidlc-engine/d-docs-path-<random>.txt` (so no shell ever reads it) and
     `document-answers.ts onboard --from-file <that file>` copies the handed-over
     documents (Markdown, text, PDF, Word; regular files only, no hidden or
     secret-looking names in a folder sweep) under
     `aidlc/spaces/<space>/knowledge/documents/<folder>/` and indexes each with
     the official `knowledge onboard`. A different file already at a target
     path stops the run; nothing is overwritten. A path that is or contains
     `aidlc/`, `.claude/` or `.aidlc-engine/` is refused, so AI-DLC's own
     records never become hand-over documents.
  2. The engine runs with the scope set explicitly
     (`--scope ui-poc-document-driven`), so there is no scope confirmation.
  3. Right after the official `intent-create`, `document-answers.ts bind`
     associates the handed-over documents with the new intent
     (`knowledge associate --intent`). The hand-over manifest records its space
     and time; `bind` refuses (and removes) a leftover from another space,
     scope, or an intent older than the hand-over. Answers read only documents associated
     with the active intent, so another intent's documents in the same space
     are never used. All DocumentKB calls go through `aidlc engine knowledge`
     (`execution.ts runEngineSync`), so the copy channel and native installs
     behave the same.
- **Grant: one short turn after the intent exists.** Measured on 2026-10-25
  with a headless run: the person's first prompt is not recorded as a
  `HUMAN_TURN`, because the record-human-turn hook writes into the active
  intent's audit and there is none yet. A grant bound to the start command is
  therefore impossible without core changes. Right after the intent is
  created, the conductor ends the turn; the person sends exactly
  `AI-DLC delegate-document-answers`, and
  `ai-approval-controller.ts document-grant` mints a `document-driven` grant
  bound to that turn with the same `grantHumanTurnRefusal` check as the
  low-risk grant. It is refused unless the intent's Scope is
  `ui-poc-document-driven`. Its stages are the intent's open EXECUTE stages from
  Ideation through `user-stories`, read from the state file.
- **Answers: `document-answers.ts answer --stage <stage>`.** No marker is
  needed: the citation check is the boundary, not a self-classification. A
  no-tool judgment model proposes `document-fact` (answer plus verbatim
  quotes with document IDs) or `needs-person` for each blank question. An
  answer is written only when every quote, NFKC-, case- and
  whitespace-normalized, is at least 15 characters and occurs in the current
  extracted text of a current DocumentKB record (read through the official
  `knowledge list/show --json`). This proves the quote is the documents'
  own words, not that it supports the answer: that judgement is the person's,
  made from the gate digest, which shows each answer beside its quote. The
  prompt, documents included, reaches the model on stdin, so no OS argument
  limit applies; one unusable model entry goes to the person on its own.
  Before writing, one `list` plus a hash of each original confirms that no
  document read was changed or removed meanwhile. The tool writes the slot with
  `[Answer Source]: document-fact`, `[AI Decision ID]` and `[Citation]` lines,
  appends `d-document-grounded-answer` rows to its own D ledger
  `decisions/document-answers.jsonl` before it writes the file (a crash in
  between leaves the slot blank), and returns the `residual`
  questions. Partial settlement is on; protected topics need the same
  verified quote as any other topic. The official audit is never written.
- **Gate digest: `document-answers.ts digest --stage <stage>`** reads the
  questions file as it is now: a slot counts as the documents' answer only
  while it carries the `document-fact` provenance and its exact answer matches
  a ledger row for that decision and question; any other filled slot is the
  person's. The conductor opens each gate message with it.
- **Rough Mockups:** in this scope the conductor first revises and has the
  reviewer review again (at most two more times, as the review loop allows)
  before asking about open Critical or Major findings.
- **Not built yet:** pre-drafting the next stage while a gate waits, and push
  notification at a gate.

Stops for a new project whose documents settle every question: 1 delegation
turn plus 6 stage gates. Each residual question set adds at most one message
for its stage.

## Goal

The person hands AI-DLC every requirement document at the start. From then on
the workflow keeps producing AI-DLC artifacts and stops for the person only
where the upstream engine leaves no other choice. Every question that the
documents settle is answered from the documents, with a verified citation.
The goal is measurable: the number of human stops per workflow, counted from
the official audit (`HUMAN_TURN` rows the run needed).

Non-goals:

- Changing `core/`. It stays byte-identical to upstream AI-DLC v2.11.0.
- Producing approvals without a person. Faking presence (a driver that types
  "approve", a minted `HUMAN_TURN`, `AIDLC_SKIP_HUMAN_PRESENCE_GUARD`) is out
  of scope, because it defeats the guard that makes an approval the person's.

## Fixed constraints from the upstream engine

These are facts of core v2.11.0, not D choices. The mode is designed around
them.

| Constraint | Source |
| --- | --- |
| Every Ideation and Inception stage ends with an approval gate. No setting removes one. | `docs/guide/07-interaction-modes.md` "Approval Gates"; `docs/guide/05-scopes-and-depth.md` ("No other setting removes an approval gate") |
| One human turn resolves exactly one decision. The boundary is workflow-global, so one reply cannot approve two gates. | `core/tools/aidlc-lib.ts` `GATE_RESOLUTION_EVENTS` and the comment above it; `core/tools/aidlc-state.ts` ("one commit per human turn") |
| The agent may choose a stage's answers only when the person left that stage's choice to it, recorded with `--on-instruction`. It is one-time, per stage. | `core/aidlc-common/protocols/stage-protocol.md` §3 item 6 and "When a user leaves a choice to you" |
| In Construction, **Continue automatically** waives ordinary per-Unit completion checkpoints. Plan Approval (unless off), enabled summary confirmation, verification command selection, skeleton approval, and failures still stop. | `docs/guide/04-phases-and-stages.md` Phase 3 |
| Scope ceremony defaults (`summary_confirmation`, `learnings`, `plan_approval`, `skeleton`) are per-scope settings a plugin scope may declare. | `docs/guide/05-scopes-and-depth.md` "Ceremony"; `poc/ui-poc/scopes/*.md` frontmatter |
| DocumentKB indexes the team's own documents (Markdown, text, PDF, Word) and returns citable records with extracted text bound to a revision. | `docs/guide/08-knowledge.md` "Document Knowledge"; `/aidlc knowledge onboard\|sync\|show` |

D already has three building blocks:

- The generic `/aidlc --auto` session (`generic-auto-cli.ts`, `host-session.ts`):
  bounded continuation, deadline that pauses while the person is waiting,
  checkpoints on every official directive.
- Delegated stage questions (`ai-question-controller.ts`,
  `ai-question-answers.ts`, `delegated-questions.md`): a judgment model answers
  stage questions under the person's hash-bound grant, recorded in the D ledger.
  Today it is nearly inert, because every question needs the
  `[AI-Autonomy]: low-risk-reversible` marker and a whole set is refused when
  any protected term appears. Requirement documents nearly always contain
  protected terms (target users, pricing, release).
- Read-only cross-stage speculation (`cross-stage-speculation.ts`): drafts for a
  later stage while the current stage waits at its gate.

## Inventory of human stops

Each stop the official flow can raise, and what the mode does with it.
"Remove" means the stop does not occur. "Delegate" means D answers it from
the documents under the person's grant. "Shrink" means the stop stays, but it
takes a one-word reply. "Keep" means it stays as it is.

| Stop | Owner | Mode |
| --- | --- | --- |
| Scope confirmation | core | Remove: the start command names the scope explicitly (to be confirmed by measurement in P0). |
| Interaction-mode question (Guide me / Edit file / Chat) | core | Remove: the start request says how questions are answered, so the stage protocol records it with `--on-instruction` and does not ask. |
| Stage questions (`<stage>-questions.md`) | core stage, D settler | Delegate: document-grounded answers (below). Residual questions go to the person. |
| Summary confirmation | ceremony | Remove: the mode's scope declares `summary_confirmation: off`. |
| Learnings ritual | ceremony | Remove: `learnings: off`. |
| Ideation and Inception approval gates | core | Shrink: gate digest, pre-drafted next stage, notification. One-word reply. |
| Walking skeleton approval | ceremony | Remove: `skeleton: off`. |
| Construction autonomy offer | core | Shrink to zero extra turns: the person states it in their Delivery Planning approval ("approve, and run Construction on its own"), which core accepts in the same message. |
| Per-Unit completion checkpoints | core | Remove: autonomous Construction. |
| Plan Approval (per Unit) | ceremony | Remove: `plan_approval: off` in the mode's scope. |
| Verification command selection | core | Keep (once per workflow). Candidate: pre-declare it in project memory; to be measured. |
| Failures, blocking sensors, recovery | core | Keep. A failure needs the person. |
| Operation stages | core | Out of the first version: the default boundary is `--through build-and-test`. |

## Mode design

### Entry

```
/aidlc --from-docs <path> <description>
```

1. **Documents.** D runs the official `knowledge onboard <path>` and
   `knowledge sync`, so DocumentKB holds every document with an ID, a revision,
   and extracted text. D never parses PDFs or Word files itself.
2. **Scope.** A new ui-poc plugin scope `ui-poc-document-driven` (stages under
   "Decisions") with these ceremony defaults:
   `summary_confirmation: off`, `learnings: off`, `plan_approval: off`,
   `skeleton: off`, `collaborators: off`. Sensors and reviewers stay on. These
   are scope defaults, not locks, so the person can turn any of them back on.
   The person can pick another scope with `--scope`; the stop count then rises
   by that scope's ceremonies.
3. **Grant.** The start command itself is the delegation. Today the grant needs
   the separate exact turn `AI-DLC delegate-ai-approvals ...`. The mode adds a
   second grammar in `ai-approval-controller.ts`: when the person's latest
   host-recorded turn is `/aidlc --from-docs ...`, `grant` mints a
   `document-driven` grant for every question stage of the selected scope up
   to the `--through` boundary, bound to the hash of those words and to the
   DocumentKB revision set. The same `grantHumanTurnRefusal` check applies.
   One owner per rule: the existing check is reused, not copied.
4. **Session.** `generic-auto-cli.ts start` as today, with the boundary at
   `user-stories` and the deadline/step/no-progress limits as today.

### Document-grounded answers

A new eligibility class next to `low-risk-reversible`:

```
[AI-Autonomy]: document-grounded
```

The conductor writes it on every `## Q<n>` question while a `document-driven`
grant covers the stage. The controller then gives the judgment model the
question file, the stage's upstream artifacts, and the DocumentKB extracted
texts (within the existing input limits; larger corpora are pre-selected by
DocumentKB summary and tags). For each question the model returns either:

- `document-fact`: an answer plus one or more citations
  (`documentId`, `revision`, exact quote), or
- `needs-person`: no document settles it.

The settler accepts a `document-fact` only when every citation verifies
deterministically: the document ID and revision are current in DocumentKB,
and the quote occurs in its extracted text after whitespace normalization.
A citation that does not verify turns that answer into `needs-person`. The
model never decides that a citation is valid.

Protected terms change meaning in this mode. Today one protected term anywhere
stops the whole set. Under `document-grounded`, a question that touches a
protected category (target users, pricing, personal data, contracts, release,
security, credentials, production, deletion, legal, payment) may be answered
only as a verified `document-fact`: the person's own document decided it.
A `delegated-ai-assumption` on a protected question is never accepted.

Partial settlement. Today a mixed set stops as a whole. In this mode D fills
every verified answer, then asks the person only the remaining questions, in
one message. The reasons for all-or-nothing in `delegated-questions.md` are
addressed as follows: each filled slot carries `[Answer Source]` and the
citation, so the source of every slot is readable; the person answers far fewer
questions; the filled answers are the documents' words, not the model's
preference, so anchoring is limited to what the person already wrote.

### Gates

A gate still needs the person's reply. The mode makes each one cheap:

- **Gate digest.** At each gate D shows one screen: the decisions taken from
  documents (with citations), the assumptions (none on protected topics), what
  the documents did not cover, and the artifact list. The person can approve
  from the digest alone.
- **Pre-drafting.** While the gate waits, `cross-stage-speculation.ts` drafts the
  next stage from the documents and the settled upstream records. After the
  approval, the next stage finishes quickly and reaches its gate soon.
- **Notification.** D sends a push notification when the run reaches a gate or a
  residual question, so the person can reply "承認" from another device.

### Construction

The person's Delivery Planning approval carries the autonomy choice
("承認、Construction は自動で進めて"). With `plan_approval: off` and
`skeleton: off`, Construction then runs every Unit without a stop until Build
and Test, except for the verification command choice and any failure.

## Expected stops

Estimate for `ui-poc-document-driven` on a new project with documents that
cover the requirements. P0 replaces these numbers with measured counts.

| Stop | Today (`ui-poc-application`) | Mode |
| --- | --- | --- |
| Scope confirmation | 1 | 0 |
| Interaction mode | 1 | 0 |
| Stage question sets | about 10 | residual only (0 to a few) |
| Summary confirmations | about 10 | 0 |
| Learnings questions | about 13 | 0 |
| Ideation and Inception gates | about 12 | about 12, one word each |
| Skeleton, autonomy offer | 2 | 0 |
| Plan Approval | 1 per Unit | 0 |
| Per-Unit checkpoints | 1 per Unit (if gated) | 0 |
| Verification command | 1 | 1 |

The floor is the Ideation and Inception gates plus the verification command.
Fewer gates are possible only by running fewer stages (`--skip`, or a smaller
scope), which also produces fewer AI-DLC artifacts.

## Implementation plan

- **P0 Measurement.** A headless fixture run that counts the human stops by
  kind from the audit, for `ui-poc-application` today. It settles the open
  facts above (scope confirmation with an explicit scope, interaction mode,
  verification command).
- **P1 Scope and entry.** `ui-poc-document-driven` scope, the `--from-docs` entry in
  the Claude `SKILL.md`, DocumentKB onboarding, the `document-driven` grant.
- **P2 Document-grounded answers.** Eligibility class, citation verifier,
  protected-topic rule, partial settlement, ledger rows with citations.
- **P3 Gate cost.** Gate digest, pre-drafting hook-up, notification.
- **P4 Construction glue.** Autonomy in the Delivery Planning reply, measured
  end-to-end run with P0's counter.

Every phase keeps `git diff --stat -- core` empty.

## Decisions (2026-10-25)

The person decided:

1. **UI only.** The mode is a ui-poc scope. No non-UI variant.
2. **Boundary: through 2.4 User Stories.** The mode stops before 2.5 Refined
   Mockups. Construction and Operation are out, so Plan Approval, skeleton,
   autonomy, and the verification command never arise. To continue, the person
   runs `/aidlc --add refined-mockups` (or starts a `ui-poc-application`
   intent) after reviewing the stories.
3. **Protected topics.** A question on any topic may be answered by AI when a
   verified document quote settles it. Without a verified quote it goes to the
   person; a `delegated-ai-assumption` on a protected topic is never accepted.

### Resulting scope: `ui-poc-document-driven`

Stages (the `ui-poc-requirements` set without Refined Mockups): Initialization
(3, no gate), 1.1 Intent Capture, 1.4 Scope Definition, 1.6 Rough Mockups,
2.1 Reverse Engineering (brownfield only), 2.2 Practices Discovery,
2.3 Requirements Analysis, 2.4 User Stories. The intent completes when User
Stories is approved.

Frontmatter: `skeleton: off`, `summary_confirmation: off`, `learnings: off`,
`plan_approval: off`, `collaborators: off`, `sensors: on`,
`guard_policy: strict`. No routing keywords: the mode is entered only by the
explicit `--from-docs` command or by naming the scope.

### Resulting stop budget

| Stop | Count (new project) |
| --- | --- |
| Approval gates | 6 (7 on an existing codebase, with Reverse Engineering) |
| Residual questions | only questions the documents do not settle, one message per stage at most |
| Rough Mockups open Major review findings | 0 when the bounded fix loop clears them, else 1 |
| Failures, blocking sensors | as they occur |

Rough Mockups adds a stop of its own: when the reviewer leaves a Critical or
Major finding open, the ui-poc contribution asks the person "Fix / Decide each /
Accept all". In this scope the conductor takes the recommended **Fix the Major
findings first** path without asking, for at most two fix-and-review rounds,
and asks only when findings remain open after that. Accepting a risk always
stays the person's, because it needs their own words as the rationale.
