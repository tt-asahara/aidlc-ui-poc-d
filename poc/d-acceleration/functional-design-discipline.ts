/** Feature 22: optional functional-design-only document budget discipline. */

export const DEFAULT_FUNCTIONAL_DESIGN_BUDGETS = {
  artifactBytes: 60_000,
  unitBytes: 160_000,
  metadataBytes: 30_000,
} as const;

export type FunctionalDesignArtifactName =
  | "functional-spec.md"
  | "entities.md"
  | "rules.md"
  | "frontend-components.md";

export interface FunctionalDesignInput {
  stage: string;
  artifacts: Partial<Record<FunctionalDesignArtifactName, string>>;
  /** Kept separate and never reduced or rewritten by this feature. */
  traceability: unknown;
  budgets?: Partial<typeof DEFAULT_FUNCTIONAL_DESIGN_BUDGETS>;
}

export interface FunctionalDesignFinding {
  code: "WRONG_STAGE" | "ARTIFACT_BUDGET" | "UNIT_BUDGET" | "METADATA_BUDGET" | "DUPLICATE_METADATA";
  artifact?: string;
  detail: string;
}

export interface FunctionalDesignDisciplineResult {
  enabled: boolean;
  pass: boolean;
  artifactBytes: Record<string, number>;
  unitBytes: number;
  metadataBytes: number;
  findings: FunctionalDesignFinding[];
}

const META_HEADINGS = ["Sources", "Assumptions & Open Questions", "Scope", "Traceability"];
const bytes = (text: string): number => new TextEncoder().encode(text).byteLength;

function metadataSections(markdown: string): Array<{ heading: string; body: string }> {
  const headings = [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)];
  const result: Array<{ heading: string; body: string }> = [];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index][1].trim();
    if (!META_HEADINGS.includes(heading)) continue;
    const start = (headings[index].index ?? 0) + headings[index][0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    result.push({ heading, body: markdown.slice(start, end).trim() });
  }
  return result;
}

export function validateFunctionalDesignDiscipline(input: FunctionalDesignInput): FunctionalDesignDisciplineResult {
  const budget = { ...DEFAULT_FUNCTIONAL_DESIGN_BUDGETS, ...input.budgets };
  const artifactBytes: Record<string, number> = {};
  const findings: FunctionalDesignFinding[] = [];
  let metadataBytes = 0;

  if (input.stage !== "functional-design") {
    findings.push({ code: "WRONG_STAGE", detail: `feature 22 only applies to functional-design, received ${input.stage}` });
  }

  for (const [name, content] of Object.entries(input.artifacts)) {
    if (content === undefined) continue;
    const size = bytes(content);
    artifactBytes[name] = size;
    if (size > budget.artifactBytes) {
      findings.push({ code: "ARTIFACT_BUDGET", artifact: name, detail: `${size} > ${budget.artifactBytes} bytes` });
    }
    const sections = metadataSections(content);
    metadataBytes += sections.reduce((sum, section) => sum + bytes(section.body), 0);
    if (name !== "functional-spec.md") {
      for (const section of sections) {
        findings.push({
          code: "DUPLICATE_METADATA",
          artifact: name,
          detail: `move ## ${section.heading} to functional-spec.md and leave a short reference`,
        });
      }
    }
  }

  const unitBytes = Object.values(artifactBytes).reduce((sum, size) => sum + size, 0);
  if (unitBytes > budget.unitBytes) findings.push({ code: "UNIT_BUDGET", detail: `${unitBytes} > ${budget.unitBytes} bytes` });
  if (metadataBytes > budget.metadataBytes) findings.push({ code: "METADATA_BUDGET", detail: `${metadataBytes} > ${budget.metadataBytes} bytes` });
  findings.sort((a, b) => a.code.localeCompare(b.code) || (a.artifact ?? "").localeCompare(b.artifact ?? "") || a.detail.localeCompare(b.detail));
  return { enabled: true, pass: findings.length === 0, artifactBytes, unitBytes, metadataBytes, findings };
}

/** The loader is deliberately lazy: disabled means no reads and no model work. */
export function runFunctionalDesignDiscipline(
  enabled: boolean,
  load: () => FunctionalDesignInput,
): FunctionalDesignDisciplineResult {
  if (!enabled) return { enabled: false, pass: true, artifactBytes: {}, unitBytes: 0, metadataBytes: 0, findings: [] };
  return validateFunctionalDesignDiscipline(load());
}

