# Shared A/B/C AI-DLC UI PoC foundation

Initial integration scaffold, prepared for version-controlled A/B/C repositories. Arm C adds a deterministic Matt + pinned historical Impeccable stage harness. It does not claim a live model run, treatment invocation in a lifecycle stage, or human artifact approval.

Pinned API research: awslabs/aidlc-workflows v2.11.0, commit `6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a`. Only selected source files are available, not a complete buildable checkout. Source manifest and validation limitations are in docs/verification.md.

The source plugin is named `ui-poc`. The original foundation was shared; this repository deliberately adds C-only routing and contribution guidance without changing core or A/B. `poc/arm.json` selects the treatment. Treatment definitions remain under `treatments/`.

## Local verification

```
node --test tests/browser-readiness.test.cjs tests/evidence.test.cjs tests/fidelity.test.cjs tests/visual.test.cjs tests/fidelity-e2e.test.cjs tests/unit-matrix.test.cjs
UI_POC_REQUIRE_BROWSER=1 node --test tests/fidelity-e2e-browser.test.cjs   # real Chrome/Edge capture; skipped (not passed) without a renderer
python3 tests/check-source-contract.py --source-root /path/to/pinned-source --tree /path/to/tree.json
node tools/ui-poc-evidence.cjs --stage refined-mockups --output-path /actual/stage/mockups.md
```

In a multi-Unit intent the element rule matrix is per Unit: Functional Design
runs `rule-matrix generate|check --unit <unit> --contract ui-poc-functional-contract.md`
so the denominator is that Unit's screen/state slice, and Build and Test merges
every Unit matrix with `rule-matrix union` to prove each approved element has
one consistent owner. See `docs/contract.md` ("Unit-scoped matrices").

## Ordinary D dogfooding start

Start the same way as any normal project; describe the application, not the
internal workflow, in any language:

```text
/aidlc
Build a household budget web app with monthly planning, transaction tracking,
category summaries, and a responsive user interface.
```

```text
/aidlc
家計管理のWebアプリを作りたい
```

AI-DLC reads the request and proposes the plan that fits it from the
install's plan list, where `ui-poc-application` appears with its description
and hints (`web app`, `dashboard`, `website`, `frontend`, `user interface`,
`mobile app`). The person confirms the proposal at the official scope
question, picks another plan there, or names one up front with
`/aidlc --scope ui-poc-application`; either way the rest of the run is the same.

Why: plan choice is the unmodified upstream flow, because core/ stays
byte-identical to AI-DLC v2.11.2 (`10a9bc9d`). Since v2.11.2 the engine no
longer classifies requests by keyword: the agent proposes the plan and the
person decides, so long and Japanese requests reach the UI scope the same way
short English ones do.

`ui-poc-application` retains the C rough/refined HTML evidence handoff.
Explicit scopes, explicit serial execution, and non-UI requests keep their
normal meaning. Delivery Planning evaluates the actual Unit DAG and write
conflicts before it proposes stage-major execution and official Code
Generation swarm (the proposal is spliced in just before the official
Construction iteration choice); the person still decides at the official gate.
Opus defaults, routing evidence, and D's four automatic design waves do not
depend on wording them into this prompt.

## Review findings at the mockup gates

A Critical or Major finding of the rough-mockups or refined-mockups review is
never accepted in bulk and without a reason. While one is open and undecided,
the `ui-poc-evidence` gate sensor keeps the gate closed; the agent asks the
engine-logged question `Major review findings still open` (fix first, decide
each, or accept all) and records the person's decision with
`bun .claude/tools/ui-poc-review-risks.cjs decide …`, where an acceptance needs
the person's own words as the reason. What the gate finally accepted becomes a
Build and Test check item (`fidelity.acceptedRisks`, printed by
`ui-poc-review-risks.cjs handoff`). The same sensor fails two different states
whose PNGs are byte-identical. See `docs/contract.md`, "Review findings at the
mockup gates".

