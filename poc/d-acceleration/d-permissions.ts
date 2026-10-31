// Packager-side host permissions for D's commands on Kiro CLI, Kiro IDE, and
// Codex (called by scripts/package.ts; never shipped itself). Claude's allow
// list is authored in harness/claude/settings.json; the D tests compare it with
// dAllowedCommands so the two cannot drift.
//
// The allowed set is D_NATIVE_TOOLS minus D_PROMPTED_TOOLS (the tools that
// publish outside the project keep the host's own prompt), plus the plugin
// tools the D path runs. Every edit replaces the previous D entries, so a
// native rewrite of a copy-channel tree leaves no stale `bun` line behind.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { D_NATIVE_TOOLS, D_PROMPTED_TOOLS } from "./native-commands.ts";

/** D tools the host runs without asking. */
export const D_HOST_ALLOWED_TOOLS: readonly string[] = Object.keys(D_NATIVE_TOOLS).filter((name) => !D_PROMPTED_TOOLS.has(name));
/** Plugin tools under `<harness dir>/tools/` that the D path runs. */
export const D_ALLOWED_PLUGIN_TOOLS: readonly string[] = [
  "pr-lens-review.ts", "ui-poc-fidelity.cjs", "ui-poc-element-matrix.cjs", "ui-poc-review-risks.cjs", "ui-poc-evidence.cjs", "ui-poc-baseline.cjs",
];

/**
 * The command prefixes D needs allowed, each a list of words. A native install
 * runs D as `aidlc d <tool>` and allows no `bun` command, as Claude's native
 * settings do (rewriteClaudeNativePermissions in scripts/package.ts).
 */
export function dAllowedCommands(harnessDir: string, native: boolean): string[][] {
  if (native) return D_HOST_ALLOWED_TOOLS.map((name) => ["aidlc", "d", name]);
  return [
    ...D_HOST_ALLOWED_TOOLS.map((name) => ["bun", `${harnessDir}/tools/d-acceleration/${name}.ts`]),
    ...D_ALLOWED_PLUGIN_TOOLS.map((file) => ["bun", `${harnessDir}/tools/${file}`]),
  ];
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDEntry = (text: string) => /d-acceleration\/|^aidlc d |pr-lens-review|ui-poc-/.test(text);
const BEGIN = "# BEGIN AI-DLC D permissions", END = "# END AI-DLC D permissions";

/** Write D's allow entries into the harness's own permission file. A harness without one is left alone. */
export function applyDPermissions(treeRoot: string, harness: string, harnessDir: string, native: boolean): void {
  const commands = dAllowedCommands(harnessDir, native);
  if (harness === "kiro") {
    const file = join(treeRoot, "agents", "aidlc.json");
    if (!existsSync(file)) return;
    const value = JSON.parse(readFileSync(file, "utf8")) as { toolsSettings?: { execute_bash?: { allowedCommands?: unknown } } };
    const allowed = value.toolsSettings?.execute_bash?.allowedCommands;
    if (!Array.isArray(allowed)) throw new Error("[kiro] agents/aidlc.json has no execute_bash.allowedCommands list");
    const kept = allowed.filter((entry) => typeof entry !== "string" || !isDEntry(entry));
    value.toolsSettings!.execute_bash!.allowedCommands = [...kept, ...commands.map((words) => `${escapeRegExp(words.join(" "))}( .*)?`)];
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  } else if (harness === "kiro-ide") {
    const file = join(treeRoot, "agents", "aidlc-aidlc.md");
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8").replace(new RegExp(`\\n {8}${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`), "");
    const anchor = /( {6}match:\n(?: {8}- "[^"\n]*"\n)+)/.exec(text);
    if (!anchor) throw new Error("[kiro-ide] agents/aidlc-aidlc.md has no shell permission match list");
    const lines = [`        ${BEGIN}`, ...commands.map((words) => `        - "${words.join(" ")} *"`), `        ${END}`].join("\n");
    writeFileSync(file, text.replace(anchor[1]!, `${anchor[1]}${lines}\n`));
  } else if (harness === "codex") {
    const file = join(treeRoot, "rules", "default.rules");
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8").replace(new RegExp(`\\n?${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n`), "");
    const dRule = native
      ? `prefix_rule(pattern = ["aidlc", "d", [${D_HOST_ALLOWED_TOOLS.map((name) => JSON.stringify(name)).join(", ")}]], decision = "allow")`
      : `prefix_rule(pattern = ["bun", [\n${commands.filter((words) => words[0] === "bun").map((words) => `    ${JSON.stringify(words[1])}`).join(",\n")}\n]], decision = "allow")`;
    writeFileSync(file, `${text.endsWith("\n") ? text : `${text}\n`}\n${BEGIN}\n${dRule}\n${END}\n`);
  }
}
