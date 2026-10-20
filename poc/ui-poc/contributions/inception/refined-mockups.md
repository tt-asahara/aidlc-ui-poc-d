---
target: refined-mockups
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
    - ui-poc-application
    - ui-poc-requirements
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
  - anchor: before-step:5
    order: 100
---

## fragment: before-step:4

### UI PoC evidence handoff

Run the C router with explicit `unresolved_visual_alternatives`. Its plan's `designSkill` is the design skill the person chose in `uiDesign.refinedMockupSkill` (D configuration; default `impeccable-historical`, the pinned historical Impeccable). Apply that design invocation exactly as planned (its entrypoints, inputs, outputs, and adapter) using the previously creator-confirmed context, approved requirements, and Stories/AC, and record the plan's `designSkill` in `ui-poc-skill-evidence.json`; never substitute another skill. Use Matt UI only for a remaining explicit design question. With the default, read all seven references and emit the WCAG correction report; a selected alternative's plan has no correction-report output. If the router or the sensor stops on an unknown, comparison-scope, or uninstalled choice, report its one-line reason and next step instead of falling back to another skill. Preserve core outputs and stable IDs, hash all assets and routing evidence, and do not claim approval; the ordinary AI-DLC gate is sole owner.

In every `ac` (mappings and requiredMappings), use the official acceptance-criterion ID from stories.md verbatim, in its `AC{story-group}.{story-seq}.{criterion-seq}` form (for example `AC1.2.3`); never rewrite it as `AC-1-2-3` or renumber it. The legacy `AC-…` form remains valid only for provisional rough IDs and existing contracts; under the optional D requirement-ID check a legacy ID needs an explicit `featureInputs.requirementIdBridges` entry.

New work uses schema=2 and fidelity.approvedSnapshot. Before the ordinary approval gate, render every declared screen/state with `bun {{HARNESS_DIR}}/tools/ui-poc-fidelity.cjs capture --html <state-html> --out <snapshot.json>` and preserve the complete state denominator. The render root uses data-ui-screen/data-ui-state. Interactive, conditional, exact-copy, and business-value elements need stable data-ui-id; ordinary static text uses generated fingerprints. If a state, computed truncation, or declared action cannot be observed, stop as NOT-READY. Do not substitute a hand-written inventory or static regex scan. Hash every declared asset with `bun {{HARNESS_DIR}}/tools/ui-poc-evidence.cjs hash --dir <stage directory> <path>...` (never `shasum`, `node`, or `python`) and self-check with `bun {{HARNESS_DIR}}/tools/ui-poc-evidence.cjs --stage refined-mockups --output-path <contract path>`.

Read the D settings. Effective baseline PNG generation is `mockupPngGeneration || visualRegression`; when effective, add `--png <baseline.png>` (and, when the screen has dynamic regions or needs a non-default threshold, `--visual-policy <policy.json>`) during this pre-approval capture and bind its hash plus the recorded viewport, device scale factor, renderer, OS, font, and visual-policy metadata. The visual policy (threshold, anti-aliasing tolerance, masks with reasons) is part of what the ordinary gate approves. Both settings default OFF and govern only images, not mandatory semantic rendering. Never generate a baseline first during Build and Test. Hash all assets. The ordinary gate remains the sole approval owner.

When this is a revision of a previously approved refined mockup, keep the previously approved snapshot as an asset and declare `fidelity.revision` = `{previousSnapshot, changedElements, deltaSha256}` from `bun {{HARNESS_DIR}}/tools/ui-poc-element-matrix.cjs revision --previous <old.json> --current <new.json>`. The sensor recomputes the element delta; an undeclared change fails. Present the changed elements at the ordinary gate so the person's approval of the revised contract is the recorded confirmation. Downstream Functional Design matrices bound to the old snapshot become stale and must be regenerated with `--previous`.

Read the installed runtime contract at {{HARNESS_DIR}}/tools/ui-poc/contract.md and the current arm’s {{HARNESS_DIR}}/tools/ui-poc/treatments/<arm>.json (lowercase a, b or c). Its source_lock resolves beside that JSON. Verify the selected commit and installed skill entrypoints before applying the treatment. These files are projected through the supported tools subtree; do not depend on uninstalled source docs or treatment directories.

## fragment: before-step:5

### Review findings before the gate

The `ui-poc-evidence` sensor fires when this stage's gate opens. While the current review leaves any Critical or Major finding `New` or `Unresolved` with no decision by the person, it reports `Open Major review findings without the person's decision: …` and the engine keeps the gate closed. That hold is the designed path, not a sensor defect: do not take the blocking-sensor override for it on your own, and never record a decision the person did not make. Only Minor findings open, or none: nothing changes, present the standard gate.

Ask the person one question through the engine, exactly: `bun {{HARNESS_DIR}}/tools/aidlc-log.ts decision --stage refined-mockups --decision "Major review findings still open" --options "Fix the Major findings first,Decide each finding,Accept all as risks"`. Show the open Major findings from the review brief and the three choices in that order, the first marked recommended, in the conversation language, and end the turn. Record their reply with `bun {{HARNESS_DIR}}/tools/aidlc-log.ts answer --stage refined-mockups --details "<the chosen label>"`, then record what they decided with `bun {{HARNESS_DIR}}/tools/ui-poc-review-risks.cjs decide --stage refined-mockups --output-path <record>/inception/refined-mockups/ui-poc-refined-contract.md …` (run `status` with the same flags to see what is open):

- **Fix the Major findings first** (recommended): `--fix R-NN` for every open Major finding, then report again so the gate opens. The person's Request Changes at that gate is what reopens the reviewed artifacts; fix them and the revision is reviewed again as usual.
- **Decide each finding**: go through the Major findings one at a time. A finding they want fixed is `--fix R-NN`; a finding they accept is `--accept R-NN --rationale "<their words>"`. One call may carry several of each.
- **Accept all as risks**: every Major finding needs the person's reason; ask for it when their reply gives none. Record `--accept R-NN --rationale "<their words>"` for each; one reason covers several findings only when the person said so.

`--rationale` is the person's own words, verbatim: the tool refuses a reason that was not typed in this chat after the review, and an empty one; never paraphrase, summarize, or supply it. `--follow-up-stage` names where the accepted risk is checked again (default and only supported value: `build-and-test`). Decisions are written to `ui-poc-review-decisions.json` beside this stage's contract and carry over while the finding's text is unchanged. At the gate itself the ordinary Approve still records every open finding as `Accepted risk` on the engine's `GATE_APPROVED` row; what this stage adds is the person's reason for each accepted Major and its Build and Test check item, which Build and Test's `ui-poc-evidence` sensor requires.
