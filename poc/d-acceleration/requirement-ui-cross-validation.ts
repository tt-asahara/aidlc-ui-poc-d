/**
 * Feature 21: optional, deterministic validation between official AI-DLC
 * traceability IDs and the C UI evidence contract. This module never rewrites
 * or normalizes IDs; the strings authored by the two producers are compared.
 */

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
  /** C contract ID, for example AC-001. */
  uiAc: string;
  /** Existing official ID, for example AC1.1.1. */
  officialId: string;
}

export interface RequirementUiFinding {
  code: "UNKNOWN_AC" | "INVALID_BRIDGE" | "DUPLICATE_BRIDGE" | "DUPLICATE_MAPPING" | "MISSING_REQUIRED_MAPPING" | "UNDECLARED_REQUIRED_MAPPING";
  value: string;
}

export interface RequirementUiResult {
  enabled: boolean;
  pass: boolean;
  checkedMappings: number;
  findings: RequirementUiFinding[];
}

export function validateRequirementUiCrossReferences(
  traceability: OfficialTraceability,
  contract: UiContract,
  bridges: RequirementIdBridge[] = [],
): RequirementUiResult {
  const officialIds = new Set([
    ...traceability.upstream_ids,
    ...traceability.coverage.map((entry) => entry.id),
  ]);
  const findings: RequirementUiFinding[] = [];
  const mappingKeys = new Set<string>();
  const bridgeByUiAc = new Map<string, string>();

  for (const bridge of bridges) {
    if (bridgeByUiAc.has(bridge.uiAc)) {
      findings.push({ code: "DUPLICATE_BRIDGE", value: bridge.uiAc });
      continue;
    }
    bridgeByUiAc.set(bridge.uiAc, bridge.officialId);
    if (!officialIds.has(bridge.officialId)) {
      findings.push({ code: "INVALID_BRIDGE", value: `${bridge.uiAc}->${bridge.officialId}` });
    }
  }

  for (const mapping of contract.mappings) {
    const key = `${mapping.screen}/${mapping.state}/${mapping.ac}`;
    if (mappingKeys.has(key)) findings.push({ code: "DUPLICATE_MAPPING", value: key });
    mappingKeys.add(key);
    // Exact official IDs work directly. Differently-shaped C IDs require an
    // explicit bridge; no spelling, sequence, or similarity inference occurs.
    const officialId = officialIds.has(mapping.ac) ? mapping.ac : bridgeByUiAc.get(mapping.ac);
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
  return { enabled: true, pass: findings.length === 0, checkedMappings: contract.mappings.length, findings };
}

/** The loader is deliberately lazy: disabled means no reads and no model work. */
export function runRequirementUiCrossValidation(
  enabled: boolean,
  load: () => { traceability: OfficialTraceability; contract: UiContract; bridges?: RequirementIdBridge[] },
): RequirementUiResult {
  if (!enabled) return { enabled: false, pass: true, checkedMappings: 0, findings: [] };
  const input = load();
  return validateRequirementUiCrossReferences(input.traceability, input.contract, input.bridges);
}

