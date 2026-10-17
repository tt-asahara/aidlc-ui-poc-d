---
target: requirements-analysis
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
    - ui-poc-application
    - ui-poc-requirements
  sensors:
    - ui-poc-evidence
  consumes:
    - artifact: ui-poc-rough-contract
      required: true
fragments:
  - anchor: after-step:1
    order: 100
---

## fragment: after-step:1

### Rough UI evidence as requirements input

Read the rough evidence and run the C router with explicit requirements/domain facts. Grilling may organize only the existing question frontier; AI-DLC asks and records answers. Domain-modeling is limited to terms, responsibility, ownership, and boundaries—never types, validation, allowed values, cardinality, or implementation. Do not create a separate confirmation, approval, or tracker action. Record the routed evidence bundle; missing facts or evidence block the gate.
