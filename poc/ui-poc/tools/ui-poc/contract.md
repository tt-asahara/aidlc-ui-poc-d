# UI evidence contract, version 1

This contract supplements, never replaces, the core Markdown deliverables. An HTML preview alone is not an AI-DLC handoff. Write the stage's plugin-prefixed Markdown artifact in the same engine-resolved stage directory as its core outputs:

- rough-mockups: ui-poc-rough-contract.md
- refined-mockups: ui-poc-refined-contract.md
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

Paths are relative to this contract's stage directory. Absolute paths, parent traversal, backslashes, missing assets, non-files and symlink escapes are rejected. Declare every referenced HTML, CSS, JS, PNG/JPEG/SVG/WebP image and WOFF2 font in assets with its exact SHA-256. No remote dependencies are allowed. Browser-dependency completeness is a separate review obligation; this checker verifies declared assets and does not parse every possible dynamic import or network request. An independently approved inventory of screen/state/AC triples must cover loading, empty, success, error and interaction recovery states where applicable. A syntactically valid ID does not establish semantic completeness; reviewer comparison with requirements remains mandatory.

## Approval trust boundary

`UI_POC_APPROVAL_LEDGER` must point to an operator-managed detached JSON file outside the stage evidence directory. It contains `approvals` entries with `contractSha256`, `stage`, `arm`, `status: "approved"`, `source`, `reviewer`, and `requiredMappings` in contract order. This is a local plugin trust input, NOT a claimed built-in AI-DLC approval schema or API. The workflow agent must not create or amend its own approval entries. The operator records a real approval's exact source only after actual review. No production ledger ships here.

For code-generation, include upstream: {path, sha256, stage: "refined-mockups"}; for build-and-test, use stage: "code-generation". The path points to a byte-identical local evidence copy of that upstream contract, and the approval ledger binds its SHA-256 and mapping inventory. The checker recursively validates the complete refined → implementation → testing chain, including every ancestor’s headings, assets, hashes, mappings and required prior approval. The chain is bounded to three stage contracts; repeated real file identities are rejected. Copy the entire referenced snapshot tree, not Markdown alone. Each ancestor resolves its own relative asset and upstream paths from its containing directory, with nested paths confined within the current-stage evidence root. Upstream copies are evidence, never substituted for engine-resolved core artifacts. Approval does not assert that generated implementation assets are byte-identical to design prototypes. The ledger path is environment-configured, not supplied by untrusted contract text. Filesystem isolation/ownership and actual human identity are deployment responsibilities; the checker cannot authenticate the purported reviewer or protect a ledger writable by the same agent. A writable self-authored ledger is NOT acceptable production evidence. Verify these controls before live runs. Unit tests intentionally create synthetic approvals solely to exercise validation.

The gate sensor is a preflight evidence check. Rough and refined producer gates validate draft shape and hashes without demanding an additional human approval. The consuming code-generation and build-and-test gates require a receipt of the prior stage’s ordinary approval, not approval of their own new draft. This receipt does not impersonate or replace the core stage-approval event. If approval infrastructure is unavailable, block and report the missing evidence; never set approved to make tests green.

## Developer and testing handoff

The developer must receive the refined contract, core mockup documents, user stories/ACs, unit definition and story map, functional design, and the actual engine-produced implementation/testing brief. Preserve core source-manifest.json, traceability.json, code-generation-plan.md, unit-test-instructions.md and code-summary.md. Read the pinned treatment entrypoints during the applicable stage and record actual read evidence. Do not merely name a skill in a prompt and report that it ran.

Build and Test records measured results and exact commands separately from unexecuted instructions. Capture screenshots, console errors, keyboard behavior, responsive states, cancel/back/repeated actions and inaccessible states when browser execution is authorized and available. Never promote local checker tests or generated HTML to a passed end-to-end workflow.

## Arm C routing evidence

At every C stage with routing rules, keep `ui-poc-routing-facts.json`, `ui-poc-routing-context.json`, and `ui-poc-skill-evidence.json` beside the output. The blocking sensor derives record, Unit, scope, and `aidlc-state.md` digest from the dispatched output path; hashes facts, context, installed pinned files, inputs, and actual output files; and rejects unselected or disabled skills. Impeccable applications additionally require a JSON Design Context snapshot with observed creator confirmation, allowed provenance kind, project-confined confirmation-source `{path,sha256}`, project-confined common-brief `{path,sha256}`, audience/use-cases/brand-tone, plus a JSON WCAG report asserting pinned-source preservation and the 24/18.6667 CSS px correction. When teach-impeccable is selected, its context output must precede and exactly equal frontend-design's context input. These checks bind observed files but do not authenticate a human identity. The official sensor API has no canonical attempt ID, so distinct attempts with byte-identical engine state cannot be fully authenticated. Logs are mechanically verified attestations, not proof of model cognition.
