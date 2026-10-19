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

Acceptance-criterion IDs (`ac`, and the last segment of each `requiredMappings`
entry) take one of two forms, compared exactly and never normalized:

- **Official (use this from refined-mockups on):** the story criterion ID from
  the official `stories.md`, verbatim, in the core user-stories grammar
  `AC{story-group}.{story-seq}.{criterion-seq}` (`^AC[0-9]+\.[0-9]+\.[0-9]+$`,
  for example `AC1.2.3`). Do not rewrite it as `AC-1-2-3`.
- **Legacy:** `^AC-[A-Z0-9-]+$` (for example `AC-001`, `AC-ISSUE-1`). It stays
  valid for provisional rough-mockups IDs, written before user stories exist,
  and for existing contracts. The optional D requirement-ID check accepts a
  legacy ID only through an explicit `featureInputs.requirementIdBridges` entry.

Full-width (`ＡＣ１.１.１`), lower-case, two- or four-segment, and mixed
spellings such as `AC1-1-1` or `AC-1.1.1` fail the checker.

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
  "mappings": [{"screen":"SCREEN-HOME","state":"STATE-READY","ac":"AC1.1.1","asset":"assets/home.html","check":"..."}],
  "requiredMappings": ["SCREEN-HOME/STATE-READY/AC1.1.1"],
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
introduced. That receipt form applies to ledger scopes; in an engine-record
scope (`ui-poc-application`, `ui-poc-requirements`) a disposition carries no
receipt and is approved by the official gate of the Functional Design that
states it (see "Approval trust boundary").

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
bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs capture --html <approved.html> [--query scenario=...] --out <snapshot.json> [--png <baseline.png>] [--width N --height N --device-scale-factor 1|2|3] [--visual-policy <policy.json>]
bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs capture --url <loopback-url> --out <actual.json> [--png <actual.png> ...same viewport/policy...] [--setup-click ELEMENT-ID@STATE-ID,...]
bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs compare --approved <approved.json> --actual <actual.json> [--dispositions <json>] [--approval-ledger <json>]
bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs visual-compare --baseline <baseline.png> --actual <actual.png> --baseline-snapshot <approved.json> --actual-snapshot <actual.json> [--diff-out <diff.png>]
bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs visual-calibrate --a <one.png> --b <two.png> [--a-snapshot <one.json> --b-snapshot <two.json>]
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

### PNG capture and visual comparison

Capture is deterministic by construction, not by hope. The tool launches the
local Chrome/Edge with a fixed flag set (`--headless=new`, `--hide-scrollbars`,
`--force-color-profile=srgb`, `--font-render-hinting=none`,
`--disable-lcd-text`, ...), sets the viewport and device scale factor
(default 1280x720 at 1x), emulates `prefers-reduced-motion: reduce` and a light
colour scheme, then freezes CSS animations/transitions, caret blink and Web
Animations before observing; a capture with an animation still running fails
`ANIMATION_NOT_FROZEN`. It waits for `document.fonts.ready`, fails on any font
load error or remote `@font-face` source, hashes every bundled font file, and
records the platform fonts that actually rendered glyphs (from the renderer,
not from CSS). With policy `fonts: "bundled-only"` any glyph rendered by an
unpinned system font fails `FONT_NOT_PINNED`.

Each PNG snapshot records `environment` = renderer (`/json/version` browser
product, WebKit revision, protocol and V8 versions, executable name), OS
(platform, release, arch), viewport (width, height, deviceScaleFactor), colour
profile, animation mode, a hash of the renderer flags, and the font fingerprint;
plus `visual` = the validated policy, its SHA-256, and the resolved mask
rectangles. `visual-compare` **refuses** (status `NOT-READY`, no pixel result)
when any of that metadata is missing or differs, when the actual capture used a
different policy than the approved baseline, when a mask target is missing in
either capture, or when masks would hide more than `maxMaskRatio`. A different
image size is a `FAIL`; there is no "common area" comparison.

The visual policy (JSON, all keys optional, unknown keys rejected):

