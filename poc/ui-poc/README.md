# Shared A/B/C AI-DLC UI PoC foundation

Initial integration scaffold, prepared for version-controlled A/B/C repositories. Arm C adds a deterministic Matt + pinned historical Impeccable stage harness. It does not claim a live model run, treatment invocation in a lifecycle stage, or human artifact approval.

Pinned API research: awslabs/aidlc-workflows v2.11.0, commit `6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a`. Only selected source files are available, not a complete buildable checkout. Source manifest and validation limitations are in docs/verification.md.

The source plugin is named `ui-poc`. The original foundation was shared; this repository deliberately adds C-only routing and contribution guidance without changing core or A/B. `poc/arm.json` selects the treatment. Treatment definitions remain under `treatments/`.

## Local verification

```
node --test tests/evidence.test.cjs tests/fidelity.test.cjs tests/visual.test.cjs tests/fidelity-e2e.test.cjs
UI_POC_REQUIRE_BROWSER=1 node --test tests/fidelity-e2e-browser.test.cjs   # real Chrome/Edge capture; skipped (not passed) without a renderer
python3 tests/check-source-contract.py --source-root /path/to/pinned-source --tree /path/to/tree.json
node tools/ui-poc-evidence.cjs --stage refined-mockups --output-path /actual/stage/mockups.md
```

## Ordinary D dogfooding start

Start the same way as any normal project; describe the application, not the
internal workflow. A short ASCII request (five words or fewer) that names a UI
keyword (`web app`, `dashboard`, `website`, `frontend`, `user interface`,
`mobile app`) is proposed `ui-poc-application` automatically:

```text
/aidlc
Build a budget web app
```

A long or Japanese request gets the standard scope proposal instead, for
example:

```text
/aidlc
Build a household budget web app with monthly planning, transaction tracking,
category summaries, and a responsive user interface.
```

```text
/aidlc
家計管理のWebアプリを作りたい
```

Both show the stock proposal (or the compose offer) at the official scope
confirmation. Select `ui-poc-application` there, or name it up front with
`/aidlc --scope ui-poc-application`; either way the rest of the run is the same.

Why: scope inference is the unmodified upstream resolver, because core/ stays
byte-identical to AI-DLC v2.11.0 (`6a378b53`). For requests longer than five
words that resolver accepts only its own built-in high-specificity keywords,
which a plugin scope cannot extend, and its keyword match uses ASCII word
boundaries, so `Webアプリ` and other Japanese text never match a plugin keyword.
Changing either would be a core change, which this PoC does not make.

`ui-poc-application` retains the C rough/refined HTML evidence handoff.
Explicit scopes, explicit serial execution, and non-UI requests keep their
normal meaning. Delivery Planning evaluates the actual Unit DAG and write
conflicts before it proposes stage-major execution and official Code
Generation swarm (the proposal is spliced in just before the official
Construction iteration choice); the person still decides at the official gate.
Opus defaults, routing evidence, and D's four automatic design waves do not
depend on wording them into this prompt.

## Requirements-only loop

To grow requirements and the `/aidlc --doc` design document set without
building, select the requirements loop explicitly (the `requirements-loop`
keyword routes only short ASCII requests):

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

Outside the comparison, the person may opt in to another refined-mockups design skill with `uiDesign.refinedMockupSkill` in D configuration. The choices are `impeccable-historical` (the default), `impeccable` (Impeccable 4.6.0), and `ui-ux-pro-max` (UI/UX Pro Max). Install a non-default choice first with `bun poc/ui-poc/scripts/setup-design-skill.ts --product <PRODUCT> --skill <id>`. The router refuses a non-default choice in `ui-poc-comparison`, so the C arm stays as pinned. See `docs/c-stage-skill-matrix.md` ("Refined-mockups design slot") and `poc/d-acceleration/configuration.md`.

## Required remaining verification

1. Repeat official plugin validation, build, and disposable composition after routing/contribution changes. The C harness currently passes with zero drops, compiled graph, and an idempotent second compose.
2. Keep the real dispatcher regression test that converts missing routing evidence into a blocking `failed` sensor result; live model-backed stage execution remains separate.
3. Verify the pinned public treatment payloads and actual stage entrypoint reads, preserving license/provenance. Use C’s selected historical component and exact dependency/license list; do not install the latest runtime/hooks. Obtain the old custom HTML extension only if exact reproduction is required.
4. Provision trusted human approval capture/ledger outside the agent-writable workspace. Confirm engine gate approval separately.
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
