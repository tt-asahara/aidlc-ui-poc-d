# UI evidence contract, versions 1 and 2

This contract supplements, never replaces, the core Markdown deliverables. An HTML preview alone is not an AI-DLC handoff. Write the stage's plugin-prefixed Markdown artifact in the same engine-resolved stage directory as its core outputs:

- rough-mockups: ui-poc-rough-contract.md
- refined-mockups: ui-poc-refined-contract.md
- functional-design: ui-poc-functional-contract.md (schema 2 only)
- code-generation: ui-poc-implementation-contract.md
- build-and-test: ui-poc-test-contract.md

Each carries H2 headings `Artifact References`, `Screen State Acceptance Mapping`, `Approval Evidence`, and `Testing Brief`, and exactly one fenced `ui-poc-contract` JSON block. The body must link the actual upstream core artifacts and plugin contracts, explain deltas, list unanswered decisions, and carry the inherited Testing Contract without changing its hash. The JSON is a plugin data format, not an upstream sensor API.

Example shape (placeholders below are deliberately not valid runtime evidence):

```ui-poc-contract
{
  "schema": 1,
  "stage": "refined-mockups",
  "arm": "A",
  "assets": [{"path": "assets/home.html", "sha256": "REPLACE_WITH_REAL_SHA256"}],
  "mappings": [{"screen": "SCREEN-HOME", "state": "STATE-EMPTY", "ac": "AC-001", "asset": "assets/home.html", "check": "Exact observable expectation and check method"}],
  "requiredMappings": ["SCREEN-HOME/STATE-EMPTY/AC-001"]
}
```

Schema 1 is accepted only for an explicit migration of an existing evidence
chain, by an operator setting `UI_POC_SCHEMA1_MIGRATION=1` for that migration
run. The default and every new refined-mockups, code-generation, and
build-and-test contract require schema 2 and add `fidelity`. Do not set the
migration input for new work; it is not a fidelity off switch.
The approved semantic snapshot is produced from the rendered HTML, not copied
from a hand-written inventory. It records every declared screen/state render,
visible text, control, field, important conditional region, computed truncation
facts, and observable action result. Important interactive, conditional,
exact-copy, and business-value elements carry stable `data-ui-id` values;
ordinary static text may use the capture tool's deterministic fingerprint.

```ui-poc-contract
{
  "schema": 2,
  "stage": "refined-mockups",
  "arm": "C",
  "assets": [
    {"path": "assets/home.html", "sha256": "..."},
    {"path": "assets/ui-semantic-snapshot.json", "sha256": "..."}
  ],
  "mappings": [{"screen":"SCREEN-HOME","state":"STATE-READY","ac":"AC-001","asset":"assets/home.html","check":"..."}],
  "requiredMappings": ["SCREEN-HOME/STATE-READY/AC-001"],
  "fidelity": {
    "approvedSnapshot": {"path":"assets/ui-semantic-snapshot.json","sha256":"..."},
    "dispositions": []
  }
}
```

At Functional Design, only actual changes or omissions receive a disposition:
`upstream-revised`, `approved-deviation`, or `intentionally-omitted`. Every
disposition names the snapshot element key, a non-empty reason, and a detached
`approvalReceipt`. The receipt is recorded for the existing Functional Design
approval in `UI_POC_APPROVAL_LEDGER`; it binds `decisionId`,
`stage: "functional-design"`, `status: "approved"`, the canonical
`snapshotSha256`, exact `elementKeys`, canonical `dispositionSha256` over
element key/status/reason, and `deltaSha256` over the exact observed difference,
plus source and reviewer. An omission receipt therefore cannot approve a later
copy or behavior change. An omission is not
accepted merely because an agent wrote a reason. No additional approval gate is
introduced.

Build and Test adds `fidelity.actualSnapshot`, captured from the running
implementation through the same observation schema but a separate execution
path. The checker compares it with the frozen approved snapshot. It never
regenerates an expected snapshot from implementation code. Exact copy, element
presence, role, computed truncation, and declared action-to-state observations
are deterministic checks. Natural-language equivalence, design quality, and
whether an approved change is wise remain reviewer/human judgement.

The actual snapshot also binds its reported observation metadata to the
loopback URL and source hash. This detects substitution inside the evidence
chain, but it is not a cryptographic attestation that an agent launched the
browser; the capture command/result and sensor-verified bytes remain part of
the review evidence.

Run the packaged tool with Bun. `capture` requires a local Chrome/Edge CDP
renderer and fails with `BROWSER_TOOL_UNAVAILABLE` or a render-state error; it
never substitutes regex parsing or reports an unrendered state as passing.

```text
bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs capture --html <approved.html> [--query scenario=...] --out <snapshot.json> [--png <baseline.png>]
bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs capture --url <loopback-url> --out <actual.json> [--setup-click ELEMENT-ID@STATE-ID,...]
bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs compare --approved <approved.json> --actual <actual.json> [--dispositions <json>] [--approval-ledger <json>]
```

