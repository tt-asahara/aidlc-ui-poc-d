---
target: rough-mockups
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
    - ui-poc-application
    - ui-poc-requirements
    - ui-poc-document-driven
  produces:
    - ui-poc-rough-contract
  sensors:
    - ui-poc-evidence
fragments:
  - anchor: before-step:4
    order: 100
  - anchor: before-step:5
    order: 100
---

## fragment: before-step:4

### UI PoC evidence handoff

Run the C routing plan with explicit `design_context_missing` and `state_model_uncertainty` facts. Use the same creator-confirmed common brief as A/B; if context is incomplete, bounded teach-impeccable may organize only the existing AI-DLC questions and must not edit AGENTS.md or create another approval round. Apply Matt exploration plus the historical Impeccable component to self-contained low-fidelity HTML; read all seven references and apply the declared WCAG large-text correction without editing pinned source. Preserve core artifacts, mark provisional discoveries, and record context/facts, pinned reads, bounded inputs, hashed outputs, and correction report in the three routing evidence files. Missing context, pins, evidence, or attempted prototype branch/no-tests behavior blocks completion.

The plugin contract must have H2 sections Artifact References, Screen State Acceptance Mapping, Approval Evidence, and Testing Brief; exactly one fenced ui-poc-contract JSON object with schema=1, stage, arm A/B/C, assets [{path,sha256}], mappings [{screen,state,ac,asset,check}], and requiredMappings ["SCREEN-…/STATE-…/<ac>"]. User stories do not exist yet, so `ac` uses a provisional legacy ID `AC-[A-Z0-9-]+` (for example AC-ISSUE-1); refined mockups replace it with the official story ID. Paths must remain inside this stage directory; hash every referenced local asset with `bun {{HARNESS_DIR}}/tools/ui-poc-evidence.cjs hash --dir <stage directory> <path>...` (project-relative routing-evidence hashes: the same command without `--dir`), never `shasum`, `node`, or `python`, and self-check with `bun {{HARNESS_DIR}}/tools/ui-poc-evidence.cjs --stage rough-mockups --output-path <contract path>`. For consuming code/test contracts include upstream {path,sha256,stage}, naming a byte-identical local copy of the prior contract, and require its real approval in the independently managed UI_POC_APPROVAL_LEDGER. Never fabricate that ledger. Rough/refined draft gates require no extra approval.

Read the installed runtime contract at {{HARNESS_DIR}}/tools/ui-poc/contract.md and the current arm’s {{HARNESS_DIR}}/tools/ui-poc/treatments/<arm>.json (lowercase a, b or c). Its source_lock resolves beside that JSON. Verify the selected commit and installed skill entrypoints before applying the treatment. These files are projected through the supported tools subtree; do not depend on uninstalled source docs or treatment directories.

## fragment: before-step:5

### Review findings before the gate

The `ui-poc-evidence` sensor fires when this stage's gate opens. While the current review leaves any Critical or Major finding `New` or `Unresolved` with no decision by the person, it reports `Open Major review findings without the person's decision: …` and the engine keeps the gate closed. That hold is the designed path, not a sensor defect: do not take the blocking-sensor override for it on your own, and never record a decision the person did not make. Only Minor findings open, or none: nothing changes, present the standard gate.

In the `ui-poc-document-driven` scope, first try to clear them without a question: revise the artifacts to address every open Critical or Major finding and have the stage's reviewer review again, as the stage protocol's review loop allows, at most two more times. Ask the question below only when such a finding is still open after that. Accepting a risk is never taken on the person's behalf.

Ask the person one question through the engine, exactly: `bun {{HARNESS_DIR}}/tools/aidlc-log.ts decision --stage rough-mockups --decision "Major review findings still open" --options "Fix the Major findings first,Decide each finding,Accept all as risks"`. Show the open Major findings from the review brief and the three choices in that order, the first marked recommended, in the conversation language, and end the turn. Record their reply with `bun {{HARNESS_DIR}}/tools/aidlc-log.ts answer --stage rough-mockups --details "<the chosen label>"`, then record what they decided with `bun {{HARNESS_DIR}}/tools/ui-poc-review-risks.cjs decide --stage rough-mockups --output-path <record>/ideation/rough-mockups/ui-poc-rough-contract.md …` (run `status` with the same flags to see what is open):

- **Fix the Major findings first** (recommended): `--fix R-NN` for every open Major finding, then report again so the gate opens. The person's Request Changes at that gate is what reopens the reviewed artifacts; fix them and the revision is reviewed again as usual.
- **Decide each finding**: go through the Major findings one at a time. A finding they want fixed is `--fix R-NN`; a finding they accept is `--accept R-NN --rationale "<their words>"`. One call may carry several of each.
- **Accept all as risks**: every Major finding needs the person's reason; ask for it when their reply gives none. Record `--accept R-NN --rationale "<their words>"` for each; one reason covers several findings only when the person said so.

`--rationale` is the person's own words, verbatim: the tool refuses a reason that was not typed in this chat after the review, and an empty one; never paraphrase, summarize, or supply it. `--follow-up-stage` names where the accepted risk is checked again (default and only supported value: `build-and-test`). Decisions are written to `ui-poc-review-decisions.json` beside this stage's contract and carry over while the finding's text is unchanged. At the gate itself the ordinary Approve still records every open finding as `Accepted risk` on the engine's `GATE_APPROVED` row; what this stage adds is the person's reason for each accepted Major and its Build and Test check item, which Build and Test's `ui-poc-evidence` sensor requires.