## Document-driven run

To carry a UI product from handed-over requirement documents to approved user
stories with only the stage approvals as stops, select the document-driven
scope explicitly (it has no routing keywords):

```text
/aidlc --scope ui-poc-document-driven
```

It runs the requirements-loop stages without refined-mockups (intent-capture,
scope-definition, rough-mockups, reverse-engineering on brownfield only,
practices-discovery, requirements-analysis, user-stories), with summary
confirmation, learnings, and plan approval off: 6 approval gates on a new
project. The D entry `/aidlc --from-docs <path> <description>` selects it
and answers stage questions from the documents; see
`../d-acceleration/document-driven-auto.md`.

## Requirements-only loop

To grow requirements and the `/aidlc --doc` design document set without
building, select the requirements loop explicitly (or accept it when AI-DLC proposes it):

```text
/aidlc --scope ui-poc-requirements
```

`ui-poc-requirements` runs intent-capture, scope-definition, rough-mockups,
reverse-engineering (brownfield only), practices-discovery,
requirements-analysis, user-stories and refined-mockups with the same HTML
evidence handoffs and official gates, and nothing after them. One round is one
intent: start the next round as a new intent, or reopen the current one with
`/aidlc --stage requirements-analysis`. Run `/aidlc --doc` after each round; it
merges every intent into the product-level design set. Basic and detailed
design chapters stay "未検討" because this scope runs no design stage. To build,
start a new intent under `ui-poc-application`.

Arm C's full 33-stage matrix is `docs/c-stage-skill-matrix.md`; routing is `tools/ui-poc-c-routing.cjs` over `tools/ui-poc/c-stage-routing.json`. The verifier binds routing evidence to engine state and pinned files. It cannot prove model cognition or distinguish different attempts whose official engine state bytes are identical.

The source-contract check needs the inspected pinned source directory and corresponding Git tree JSON. You may set UI_POC_SOURCE_ROOT and UI_POC_UPSTREAM_TREE instead of its CLI flags. The sensor command is an invocation example, not a completed live check. Without valid evidence, and without an independently managed `UI_POC_APPROVAL_LEDGER` in a ledger scope, the sensor fails closed; `tools/ui-poc/scope-evidence.json` sets per scope whether upstream approval comes from that ledger or from the official stage gate's engine record, and can declare the sensor off for a scope. See docs/contract.md for the format and trust assumptions.

## Treatment status

A: frontend-design. B: Matt custom extension plus frontend-design. C: Matt custom extension plus Impeccable. Public Anthropic and Matt sources are now pinned in treatments/source-lock.json; that separate research is not evidence that any lifecycle stage invoked them. C is selected as Matt plus the historical official Impeccable frontend-design component at 209444a9d552c18bcaa74e26bf66a25fc568a767, including its seven reference files, conditional teach-impeccable dependency, LICENSE and NOTICE.md. It is explicitly a historical component comparison, not latest full Impeccable. The full latest runtime/hooks and historical critique script are excluded. The user’s previous custom stage-2.5 HTML extension is unavailable; obtaining it is necessary only to reproduce that exact implementation. This new integration does not claim to reproduce it. Do not silently substitute generic prompts or a differently configured C arm.

Outside the comparison, the person may opt in to another refined-mockups design skill with `uiDesign.refinedMockupSkill` in D configuration. The choices are `impeccable-historical` (the default), `impeccable` (Impeccable 4.6.0), `ui-ux-pro-max` (UI/UX Pro Max), and `ponta-pass-design` (the Pontaパス design system). Install a non-default choice first with `bun poc/ui-poc/scripts/setup-design-skill.ts --product <PRODUCT> --skill <id>`; `ponta-pass-design` is not published, so it also takes `--source <your copy>` and only its hashes are kept in this repository. Each refined-mockups run with `ponta-pass-design` asks the person for the absolute path of their folder of original Pontaパス screens, because its location and name differ per person; it never reads `PONTA_PASS_EXPORT` or a default folder. The router refuses a non-default choice in `ui-poc-comparison`, so the C arm stays as pinned. See `docs/c-stage-skill-matrix.md` ("Refined-mockups design slot") and `poc/d-acceleration/configuration.md`.

