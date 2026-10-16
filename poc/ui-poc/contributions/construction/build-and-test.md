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

Read each unit’s approved implementation contract and inherited refined contract hash chain alongside ALL core code outputs and Testing Contracts. Produce ui-poc-test-contract.md with the upstream implementation contract hash, measured checks per screen/state/AC, commands and results, and explicit unavailable or unexecuted checks. For this minimal shared PoC keep one integrated UI unit; multi-unit evidence aggregation requires a separately reviewed extension of the checker. Preserve every core test instruction and summary. Actual browser/CLI/compose evidence must be recorded separately from checker unit tests.

Start the real implementation with its declared test command and capture every declared screen/state from its loopback URL using `bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs capture --url <loopback-url> --out <actual.json>`. Compare this independent observation with the frozen approved snapshot. Exact copy, visible text/control presence, roles, computed truncation dimensions/styles, and declared action-to-state results are blocking. Hidden nodes in other states are not coverage. Renderer, state, dimensions, or action unavailable means NOT-READY, never a zero-observation pass.

When visualRegression is ON, compare only with the pre-approval baseline bound to the approved HTML hash and matching environment. Missing/incompatible baseline is NOT-READY; never create or update it here. When OFF, do not run pixel comparison. PNG evidence cannot override semantic failure.

New work uses schema=2 with frozen approved snapshot, independently measured actual snapshot, approved dispositions, commands/results, and the existing upstream approval chain. Hash every asset. Never substitute checker fixtures for running-application evidence.

Read the installed runtime contract at {{HARNESS_DIR}}/tools/ui-poc/contract.md and the current arm’s {{HARNESS_DIR}}/tools/ui-poc/treatments/<arm>.json (lowercase a, b or c). Its source_lock resolves beside that JSON. Verify the selected commit and installed skill entrypoints before applying the treatment. These files are projected through the supported tools subtree; do not depend on uninstalled source docs or treatment directories.
