# D automation and grounding implementation plan

This change implements only the explicitly selected D additions. Official
AI-DLC lifecycle authority, the composed C UI contracts, approval ledger,
reviewer and sensor protocols, and D model routing stay authoritative. Clef
routing was declined and removed on 2026-10-17.

## Adopted features

- 7: high-confidence secret scanning integrated into approved-transition Git persistence; no separate switch.
- 9: intake of one explicitly numbered issue.
- 10: deterministic issue-list selection intake.
- 11: `halt` / `assume` / `research` policy for unresolved requirements, with an assumption ledger.
- 12: automation status and stop controls.
- 13: an explicitly recorded `through` boundary.
- 14: session-scoped automation state.
- 15: issue claim, lock, and bounded retry.
- 16: target-label allowlist.
- 17: one-issue-per-run issue autopilot callable from `/loop`, default off.
- 21: optional cross-check between official traceability IDs and the C screen/state/AC contract, default off.
- 22: optional Functional Design duplicate-meta discipline, default off.
- 27: optional bounded source grounding, default off.
- 28: optional bounded specification grounding, default off.

## Work packages

1. JSONC-compatible configuration and project/local precedence.
2. Issue intake and bounded automation coordinator with injected external adapters.
3. Requirement-ID and Functional Design document checks.
4. Source/spec grounding plans and evidence contracts.
5. Persistence secret-protection integration.
6. Claude distribution, ordinary `/aidlc` and `/loop` handoff documentation.
7. Fixture/mock tests, packaging checks, checkpoint commits and review-ready PR.

## Explicit exclusions

Features 6, 8, 18-20, 23-26, and 29+ are not added. This implementation does
not start a live loop, mutate a real issue, call a paid model in tests, deploy to
any dogfooding checkout, auto-merge, or force-push.
