---
name: ui-poc-application
plugin: ui-poc
depth: Standard
keywords:
  - web app
  - webapp
  - dashboard
  - website
  - frontend
  - user interface
  - mobile app
  - Webアプリ
description: UI application lifecycle with rough and refined HTML evidence handoffs
skeleton: on
runner: true
guard_policy: strict
sensors: on
learnings: on
summary_confirmation: on
plan_approval: on
collaborators: off
---

# UI application

Use this scope when the request clearly asks for a user-facing application or
site and no scope was explicitly selected. It retains rough and refined HTML
mockups, their downstream design/code/test contracts, and the normal official
approval gates. It is not the controlled A/B/C comparison scope.

Explicit user scope and execution choices always win. Non-UI work must remain
on the stock resolver result. At Delivery Planning, inspect the official Unit
DAG and write sets before proposing stage-major Construction and official Code
Generation swarm; do not propose concurrency for dependent or conflicting
Units, and do not change an explicit serial choice. The person approves or
changes that proposal at the official gate.