| Key | Default | Meaning |
| --- | --- | --- |
| `colorThreshold` | `0.1` | YIQ colour distance (0..1) below which a pixel is equal |
| `antiAliasing` | `true` | ignore pixels classified as anti-aliased edges in either image |
| `maxDiffPixels` | `16` | absolute budget for isolated noise |
| `maxDiffRatio` | `0.0005` | relative budget (differing / compared pixels); both budgets must hold |
| `maxMaskRatio` | `0.25` (max `0.5`) | masks can never hide more than this share |
| `fonts` | `"any"` | `"bundled-only"` requires every glyph from a hashed web font |
| `masks` | `[]` | `{id, selector, reason}` for dynamic regions (clock, random IDs) |

The policy is chosen at Refined Mockups and approved with the baseline; Build
and Test cannot loosen it. The pixel classifier re-implements the pixelmatch
YIQ delta and anti-aliasing detector (ISC) without a dependency.

False-positive handling, in order:

1. `NOT-READY` (environment/policy/mask refusal): re-run the actual capture in
   the recorded environment with the recorded viewport, scale factor and
   policy. Never compare across renderers, OS releases, fonts or scale factors.
2. `FAIL`: open the `--diff-out` image (red = differing, yellow = tolerated
   anti-aliasing, blue = masked). Isolated specks and edge anti-aliasing within
   the budget already pass.
3. Dynamic content (time, generated IDs, live data): add a mask with a reason
   (or make the state deterministic) at Refined Mockups and re-approve the
   baseline through the ordinary gate. Masks are not added during Build and
   Test.
4. Renderer noise between two captures of the same build: run
   `visual-calibrate`; it reports the observed noise and recommends 3x that
   noise as a budget (never below the defaults). The recommendation is advice
   for the person approving the policy, never applied automatically.
5. A real but intended change: record an approved deviation or upstream
   revision through the existing disposition receipts. A sub-pixel layout shift
   of whole content re-rasterizes every glyph and is treated as a real change.

Recorded real run (Chrome 155, macOS arm64): see
`poc/d-acceleration/evidence/visual-regression/summary.json`.

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
  `DISPOSITION_WITHOUT_RECEIPT` (ledger scopes), `DISPOSITION_INVALID` /
  `DISPOSITION_SOURCE_MISSING` (engine-record scopes),
  `DISPOSITION_DEFERRAL_INVALID`, `EMPTY_DENOMINATOR`. Rule IDs resolve as whole
  tokens (`BR6.2` is not defined by `BR6.2.1`) against every Markdown copy in
  `fidelity.functionalDesign`; when `rules.md` is the rule source, include it
  there (the core drops `rules.md` from `ui` Units' produces, but a host that
  keeps it for sensor traceability lists it like any other Functional Design
  file).
- **Element-level Build and Test matrix** (`ui-poc-element-test-matrix.json`,
  `test-matrix generate`). One row per approved element plus every important
  explicit-ID element the implementation added; each row lists its rule IDs,
  checks, observed differences, and `pass`, `fail`, or the approved
  disposition status. The gate recomputes it byte-for-byte (canonical JSON); a
  hand-edited row (`TEST_MATRIX_MISMATCH`), an empty denominator, or any
  `fail` row is NOT-READY.

