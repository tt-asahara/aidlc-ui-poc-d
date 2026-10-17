import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cli = join(import.meta.dir, "..", "generic-auto-cli.ts");
function fixture(config: object) {
  const root = mkdtempSync(join(tmpdir(), "d-generic-auto-"));
  mkdirSync(join(root, ".claude", "tools"), { recursive: true });
  mkdirSync(join(root, ".aidlc-engine"), { recursive: true });
  writeFileSync(join(root, ".claude", "d-acceleration.jsonc"), JSON.stringify(config));
  writeFileSync(join(root, ".claude", "tools", "aidlc-orchestrate.ts"), `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2), at = args.indexOf("--project-dir"), root = args[at + 1];
writeFileSync(join(root, "official-argv.json"), JSON.stringify(args.slice(0, at)));
process.stdout.write(JSON.stringify({ kind: "ask", ask_type: "scope-confirm", gate: true, question: "Choose scope" }));
`);
  return root;
}
const run = (root: string, args: string[]) => spawnSync(process.execPath, [cli, ...args, "--project-dir", root], { cwd: root, encoding: "utf8" });

describe("generic /aidlc --auto controller", () => {
  test("routes the representative budget request and preserves bounded human-gated continuation", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 3, deadlineMs: 60000 } });
    const description = "架空データだけを使う予算管理Webアプリを作ってください。収支登録、カテゴリ別予算、月次集計、CSV入出力が必要です。TypeScriptで実装し、実口座連携・外部送信は不要です。";
    writeFileSync(join(root, ".aidlc-engine", "representative-request.txt"), description);

    const routed = JSON.parse(run(root, ["start", "--description-file", ".aidlc-engine/representative-request.txt"]).stdout);
    expect(routed).toMatchObject({ status: "routed", reason: "human-gate", directive: { ask_type: "scope-confirm", gate: true }, hostControl: { through: "inception", maxSteps: 3 } });
    const officialArgv = JSON.parse(readFileSync(join(root, "official-argv.json"), "utf8"));
    expect(officialArgv).toEqual(["next", description]);
    expect(officialArgv.join(" ")).not.toContain("/aidlc");
    expect(officialArgv.join(" ")).not.toContain("--auto");

    expect(run(root, ["init", "--active-stages", "requirements-analysis,units-generation"]).status).toBe(0);
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "requirements-analysis", receipt: "work-1" }));
    expect(JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout)).toMatchObject({ action: "continue", state: { steps: 1 } });
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "ask", stage: "requirements-analysis", gate: true, receipt: "approval-1" }));
    expect(JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout)).toMatchObject({ action: "stop", reason: "human-gate", state: { awaitingHuman: true, steps: 2 } });
  });

  test("routes arbitrary description as one official argv value without leaking --auto", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 7, deadlineMs: 60000 } });
    const description = "Build a budget app; $(touch nope)\nwith approvals";
    writeFileSync(join(root, ".aidlc-engine", "request.txt"), description);
    const result = run(root, ["start", "--description-file", ".aidlc-engine/request.txt"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "routed", reason: "human-gate", directive: { kind: "ask", ask_type: "scope-confirm" }, hostControl: { through: "inception", maxSteps: 7, deadlineMs: 60000 } });
    expect(JSON.parse(readFileSync(join(root, "official-argv.json"), "utf8"))).toEqual(["next", description]);
    expect(readFileSync(join(root, ".aidlc-engine", "request.txt"), "utf8")).toBe(description);
    expect(existsSync(join(root, "nope"))).toBeFalse();
  });

  test("fails closed when auto is disabled or session-only", () => {
    for (const auto of [{ enabled: false, sessionOnly: false }, { enabled: true, sessionOnly: true }]) {
      const root = fixture({ auto });
      writeFileSync(join(root, ".aidlc-engine", "request.txt"), "Build it");
      expect(JSON.parse(run(root, ["start", "--description-file", ".aidlc-engine/request.txt"]).stdout).reason).toBe(auto.enabled ? "session-only" : "disabled");
      expect(existsSync(join(root, "official-argv.json"))).toBeFalse();
    }
  });

  test("rejects description symlinks and initializes configured bounded session", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, through: "inception", maxSteps: 5, deadlineMs: 45000 } });
    writeFileSync(join(root, ".aidlc-engine", "real.txt"), "Build it");
    symlinkSync(join(root, ".aidlc-engine", "real.txt"), join(root, ".aidlc-engine", "link.txt"));
    expect(run(root, ["start", "--description-file", ".aidlc-engine/link.txt"]).status).not.toBe(0);
    const initialized = run(root, ["init", "--active-stages", "requirements-analysis,units-generation"]);
    expect(initialized.status).toBe(0);
    expect(JSON.parse(initialized.stdout)).toMatchObject({ action: "continue", state: { through: "units-generation", maxSteps: 5, deadlineMs: 45000, steps: 0 } });
  });

  test("checkpoint preserves human gates and enforces configured step bound", () => {
    const root = fixture({ auto: { enabled: true, sessionOnly: false, maxSteps: 1, deadlineMs: 45000 } });
    expect(run(root, ["init", "--active-stages", "requirements-analysis"]).status).toBe(0);
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "ask", stage: "requirements-analysis", gate: true, receipt: "human-1" }));
    const gate = JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout);
    expect(gate).toMatchObject({ action: "stop", reason: "human-gate", state: { awaitingHuman: true, steps: 1 } });
    expect(run(root, ["init", "--active-stages", "requirements-analysis"]).status).toBe(0);
    writeFileSync(join(root, "directive.json"), JSON.stringify({ kind: "run-stage", stage: "requirements-analysis", receipt: "work-2" }));
    expect(JSON.parse(run(root, ["checkpoint", "--directive-file", "directive.json"]).stdout)).toMatchObject({ action: "stop", reason: "max-steps-exceeded" });
  });
});
