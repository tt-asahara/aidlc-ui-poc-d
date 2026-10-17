---
name: ui-poc-comparison
plugin: ui-poc
depth: Standard
keywords:
  - ui-poc-comparison
  - design-treatment-comparison
description: Controlled UI comparison with rough and refined design plus unit handoffs
skeleton: on
runner: true
guard_policy: strict
sensors: on
learnings: on
summary_confirmation: on
plan_approval: on
collaborators: off
---

# UI PoC comparison

This is an owned comparison scope, not core poc. It retains rough-mockups (1.6), refined-mockups (2.5), user-stories, domain-design, units-generation, functional-design, code-generation and build-and-test. Display numbers are documentation only; slugs determine identity. Contributions add membership without replacing core behavior.

## Comparison controls

Use the same user-approved requirements, stable screen/state/acceptance-criterion IDs, unit boundaries, model/runtime version, test strategy and evaluation rubric in A/B/C. The only intended difference is the externally pinned skill treatment. Do not run an arm while its treatment is unresolved. Conditional stages require the engine's actual execution decision; do not invent an EXECUTE result. Retain every core Markdown artifact and code-generation Testing Contract.

## Plugin activation boundary

This scope does not isolate contribution effects. Once enabled, the plugin’s other additions also affect these target stages in stock scopes. Use isolated comparison repositories; disable/remove this plugin for unrelated workflows.