The HTML render root carries `data-ui-screen` and `data-ui-state`. Important
elements use `data-ui-id` plus `data-ui-important`; exact copy additionally uses
`data-ui-exact-copy`. A truncation requirement uses
`data-ui-require-truncation`. An observable control action uses
`data-ui-action-id`, `data-ui-expected-state`, and `data-ui-action-target` for
the truncated element it expands; the capture fails the later comparison unless
the click actually changes the root to the expected state and expands that
target.
Element kind is derived from the rendered DOM: inputs/selects/textareas are
`field`; buttons, links, interactive roles, and `data-ui-action-id` elements are
`control`; `data-ui-business-value` is `business-value`; truncation targets,
`data-ui-region`, and other roles are `region`; everything else is `text`.
States reached by an environment condition (storage failure, private mode) use
a query scenario: `--query scenario=...` for approved HTML, or the query in the
loopback URL. `merge` combines per-state captures of one page; loopback
captures that differ only in query keep every bound observation under
`observations`.
Capture each conditional screen/state separately. A hidden node in a different
state is not coverage for the state where it must be visible.

`features.mockupPngGeneration` and `features.visualRegression` are independent,
default-off D settings. Effective baseline PNG generation is enabled when
either is true. Visual comparison may consume only a baseline generated before
approval and bound to the approved HTML hash and rendering environment; it must
not create or update a baseline during Build and Test. DOM semantic capture is
mandatory for schema 2 and may still use the renderer when both image settings
are off. The image settings govern only PNG capture and pixel comparison.

Paths are relative to this contract's stage directory. Absolute paths, parent traversal, backslashes, missing assets, non-files and symlink escapes are rejected. Declare every referenced HTML, CSS, JS, PNG/JPEG/SVG/WebP image and WOFF2 font in assets with its exact SHA-256. No remote dependencies are allowed. Browser-dependency completeness is a separate review obligation; this checker verifies declared assets and does not parse every possible dynamic import or network request. An independently approved inventory of screen/state/AC triples must cover loading, empty, success, error and interaction recovery states where applicable. A syntactically valid ID does not establish semantic completeness; reviewer comparison with requirements remains mandatory.

## Element matrices and approved-upstream change control (schema 2)

`tools/ui-poc-element-matrix.cjs` derives two deterministic matrices from the
frozen approved snapshot. Tools own the denominator and every generated field;
the Functional Design agent supplies only knowledge; the person supplies
judgement through detached receipts.

- **Element → rule / unimplemented-reason matrix** (`ui-poc-element-rule-matrix.json`,
  produced at Functional Design with `rule-matrix generate`). One row per
  approved `SCREEN/STATE/KEY`, with generated `kind`, `obligations`
  (`exact-copy`, `action`, `truncation-*`, `interactive`, `important`,
  `business-value`), `role`, `text`, `action`, `truncation`, and `requiresRule`,
  plus agent-filled `ruleIds` or `unimplementedReason`. `rule-matrix check`
  (also run by the sensor at the Functional Design gate) is bidirectional and
  fails with: `MATRIX_SNAPSHOT_STALE`, `MATRIX_ROW_MISSING`/`EXTRA`/`DUPLICATE`,
  `MATRIX_ROW_ALTERED` (an edited generated field), `ELEMENT_UNMAPPED`,
  `RULE_ID_UNKNOWN` (ID absent from the Functional Design text),
  `EXACT_COPY_NOT_PROPAGATED` (approved wording not verbatim in Functional
  Design and no approved deviation), `UNIMPLEMENTED_WITHOUT_DISPOSITION`,
  `DISPOSITION_WITHOUT_RECEIPT`, `EMPTY_DENOMINATOR`.
- **Element-level Build and Test matrix** (`ui-poc-element-test-matrix.json`,
  `test-matrix generate`). One row per approved element plus every important
  explicit-ID element the implementation added; each row lists its rule IDs,
  checks, observed differences, and `pass`, `fail`, or the approved
  disposition status. The gate recomputes it byte-for-byte (canonical JSON); a
  hand-edited row (`TEST_MATRIX_MISMATCH`), an empty denominator, or any
  `fail` row is NOT-READY.

Stage contracts:

- functional-design: `ui-poc-functional-contract.md` with `upstream`
  (refined-mockups), `fidelity.approvedSnapshot`, `fidelity.elementRuleMatrix`,
  `fidelity.functionalDesign` (byte-identical Markdown copies), and
  `fidelity.dispositions`. The producer gate needs the refined approval, not its
  own.
- code-generation additionally requires `fidelity.elementRuleMatrix` and
  `fidelity.functionalDesignContract`, a byte-identical copy of the approved
  Functional Design contract. The handoff is refused if that contract is
  missing, unapproved in the ledger (`stage: "functional-design"`,
  `contractSha256`), or if its snapshot, matrix, dispositions, or mapping
  inventory differ from the implementation contract.
