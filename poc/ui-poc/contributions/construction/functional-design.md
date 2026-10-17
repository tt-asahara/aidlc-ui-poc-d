---
target: functional-design
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
    - ui-poc-application
  consumes:
    - artifact: ui-poc-refined-contract
      required: true
fragments:
  - anchor: after-step:1
    order: 100
---

## fragment: after-step:1

### Refined UI evidence as functional design input

Read the actual refined HTML and ui-poc-refined-contract.md with the unit definition. Map relevant screen/state/AC triples into functional-spec.md and frontend-components.md where applicable. Preserve the core business-rule/domain design boundary; HTML is evidence and interaction specification, not permission to skip functional design or change the approved Testing Contract. Keep all core Markdown outputs.

Read the approved semantic snapshot first and generate the element-to-rule/copy projection from it; do not ask the person to maintain another full-screen table. Interactive, conditional, and business-value elements map to a rule/AC; exact copy maps to a copy/spec ID. Only a changed or omitted element gets `upstream-revised`, `approved-deviation`, or `intentionally-omitted`, with a reason and the existing Functional Design approval receipt ID. Every omission requires that detached receipt. Natural-language equivalence remains reviewer judgement; feature 28 specGrounding is the optional existing lane for ambiguous specification meaning.
