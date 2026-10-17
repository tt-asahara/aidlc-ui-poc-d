# D grounding integration contract

Feature 27 (`sourceGrounding`) and feature 28 (`specGrounding`) are independent,
default-off semantic checks. The caller passes already-resolved configuration to
`runGrounding`; this module deliberately does not own project/local precedence.

- Source grounding applies after `domain-design` and compares design claims with
  configured source roots.
- Spec grounding applies after `domain-design`, and per construction unit after
  `functional-design` and `code-generation`, comparing artifacts with configured
  specification roots.
- Both workers are read-only and limited to `Read`, `Grep`, and `Glob`. Results are
  returned to the official stage lead as structured findings; this module writes no
  artifacts, review receipts, workflow state, or approval records.
- `grounding-unavailable` is required where evidence cannot be verified. A grounding
  result is evidence for the lead and human, never evidence of approval.
- An empty result is NOT-READY. Every `confirmed` or `refuted` finding must cite at
  least one existing file inside the configured evidence roots; a model assertion
  without bounded evidence cannot make a stage READY.
- When disabled, the result is `disabled` before path resolution or worker dispatch:
  no model call, document, review, or receipt is produced.

The official host remains responsible for deciding whether and where to persist the
findings and for every normal engine transition. Grounding must run after the stage
body and before the existing official reviewer/approval protocol; it does not replace
either protocol.
