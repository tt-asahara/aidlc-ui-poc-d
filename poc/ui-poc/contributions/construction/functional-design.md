---
target: functional-design
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
    - ui-poc-application
  sensors:
    - ui-poc-evidence
  consumes:
    - artifact: ui-poc-refined-contract
      required: true
    - artifact: stories
      required: false
fragments:
  - anchor: after-step:1
    order: 100
---

## fragment: after-step:1

### Refined UI evidence as functional design input

Read the actual refined HTML and ui-poc-refined-contract.md with the unit definition. Map relevant screen/state/AC triples into functional-spec.md and frontend-components.md where applicable, keeping each AC ID exactly as the refined contract and stories.md (consumed when present) spell it. Preserve the core business-rule/domain design boundary; HTML is evidence and interaction specification, not permission to skip functional design or change the approved Testing Contract. Keep all core Markdown outputs.

Read the approved semantic snapshot first and generate the element-to-rule matrix from it with `bun {{HARNESS_DIR}}/tools/ui-poc-element-matrix.cjs rule-matrix generate --approved <snapshot.json> --out ui-poc-element-rule-matrix.json`; do not hand-write the rows or ask the person to maintain another full-screen table. In a Construction Unit, first write the `mappings` and `requiredMappings` of ui-poc-functional-contract.md with only this Unit's screen/state/AC slice of the refined inventory (from the unit definition and story map), then add `--unit <unit-directory-name> --contract ui-poc-functional-contract.md` to both `generate` and `check`: the denominator is exactly that slice, and other Units' elements and copy are not this Unit's obligation. Do not invent rule IDs or omission receipts for other Units' states. A state approved on another Unit's screen that this Unit also renders (for example an app-shell banner approved only on the home screen) is claimed only by adding that state's approved mapping to this slice; then map the elements this Unit implements with the same rule IDs the owning Unit uses, and present each other rule-requiring element of that state as an `intentionally-omitted` disposition with `deferredTo: <the Unit that implements it>` for the person's decision. The same holds inside this Unit's own states: an element a later Unit implements (for example an action that Unit registers in this Unit's slot) is an `intentionally-omitted` disposition with `deferredTo` that later Unit, never a rule ID that Unit has not designed yet; the later Unit claims the state in its own slice and maps it, and Build and Test refuses a deferral nobody implements. An element whose rendering depends on data a later Unit creates is mapped to this Unit's rendering rule, not omitted. Showing it somewhere the mockup did not approve is an approved deviation or a refined-mockup revision, never implicit. Fill only `ruleIds` (rule/copy/spec IDs defined in functional-spec.md, frontend-components.md, or rules.md when this Unit keeps it; every file that defines a rule ID must be listed in `fidelity.functionalDesign` and passed to `--fd`) or `unimplementedReason`; never edit the generated copy, kind, role, action, truncation, or obligation fields. Every exact-copy element's approved wording must appear verbatim in the Functional Design text (for a templated message, quote the approved rendered example beside the template). Only a changed or omitted element gets `upstream-revised`, `approved-deviation`, or `intentionally-omitted`, with a reason; every `unimplementedReason` requires an `intentionally-omitted` disposition. Who approves it comes from the scope's `upstreamApproval` in {{HARNESS_DIR}}/tools/ui-poc/scope-evidence.json. With `ledger`, cite the existing detached Functional Design approval receipt ID. With `engine-record` there is no receipt: write no `approvalReceipt`; give `deltaSha256` (`missing` for an omission; for a deviation or revision the hash of the `differences` you declare, such as a placement), and `source: {path, heading}` naming the Functional Design section that lists the element key (for example the functional-spec.md section that records the person's deviation decision); present that section at this stage's gate, whose official approval (or the Unit-end checkpoint's) approves them. Never write a ledger entry or receipt yourself. Run `rule-matrix check` (with the same `--unit`/`--contract` in a Unit, plus `--engine-record` in an engine-record scope) before presenting the gate and fix every finding; after any change to the slice, regenerate with `--previous` because the recorded slice makes the old matrix stale; a finding is never answered by editing generated fields.

Write ui-poc-functional-contract.md (schema 2, stage functional-design) beside the core outputs with the approved snapshot, the matrix as `fidelity.elementRuleMatrix`, byte-identical copies of the Functional Design Markdown as `fidelity.functionalDesign`, the dispositions, and the byte-identical refined contract as `upstream`. The blocking ui-poc-evidence sensor re-runs the matrix check at this gate. The contract is a sibling plugin artifact, not an engine-declared produce: an untagged produce on this per-unit-kind stage fails graph compilation, so the sensor and the code-generation gate enforce it instead. A unit with neither ui-poc-functional-contract.md nor frontend-components.md is a non-UI unit and carries no obligation here. Natural-language equivalence remains reviewer judgement; feature 28 specGrounding is the optional existing lane for ambiguous specification meaning.
