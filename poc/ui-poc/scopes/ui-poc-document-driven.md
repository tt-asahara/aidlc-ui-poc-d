---
name: ui-poc-document-driven
plugin: ui-poc
depth: Standard
description: Document-driven requirements run with rough HTML evidence that stops after User Stories with only the stage approvals
skeleton: off
runner: true
guard_policy: strict
sensors: on
learnings: off
summary_confirmation: off
plan_approval: off
collaborators: off
---

# UI document-driven run

Use this scope when the person hands over the requirement documents and asks
AI-DLC to carry the work forward from them (`/aidlc --auto --docs <path>`). It
retains intent-capture, scope-definition, rough-mockups, reverse-engineering
(brownfield only), practices-discovery, requirements-analysis and user-stories
with the normal official approval gates and the same rough HTML evidence
contract as `ui-poc-application`. It runs no Refined Mockups, design,
Construction or Operation stage, so there is no Plan Approval and no skeleton
stance, and the summary confirmation and learnings ceremonies are off.

Stage questions that the indexed documents settle are answered from them with a
verified citation under the person's document-driven grant; only what the
documents leave open is asked. Every stage gate stays the person's.

## Continuing

The intent completes when User Stories is approved. Continue with
`/aidlc --add refined-mockups` to keep this intent, or start a new intent under
`ui-poc-application` to build. `/aidlc --doc` merges the result into the
product-level design document set like any other intent.
