#!/usr/bin/env bun
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { auditBlockField, latestPersonTurn } from "../../core/tools/aidlc-lib.ts";
import { resolveDAiApproval } from "./d-config.ts";
import stagePolicy from "./stage-policy.json";

const MAX_FILE_BYTES = 192 * 1024;
const MAX_ITEMS = 64;
const MAX_ITEM_BYTES = 4 * 1024;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const DENIED_STAGE_TOKEN = /(^|[-_])(operations?|deployment|deploy|production|release|external|publish|auth|authentication|authorization|destructive)([-_]|$)/i;
const OPERATION_STAGES = new Set(stagePolicy.stages.filter((entry) => entry.phase === "operation").map((entry) => entry.stage));
const PHASES = ["initialization", "ideation", "inception", "construction", "operation"] as const;
const DEFAULT_GRANT_PATH = "decisions/ai-approval-delegation.json";
const DOCUMENT_DELEGATION_PATH = "decisions/document-answer-delegation.json";
/** The person's exact words that hand a document-driven intent's question stages to document-grounded answers. */
export const DOCUMENT_DELEGATION_COMMAND = "AI-DLC delegate-document-answers";
/** Document-grounded answers never reach past this stage (the document-driven mode's boundary). */
export const DOCUMENT_DELEGATION_THROUGH = "user-stories";
export const DOCUMENT_GRANT_HUMAN_TURN_REQUIRED = `Document answer delegation needs the person's own latest turn to be exactly \`${DOCUMENT_DELEGATION_COMMAND}\`; ask the person to send it, then rerun document-grant.`;
const DELEGATION_COMMAND = /^AI-DLC delegate-ai-approvals --scope ([A-Za-z0-9._-]+) --through ([A-Za-z0-9._-]+) --stages ([A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)*)$/;
/** Grants minted before the human-turn binding (schemaVersion 1) are never accepted. */
export const DELEGATION_GRANT_SCHEMA_VERSION = 2;
export const GRANT_HUMAN_TURN_REQUIRED = "AI delegation grant needs the person's own latest turn to be the exact delegate-ai-approvals command; ask the person to type it, then rerun grant.";

/** The host-recorded HUMAN_TURN the delegation words were read from. */
export type GrantHumanTurn = { at: string; session: string; wordsSha256: string };

export type DelegationGrant = {
  schemaVersion: typeof DELEGATION_GRANT_SCHEMA_VERSION;
  messageId: string;
  userMessage: string;
  userMessageSha256: string;
  humanTurn: GrantHumanTurn;
  mode: "stage-gates" | "document-driven";
  scope: string;
  through: string | null;
  allowedStages: string[];
  minConfidence: number;
  requestSha256: string;
};

export type AiApprovalGrantOptions = {
  projectDir: string;
  userMessageFile: string;
  messageId: string;
  scope: string;
  through?: string | null;
  allowedStages: string[];
};

export type AiApprovalGrantResult = {
  path: string;
  sha256: string;
  messageId: string;
  requestSha256: string;
};

type Snapshot = { path: string; absolute: string; bytes: Buffer; sha256: string };

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function checkedClaudeExecutable(projectRoot: string, requested: string, expectedSha256?: string): string {
  if (basename(requested) !== "claude") throw new Error("Claude executable entry must be named claude");
  const actual = realpathSync(requested);
  const metadata = lstatSync(actual);
  const bytes = readFileSync(actual);
  if (!metadata.isFile() || within(projectRoot, actual)) throw new Error("host-pinned Claude executable must be a file outside the project");
  if (!isNativeExecutable(bytes)) throw new Error("host-pinned Claude executable must be a native binary, not a script");
  if (expectedSha256 && sha256(bytes) !== expectedSha256) throw new Error("host-pinned Claude executable digest mismatch");
  return actual;
}

