# Arm C stage-to-skill contract

This is the human-readable companion to `tools/ui-poc/c-stage-routing.json`. The JSON is the deterministic routing source; this document explains why. It is pinned to Matt Pocock `skills` commit `49dd158d1076134a641b33efb035946536778336`, historical Impeccable commit `209444a9d552c18bcaa74e26bf66a25fc568a767`, and AI-DLC `v2.11.0` commit `6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a`. Updating any pin is a separate reviewed change.

AI-DLC owns stage order, stage conditions, questions, pending-question state, artifacts, Testing Contracts, reviews, and every approval. A Matt skill is a bounded method used inside an already-running stage. It never opens its own approval, advances a stage, changes a Testing Contract, publishes to a tracker, or creates a throwaway branch. `adds.scopes` only adds membership; it does not scope prose or sensors. Therefore this plugin is enabled only in the isolated C comparison repository, with the `ui-poc-comparison` scope explicitly selected.

## Deterministic invocation boundary

Run the projected tool before applying a treatment:

```text
node <harness>/tools/ui-poc-c-routing.cjs plan --stage <slug> --scope <engine-scope> [--facts <stage-facts.json>]
```

The routing config's `runtimeProfiles` map is the single source of enabled scopes. The engine-derived scope, recorded execution context, and selected runtime profile must agree exactly. `ui-poc-comparison` carries comparison treatment `C`; ordinary `ui-poc-application` uses the same bounded runtime methods without claiming comparison-treatment metadata. Missing facts for a conditional rule are a hard stop. A true fact yields `use`; false yields `do-not-use`. The plan names the runtime profile, optional comparison treatment, exact entrypoints, inputs, outputs, adapter constraints, and routing-config hash. The stage writes `ui-poc-skill-evidence.json` in its engine-resolved record directory and verifies it before completion:

```text
node <harness>/tools/ui-poc-c-routing.cjs verify --stage <slug> --facts <record>/ui-poc-routing-facts.json --context <record>/ui-poc-routing-context.json --output-path <record>/<stage-output> --log <record>/ui-poc-skill-evidence.json
```

`skill-read` attests that exact entrypoint bytes were read; the verifier checks those bytes against the source-lock repository, commit, byte size, and Git blob SHA. `skill-applied` separately binds every configured input and output to either a bounded input value or a project-confined file plus SHA-256; outputs must be files. A read alone never proves application. The verifier rejects approval, tracker-publication, and read/application events for unselected or disabled skills. It checks repeatable routing and evidence shape, not identical model prose or pixels.

For a false conditional fact the log records `skill-skipped` with the condition and reason; this is different from silently omitting the skill. Facts must be JSON booleans. The log carries SHA-256 bindings for the facts file and `ui-poc-routing-context.json`. The sensor derives the record ID, Unit, scope, and current `aidlc-state.md` SHA-256 from the dispatcher-provided output path and requires the context to match them. The positive numeric `attempt` is an audit label; the engine-state digest is the enforceable replay boundary. This rejects reuse after the engine state changes or in another record/Unit. The official sensor API does not expose the engine's canonical attempt identity, so two distinct attempts that somehow retain byte-identical state are outside this guarantee. It remains an auditable agent attestation, not proof that a model cognitively followed prose.

The read event is an auditable agent attestation whose hash is checked against the installed file; software cannot prove that a model cognitively followed prose. Likewise, `prototype-ui`, `prototype-logic`, `grilling`, and `domain-modeling` are recorded as `bounded-adapter`, not as full upstream-skill execution, because the adapter deliberately excludes upstream lifecycle actions that conflict with AI-DLC.

### Why rough-mockups contains bounded HTML exploration

The experiment's required causal chain begins with exploratory HTML, then uses what it reveals to sharpen requirements and Stories/AC before a separately approved refined HTML handoff. Waiting until Refined Mockups for the first HTML would remove that discovery loop. The rough adapter therefore borrows only Matt UI's single-surface variant switcher and structural contrast. It caps the work to the stage-provided timebox, keeps the core `wireframes.md`, `user-flow.md`, and questions, uses placeholder/read-only behavior, avoids production polish and mutations, and labels every treatment-discovered requirement provisional until Requirements Analysis settles it. This is not a full execution of the upstream UI skill, whose production-adjacent routing, polish, capture, and throwaway-branch instructions are excluded here.

