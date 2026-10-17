---
name: ui-poc-requirements
plugin: ui-poc
depth: Standard
keywords:
  - requirements-loop
  - 要件定義ループ
description: Requirements-only loop with rough and refined HTML evidence that grows the --doc design set
skeleton: off
runner: true
guard_policy: strict
sensors: on
learnings: on
summary_confirmation: on
plan_approval: off
collaborators: off
---

# UI requirements loop

Use this scope to iterate on requirements without building anything. It retains
intent-capture, scope-definition, rough-mockups, reverse-engineering (brownfield
only), practices-discovery, requirements-analysis, user-stories and
refined-mockups with the normal official approval gates and the same rough and
refined HTML evidence contracts as `ui-poc-application`. It runs no
domain/unit design, Construction or Operation stage, so there is no Plan
Approval and no skeleton stance.

## Iterating

One round is one intent: the intent completes when refined-mockups is approved.
Start the next round as a new intent with the new or changed requirement; reopen
the current intent with `/aidlc --stage requirements-analysis` to rework it in
place (existing artifacts are kept and each reopened stage offers Keep, Modify or
Redo). After each round, `/aidlc --doc` merges every intent into the product-level
design document set; requirements, story and screen chapters grow round by
round, while basic and detailed design chapters stay "未検討" because this scope
runs no design stage. To build, start a new intent under `ui-poc-application`.
