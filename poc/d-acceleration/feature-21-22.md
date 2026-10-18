# Optional requirement and document-discipline checks

These D checks are deterministic additions. They do not replace the official
traceability sensor, C's blocking UI evidence sensor, stage reviewers, approval
ledger, or engine transitions.

## Feature 21 — requirement/UI cross-validation (default: off)

At the refined-mockups and functional-design handoff, compare every C
`screen/state/ac` mapping with the **official acceptance-criteria IDs**.

**Official ID form.** The official user-stories stage gives each criterion a
three-segment `AC{story-group}.{story-seq}.{criterion-seq}` ID, for example
`AC1.1.1` (core `aidlc-common/stages/inception/user-stories.md` Step 8; the core
traceability sensor uses the same grammar). The check accepts exactly the ASCII
grammar `^AC[0-9]+\.[0-9]+\.[0-9]+$`. Nothing is normalized: full-width
(`ＡＣ１.１.１`, `AC1．1．1`), lower-case, two- or four-segment, and `AC-1-1-1`
spellings are never official IDs.

**Official ID source.** The set is parsed deterministically from the official
`stories.md` (manifest `storiesPath`) by the one owner
`official-acceptance-criteria.ts`, which reads block structure through the
engine's single Markdown interpreter (`markdownBlocks`). An ID is *defined*
when it is the first token of a list item, a heading, or the first cell of a
table row. Mentions in prose, continuation lines, code, and HTML comments are
references and are ignored, so a cross-reference such as "US6.2 の AC6.2.6 は…"
is not a second definition. The parser does not read heading wording, so
English ("Acceptance Criteria") and Japanese ("受入条件") stories parse the same.
A lookalike at a definition position is a `MALFORMED_OFFICIAL_AC` finding, not
an ID. An official `traceability.json` (manifest `traceabilityPath`) is an
optional extra source: its AC-grammar IDs are unioned in. The user-stories
traceability carries only FR/NFR IDs, so it adds nothing there; the
functional-design traceability carries the Unit's ACs.

**Matching.** A contract AC in the official form must be in that set verbatim;
no bridge is needed or allowed for it. A legacy C `AC-…` ID (provisional
rough-mockups IDs, existing contracts) is accepted only through an explicit
`featureInputs.requirementIdBridges` entry `{uiAc, officialId}` whose `uiAc` is
not itself an official ID and whose `officialId` is in the set. IDs are never
inferred, rewritten, or renumbered. The check also confirms that
`requiredMappings` and `mappings` describe the same triples.

**Fail closed.** Each of these is recorded NOT-READY evidence with exact
findings, never a pass: `MISSING_STORIES_INPUT` (no `storiesPath`),
`STORIES_NOT_FOUND`, `NO_OFFICIAL_AC` (zero IDs parsed),
`DUPLICATE_OFFICIAL_AC` (with its stories line), `MALFORMED_OFFICIAL_AC`,
`UNKNOWN_AC`, `INVALID_BRIDGE`, `DUPLICATE_BRIDGE`, `DUPLICATE_MAPPING`,
`MISSING_REQUIRED_MAPPING`, and `UNDECLARED_REQUIRED_MAPPING`. An unknown AC is
not silently added to official traceability. A path outside the project, or a
manifest artifact the fresh official directive does not declare, is refused by
the host boundary before any check runs.

**Declared inputs.** `host-stage-boundary.ts` binds `storiesPath`,
`traceabilityPath`, `uiContractPath`, and every other manifest artifact to the
fresh directive's `consumes`/`produces`:

| Stage | `storiesPath` | `uiContractPath` | `traceabilityPath` |
| --- | --- | --- | --- |
| refined-mockups | core `consumes: stories` | C plugin `produces: ui-poc-refined-contract` | not declared here: omit it |
| functional-design | C plugin `consumes: stories` (`required: false`) | C plugin `consumes: ui-poc-refined-contract` | the Unit's own `produces: traceability` (optional union) |

Core functional-design does not consume `stories`; the ui-poc
functional-design contribution adds that optional consume through the
supported plugin `adds.consumes` seam so the official stories artifact is a
declared input there too (core stays untouched).

Manifests for an intent `<I>` = `aidlc/spaces/<space>/intents/<intent>`:

```json
{"stage": "refined-mockups", "unit": null,
 "storiesPath": "<I>/inception/user-stories/stories.md",
 "uiContractPath": "<I>/inception/refined-mockups/ui-poc-refined-contract.md"}
```

```json
{"stage": "functional-design", "unit": "<unit>",
 "storiesPath": "<I>/inception/user-stories/stories.md",
 "uiContractPath": "<I>/inception/refined-mockups/ui-poc-refined-contract.md",
 "traceabilityPath": "<I>/construction/<unit>/functional-design/traceability.json"}
```

The C contract is read from its single fenced `ui-poc-contract` block.

## Feature 22 — functional-design document discipline (default: off)

Only at functional-design, keep Sources, Assumptions & Open Questions, Scope,
and Traceability metadata in `functional-spec.md`. Sibling artifacts retain a
short reference instead of copying those sections. Defaults are 60,000 bytes
per Markdown artifact, 160,000 bytes across the Unit's functional-design
Markdown, and 30,000 bytes of metadata. `traceability.json` remains an official
artifact and is never removed, shortened, or rewritten by this check.
Feature 22 is independent and does not require feature 21 or an ID bridge.
An enabled check fails closed when no functional-design artifacts are supplied
or when the canonical `functional-spec.md` is absent or empty; it does not add
new required sections beyond this duplicate-metadata discipline.

Both entry points accept an `enabled` flag and a lazy loader. When disabled the
loader is not called, so they create no documents, perform no reads, and cannot
cause an additional model call. Project/local configuration and stage wiring
are owned by the shared D configuration work; these modules intentionally do
not introduce a second configuration owner.