The LOGIC adapter is narrower still: it routes only when the stage fact `state_model_uncertainty` is explicitly true and requires the uncertainty source, one prototype question, scenarios, and a timebox. It produces an adjunct HTML/verdict, not Domain Design or Functional Design. If those inputs are absent the router blocks rather than inventing them.

### C Design Context and accessibility adapters

Before the first design application, use this order: a loaded creator-confirmed `Design Context`, then root `.impeccable.md`, then—only if required fields are still absent—the fixed `teach-impeccable` text as a bounded question organizer inside AI-DLC's existing question flow. Audience, use cases, and brand tone must come from the creator; code inspection is supporting evidence, not confirmation. The stage hashes a context snapshot and its source reference. The adapter never edits `AGENTS.md`, creates a second approval, or starts a separate interview. A/B/C must receive the same confirmed comparison brief; any C-only follow-up is logged as an evaluation difference so C gains no silent information advantage.

All seven bundled frontend-design reference files are read and hash-verified for each design application; this conservative rule avoids claiming an unread reference was followed. The pinned `color-and-contrast.md` incorrectly says large text is 18px or 14px bold. The source remains byte-identical. C instead emits a hashed correction report and verifies WCAG's 18pt or 14pt bold threshold as 24 CSS px or approximately 18.67 CSS px. This is an explicit adapter, not a silent source edit.

## All-stage routing

