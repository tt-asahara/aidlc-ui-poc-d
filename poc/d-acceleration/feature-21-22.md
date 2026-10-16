# Optional requirement and document-discipline checks

These D checks are deterministic additions. They do not replace the official
traceability sensor, C's blocking UI evidence sensor, stage reviewers, approval
ledger, or engine transitions.

## Feature 21 — requirement/UI cross-validation (default: off)

At refined-mockups and functional-design handoff, compare every C
`screen/state/ac` mapping with the IDs already present in the official
`traceability.json`. An exact ID is accepted directly. A C-style `AC-…` ID may
point to a differently-shaped official `AC1.…` ID only through an explicit
`{uiAc, officialId}` bridge. IDs are never inferred, rewritten, or renumbered.
The check also confirms that `requiredMappings` and `mappings`
describe the same triples. An unknown AC is a finding; it is not silently added
to official traceability.

## Feature 22 — functional-design document discipline (default: off)

Only at functional-design, keep Sources, Assumptions & Open Questions, Scope,
and Traceability metadata in `functional-spec.md`. Sibling artifacts retain a
short reference instead of copying those sections. Defaults are 60,000 bytes
per Markdown artifact, 160,000 bytes across the Unit's functional-design
Markdown, and 30,000 bytes of metadata. `traceability.json` remains an official
artifact and is never removed, shortened, or rewritten by this check.
Feature 22 is independent and does not require feature 21 or an ID bridge.

Both entry points accept an `enabled` flag and a lazy loader. When disabled the
loader is not called, so they create no documents, perform no reads, and cannot
cause an additional model call. Project/local configuration and stage wiring
are owned by the shared D configuration work; these modules intentionally do
not introduce a second configuration owner.
