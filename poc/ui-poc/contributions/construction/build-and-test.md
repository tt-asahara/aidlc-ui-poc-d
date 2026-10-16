---
target: build-and-test
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
  produces:
    - ui-poc-test-contract
  sensors:
    - ui-poc-evidence
  consumes:
    - artifact: ui-poc-implementation-contract
      required: true
fragments:
  - anchor: after-step:1
    order: 100
---

## fragment: after-step:1

### UI PoC evidence handoff

Read each unit’s approved implementation contract and inherited refined contract hash chain alongside ALL core code outputs and Testing Contracts. Produce ui-poc-test-contract.md with the upstream implementation contract hash, measured checks per screen/state/AC, commands and results, and explicit unavailable or unexecuted checks. For this minimal shared PoC keep one integrated UI unit; multi-unit evidence aggregation requires a separately reviewed extension of the checker. Preserve every core test instruction and summary. Actual browser/CLI/compose evidence must be recorded separately from checker unit tests.

The plugin contract must have H2 sections Artifact References, Screen State Acceptance Mapping, Approval Evidence, and Testing Brief; exactly one fenced ui-poc-contract JSON object with schema=1, stage, arm A/B/C, assets [{path,sha256}], mappings [{screen,state,ac,asset,check}], and requiredMappings ["SCREEN-…/STATE-…/AC-…"]. Paths must remain inside this stage directory; hash every referenced local asset. For consuming code/test contracts include upstream {path,sha256,stage}, naming a byte-identical local copy of the prior contract, and require its real approval in the independently managed UI_POC_APPROVAL_LEDGER. Never fabricate that ledger. Rough/refined draft gates require no extra approval.

Read the installed runtime contract at {{HARNESS_DIR}}/tools/ui-poc/contract.md and the current arm’s {{HARNESS_DIR}}/tools/ui-poc/treatments/<arm>.json (lowercase a, b or c). Its source_lock resolves beside that JSON. Verify the selected commit and installed skill entrypoints before applying the treatment. These files are projected through the supported tools subtree; do not depend on uninstalled source docs or treatment directories.
