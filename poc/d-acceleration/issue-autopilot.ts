/**
 * D issue intake/autopilot (features 9-17).
 *
 * This module does not know how to talk to GitHub or invoke a model. Callers
 * inject those adapters, which keeps tests offline and makes the trust boundary
 * explicit. Official workflow state is changed only through EngineAdapter.
 */

export type UncertaintyPolicy = "halt" | "assume" | "research";

export type IssueAutopilotConfig = {
  /** Feature 17: off unless project/local configuration explicitly enables it. */
  enabled: boolean;
  /** Feature 16: every configured label must be present; an empty list allows no issue. */
  labelAllowlist: string[];
  /** Feature 11: unresolved input never silently becomes an assumption. */
  uncertaintyPolicy: UncertaintyPolicy;
  /** Feature 13: optional inclusive last stage for unattended progress. */
  through?: string;
  /** Feature 14: continue in this invocation after intent creation. */
  sessionAuto: boolean;
  /** Feature 15: bounded transient retries; zero means one attempt only. */
  maxRetries: number;
};

export const DEFAULT_ISSUE_AUTOPILOT_CONFIG: Readonly<IssueAutopilotConfig> = {
  enabled: false,
  labelAllowlist: [],
  uncertaintyPolicy: "halt",
  sessionAuto: false,
  maxRetries: 2,
};

export type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
};

export type IssueSummary = Pick<Issue, "number" | "title" | "labels">;

export interface IssueSource {
  get(number: number): Promise<Issue | null>;
  list(): Promise<IssueSummary[]>;
}

export interface ClaimStore {
  /** Must be an atomic compare-and-set across concurrent loop workers. */
  acquire(issueNumber: number, owner: string): Promise<"acquired" | "busy">;
  /** Must release only when the persisted claim is still owned by owner. */
  release(issueNumber: number, owner: string): Promise<void>;
}

export type InputAssessment = {
  unresolved: string[];
  assumptions?: string[];
  researchedFacts?: string[];
  /** The description after optional research; never executable instructions. */
  description: string;
};

export interface InputAssessor {
  assess(issue: Readonly<Issue>, mode: UncertaintyPolicy): Promise<InputAssessment>;
}

export interface AssumptionLedger {
  append(entry: {
    issueNumber: number;
    policy: "assume" | "research";
    assumptions: string[];
    researchedFacts: string[];
  }): Promise<void>;
}

export type OfficialDirective = {
  kind: string;
  stage?: string;
  gate?: boolean;
  dangerous?: boolean;
  completed?: boolean;
  [key: string]: unknown;
};

/**
 * Implementations must invoke the official engine directly with an argv array
 * (never a shell string). The engine remains the sole owner of transitions,
 * approval records, questions, and stage completion.
 */
export interface EngineAdapter {
  createIntent(args: readonly ["--new-intent", "--scope", string, "--label", string, string]): Promise<OfficialDirective>;
  next(): Promise<OfficialDirective>;
  execute(directive: Readonly<OfficialDirective>): Promise<OfficialDirective>;
}

export type IntakeSelection =
  | { issueNumber: number }
  | { selectFromList: (issues: readonly IssueSummary[]) => Promise<number | null> };

export type AutopilotStopReason =
  | "disabled"
  | "not-found"
  | "not-open"
  | "label-not-allowed"
  | "selection-cancelled"
  | "claim-busy"
  | "uncertainty"
  | "intent-created"
  | "boundary-reached"
  | "human-gate"
  | "dangerous-operation"
  | "failure"
  | "complete";

export type AutopilotResult = {
  status: "stopped" | "completed";
  reason: AutopilotStopReason;
  issueNumber?: number;
  stage?: string;
  attempts?: number;
  detail?: string;
};

/** Serializable status for `/loop` output; it grants no execution authority. */
export type IssueAutopilotStatus = {
  enabled: boolean;
  mode: "single-issue-per-run";
  sessionAuto: boolean;
  through: string | null;
  uncertaintyPolicy: UncertaintyPolicy;
  labelAllowlist: string[];
  maxAttempts: number;
};

export type IssueAutopilotDependencies = {
  issues: IssueSource;
  claims: ClaimStore;
  assessor: InputAssessor;
  assumptions: AssumptionLedger;
  engine: EngineAdapter;
};

function validateConfig(config: IssueAutopilotConfig): void {
  if (!Number.isSafeInteger(config.maxRetries) || config.maxRetries < 0 || config.maxRetries > 10) {
    throw new Error("issue autopilot maxRetries must be an integer from 0 through 10");
  }
  if (!config.labelAllowlist.every((label) => typeof label === "string" && label.trim())) {
    throw new Error("issue autopilot labelAllowlist must contain non-empty strings");
  }
  if (config.through !== undefined && !config.through.trim()) throw new Error("issue autopilot through must be a non-empty stage slug");
}

export function issueAutopilotStatus(config: IssueAutopilotConfig = DEFAULT_ISSUE_AUTOPILOT_CONFIG): IssueAutopilotStatus {
  validateConfig(config);
  return {
    enabled: config.enabled,
    mode: "single-issue-per-run",
    sessionAuto: config.sessionAuto,
    through: config.through ?? null,
    uncertaintyPolicy: config.uncertaintyPolicy,
    labelAllowlist: [...config.labelAllowlist],
    maxAttempts: config.maxRetries + 1,
  };
}

function allowed(issue: Issue, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return false;
  const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
  return allowlist.every((label) => labels.has(label.toLowerCase()));
}

function slug(title: string, number: number): string {
  const value = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 3)
    .join("-");
  return value || `issue-${number}`;
}