export function productionClaudeExecutable(projectRoot: string): string {
  const requested = process.env.AIDLC_CLAUDE_EXECUTABLE_PATH;
  const expectedSha256 = process.env.AIDLC_CLAUDE_EXECUTABLE_SHA256;
  if (requested || expectedSha256) {
    if (!requested || !expectedSha256) throw new Error("strict Claude executable pin requires both path and sha256");
    return checkedClaudeExecutable(projectRoot, requested, expectedSha256);
  }
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry || !isAbsolute(entry)) continue;
    const candidate = join(entry, "claude");
    if (!existsSync(candidate)) continue;
    try { return checkedClaudeExecutable(projectRoot, candidate); } catch { /* Ignore untrusted PATH entries and continue. */ }
  }
  throw new Error("no trusted native Claude executable was found on PATH");
}

function isNativeExecutable(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const magic = bytes.subarray(0, 4).toString("hex");
  return magic === "7f454c46" || ["cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(magic) || bytes.subarray(0, 2).toString("ascii") === "MZ";
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonical value");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = canonicalize(child);
    }
    return output;
  }
  throw new Error(`unsupported ${typeof value} in canonical value`);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function parseDelegationCommand(message: string): { scope: string; through: string; allowedStages: string[] } {
  const match = message.trim().match(DELEGATION_COMMAND);
  if (!match) throw new Error("user message must be the exact structured AI-DLC delegate-ai-approvals command");
  const allowedStages = match[3].split(",");
  if (new Set(allowedStages).size !== allowedStages.length) throw new Error("delegated stages must be unique");
  return { scope: match[1], through: match[2], allowedStages };
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function normalizedRelative(path: string, label: string): string {
  if (!path.trim() || isAbsolute(path)) throw new Error(`${label} must be a non-empty relative path`);
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must not escape or alias the project`);
  }
  return normalized;
}

function snapshot(projectRoot: string, path: string, label: string): Snapshot {
  const normalized = normalizedRelative(path, label);
  const candidate = resolve(projectRoot, normalized);
  if (!existsSync(candidate)) throw new Error(`${label} is missing: ${normalized}`);
  if (lstatSync(candidate).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${normalized}`);
  const absolute = realpathSync(candidate);
  if (!within(projectRoot, absolute) || !lstatSync(absolute).isFile()) throw new Error(`${label} must be a regular project file: ${normalized}`);
  const bytes = readFileSync(absolute);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${label} exceeds ${MAX_FILE_BYTES} bytes: ${normalized}`);
  return { path: normalized, absolute, bytes, sha256: sha256(bytes) };
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const normalized = value.trim();
  if (Buffer.byteLength(normalized) > MAX_ITEM_BYTES) throw new Error(`${label} is oversized`);
  return normalized;
}

function boundedStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error(`${label} must be an array of at most ${MAX_ITEMS} strings`);
  const result: string[] = [];
  for (const item of value) {
    const string = boundedString(item, label);
    if (!result.includes(string)) result.push(string);
  }
  return result;
}

function grantRequestSha(grant: Omit<DelegationGrant, "schemaVersion" | "requestSha256">): string {
  return sha256(canonicalJson(grant));
}

function activeIntentDir(projectRoot: string): string {
  const aidlcRoot = join(projectRoot, "aidlc");
  let space = "default";
  const spacePointer = join(aidlcRoot, "active-space");
  if (existsSync(spacePointer)) space = readFileSync(spacePointer, "utf8").trim();
  if (!SAFE_SEGMENT.test(space)) throw new Error("active-space contains an invalid space name");
  const intents = join(aidlcRoot, "spaces", space, "intents");
  let intent = "";
  const intentPointer = join(intents, "active-intent");
  if (existsSync(intentPointer)) intent = readFileSync(intentPointer, "utf8").trim();
  if (!intent) {
    const records = existsSync(intents)
      ? readdirSync(intents).filter((entry) => SAFE_SEGMENT.test(entry) && existsSync(join(intents, entry, "aidlc-state.md")))
      : [];
    if (records.length !== 1) throw new Error("cannot resolve exactly one active intent record");
    intent = records[0];
  }
  if (!SAFE_SEGMENT.test(intent)) throw new Error("active-intent contains an invalid intent name");
  const candidate = join(intents, intent);
  if (!existsSync(join(candidate, "aidlc-state.md"))) throw new Error("active intent has no aidlc-state.md");
  const resolved = realpathSync(candidate);
  if (!within(projectRoot, resolved)) throw new Error("active intent resolves outside the project");
  return resolved;
}

function stateScope(state: Snapshot): string | null {
  const match = state.bytes.toString("utf8").match(/^\s*-\s*\*\*Scope\*\*:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() || null;
}

function atomicWrite(path: string, text: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
    const directory = openSync(parent, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function intentOutputPath(intentDir: string, relativePath: string, label: string): string {
  const normalized = normalizedRelative(relativePath, label);
  const candidate = resolve(intentDir, normalized);
  if (!within(intentDir, candidate)) throw new Error(`${label} escapes the active intent`);
  mkdirSync(dirname(candidate), { recursive: true, mode: 0o700 });
  const parent = realpathSync(dirname(candidate));
  if (!within(intentDir, parent)) throw new Error(`${label} resolves outside the active intent`);
  const output = join(parent, basename(candidate));
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  return output;
}

function assertUnchanged(snapshots: Snapshot[]): void {
  for (const item of snapshots) {
    if (!existsSync(item.absolute) || sha256(readFileSync(item.absolute)) !== item.sha256) throw new Error(`bound input changed during assessment: ${item.path}`);
  }
}

/**
 * The latest HUMAN_TURN the record-human-turn hook wrote for the active
 * Intent, read through core's read-only `latestPersonTurn` plus the row's
 * Session field (so a settler can find the same row again). Null when no turn
 * with kept words is on record.
 */
function latestRecordedHumanTurn(projectRoot: string, intentDir: string): { at: string; session: string; words: string } | null {
  const turn = latestPersonTurn(projectRoot);
  if (!turn?.words || !turn.at) return null;
  const row = humanTurnRows(intentDir).filter((block) => auditBlockField(block, "Timestamp") === turn.at).at(-1);
  const session = row ? auditBlockField(row, "Session") : null;
  return session ? { at: turn.at, session, words: turn.words } : null;
}

function humanTurnRows(intentDir: string): string[] {
  const audit = join(intentDir, "audit");
  if (!existsSync(audit) || lstatSync(audit).isSymbolicLink()) return [];
  return readdirSync(audit).filter((name) => name.endsWith(".md")).sort().flatMap((name) => {
    const path = join(audit, name);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) return [];
    return readFileSync(path, "utf8").replace(/\r\n/g, "\n").split("\n---\n").filter((block) => auditBlockField(block, "Event") === "HUMAN_TURN");
  });
}

/**
 * The one shared check that a delegation grant was minted by
 * `createAiApprovalGrant` from the person's own host-recorded turn: current
 * schema, a self-consistent request hash, delegation words that hash to the
 * bound turn, and a HUMAN_TURN row with that exact Timestamp and Session in
 * the active Intent's official audit (read-only). Returns a refusal reason,
 * or null when the grant holds.
 */
export function grantHumanTurnRefusal(intentDir: string, grant: unknown): string | null {
  const value = grant as Partial<DelegationGrant> | null;
  if (!value || typeof value !== "object" || value.schemaVersion !== DELEGATION_GRANT_SCHEMA_VERSION) return "delegation grant predates the human-turn binding; mint a new one with grant";
  const turn = value.humanTurn;
  if (!turn || typeof turn.at !== "string" || !turn.at || typeof turn.session !== "string" || !turn.session || typeof turn.wordsSha256 !== "string") return "delegation grant is not bound to a recorded human turn";
  if (typeof value.userMessage !== "string" || sha256(value.userMessage) !== value.userMessageSha256 || turn.wordsSha256 !== value.userMessageSha256) return "delegation grant words do not match its bound human turn";
  const { schemaVersion: _version, requestSha256, ...request } = value;
  if (grantRequestSha(request as Omit<DelegationGrant, "schemaVersion" | "requestSha256">) !== requestSha256) return "delegation grant request hash does not bind its contents";
  const recorded = humanTurnRows(intentDir).some((block) => auditBlockField(block, "Timestamp") === turn.at && auditBlockField(block, "Session") === turn.session);
  return recorded ? null : "delegation grant's human turn is not in the official audit";
}

/**
 * Create the explicit, hash-bound delegation grant for low-risk stage
 * questions. The words must be the person's own latest host-recorded turn.
 */
export function createAiApprovalGrant(options: AiApprovalGrantOptions): AiApprovalGrantResult {
  if (!isAbsolute(options.projectDir) || !existsSync(options.projectDir)) throw new Error("--project-dir must be an existing absolute path");
  const projectRoot = realpathSync(options.projectDir);
  const config = resolveDAiApproval(projectRoot);
  if (config.mode !== "stage-gates") throw new Error("AI approval grant creation requires aiApproval.mode=stage-gates");
  const messageFile = snapshot(projectRoot, options.userMessageFile, "user message file");
  const userMessage = boundedString(messageFile.bytes.toString("utf8"), "user message");
  const delegated = parseDelegationCommand(userMessage);
  const messageId = boundedString(options.messageId, "message ID");
  const scope = boundedString(options.scope, "scope");
  const through = options.through === undefined || options.through === null ? null : boundedString(options.through, "through");
  const allowedStages = boundedStrings(options.allowedStages, "allowed stages");
  if (scope !== delegated.scope || through !== delegated.through || canonicalJson(allowedStages) !== canonicalJson(delegated.allowedStages)) {
    throw new Error("grant flags must exactly match the structured human delegation command");
  }
  if (allowedStages.length === 0 || allowedStages.length !== options.allowedStages.length) throw new Error("allowed stages must contain unique non-empty stages");
  const humanOnly = allowedStages.find((stage) => OPERATION_STAGES.has(stage) || DENIED_STAGE_TOKEN.test(stage));
  if (humanOnly) throw new Error(`AI approval cannot be delegated for human-only stage: ${humanOnly}`);
  if (through && (through.toLowerCase() === "operation" || OPERATION_STAGES.has(through) || DENIED_STAGE_TOKEN.test(through))) throw new Error("AI approval through boundary cannot include operation or other human-only work");
  if (through) {
    const exactBoundaryIndex = stagePolicy.stages.findIndex((entry) => entry.stage === through);
    const phaseIndex = PHASES.indexOf(through as (typeof PHASES)[number]);
    const boundaryIndex = exactBoundaryIndex >= 0 ? exactBoundaryIndex : phaseIndex >= 0 ? stagePolicy.stages.findLastIndex((entry) => entry.phase === through) : -1;
    if (boundaryIndex < 0) throw new Error("AI approval through boundary must name an official phase or stage");
    for (const allowed of allowedStages) {
      const allowedIndex = stagePolicy.stages.findIndex((entry) => entry.stage === allowed);
      if (allowedIndex < 0 || allowedIndex > boundaryIndex) throw new Error(`allowed stage exceeds AI approval through boundary: ${allowed}`);
    }
  }
  const intentDir = activeIntentDir(projectRoot);
  const state = snapshot(projectRoot, relative(projectRoot, join(intentDir, "aidlc-state.md")), "active intent state");
  if (stateScope(state) !== scope) throw new Error("grant scope must match the active intent state Scope");
  const turn = latestRecordedHumanTurn(projectRoot, intentDir);
  if (!turn || turn.words.trim() !== userMessage) throw new Error(GRANT_HUMAN_TURN_REQUIRED);
  const userMessageSha256 = sha256(userMessage);
  const request = {
    messageId,
    userMessage,
    userMessageSha256,
    humanTurn: { at: turn.at, session: turn.session, wordsSha256: userMessageSha256 },
    mode: "stage-gates" as const,
    scope,
    through,
    allowedStages,
    minConfidence: config.minConfidence,
  };
  const grant: DelegationGrant = { schemaVersion: DELEGATION_GRANT_SCHEMA_VERSION, ...request, requestSha256: grantRequestSha(request) };
  const path = intentOutputPath(intentDir, DEFAULT_GRANT_PATH, "AI approval delegation path");
  const body = `${JSON.stringify(grant, null, 2)}\n`;
  assertUnchanged([messageFile, state]);
  atomicWrite(path, body);
  return {
    path: relative(projectRoot, path).split(sep).join("/"),
    sha256: sha256(body),
    messageId,
    requestSha256: grant.requestSha256,
  };
}

/**
 * The stages a document-driven grant covers: every stage the active intent's
 * state lists as EXECUTE and not yet completed under its Ideation and
 * Inception phase headings, in the state's own order, up to and including
 * DOCUMENT_DELEGATION_THROUGH; never a human-only stage token. Derived from
 * recorded state, never from prose.
 */
export function documentDelegationStages(stateBody: string): string[] {
  const stages: string[] = [];
  let phase = "";
  for (const line of stateBody.split(/\r?\n/)) {
    const heading = line.match(/^###\s+([A-Z]+)\s+PHASE\s*$/);
    if (heading) { phase = heading[1].toLowerCase(); continue; }
    const match = line.match(/^\s*-\s*\[([ ?R-]|x)\]\s+([a-z0-9-]+)\s+—\s+EXECUTE\s*$/);
    if (!match || (phase !== "ideation" && phase !== "inception")) continue;
    const [, mark, stage] = match;
    if (mark !== "x" && !OPERATION_STAGES.has(stage) && !DENIED_STAGE_TOKEN.test(stage) && !stages.includes(stage)) stages.push(stage);
    if (stage === DOCUMENT_DELEGATION_THROUGH) break;
  }
  return stages;
}

export type DocumentAnswerGrantOptions = { projectDir: string; userMessageFile: string; messageId: string };

/**
 * Create the person's delegation of document-grounded answers for the active
 * document-driven intent. The words must be exactly DOCUMENT_DELEGATION_COMMAND
 * and the person's own latest host-recorded turn; the same human-turn binding
 * and `grantHumanTurnRefusal` check as the low-risk grant apply. It never
 * approves a gate.
 */
export function createDocumentAnswerGrant(options: DocumentAnswerGrantOptions): AiApprovalGrantResult & { allowedStages: string[] } {
  if (!isAbsolute(options.projectDir) || !existsSync(options.projectDir)) throw new Error("--project-dir must be an existing absolute path");
  const projectRoot = realpathSync(options.projectDir);
  const messageFile = snapshot(projectRoot, options.userMessageFile, "user message file");
  const userMessage = boundedString(messageFile.bytes.toString("utf8"), "user message");
  if (userMessage !== DOCUMENT_DELEGATION_COMMAND) throw new Error(`user message must be exactly ${DOCUMENT_DELEGATION_COMMAND}`);
  const messageId = boundedString(options.messageId, "message ID");
  const intentDir = activeIntentDir(projectRoot);
  const state = snapshot(projectRoot, relative(projectRoot, join(intentDir, "aidlc-state.md")), "active intent state");
  const scope = stateScope(state);
  if (!scope) throw new Error("active intent state has no Scope");
  const allowedStages = documentDelegationStages(state.bytes.toString("utf8"));
  if (allowedStages.length === 0) throw new Error(`no open question stage up to ${DOCUMENT_DELEGATION_THROUGH} remains for document-grounded answers`);
  const turn = latestRecordedHumanTurn(projectRoot, intentDir);
  if (!turn || turn.words.trim() !== userMessage) throw new Error(DOCUMENT_GRANT_HUMAN_TURN_REQUIRED);
  const userMessageSha256 = sha256(userMessage);
  const request = {
    messageId,
    userMessage,
    userMessageSha256,
    humanTurn: { at: turn.at, session: turn.session, wordsSha256: userMessageSha256 },
    mode: "document-driven" as const,
    scope,
    through: DOCUMENT_DELEGATION_THROUGH,
    allowedStages,
    minConfidence: 0,
  };
  const grant: DelegationGrant = { schemaVersion: DELEGATION_GRANT_SCHEMA_VERSION, ...request, requestSha256: grantRequestSha(request) };
  const path = intentOutputPath(intentDir, DOCUMENT_DELEGATION_PATH, "document answer delegation path");
  const body = `${JSON.stringify(grant, null, 2)}\n`;
  assertUnchanged([messageFile, state]);
  atomicWrite(path, body);
  return { path: relative(projectRoot, path).split(sep).join("/"), sha256: sha256(body), messageId, requestSha256: grant.requestSha256, allowedStages };
}

function cliValues(argv: string[], known: ReadonlySet<string>): { values: (flag: string) => string[]; one: (flag: string, required?: boolean) => string | undefined } {
  const values = (flag: string) => argv.flatMap((value, index) => value === flag && argv[index + 1] ? [argv[index + 1]] : []);
  const one = (flag: string, required = true) => {
    const found = values(flag);
    if (found.length > 1) throw new Error(`${flag} may be supplied only once`);
    if (required && found.length !== 1) throw new Error(`${flag} is required`);
    return found[0];
  };
  for (let index = 1; index < argv.length; index += 2) if (!known.has(argv[index]) || argv[index + 1] === undefined) throw new Error(`unknown or incomplete argument: ${argv[index]}`);
  return { values, one };
}

function grantCliOptions(argv: string[]): AiApprovalGrantOptions {
  if (argv[0] !== "grant") throw new Error("usage: ai-approval-controller.ts grant --project-dir ABS --user-message-file REL --message-id ID --scope SCOPE --allowed-stages CSV [--through BOUNDARY]");
  const { one } = cliValues(argv, new Set(["--project-dir", "--user-message-file", "--message-id", "--scope", "--through", "--allowed-stages"]));
  const projectDir = one("--project-dir");
  const userMessageFile = one("--user-message-file");
  const messageId = one("--message-id");
  const scope = one("--scope");
  const stages = one("--allowed-stages");
  if (!projectDir || !userMessageFile || !messageId || !scope || !stages) throw new Error("required AI approval grant arguments are missing");
  return { projectDir, userMessageFile, messageId, scope, through: one("--through", false) ?? null, allowedStages: stages.split(",").map((stage) => stage.trim()) };
}

/**
 * Delegated AI stage-gate approval was dropped when core/ was restored to
 * upstream AI-DLC v2.11.0: the upstream engine accepts a stage approval only
 * from the person, and a D extension cannot add a new approval authority. The
 * grant remains as the person's explicit delegation for low-risk stage
 * questions (ai-question-controller.ts); it never approves a gate.
 */
export const AI_GATE_APPROVAL_DROPPED = "Delegated AI stage-gate approval is not available: upstream AI-DLC accepts a stage approval only from the person; approve or request changes at the official gate.";

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    if (argv[0] === "document-grant") {
      const { one } = cliValues(argv, new Set(["--project-dir", "--user-message-file", "--message-id"]));
      process.stdout.write(`${JSON.stringify(createDocumentAnswerGrant({ projectDir: one("--project-dir")!, userMessageFile: one("--user-message-file")!, messageId: one("--message-id")! }), null, 2)}\n`);
      process.exit(0);
    }
    if (argv[0] === "grant") {
      process.stdout.write(`${JSON.stringify(createAiApprovalGrant(grantCliOptions(argv)), null, 2)}\n`);
      process.exit(0);
    }
    process.stdout.write(`${JSON.stringify({ status: "block", reason: AI_GATE_APPROVAL_DROPPED }, null, 2)}\n`);
    process.exit(2);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "block", reason: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exit(2);
  }
}