**Unit-scoped matrices (per-Unit Functional Design and Code Generation).**
Inside a Construction Unit the denominator is exactly the Unit's contract
slice: the screen/state pairs of its `requiredMappings` (the same slice the
sensor already checks is a subset of the approved refined inventory). Generate
and check with `--unit <unit> --contract <ui-poc-functional-contract.md>`
(write the contract's `mappings`/`requiredMappings` first). The matrix records
`slice = {unit, states, sha256}`; the gate recomputes it from the Unit and the
contract, so a matrix for another Unit, a whole-snapshot matrix, or a matrix
from before a slice change is `MATRIX_SLICE_STALE`. A slice state the approved
snapshot never captured is `SLICE_STATE_UNKNOWN` (fail closed). Elements of
other states are out of scope: not `ELEMENT_UNMAPPED`, no omission receipts,
and no exact-copy propagation; a row or disposition for them is
`MATRIX_ROW_EXTRA` / `DISPOSITION_UNKNOWN_ELEMENT`. Without a Unit (one
intent-level Functional Design) the denominator stays the whole snapshot and a
Unit-scoped matrix is refused.

**Intent-level coverage at Build and Test.** With several Units, Build and
Test (once per Intent) copies every Unit's approved implementation contract
tree under its own directory, lists them in `fidelity.unitContracts`
(`[{path, sha256}]`, each also an asset), and omits `upstream`. `rule-matrix
union --approved <snapshot> --unit-contracts <c1,c2,...> --out
ui-poc-element-rule-matrix.json --dispositions-out <file>` merges the Unit
matrices; record its output as `fidelity.elementRuleMatrix` and
`fidelity.dispositions`. The gate re-validates each Unit chain as that Unit
(approval from the ledger, or byte identity with
`construction/<unit>/code-generation/` in an engine-record scope), checks that
all Units name the same refined contract and that this contract carries its
full inventory, recomputes the union, and refuses a different matrix or
dispositions. Every approved element that requires a rule needs an owner (a
Unit row with rule IDs) or, when no Unit implements it, an approved
`intentionally-omitted` row: otherwise `ELEMENT_NO_OWNER` names it. An omission
with `deferredTo: <unit>` is covered only when that Unit implements the
element; otherwise `ELEMENT_DEFERRED_NOT_IMPLEMENTED`. Two Units
may own one element only with identical rule IDs and the same disposition
(status and delta); otherwise `ELEMENT_OWNER_CONFLICT`. A Unit-local omission
never excuses an element another Unit owns: only the owner's disposition
reaches the Build and Test comparison. A single intent-level code-generation
contract keeps the existing `upstream` handoff unchanged.

**Shared/cross-Unit states.** A state approved on one Unit's screen (for
example the offline, loading, storage-unavailable, or load-failed banners
approved only on `SCREEN-HOME`) is not auto-allowed to another Unit. A Unit that
also renders it claims the state by adding that state's approved
screen/state/AC mapping to its own contract slice; the whole state then joins
its denominator, so it maps the elements it implements with the same rule IDs
as the other claiming Unit and records an approved `intentionally-omitted`
disposition (with `deferredTo` naming the implementing Unit) for each
rule-requiring element it does not implement. Rendering it in a different place
than approved (another screen) is an approved deviation or an artifact revision
of the refined mockup, never a silent pass; every Unit that implements the
element carries the same deviation (status and delta), or the union is an
`ELEMENT_OWNER_CONFLICT`.

