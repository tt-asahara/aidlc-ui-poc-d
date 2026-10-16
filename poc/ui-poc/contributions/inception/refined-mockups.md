---
target: refined-mockups
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
  produces:
    - ui-poc-refined-contract
  sensors:
    - ui-poc-evidence
  consumes:
    - artifact: ui-poc-rough-contract
      required: true
fragments:
  - anchor: before-step:4
    order: 100
---

## fragment: before-step:4

### UI PoC evidence handoff

Run the C router with explicit `unresolved_visual_alternatives`. Apply historical Impeccable using the previously creator-confirmed context, approved requirements, and Stories/AC; use Matt UI only for a remaining explicit design question. Read all seven references and emit the WCAG correction report. Preserve core outputs and stable IDs, hash all assets and routing evidence, and do not claim approval; the ordinary AI-DLC gate is sole owner.

The plugin contract must have H2 sections Artifact References, Screen State Acceptance Mapping, Approval Evidence, and Testing Brief; exactly one fenced ui-poc-contract JSON object with schema=1, stage, arm A/B/C, assets [{path,sha256}], mappings [{screen,state,ac,asset,check}], and requiredMappings ["SCREEN-…/STATE-…/AC-…"]. Paths must remain inside this stage directory; hash every referenced local asset. For consuming code/test contracts include upstream {path,sha256,stage}, naming a byte-identical local copy of the prior contract, and require its real approval in the independently managed UI_POC_APPROVAL_LEDGER. Never fabricate that ledger. Rough/refined draft gates require no extra approval.

Read the installed runtime contract at {{HARNESS_DIR}}/tools/ui-poc/contract.md and the current arm’s {{HARNESS_DIR}}/tools/ui-poc/treatments/<arm>.json (lowercase a, b or c). Its source_lock resolves beside that JSON. Verify the selected commit and installed skill entrypoints before applying the treatment. These files are projected through the supported tools subtree; do not depend on uninstalled source docs or treatment directories.
