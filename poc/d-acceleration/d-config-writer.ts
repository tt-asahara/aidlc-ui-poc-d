// Writes the project's D configuration at setup: every key of the shipped,
// commented d-acceleration.example.jsonc, with the setup values for the
// switches the person is asked about. An existing file keeps every value the
// person set; setup only adds the keys it lacks, each with the value the
// project already runs with (the example's runtime default), so completing a
// file never changes behaviour. A file it cannot rewrite without losing
// something is left exactly as it is.
//
//   bun d-config-writer.ts --project-dir ABS --harness-dir .claude [--set features.prLensReview=true ...] [--dry-run]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseDJsonc } from "./d-config.ts";

/**
 * The switches setup asks about, with the value it writes when the person
 * takes the default. The runtime default of a missing key stays as
 * d-config.ts resolves it; these are what a fresh setup writes down.
 */
export const SETUP_SWITCHES: Readonly<Record<string, boolean>> = {
  "parallel.enabled": true,
  "features.requirementIdValidation": true,
  "features.functionalDesignDocumentDiscipline": false,
  "features.sourceGrounding": false,
  "features.specGrounding": false,
  "features.mockupPngGeneration": true,
  "features.visualRegression": false,
  "features.prLensReview": false,
  "gitPersistence.enabled": true,
  "gitPersistence.push": false,
  "auto.enabled": true,
  "issueAutopilot.enabled": false,
  "decisionIssueSummary.enabled": false,
  "decisionIssueSummary.send": false,
};

const TEMPLATE = join(import.meta.dir, "d-acceleration.example.jsonc");
const KEY_LINE = /^(\s*)"([A-Za-z0-9]+)":\s*(.*?)(,?)\s*$/;

/** Every key path the template sets, each with its JSON value text: one line per key. */
export function templateLeaves(template: string): Map<string, string> {
  const leaves = new Map<string, string>(), stack: string[] = [];
  for (const line of template.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed === "{") continue;
    if (/^},?$/.test(trimmed)) { stack.pop(); continue; }
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    if (match[3] === "{") { stack.push(match[2]!); continue; }
    leaves.set([...stack, match[2]].join("."), match[3]!);
  }
  return leaves;
}

/** One-line JSON in the template's own spacing: `{ "a": 1 }`, `["x", "y"]`. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([key, child]) => `${JSON.stringify(key)}: ${inline(child)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(value);
}

/** The template with each listed key path's value replaced; comments and order stay. */
export function renderDConfig(template: string, values: ReadonlyMap<string, unknown>): string {
  const stack: string[] = [];
  return template.split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed === "{") return line;
    if (/^},?$/.test(trimmed)) { stack.pop(); return line; }
    const match = KEY_LINE.exec(line);
    if (!match) return line;
    if (match[3] === "{") { stack.push(match[2]!); return line; }
    const key = [...stack, match[2]].join(".");
    if (!values.has(key)) return line;
    return `${match[1]}"${match[2]}": ${inline(values.get(key))}${match[4]}`;
  }).join("\n");
}

function flatten(value: unknown, prefix: string, leafPaths: ReadonlySet<string>, out: Map<string, unknown>): void {
  if (leafPaths.has(prefix) || !value || typeof value !== "object" || Array.isArray(value)) { if (prefix) out.set(prefix, value); return; }
  for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, leafPaths, out);
}

export type DConfigWrite = { action: "written" | "completed" | "unchanged" | "left-as-is"; path: string; added: string[]; values: Record<string, unknown>; reason?: string };

export function writeDConfig(projectDir: string, harnessDir: string, answers: Readonly<Record<string, boolean>> = {}, options: { dryRun?: boolean; create?: boolean } = {}): DConfigWrite {
  for (const key of Object.keys(answers)) if (!(key in SETUP_SWITCHES)) throw new Error(`unknown setup switch ${key} (known: ${Object.keys(SETUP_SWITCHES).join(", ")})`);
  const template = readFileSync(TEMPLATE, "utf8"), leaves = templateLeaves(template), leafPaths = new Set(leaves.keys());
  const rel = `${harnessDir}/d-acceleration.jsonc`, path = join(projectDir, rel);
  if (existsSync(join(projectDir, harnessDir, "d-acceleration.json"))) {
    return { action: "left-as-is", path: rel, added: [], values: {}, reason: `${harnessDir}/d-acceleration.json is the project's D configuration; setup does not add a second file` };
  }
  const existing = new Map<string, unknown>();
  if (!existsSync(path) && options.create === false) return { action: "unchanged", path: rel, added: [], values: {}, reason: "no D configuration file; only setup creates one" };
  if (existsSync(path)) flatten(parseDJsonc(readFileSync(path, "utf8"), path), "", leafPaths, existing);
  const unknown = [...existing.keys()].filter((key) => !leafPaths.has(key));
  if (unknown.length) {
    return { action: "left-as-is", path: rel, added: [], values: {}, reason: `it sets keys the standard layout does not hold (${unknown.join(", ")}), so rewriting it would lose them` };
  }
  const values = new Map<string, unknown>(), added: string[] = [];
  for (const [key, text] of leaves) {
    if (existing.has(key)) { values.set(key, existing.get(key)); continue; }
    const fresh = existing.size === 0;
    values.set(key, fresh && key in answers ? answers[key] : fresh && key in SETUP_SWITCHES ? SETUP_SWITCHES[key] : JSON.parse(text));
    added.push(key);
  }
  const result = { path: rel, added, values: Object.fromEntries([...values].filter(([key]) => key in SETUP_SWITCHES)) };
  if (existing.size && !added.length) return { action: "unchanged", ...result };
  const rendered = renderDConfig(template, values);
  parseDJsonc(rendered, rel);
  if (!options.dryRun) writeFileSync(path, rendered);
  return { action: existing.size ? "completed" : "written", ...result };
}

if (import.meta.main) {
  const argv = process.argv.slice(2), flag = (name: string) => { const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]; };
  const projectDir = flag("--project-dir"), harnessDir = flag("--harness-dir") ?? ".claude";
  try {
    if (!projectDir || !isAbsolute(projectDir)) throw new Error("--project-dir must be an absolute PRODUCT path");
    const answers: Record<string, boolean> = {};
    argv.forEach((arg, index) => {
      if (argv[index - 1] !== "--set") return;
      const [key, value] = arg.split("=");
      if (!key || !["true", "false"].includes(value ?? "")) throw new Error(`--set takes <switch>=true|false, got ${arg}`);
      answers[key] = value === "true";
    });
    process.stdout.write(`${JSON.stringify(writeDConfig(projectDir, harnessDir, answers, { dryRun: argv.includes("--dry-run") }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`D configuration setup stopped: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