**Later-Unit elements inside a Unit's own states (slots).** A Unit's slice is
by screen/state pair, so every element of a state it owns is in its
denominator, including elements a later Unit implements (for example the
EQUIPMENT-DETAIL inspection status, open anomalies, recent history, and the
bottom actions that U2/U3/U5 register in U1's slot). The owning Unit maps the
elements it implements (the slot container's own rule, such as BR6.2, belongs
in its Functional Design) and records each element a later Unit implements as
`intentionally-omitted` with `deferredTo: <later unit>`; it does not cite rule
IDs the later Unit has not designed yet. The later Unit adds that screen/state
mapping to its own slice, maps the element with its rule, and omits (with
`deferredTo` back to the owner) the elements it does not implement. The union
at Build and Test then needs that implementer. An element whose rendering
depends on data that only a later Unit creates (an "異常あり" status that needs
an open anomaly) is still mapped by the Unit that implements its rendering rule,
not omitted. The approved snapshot fixes the data each approved state shows:
the Build and Test capture must reproduce that state's data through its setup
(`--query`, `--setup-click`, or a state fixture the implementation exposes for
capture), never through whatever sample data happens to ship; a state the
capture cannot reproduce is NOT-READY, not a pass.

Stage contracts:

- functional-design: `ui-poc-functional-contract.md` with `upstream`
  (refined-mockups), `fidelity.approvedSnapshot`, `fidelity.elementRuleMatrix`,
  `fidelity.functionalDesign` (byte-identical Markdown copies), and
  `fidelity.dispositions`. The producer gate needs the refined approval, not its
  own.
- code-generation additionally requires `fidelity.elementRuleMatrix` and
  `fidelity.functionalDesignContract`, a byte-identical copy of the approved
  Functional Design contract. The handoff is refused if that contract is
  missing, unapproved (in the ledger with `stage: "functional-design"` and
  `contractSha256`, or by the engine record's official gate in an
  engine-record scope), or if its snapshot, matrix, dispositions, or mapping
  inventory differ from the implementation contract.
- build-and-test additionally requires `fidelity.elementRuleMatrix` (unchanged
  from code-generation, or with several Units the deterministic union over
  `fidelity.unitContracts`) and `fidelity.elementTestMatrix`.

Approved-upstream change control has exactly two legal paths. (1) An
**artifact revision**: the revised refined contract declares
`fidelity.revision = {previousSnapshot, changedElements, deltaSha256}`; the
sensor recomputes the element delta between the two approved snapshots
(`revision` command) and rejects any undeclared change; the person's ordinary
approval of the revised contract is the confirmation, and every downstream
matrix bound to the old snapshot is stale until regenerated
(`rule-matrix generate --previous` keeps mappings only for unchanged rows). (2)
A **user-confirmed deviation**: an `approved-deviation`, `upstream-revised`, or
`intentionally-omitted` disposition bound to the snapshot, element, reason,
and exact delta, approved by a detached Functional Design receipt (ledger
scopes) or by the official gate of the Functional Design that states it
(engine-record scopes, see the approval trust boundary). Any other wording or
element change (in Functional Design text, the matrix, the implementation, or
the snapshot) fails closed.

Limits: rule-ID presence and verbatim copy are deterministic; whether a rule
correctly implements an element is reviewer judgement. A revision is detected
only when the previously approved snapshot is supplied; the operator-managed
ledger remains the trust anchor.

## Approval trust boundary

`UI_POC_APPROVAL_LEDGER` must point to an operator-managed detached JSON file outside the stage evidence directory. It contains `approvals` entries with `contractSha256`, `stage`, `arm`, `status: "approved"`, `source`, `reviewer`, and `requiredMappings` in contract order. This is a local plugin trust input, NOT a claimed built-in AI-DLC approval schema or API. The workflow agent must not create or amend its own approval entries. The operator records a real approval's exact source only after actual review. No production ledger ships here.

Each engine scope picks its upstream approval source in
`tools/ui-poc/scope-evidence.json`. `upstreamApproval: "ledger"`
(`ui-poc-comparison` and any unlisted scope) requires the detached ledger above.
`upstreamApproval: "engine-record"` (`ui-poc-application`,
`ui-poc-requirements`) leaves approval to the official stage gate and reads no
ledger for it: the upstream copy must be byte-identical to the contract the
engine record holds for that stage, in the intent's refined-mockups directory or
in this Unit's Construction stage directory, and the engine audit must show
the official gate approval of that stage (the latest `STAGE_STARTED`,
`STAGE_AWAITING_APPROVAL`, `STAGE_REVISING`, `GATE_REJECTED` or `GATE_APPROVED`
row whose `Gate Stages`/`Stage` include it, for that Unit, is `GATE_APPROVED`;
a Unit-end checkpoint approves every stage in its `Gate Stages`). Byte identity
alone is never an approval.

Dispositions follow the same split, with one owner (`dispositionTrust` in
`ui-poc-evidence.cjs`). In a ledger scope each deviation or omission needs its
detached receipt exactly as above. In an engine-record scope there is no
ledger and no receipt: the person's official approval of the Functional Design
that records a disposition is its approval, so a disposition carries no
`approvalReceipt` (one is refused as AI-written). It carries `elementKey`,
`status`, a non-empty `reason`, `deltaSha256` (`missing` for an omission; for
a deviation or revision the hash of its declared `differences[]`, which
describe the difference, for example a placement), optional `deferredTo`, and
`source: {path, heading}`, the Functional Design section (for example
`functional-spec.md` "6. 承認済みの見た目からの違い（Q6）") that names the
element key, so the reviewer and the gate read one source. At the Functional
Design gate the dispositions are pending: the sensor checks only that
structure and the element's place in the Unit slice. Code generation verifies
the copied Functional Design contract and every `fidelity.functionalDesign`
Markdown copy against the engine record (`construction/<unit>/functional-design/`,
the outputs the engine fingerprints at approval and invalidates when they
change) and the Functional Design gate approval; with Construction checkpoints
enabled, where Functional Design and code generation share the Unit-end gate,
code generation accepts them as still pending. Build and Test runs after every
Unit gate and requires each Unit's Functional Design and code-generation
approval, with the person's own (non-autonomous) approval wherever that Unit
has dispositions. A disposition changed after approval changes those bytes and
is refused. `sensor: "off"` declares the sensor
not applicable to a scope; it then passes with `notApplicable` and checks neither
contracts nor routing. Inside a Construction Unit, functional-design and
code-generation contracts may carry the Unit's slice of the refined inventory:
every mapping must exist upstream, and the upstream approval is checked against
the refined contract's full inventory, and the element rule matrix is scoped to
that slice. Build and Test runs once per intent: with one intent-level
code-generation contract it needs that one upstream contract with the same
inventory; with Units it reads every Unit's implementation contract through
`fidelity.unitContracts` and checks intent-level element coverage.

For code-generation, include upstream: {path, sha256, stage: "refined-mockups"}; for build-and-test, use stage: "code-generation". The path points to a byte-identical local evidence copy of that upstream contract, and the approval ledger binds its SHA-256 and mapping inventory. For functional-design, use stage: "refined-mockups". The checker recursively validates the complete refined → functional design → implementation → testing chain, including every ancestor’s headings, assets, hashes, mappings and required prior approval. The chain is bounded to four stage contracts; a repeated real file identity along one ancestry path is rejected. Copy the entire referenced snapshot tree, not Markdown alone. Each ancestor resolves its own relative asset and upstream paths from its containing directory, with nested paths confined within the current-stage evidence root. Upstream copies are evidence, never substituted for engine-resolved core artifacts. Approval does not assert that generated implementation assets are byte-identical to design prototypes. The ledger path is environment-configured, not supplied by untrusted contract text. Filesystem isolation/ownership and actual human identity are deployment responsibilities; the checker cannot authenticate the purported reviewer or protect a ledger writable by the same agent. A writable self-authored ledger is NOT acceptable production evidence. Verify these controls before live runs. Unit tests intentionally create synthetic approvals solely to exercise validation.

The gate sensor is a preflight evidence check. Rough and refined producer gates validate draft shape and hashes without demanding an additional human approval. The consuming code-generation and build-and-test gates require a receipt of the prior stage’s ordinary approval, not approval of their own new draft. This receipt does not impersonate or replace the core stage-approval event. If approval infrastructure is unavailable, block and report the missing evidence; never set approved to make tests green.

## Developer and testing handoff

The developer must receive the refined contract, core mockup documents, user stories/ACs, unit definition and story map, functional design, and the actual engine-produced implementation/testing brief. Preserve core source-manifest.json, traceability.json, code-generation-plan.md, unit-test-instructions.md and code-summary.md. Read the pinned treatment entrypoints during the applicable stage and record actual read evidence. Do not merely name a skill in a prompt and report that it ran.

Build and Test records measured results and exact commands separately from unexecuted instructions. Capture screenshots, console errors, keyboard behavior, responsive states, cancel/back/repeated actions and inaccessible states when browser execution is authorized and available. Never promote local checker tests or generated HTML to a passed end-to-end workflow.

## Arm C routing evidence

At every C stage with routing rules, keep `ui-poc-routing-facts.json`, `ui-poc-routing-context.json`, and `ui-poc-skill-evidence.json` beside the output. The blocking sensor derives record, Unit, scope, and `aidlc-state.md` digest from the dispatched output path; hashes facts, context, installed pinned files, inputs, and actual output files; and rejects unselected or disabled skills. Impeccable applications additionally require a JSON Design Context snapshot with observed creator confirmation, allowed provenance kind, project-confined confirmation-source `{path,sha256}`, project-confined common-brief `{path,sha256}`, audience/use-cases/brand-tone, plus a JSON WCAG report asserting pinned-source preservation and the 24/18.6667 CSS px correction. When teach-impeccable is selected, its context output must precede and exactly equal frontend-design's context input. These checks bind observed files but do not authenticate a human identity. The official sensor API has no canonical attempt ID, so distinct attempts with byte-identical engine state cannot be fully authenticated. Logs are mechanically verified attestations, not proof of model cognition.
