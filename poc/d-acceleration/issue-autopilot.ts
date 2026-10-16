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
  maxSteps: number;
  deadlineMs: number;
};

export const DEFAULT_ISSUE_AUTOPILOT_CONFIG: Readonly<IssueAutopilotConfig> = {
  enabled: false,
  labelAllowlist: [],
  uncertaintyPolicy: "halt",
  sessionAuto: false,
  maxRetries: 2,
  maxSteps: 64,
  deadlineMs: 15 * 60_000,
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
  renew?(issueNumber: number, owner: string): Promise<"renewed" | "lost">;
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
  reconcileIntent?(issueNumber: number): Promise<OfficialDirective | null>;
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
  directive?: OfficialDirective;
  hostControl?: { through: string | null; maxSteps: number; deadlineMs: number };
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
  maxSteps: number;
  deadlineMs: number;
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
  if (!Number.isSafeInteger(config.maxSteps) || config.maxSteps < 1 || config.maxSteps > 1000) throw new Error("issue autopilot maxSteps must be an integer from 1 through 1000");
  if (!Number.isSafeInteger(config.deadlineMs) || config.deadlineMs < 1000 || config.deadlineMs > 86_400_000) throw new Error("issue autopilot deadlineMs must be an integer from 1000 through 86400000");
  if (!config.labelAllowlist.every((label) => typeof label === "string" && label.trim())) {
    throw new Error("issue autopilot labelAllowlist must contain non-empty strings");
  }
  if (config.through !== undefined && !OFFICIAL_STAGES.has(config.through) && !OFFICIAL_PHASES.has(config.through)) throw new Error(`issue autopilot through is not an official stage or phase: ${config.through}`);
}

export const OFFICIAL_STAGES = new Set([
  "workspace-detection", "workspace-scaffold", "state-init", "intent-capture", "feasibility", "market-research",
  "team-formation", "rough-mockups", "scope-definition", "approval-handoff", "reverse-engineering",
  "requirements-analysis", "user-stories", "domain-design", "refined-mockups", "units-generation", "contract-design",
  "practices-discovery", "delivery-planning", "functional-design", "nfr-requirements", "nfr-design",
  "infrastructure-design", "code-generation", "build-and-test", "ci-pipeline", "environment-provisioning",
  "deployment-pipeline", "deployment-execution", "observability-setup", "performance-validation",
  "feedback-optimization", "incident-response",
]);
export const OFFICIAL_PHASES = new Set(["initialization", "ideation", "inception", "construction", "operation"]);

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
    maxSteps: config.maxSteps,
    deadlineMs: config.deadlineMs,
  };
}

function allowed(issue: Issue, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return false;
  const labels = new Set(issue.labels);
  return allowlist.every((label) => labels.has(label));
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
    // Intent creation is non-idempotent. Reconcile from durable official state
    // before every create, so a later poll of the same Issue resumes the bound
    // intent instead of creating a duplicate.
    let created: { value?: OfficialDirective; attempts: number; error?: unknown };
    const existing = await input.deps.engine.reconcileIntent?.(issue.number);
    if (existing) {
      created = { value: existing, attempts: 0 };
    } else {
      try {
        created = { value: await input.deps.engine.createIntent(["--new-intent", "--scope", input.scope, "--label", slug(issue.title, issue.number), description]), attempts: 1 };
      } catch (error) {
        const reconciled = await input.deps.engine.reconcileIntent?.(issue.number);
        created = reconciled ? { value: reconciled, attempts: 1 } : { attempts: 1, error };
      }
    }
    if (!created.value) {
      return { status: "stopped", reason: "failure", issueNumber: issue.number, attempts: created.attempts, detail: String(created.error) };
    }
    const result = { status: "stopped" as const, reason: "intent-created" as const, issueNumber: issue.number, attempts: created.attempts, directive: created.value };
    return config.sessionAuto ? { ...result, hostControl: { through: config.through ?? null, maxSteps: config.maxSteps, deadlineMs: config.deadlineMs } } : result;
  } finally {
    await input.deps.claims.release(issue.number, input.owner);
  }
}
