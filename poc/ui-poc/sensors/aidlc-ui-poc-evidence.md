---
id: ui-poc-evidence
kind: deterministic
command: bun {{HARNESS_DIR}}/tools/aidlc-sensor-ui-poc-evidence.ts
default_severity: blocking
fire_on: gate
description: Verify UI contracts plus Arm C routing, Design Context, pinned payloads, and WCAG correction evidence
category: ui-evidence
input_schema:
  output_path: string
  stage_slug: string
output_schema:
  pass: boolean
  findings_count: integer
  findings: string[]
timeout_seconds: 30
---

# UI evidence gate

No matches filter: declared stage deliverables trigger contract checks; every C stage with routing rules also verifies facts, engine-bound context, source-lock bytes, selected/disabled skill events, hashed inputs/outputs, creator-confirmed Design Context, and the WCAG correction report. Schema-2 contracts also bind rendered semantic snapshots to approved HTML, require detached receipts for declared changes/omissions, and compare an independently captured implementation snapshot at Build and Test. Functional Design contracts must carry a passing element→rule matrix (scoped to the Unit's contract slice inside a Construction Unit); code-generation must consume the approved Functional Design contract; Build and Test must carry a recomputable element-level test matrix with no failed row and, with several Units, the union of every Unit matrix giving each rule-requiring element one consistent owner; a refined revision must declare its exact element delta. A D configuration whose resolver is not installed fails closed instead of treating image settings as OFF. Missing renderer observations, state coverage, computed truncation/action evidence, or an enabled visual baseline fails rather than silently passing. Requirements Analysis and Domain Design attach the same blocking sensor through the additive seam. Skipped engine stages emit no deliverable and create no sensor obligation. Rough/refined checks add no approval; AI-DLC remains the only lifecycle and approval owner.

The pinned dispatcher resolves a .ts basename, runs it with its own runtime, and consumes JSON `pass` plus `findings_count`. It does not execute an arbitrary shell prefix. Never replace this adapter with a guessed command API.
