// Every D or D-plugin command that a shipped skill or stage tells the agent to
// run must be pre-approved in the Claude settings, or be one of the commands
// that deliberately keep Claude Code's permission prompt. Without this, an
// unattended run (auto mode, /loop) stops on a permission refusal; the
// dogfood-3 Issue #1 run stopped at host-session-cli.ts this way.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { D_ACCELERATION_RUNTIME } from "../d-projection.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const SETTINGS = join(REPO, "harness", "claude", "settings.json");

// Network-facing GitHub CLIs: an explicit person-approved prompt is the design
// (see t40 T5), so they must stay out of the allow list.
const PROMPTED = new Set([
  ".claude/tools/d-acceleration/issue-autopilot-cli.ts",
  ".claude/tools/d-acceleration/decision-issue-summary.ts",
]);

// Sources that ship instructions into a Claude install: the harness skills,
// the D runtime docs, and the two D-owned plugins' contributions/skills.
const SOURCES = [
  join(REPO, "harness", "claude", "skills"),
  join(REPO, "poc", "ui-poc", "contributions"),
  join(REPO, "poc", "ui-poc", "skills"),
  join(REPO, "poc", "pr-lens-review", "contributions"),
  join(REPO, "poc", "pr-lens-review", "tools"),
  // The installed UI evidence contract (tools/ui-poc/contract.md) and the
  // --doc guide the skill reads first.
  join(REPO, "poc", "ui-poc", "tools", "ui-poc"),
  join(REPO, "poc", "d-acceleration", "design-document-guide.md"),
];

function* textFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  if (!statSync(dir).isDirectory()) { yield dir; return; }
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* textFiles(full);
    else if (/\.(md|json|jsonc)$/.test(entry)) yield full;
  }
}

// `bun .claude/tools/<path>.ts` or `bun "$CLAUDE_PROJECT_DIR"/... ` forms that
// name a D runtime or D plugin tool.
const COMMAND = /bun\s+(?:\.\/)?(?:\{\{HARNESS_DIR\}\}|\.claude)\/tools\/((?:d-acceleration\/[A-Za-z0-9_.-]+|pr-lens-review|ui-poc[A-Za-z0-9_./-]*)\.(?:ts|cjs))/g;

// Skills also name D CLIs by file name alone (`host-session-cli.ts init`);
// the agent then runs them from the installed tools/d-acceleration/.
const D_FILES = D_ACCELERATION_RUNTIME.filter((file) => file.endsWith(".ts"));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BARE = new RegExp(`(?<![A-Za-z0-9_./-])(${D_FILES.map(escape).join("|")})\\s+[a-z-]`, "g");

function referencedCommands(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (command: string, file: string) => { if (!found.has(command)) found.set(command, relative(REPO, file)); };
  for (const dir of SOURCES) {
    for (const file of textFiles(dir)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(COMMAND)) add(`.claude/tools/${match[1]}`, file);
      for (const match of text.matchAll(BARE)) add(`.claude/tools/d-acceleration/${match[1]}`, file);
    }
  }
  return found;
}

function allowed(command: string, allow: readonly string[]): boolean {
  return allow.some((rule) => {
    const body = /^Bash\((.*)\)$/.exec(rule)?.[1];
    if (!body) return false;
    const invocation = `bun ${command} --x`;
    return body.endsWith(" *") ? invocation.startsWith(body.slice(0, -1)) : invocation === body;
  });
}

describe("D command permissions", () => {
  const allow: string[] = JSON.parse(readFileSync(SETTINGS, "utf8")).permissions.allow;
  const commands = referencedCommands();

  test("finds the D commands the shipped instructions use", () => {
    expect(commands.has(".claude/tools/d-acceleration/host-session-cli.ts")).toBe(true);
    expect(commands.has(".claude/tools/d-acceleration/issue-autopilot-cli.ts")).toBe(true);
    // The UI evidence step hashes assets and self-checks through this tool.
    expect(commands.has(".claude/tools/ui-poc-evidence.cjs")).toBe(true);
  });

  // A headless run (claude -p) stopped at rough-mockups when the agent hashed
  // assets with shasum and its own node script, and --doc stalled on an
  // ad-hoc Python generator: neither is pre-approved, and nobody can answer
  // the prompt. The shipped instructions name the evidence tool's `hash`
  // command and the file tools instead, and never an interpreter command.
  test("shipped instructions never tell the agent to run a generic hashing or script interpreter", () => {
    const offenders: string[] = [];
    for (const dir of SOURCES) {
      for (const file of textFiles(dir)) {
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (/`(?:shasum|sha256sum|openssl dgst|python3?|node) [^`]*`/.test(line) && !/never/i.test(line)) offenders.push(`${relative(REPO, file)}: ${line.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(allow.some((rule) => /^Bash\((?:shasum|sha256sum|openssl|python3?|node)\b/.test(rule))).toBe(false);
  });

  test("--doc writes the design files with the file tools, not a generator script", () => {
    const skill = readFileSync(join(REPO, "harness", "claude", "skills", "aidlc", "SKILL.md"), "utf8");
    const guide = readFileSync(join(REPO, "poc", "d-acceleration", "design-document-guide.md"), "utf8");
    expect(skill).toMatch(/Create and update every design\s+file with the Write and Edit tools/);
    expect(skill).toMatch(/never write or run a\s+generator script/);
    expect(guide).toContain("**Write / Edit ツールで 1 ファイルずつ**");
  });

  test("every referenced D command is pre-approved or deliberately prompted", () => {
    const missing = [...commands].filter(([command]) => !PROMPTED.has(command) && !allowed(command, allow)).map(([command, source]) => `${command} (used in ${source})`);
    expect(missing).toEqual([]);
  });

  test("the deliberately prompted GitHub CLIs stay out of the allow list", () => {
    for (const command of PROMPTED) expect(allowed(command, allow)).toBe(false);
  });
});