async function withRetries<T>(limit: number, operation: () => Promise<T>): Promise<{ value?: T; attempts: number; error?: unknown }> {
  let attempts = 0;
  let error: unknown;
  while (attempts <= limit) {
    attempts += 1;
    try {
      return { value: await operation(), attempts };
    } catch (caught) {
      error = caught;
    }
  }
  return { attempts, error };
}

async function resolveIssue(selection: IntakeSelection, source: IssueSource): Promise<Issue | null | "cancelled"> {
  if ("issueNumber" in selection) {
    if (!Number.isSafeInteger(selection.issueNumber) || selection.issueNumber <= 0) throw new Error("issue number must be a positive integer");
    return source.get(selection.issueNumber);
  }
  const choices = (await source.list()).filter((issue) => Number.isSafeInteger(issue.number) && issue.number > 0);
  const selected = await selection.selectFromList(choices);
  if (selected === null) return "cancelled";
  if (!choices.some((issue) => issue.number === selected)) throw new Error("selected issue is not in the offered list");
  return source.get(selected);
}

/** Runs at most one issue. Suitable for a single `/loop` iteration. */
export async function runIssueAutopilot(input: {
  config?: IssueAutopilotConfig;
  selection: IntakeSelection;
  owner: string;
  scope: string;
  deps: IssueAutopilotDependencies;
}): Promise<AutopilotResult> {
  const config = input.config ?? DEFAULT_ISSUE_AUTOPILOT_CONFIG;
  validateConfig(config);
  if (!config.enabled) return { status: "stopped", reason: "disabled" };
  if (!input.owner.trim()) throw new Error("issue autopilot owner is required");
  if (!input.scope.trim()) throw new Error("issue autopilot scope is required");

  const issue = await resolveIssue(input.selection, input.deps.issues);
  if (issue === "cancelled") return { status: "stopped", reason: "selection-cancelled" };
  if (!issue) return { status: "stopped", reason: "not-found" };
  if (issue.state !== "open") return { status: "stopped", reason: "not-open", issueNumber: issue.number };
  if (!allowed(issue, config.labelAllowlist)) return { status: "stopped", reason: "label-not-allowed", issueNumber: issue.number };

  if ((await input.deps.claims.acquire(issue.number, input.owner)) !== "acquired") {
    return { status: "stopped", reason: "claim-busy", issueNumber: issue.number };
  }

  try {
    const assessment = await input.deps.assessor.assess(Object.freeze(structuredClone(issue)), config.uncertaintyPolicy);
    if (assessment.unresolved.length > 0 && config.uncertaintyPolicy === "halt") {
      return { status: "stopped", reason: "uncertainty", issueNumber: issue.number, detail: assessment.unresolved.join("; ") };
    }
    if (config.uncertaintyPolicy !== "halt") {
      const assumptions = assessment.assumptions ?? [];
      const researchedFacts = assessment.researchedFacts ?? [];
      if (assumptions.length > 0 || researchedFacts.length > 0) {
        await input.deps.assumptions.append({ issueNumber: issue.number, policy: config.uncertaintyPolicy, assumptions, researchedFacts });
      }
      if (assessment.unresolved.length > 0) {
        return { status: "stopped", reason: "uncertainty", issueNumber: issue.number, detail: assessment.unresolved.join("; ") };
      }
    }

    // The issue body is untrusted input. It is embedded in a delimited
    // description and passed as one argv element; it is never interpreted here.
    const description = [
      `Implement GitHub issue #${issue.number}: ${issue.title}`,
      "<untrusted-issue-body>",
      assessment.description,
      "</untrusted-issue-body>",
    ].join("\n");
    const created = await withRetries(config.maxRetries, () =>
      input.deps.engine.createIntent(["--new-intent", "--scope", input.scope, "--label", slug(issue.title, issue.number), description]),
    );
    if (!created.value) {
      return { status: "stopped", reason: "failure", issueNumber: issue.number, attempts: created.attempts, detail: String(created.error) };
    }
    if (!config.sessionAuto) return { status: "stopped", reason: "intent-created", issueNumber: issue.number, attempts: created.attempts };

    let directive = created.value;
    for (;;) {
      if (directive.dangerous) return { status: "stopped", reason: "dangerous-operation", issueNumber: issue.number, stage: directive.stage };
      if (directive.gate || directive.kind === "ask") return { status: "stopped", reason: "human-gate", issueNumber: issue.number, stage: directive.stage };
      if (directive.completed || directive.kind === "complete") return { status: "completed", reason: "complete", issueNumber: issue.number, stage: directive.stage };
      if (config.through && directive.stage && directive.stage !== config.through) {
        // Ordering belongs to the official engine; the controller stops only
        // after executing the named inclusive boundary, never guesses stage order.
      }
      const executed = await withRetries(config.maxRetries, () => input.deps.engine.execute(directive));
      if (!executed.value) return { status: "stopped", reason: "failure", issueNumber: issue.number, stage: directive.stage, attempts: executed.attempts, detail: String(executed.error) };
      if (config.through && directive.stage === config.through) {
        return { status: "stopped", reason: "boundary-reached", issueNumber: issue.number, stage: directive.stage, attempts: executed.attempts };
      }
      const next = await withRetries(config.maxRetries, () => input.deps.engine.next());
      if (!next.value) return { status: "stopped", reason: "failure", issueNumber: issue.number, attempts: next.attempts, detail: String(next.error) };
      directive = next.value;
    }
  } finally {
    await input.deps.claims.release(issue.number, input.owner);
  }
}