- build-and-test additionally requires `fidelity.elementRuleMatrix` (unchanged
  from code-generation) and `fidelity.elementTestMatrix`.

Approved-upstream change control has exactly two legal paths. (1) An
**artifact revision**: the revised refined contract declares
`fidelity.revision = {previousSnapshot, changedElements, deltaSha256}`; the
sensor recomputes the element delta between the two approved snapshots
(`revision` command) and rejects any undeclared change; the person's ordinary
approval of the revised contract is the confirmation, and every downstream
matrix bound to the old snapshot is stale until regenerated
(`rule-matrix generate --previous` keeps mappings only for unchanged rows). (2)
A **user-confirmed deviation**: an `approved-deviation`, `upstream-revised`, or
`intentionally-omitted` disposition with a detached Functional Design receipt
bound to the snapshot, element, reason, and exact delta. Any other wording or
element change (in Functional Design text, the matrix, the implementation, or
the snapshot) fails closed.

Limits: rule-ID presence and verbatim copy are deterministic; whether a rule
correctly implements an element is reviewer judgement. A revision is detected
only when the previously approved snapshot is supplied; the operator-managed
ledger remains the trust anchor.

## Approval trust boundary

`UI_POC_APPROVAL_LEDGER` must point to an operator-managed detached JSON file outside the stage evidence directory. It contains `approvals` entries with `contractSha256`, `stage`, `arm`, `status: "approved"`, `source`, `reviewer`, and `requiredMappings` in contract order. This is a local plugin trust input, NOT a claimed built-in AI-DLC approval schema or API. The workflow agent must not create or amend its own approval entries. The operator records a real approval's exact source only after actual review. No production ledger ships here.

For code-generation, include upstream: {path, sha256, stage: "refined-mockups"}; for build-and-test, use stage: "code-generation". The path points to a byte-identical local evidence copy of that upstream contract, and the approval ledger binds its SHA-256 and mapping inventory. For functional-design, use stage: "refined-mockups". The checker recursively validates the complete refined → functional design → implementation → testing chain, including every ancestor’s headings, assets, hashes, mappings and required prior approval. The chain is bounded to four stage contracts; a repeated real file identity along one ancestry path is rejected. Copy the entire referenced snapshot tree, not Markdown alone. Each ancestor resolves its own relative asset and upstream paths from its containing directory, with nested paths confined within the current-stage evidence root. Upstream copies are evidence, never substituted for engine-resolved core artifacts. Approval does not assert that generated implementation assets are byte-identical to design prototypes. The ledger path is environment-configured, not supplied by untrusted contract text. Filesystem isolation/ownership and actual human identity are deployment responsibilities; the checker cannot authenticate the purported reviewer or protect a ledger writable by the same agent. A writable self-authored ledger is NOT acceptable production evidence. Verify these controls before live runs. Unit tests intentionally create synthetic approvals solely to exercise validation.

The gate sensor is a preflight evidence check. Rough and refined producer gates validate draft shape and hashes without demanding an additional human approval. The consuming code-generation and build-and-test gates require a receipt of the prior stage’s ordinary approval, not approval of their own new draft. This receipt does not impersonate or replace the core stage-approval event. If approval infrastructure is unavailable, block and report the missing evidence; never set approved to make tests green.

## Developer and testing handoff

The developer must receive the refined contract, core mockup documents, user stories/ACs, unit definition and story map, functional design, and the actual engine-produced implementation/testing brief. Preserve core source-manifest.json, traceability.json, code-generation-plan.md, unit-test-instructions.md and code-summary.md. Read the pinned treatment entrypoints during the applicable stage and record actual read evidence. Do not merely name a skill in a prompt and report that it ran.

Build and Test records measured results and exact commands separately from unexecuted instructions. Capture screenshots, console errors, keyboard behavior, responsive states, cancel/back/repeated actions and inaccessible states when browser execution is authorized and available. Never promote local checker tests or generated HTML to a passed end-to-end workflow.

## Arm C routing evidence

At every C stage with routing rules, keep `ui-poc-routing-facts.json`, `ui-poc-routing-context.json`, and `ui-poc-skill-evidence.json` beside the output. The blocking sensor derives record, Unit, scope, and `aidlc-state.md` digest from the dispatched output path; hashes facts, context, installed pinned files, inputs, and actual output files; and rejects unselected or disabled skills. Impeccable applications additionally require a JSON Design Context snapshot with observed creator confirmation, allowed provenance kind, project-confined confirmation-source `{path,sha256}`, project-confined common-brief `{path,sha256}`, audience/use-cases/brand-tone, plus a JSON WCAG report asserting pinned-source preservation and the 24/18.6667 CSS px correction. When teach-impeccable is selected, its context output must precede and exactly equal frontend-design's context input. These checks bind observed files but do not authenticate a human identity. The official sensor API has no canonical attempt ID, so distinct attempts with byte-identical engine state cannot be fully authenticated. Logs are mechanically verified attestations, not proof of model cognition.
