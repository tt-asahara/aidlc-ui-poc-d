import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const RESUME_LEDGER_VERSION = 1 as const;

export interface UnitCompletion {
  completedAt: string;
  result?: unknown;
}

export interface ResumeLedger {
  version: typeof RESUME_LEDGER_VERSION;
  directiveFingerprint: string;
  succeeded: Record<string, UnitCompletion>;
}

export class DirectiveFingerprintMismatchError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super(`resume ledger belongs to a different directive (expected ${expected}, found ${actual})`);
    this.name = "DirectiveFingerprintMismatchError";
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("directive contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = canonicalize(child);
    }
    return output;
  }
  throw new Error(`directive contains unsupported ${typeof value} value`);
}

/** Hashes the complete issued directive. Object key order is immaterial; array order is preserved. */
export function fingerprintDirective(directive: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(directive))).digest("hex");
}

function validateLedger(value: unknown): ResumeLedger {
  if (!value || typeof value !== "object") throw new Error("invalid resume ledger: expected an object");
  const candidate = value as Partial<ResumeLedger>;
  if (candidate.version !== RESUME_LEDGER_VERSION || typeof candidate.directiveFingerprint !== "string") {
    throw new Error("invalid resume ledger: unsupported version or fingerprint");
  }
  if (!candidate.succeeded || typeof candidate.succeeded !== "object" || Array.isArray(candidate.succeeded)) {
    throw new Error("invalid resume ledger: succeeded must be an object");
  }
  for (const [unit, completion] of Object.entries(candidate.succeeded)) {
    if (!unit || !completion || typeof completion !== "object" || typeof (completion as UnitCompletion).completedAt !== "string") {
      throw new Error(`invalid resume ledger: malformed completion for ${unit || "<empty>"}`);
    }
  }
  return candidate as ResumeLedger;
}

export function loadResumeLedger(path: string, directive: unknown): ResumeLedger {
  const expected = fingerprintDirective(directive);
  if (!existsSync(path)) return { version: RESUME_LEDGER_VERSION, directiveFingerprint: expected, succeeded: {} };
  const ledger = validateLedger(JSON.parse(readFileSync(path, "utf8")));
  if (ledger.directiveFingerprint !== expected) {
    throw new DirectiveFingerprintMismatchError(expected, ledger.directiveFingerprint);
  }
  return ledger;
}

/** Returns issued units that have not already been durably recorded as successful. */
export function unitsToResume(path: string, directive: unknown, issuedUnits: readonly string[]): string[] {
  const ledger = loadResumeLedger(path, directive);
  return issuedUnits.filter((unit) => !Object.hasOwn(ledger.succeeded, unit));
}

/** Writes beside the destination then atomically renames, so readers see old or new JSON, never a partial file. */
export function writeResumeLedgerAtomic(path: string, ledger: ResumeLedger): void {
  validateLedger(ledger);
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directoryDescriptor = openSync(parent, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

/** Single-writer update used after the engine-accepted result for one unit is known to have succeeded. */
export function recordUnitSuccess(
  path: string,
  directive: unknown,
  unit: string,
  result?: unknown,
  completedAt = new Date().toISOString(),
): ResumeLedger {
  if (!unit) throw new Error("unit must be non-empty");
  const ledger = loadResumeLedger(path, directive);
  if (Object.hasOwn(ledger.succeeded, unit)) return ledger;
  const updated: ResumeLedger = {
    ...ledger,
    succeeded: { ...ledger.succeeded, [unit]: result === undefined ? { completedAt } : { completedAt, result } },
  };
  writeResumeLedgerAtomic(path, updated);
  return updated;
}
