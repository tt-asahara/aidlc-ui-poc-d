---
target: build-and-test
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
    - ui-poc-application
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

Read each unit’s approved implementation contract and inherited refined contract hash chain alongside ALL core code outputs and Testing Contracts. Produce ui-poc-test-contract.md with the full refined screen/state/AC inventory, measured checks per screen/state/AC, commands and results, and explicit unavailable or unexecuted checks. With one intent-level code-generation contract, reference it as `upstream`. With Construction Units, copy every UI Unit's approved implementation contract with its whole asset tree from the engine-resolved `construction/<unit>/code-generation/` directory to `units/<unit>/` beside this contract, list each in `fidelity.unitContracts` (and assets), omit `upstream`, and build the intent-level matrix with `bun {{HARNESS_DIR}}/tools/ui-poc-element-matrix.cjs rule-matrix union --approved <approved.json> --unit-contracts units/<u1>/ui-poc-implementation-contract.md,... --out ui-poc-element-rule-matrix.json --dispositions-out <dispositions.json>`; record that output as `fidelity.elementRuleMatrix` and `fidelity.dispositions`. An element with no owning Unit, two Units mapping it differently, or an omission deferred to a Unit that does not implement it is NOT-READY; resolve it in the Units' Functional Design, never by editing the union. In an engine-record scope every Unit's Functional Design and code generation must be approved through the official gate (per stage or the Unit-end checkpoint) before this gate passes, and a Unit with dispositions needs the person's own approval, not an autonomous one. Preserve every core test instruction and summary. Actual browser/CLI/compose evidence must be recorded separately from checker unit tests.

Start the real implementation with its declared test command and capture every declared screen/state from its loopback URL using `bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs capture --url <loopback-url> --out <actual.json>`. When `visualRegression` is ON, the capture command must also include `--png <actual.png>` plus the same `--width`, `--height`, `--device-scale-factor`, and `--visual-policy` values recorded in the approved baseline snapshot; when it is OFF, omit those arguments. Reproduce each approved state's data through the capture setup (`--query`, `--setup-click`, or a capture-only state fixture of the implementation), not through whatever sample data ships; an element the approved state shows only with later-Unit data is still expected. Compare this independent observation with the frozen approved snapshot, then generate the element-level matrix with `bun {{HARNESS_DIR}}/tools/ui-poc-element-matrix.cjs test-matrix generate --approved <approved.json> --actual <actual.json> --rule-matrix <ui-poc-element-rule-matrix.json> --out ui-poc-element-test-matrix.json [--dispositions <json>] [--approval-ledger <ledger> | --engine-record]` and record it as `fidelity.elementTestMatrix` with the carried (or, with Units, the union) `fidelity.elementRuleMatrix`. The gate recomputes it; a hand-edited row, an empty denominator, or any `fail` row is NOT-READY. Exact copy, visible text/control presence, roles, computed truncation dimensions/styles, and declared action-to-state results are blocking. Hidden nodes in other states are not coverage. Renderer, state, dimensions, or action unavailable means NOT-READY, never a zero-observation pass.

When visualRegression is ON, run `bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs visual-compare --baseline <baseline.png> --actual <actual.png> --baseline-snapshot <approved.json> --actual-snapshot <actual.json> --diff-out <diff.png>` against the pre-approval baseline bound to the approved HTML hash. Renderer/OS/viewport/scale/font/flag metadata or visual-policy mismatch, a missing mask target, or a missing/incompatible baseline is NOT-READY (comparison refused); never create or update the baseline or loosen its approved policy here. A FAIL keeps its diff image as review evidence; resolve it through the existing approved-deviation or upstream-revision path, not by re-capturing until it passes. When OFF, do not run pixel comparison. PNG evidence cannot override semantic failure.

New work uses schema=2 with frozen approved snapshot, independently measured actual snapshot, approved dispositions, commands/results, and the existing upstream approval chain. Hash every asset. Never substitute checker fixtures for running-application evidence.

Read the installed runtime contract at {{HARNESS_DIR}}/tools/ui-poc/contract.md and the current arm’s {{HARNESS_DIR}}/tools/ui-poc/treatments/<arm>.json (lowercase a, b or c). Its source_lock resolves beside that JSON. Verify the selected commit and installed skill entrypoints before applying the treatment. These files are projected through the supported tools subtree; do not depend on uninstalled source docs or treatment directories.
