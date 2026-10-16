---
target: domain-design
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
  sensors:
    - ui-poc-evidence
fragments:
  - anchor: after-step:1
    order: 100
---

## fragment: after-step:1

### C domain-language adapter

Run the C router with explicit `unresolved_domain_terms_or_boundaries`. When true, domain-modeling may challenge canonical terms, responsibilities, ownership, boundaries, and qualifying ADR candidates only. Do not pre-decide types, validation rules, allowed values, cardinality, state machines, framework code, SQL, or implementation. AI-DLC artifacts, questions, and approval remain authoritative; record the complete routing evidence bundle.
