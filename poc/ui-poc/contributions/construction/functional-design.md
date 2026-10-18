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

Read the approved semantic snapshot first and generate the element-to-rule matrix from it with `bun {{HARNESS_DIR}}/tools/ui-poc-element-matrix.cjs rule-matrix generate --approved <snapshot.json> --out ui-poc-element-rule-matrix.json`; do not hand-write the rows or ask the person to maintain another full-screen table. Fill only `ruleIds` (rule/copy/spec IDs defined in functional-spec.md or frontend-components.md) or `unimplementedReason`; never edit the generated copy, kind, role, action, truncation, or obligation fields. Every exact-copy element's approved wording must appear verbatim in the Functional Design text (for a templated message, quote the approved rendered example beside the template). Only a changed or omitted element gets `upstream-revised`, `approved-deviation`, or `intentionally-omitted`, with a reason and the existing Functional Design approval receipt ID; every `unimplementedReason` requires an `intentionally-omitted` disposition with that detached receipt. Run `rule-matrix check` before presenting the gate and fix every finding; a finding is never answered by editing generated fields.

Write ui-poc-functional-contract.md (schema 2, stage functional-design) beside the core outputs with the approved snapshot, the matrix as `fidelity.elementRuleMatrix`, byte-identical copies of the Functional Design Markdown as `fidelity.functionalDesign`, the dispositions, and the byte-identical refined contract as `upstream`. The blocking ui-poc-evidence sensor re-runs the matrix check at this gate. The contract is a sibling plugin artifact, not an engine-declared produce: an untagged produce on this per-unit-kind stage fails graph compilation, so the sensor and the code-generation gate enforce it instead. A unit with neither ui-poc-functional-contract.md nor frontend-components.md is a non-UI unit and carries no obligation here. Natural-language equivalence remains reviewer judgement; feature 28 specGrounding is the optional existing lane for ambiguous specification meaning.