| Phase | Stage | Decision | Skill and invocation point | Inputs → outputs | Completion / stop boundary |
|---|---|---|---|---|---|
| Initialization | workspace-scaffold | Do not use | — | Core bootstrap only | AI-DLC result owns transition |
| Initialization | workspace-detection | Do not use | — | Workspace evidence only | AI-DLC classification owns routing |
| Initialization | state-init | Do not use | — | Core state only | Never alter state from skill prose |
| Ideation | intent-capture | Do not use | — | Core intent artifacts | Core questions and approval only |
| Ideation | market-research | Do not use | — | External/product research | Skill set adds no relevant method |
| Ideation | feasibility | Do not use | — | Technical-risk analysis | Skill set adds no relevant method |
| Ideation | scope-definition | Do not use | — | Scope and backlog | Do not duplicate requirements interview |
| Ideation | team-formation | Do not use | — | Team/capacity artifacts | Skill set adds no relevant method |
| Ideation | rough-mockups | Use | `prototype/SKILL.md` + `UI.md`, then `Impeccable frontend-design/SKILL.md + seven references`, before Step 4 | approved common brief, intent/scope/backlog → low-fidelity exploration HTML, direction notes, rough contract | End when bounded variants expose the design questions and core rough artifacts exist. Stop on missing pin/entrypoint, unresolved route, remote dependency, or attempted real mutation/branch operation. AI-DLC approval remains separate. |
| Ideation | rough-mockups | Conditional | `teach-impeccable/SKILL.md` iff `design_context_missing=true`, before design work | common brief, known context, unresolved fields → creator-confirmed context snapshot | Use only AI-DLC questions; false requires skip evidence. Never infer from code, update AGENTS.md, or create a new approval round. |
| Ideation | rough-mockups | Conditional | `prototype/SKILL.md` + `LOGIC.md` before Step 4 iff `state_model_uncertainty=true` | one explicit logic question + scenarios → self-contained logic HTML + verdict | One question only. No production code, persistence, tests, or approval. False means an evidenced skip; missing fact blocks. |
| Ideation | approval-handoff | Do not use | — | Core Ideation synthesis | Phase approval is exclusively AI-DLC |
| Inception | reverse-engineering | Do not use | — | Brownfield evidence | No vendored skill replaces source scan |
| Inception | practices-discovery | Do not use | — | Team practices | Do not duplicate its interview/affirmation gate |
| Inception | requirements-analysis | Conditional | `grilling/SKILL.md` inside Steps 6–8 iff `unresolved_requirement_decisions=true` | rough UI evidence, known facts, current requirements → question frontier + settled-decision map | AI-DLC asks the frontier, records answers, and decides follow-ups. No separate “shared understanding” confirmation. Missing facts block; empty frontier ends application. |
| Inception | requirements-analysis | Conditional | `domain-modeling/SKILL.md` and formats iff `domain_language_conflict=true` | requirements, glossary, code evidence → term/boundary deltas | Stop at terminology and domain boundaries; types, validation, allowed values, cardinality, and implementation remain later-stage work. |
| Inception | user-stories | Do not use | — | Requirements → Stories/AC | Consume settled vocabulary; do not rerun the interview |
| Inception | refined-mockups | Use | `Impeccable frontend-design/SKILL.md + seven references` before Step 4 | approved requirements, Stories/AC, rough evidence → refined HTML + refined contract | Preserve stable screen/state/AC IDs and normal approval. Stop on unapproved requirements or changed Testing Contract. |
| Inception | refined-mockups | Conditional | `prototype/SKILL.md` + `UI.md` iff `unresolved_visual_alternatives=true` | one remaining design question → bounded alternatives + rationale | Skip when requirements already determine the design. Never claim generated variants are approved. |
| Inception | domain-design | Conditional | `domain-modeling/SKILL.md` and formats inside Steps 2–5 iff `unresolved_domain_terms_or_boundaries=true` | requirements, stories, glossary, architecture evidence → canonical terms, ownership/boundary and qualifying ADR candidates | Core component catalogue/ADRs/traceability remain authoritative. Do not specify types, validation, allowed values, cardinality, state machines, or implementation. |
| Inception | units-generation | Do not use | — | Approved domain artifacts → Unit DAG | Core plan approval only |
| Inception | contract-design | Do not use | — | Unit/API boundaries → contract summary | `to-spec` is not Contract Design |
| Inception | delivery-planning | Do not use | — | Approved Inception artifacts → Bolt plan | Core phase gate only |
| Construction | functional-design | Do not use | — | Unit requirements → technology-independent design | `prototype/LOGIC` is not run here; no framework code, SQL, or production implementation is pulled forward |
| Construction | nfr-requirements | Do not use | — | NFR questions/artifacts | Preserve QUESTION-ONLY / ARTIFACT-ONLY protocol |
| Construction | nfr-design | Do not use | — | NFR solution design | Preserve QUESTION-ONLY / ARTIFACT-ONLY protocol |
| Construction | infrastructure-design | Do not use | — | Infrastructure design | Preserve QUESTION-ONLY / ARTIFACT-ONLY protocol |
| Construction | code-generation | Use | `Impeccable frontend-design/SKILL.md + seven references` after Step 1 and before planning/generation | approved refined HTML/contract, functional design, exact Testing Contract → implemented UI + implementation contract | Fidelity implementation only; do not reopen design or use prototype no-tests rule. AI-DLC Plan Approval and tests remain mandatory. Missing approved upstream receipt blocks. |
| Construction | build-and-test | Do not use | — | Code/test instructions → measured results | Verify fidelity and behavior through core tests plus UI contract; never treat checker fixtures as E2E evidence |
| Construction | ci-pipeline | Do not use | — | Core CI artifacts | No relevant skill method |
| Operation | deployment-pipeline | Do not use | — | Core CD artifacts | No relevant skill method |
| Operation | environment-provisioning | Do not use | — | Core environment evidence | No relevant skill method |
| Operation | deployment-execution | Do not use | — | Core deployment evidence | No relevant skill method |
| Operation | observability-setup | Do not use | — | Core observability artifacts | No relevant skill method |
| Operation | performance-validation | Do not use | — | Core load evidence | No relevant skill method |
| Operation | incident-response | Do not use | — | Core runbooks | No relevant skill method |
| Operation | feedback-optimization | Do not use | — | Core operational feedback | No relevant skill method |

## Explicitly disabled lifecycle skill

`to-spec/SKILL.md` is not invoked by any stage. It is marked `disable-model-invocation`, asks for an additional test-seam confirmation, publishes an issue, and applies `ready-for-agent`. Those actions duplicate AI-DLC Requirements, Stories, Contract Design, and approvals, and can mutate an external tracker. It may be run only outside the lifecycle after an explicit user request, verified tracker configuration, and publication authorization; that run is not evidence for an AI-DLC stage.

## Decisions that remain human judgement

- Which visual alternative wins and whether the refined HTML is approved.
- Answers to unresolved requirements/domain questions and acceptance of trade-offs.
- Whether an ADR-worthy decision is accepted.
- Any tracker publication, branch retention, or change to the pinned upstream version.

The engine and adapter can decide stage membership, validate pins and files, route from explicit facts, hash artifacts, verify receipt structure, and stop on missing evidence. They cannot infer approval, authenticate a reviewer, or guarantee identical model output.
