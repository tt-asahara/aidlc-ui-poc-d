---
target: delivery-planning
plugin: ui-poc
adds:
  scopes:
    - ui-poc-comparison
    - ui-poc-application
fragments:
  - anchor: before-step:6
    order: 100
---

## fragment: before-step:6

### UI application execution proposal (ui-poc)

When the resolved scope is `ui-poc-application` and no explicit Construction
order has been requested, use the official Unit dependency DAG, write sets,
external dependencies, and walking-skeleton constraint to assess concurrency.
When two or more ready Units are dependency-independent and have disjoint
writes, propose stage-major Construction with official Code Generation swarm at
the normal Delivery Planning choice. If dependencies or writes conflict,
propose the safe serial order instead. This is a proposal, not a state change:
wait for the person's answer at the official gate before running either typed
setter. Keep design reviews, approvals, state writes, and Build and Test settlement
under their existing owners, preserve an explicit serial or unit-major choice, and never record the
proposal as approved until the person answers the official gate. Any non-UI
scope ignores this step.
