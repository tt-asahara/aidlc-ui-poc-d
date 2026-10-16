---
target: functional-design
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
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
