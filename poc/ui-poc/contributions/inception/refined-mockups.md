---
target: refined-mockups
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
    - ui-poc-application
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

New work uses schema=2 and fidelity.approvedSnapshot. Before the ordinary approval gate, render every declared screen/state with `bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs capture --html <state-html> --out <snapshot.json>` and preserve the complete state denominator. The render root uses data-ui-screen/data-ui-state. Interactive, conditional, exact-copy, and business-value elements need stable data-ui-id; ordinary static text uses generated fingerprints. If a state, computed truncation, or declared action cannot be observed, stop as NOT-READY. Do not substitute a hand-written inventory or static regex scan.

Read the D settings. Effective baseline PNG generation is `mockupPngGeneration || visualRegression`; when effective, add `--png <baseline.png>` during this pre-approval capture and bind its hash plus viewport/renderer metadata. Both settings default OFF and govern only images, not mandatory semantic rendering. Never generate a baseline first during Build and Test. Hash all assets. The ordinary gate remains the sole approval owner.

When this is a revision of a previously approved refined mockup, keep the previously approved snapshot as an asset and declare `fidelity.revision` = `{previousSnapshot, changedElements, deltaSha256}` from `bun {{HARNESS_DIR}}/tools/ui-poc-element-matrix.cjs revision --previous <old.json> --current <new.json>`. The sensor recomputes the element delta; an undeclared change fails. Present the changed elements at the ordinary gate so the person's approval of the revised contract is the recorded confirmation. Downstream Functional Design matrices bound to the old snapshot become stale and must be regenerated with `--previous`.

Read the installed runtime contract at {{HARNESS_DIR}}/tools/ui-poc/contract.md and the current arm’s {{HARNESS_DIR}}/tools/ui-poc/treatments/<arm>.json (lowercase a, b or c). Its source_lock resolves beside that JSON. Verify the selected commit and installed skill entrypoints before applying the treatment. These files are projected through the supported tools subtree; do not depend on uninstalled source docs or treatment directories.
