/**
 * Feature 21: optional, deterministic validation between the OFFICIAL
 * acceptance-criteria IDs and the C UI evidence contract. This module never
 * rewrites or normalizes IDs; the strings authored by the two producers are
 * compared exactly.
 *
 * The official AC set is the IDs the official stories artifact (`stories.md`)
 * defines, parsed by the one owner `official-acceptance-criteria.ts`. An
 * official `traceability.json` is an optional extra source: its AC-grammar IDs
 * are unioned in (the user-stories traceability carries FR/NFR only, the
 * functional-design traceability carries this Unit's ACs). A contract AC in the
 * official form must be in that set verbatim. A legacy C `AC-…` ID is accepted
 * only through an explicit `{uiAc, officialId}` bridge to an official ID.
 */
import { OFFICIAL_AC_ID, type OfficialAcFinding } from "./official-acceptance-criteria.ts";

export interface OfficialTraceability {
  upstream_ids: string[];
  coverage: Array<{ id: string; status: string; target?: string }>;
}

export interface UiMapping {
  screen: string;
  state: string;
  ac: string;
  asset?: string;
  check?: string;
}

export interface UiContract {
  schema: number;
  mappings: UiMapping[];
  requiredMappings: string[];
}

export interface RequirementIdBridge {
  /** Legacy C contract ID, for example AC-001. */
  uiAc: string;
  /** Existing official ID, for example AC1.1.1. */
  officialId: string;
}

/** The official AC inputs, already read by the caller. */
export interface OfficialAcInput {
  /** IDs defined by the official stories artifact; null when it could not be read. */
  storiesIds: string[] | null;
  /** Parser findings for the stories artifact (duplicates, malformed lookalikes). */
  storiesFindings?: OfficialAcFinding[];
  /** Why the stories artifact could not be read (missing input, missing file). */
  storiesUnavailable?: { code: "MISSING_STORIES_INPUT" | "STORIES_NOT_FOUND"; value: string };
  /** Optional official traceability.json, unioned in. */
  traceability?: OfficialTraceability;
}

export interface RequirementUiFinding {
  code:
    | "MISSING_STORIES_INPUT" | "STORIES_NOT_FOUND" | "NO_OFFICIAL_AC" | "DUPLICATE_OFFICIAL_AC" | "MALFORMED_OFFICIAL_AC"
    | "UNKNOWN_AC" | "INVALID_BRIDGE" | "DUPLICATE_BRIDGE"
    | "DUPLICATE_MAPPING" | "MISSING_REQUIRED_MAPPING" | "UNDECLARED_REQUIRED_MAPPING";
  value: string;
}

export interface RequirementUiResult {
  enabled: boolean;
  pass: boolean;
  checkedMappings: number;
  officialAcCount: number;
  findings: RequirementUiFinding[];
}

export function validateRequirementUiCrossReferences(
  official: OfficialAcInput,
  contract: UiContract,
  bridges: RequirementIdBridge[] = [],
): RequirementUiResult {
  const findings: RequirementUiFinding[] = [];
  if (official.storiesUnavailable) findings.push(official.storiesUnavailable);
  for (const finding of official.storiesFindings ?? []) findings.push({ code: finding.code, value: `${finding.value} (stories line ${finding.line})` });
  if (!official.storiesUnavailable && (official.storiesIds ?? []).length === 0) findings.push({ code: "NO_OFFICIAL_AC", value: "the official stories artifact defines no AC{group}.{seq}.{criterion} ID" });
  const traceIds = official.traceability
    ? [...official.traceability.upstream_ids, ...official.traceability.coverage.map((entry) => entry.id)].filter((id) => OFFICIAL_AC_ID.test(id))
    : [];
  const officialIds = new Set([...(official.storiesIds ?? []), ...traceIds]);

  const mappingKeys = new Set<string>();
  const bridgeByUiAc = new Map<string, string>();
  for (const bridge of bridges) {
    if (bridgeByUiAc.has(bridge.uiAc)) {
      findings.push({ code: "DUPLICATE_BRIDGE", value: bridge.uiAc });
      continue;
    }
    bridgeByUiAc.set(bridge.uiAc, bridge.officialId);
    // Official IDs are used verbatim and are never bridged; a bridge only maps
    // a legacy C `AC-…` ID onto an official ID that exists.
    if (OFFICIAL_AC_ID.test(bridge.uiAc) || !officialIds.has(bridge.officialId)) {
      findings.push({ code: "INVALID_BRIDGE", value: `${bridge.uiAc}->${bridge.officialId}` });
    }
  }

  for (const mapping of contract.mappings) {
    const key = `${mapping.screen}/${mapping.state}/${mapping.ac}`;
    if (mappingKeys.has(key)) findings.push({ code: "DUPLICATE_MAPPING", value: key });
    mappingKeys.add(key);
    // Exact official IDs work directly. Legacy C IDs require an explicit
    // bridge; no spelling, sequence, or similarity inference occurs.
    const officialId = OFFICIAL_AC_ID.test(mapping.ac) ? mapping.ac : bridgeByUiAc.get(mapping.ac);
    if (!officialId || !officialIds.has(officialId)) findings.push({ code: "UNKNOWN_AC", value: mapping.ac });
  }

  const required = new Set(contract.requiredMappings);
  for (const key of required) {
    if (!mappingKeys.has(key)) findings.push({ code: "MISSING_REQUIRED_MAPPING", value: key });
  }
  for (const key of mappingKeys) {
    if (!required.has(key)) findings.push({ code: "UNDECLARED_REQUIRED_MAPPING", value: key });
  }

  findings.sort((a, b) => a.code.localeCompare(b.code) || a.value.localeCompare(b.value));
  return { enabled: true, pass: findings.length === 0, checkedMappings: contract.mappings.length, officialAcCount: officialIds.size, findings };
}

/** The loader is deliberately lazy: disabled means no reads and no model work. */
export function runRequirementUiCrossValidation(
  enabled: boolean,
  load: () => { official: OfficialAcInput; contract: UiContract; bridges?: RequirementIdBridge[] },
): RequirementUiResult {
  if (!enabled) return { enabled: false, pass: true, checkedMappings: 0, officialAcCount: 0, findings: [] };
  const input = load();
  return validateRequirementUiCrossReferences(input.official, input.contract, input.bridges);
}

/**
 * The C contract is Markdown with exactly one fenced `ui-poc-contract` JSON
 * block (the C checker `ui-poc-evidence.cjs` owns that format and enforces it
 * first); a bare JSON object is accepted for fixtures.
 */
export function parseUiContract(text: string, path: string): UiContract {
  if (!path.endsWith(".md")) return JSON.parse(text) as UiContract;
  const blocks = [...text.matchAll(/^```ui-poc-contract\r?\n([\s\S]*?)^```\s*$/gm)];
  if (blocks.length !== 1) throw new Error(`UI contract must hold exactly one ui-poc-contract block: ${path}`);
  return JSON.parse(blocks[0][1]) as UiContract;
}