## Required remaining verification

1. Repeat official plugin validation, build, and disposable composition after routing/contribution changes. The C harness currently passes with zero drops, compiled graph, and an idempotent second compose.
2. Keep the real dispatcher regression test that converts missing routing evidence into a blocking `failed` sensor result; live model-backed stage execution remains separate.
3. Verify the pinned public treatment payloads and actual stage entrypoint reads, preserving license/provenance. Use C’s selected historical component and exact dependency/license list; do not install the latest runtime/hooks. Obtain the old custom HTML extension only if exact reproduction is required.
4. For `ui-poc-comparison` (ledger scopes), provision trusted human approval capture/ledger outside the agent-writable workspace and confirm engine gate approval separately. Engine-record scopes (`ui-poc-application`, `ui-poc-requirements`) need no ledger: upstream contracts and UI dispositions are approved by the official stage gate that the engine audit records (see `docs/contract.md`, "Approval trust boundary").
5. Resolve live CLI runtime's read-only-home blocker through an authorized environment/configuration. No auth or security settings were changed.
6. Run actual A/B/C lifecycle sessions on the same approved request and unit/screen/state/AC inventory, with recorded stage directives, handoffs, asset hashes, source manifests, testing briefs, audit events and measured UI results.
7. Only then compare outcomes. Local synthetic checker fixtures cannot establish skill invocation, harness integration, design quality or user approval.

## Installation boundary

Enable this plugin only in the isolated A/B/C comparison repositories. Contributions modify their target stages whenever the plugin is enabled: adds.scopes adds scope membership, but it does not condition the other additions on that scope. Disable/remove the plugin before unrelated stock-scope workflows. Runtime guidance and treatment configs live under the projected tools/ui-poc/ subtree; root docs/treatments are source/research copies. Official build/compose validation is still required.

For D project setup, the built Claude projection is composed directly into the
project's installed AI-DLC harness with its emitted `hooks/compose.ts`, explicit
`AIDLC_PROJECT_DIR`, and explicit `AIDLC_PLUGIN_ROOT`. Do not add or repoint a
machine-wide Claude marketplace. The same official composer performs
no-clobber payload copies, sentinel contribution merges, provenance sidecars,
and graph compilation; run it twice and require idempotent graph/sidecar hashes,
zero compose drops, and `uiBaseline: C-composed` preflight before use.

## Kiro CLI, Kiro IDE, and Codex

This plugin also runs on Kiro CLI, Kiro IDE, and Codex. D acceleration does not yet: those harnesses carry only D's configuration resolver (`<harness dir>/tools/d-acceleration/d-config.ts`), so `uiDesign.refinedMockupSkill` and the image settings work there, and PR Lens review and automation stay Claude-only. Install the runtime, the pinned C payload, and the composed plugin with one command from the D checkout, after `bun scripts/package.ts <harness>` and `bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc <harness>`:

```bash
bun poc/ui-poc/scripts/setup-ui-poc.ts --harness kiro|kiro-ide|codex --src "$PWD" --product <PRODUCT> --dry-run
```

Rerun without `--dry-run` to apply. Kiro and Kiro IDE take the plugin as AI-DLC's folder drop (`.kiro/aidlc-plugins/ui-poc/`); Codex composes from the build, so `/aidlc --doctor` in Codex reports the plugin as not installed in the host. Leave that warning: `engine plugin sync --prune-missing` would remove the composed plugin. D settings live in the harness directory (`.kiro/d-acceleration.jsonc`, `.codex/d-acceleration.jsonc`), and `setup-design-skill.ts` finds that directory itself, or takes `--harness-dir` when a product has more than one.
