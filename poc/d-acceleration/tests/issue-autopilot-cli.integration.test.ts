import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { intakeBindingKey } from "../issue-autopilot.ts";

const cli = join(import.meta.dir, "..", "issue-autopilot-cli.ts");
const executable = (path: string, source: string) => { writeFileSync(path, `#!/usr/bin/env bun\n${source}`); chmodSync(path, 0o755); };

describe("packaged Issue autopilot command routing", () => {
  test("exact Issue reaches fixed GH argv and official intent-create adapter once", () => {
    const root = mkdtempSync(join(tmpdir(), "d-auto-cli-")), tools = join(root, ".claude", "tools"); mkdirSync(tools, { recursive: true });
    writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ auto: { enabled: true, sessionOnly: false, through: "inception", labelAllowlist: ["aidlc-auto"] }, issueAutopilot: { enabled: true } }));
    const gh = join(root, "fake-gh.ts"); executable(gh, `import {writeFileSync} from "node:fs"; writeFileSync("gh-argv.json", JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({number:42,title:"Budget API",body:"Build the budget API",labels:[{name:"aidlc-auto"}],state:"OPEN"}));`);
    executable(join(tools, "aidlc-utility.ts"), `import {mkdirSync,readFileSync,writeFileSync} from "node:fs"; const args=process.argv.slice(2), count=Number((()=>{try{return readFileSync("utility-count","utf8")}catch{return "0"}})())+1; writeFileSync("utility-count",String(count)); writeFileSync("utility-argv.json", JSON.stringify(args)); mkdirSync("aidlc/spaces/default/intents/fixture/.aidlc-engine",{recursive:true}); writeFileSync("aidlc/spaces/default/intents/fixture/project-description.json",JSON.stringify(args[args.indexOf("--arguments")+1])); writeFileSync("aidlc/spaces/default/intents/fixture/aidlc-state.md","state"); writeFileSync("aidlc/spaces/default/intents/active-intent","fixture\\n"); console.log(JSON.stringify({ok:true}));`);
    executable(join(tools, "aidlc-orchestrate.ts"), `console.log(JSON.stringify({kind:"ask",gate:true,stage:"workspace-detection"}));`);
    const result = spawnSync(process.execPath, [cli, "--project-dir", root, "--repo", "owner/repo", "--gh-executable", gh, "--active-stages", "requirements-analysis,domain-design,units-generation", "42"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ reason: "intent-created", issueNumber: 42, attempts: 1, hostControl: { through: "units-generation" }, directive: { kind: "ask", gate: true } });
    expect(JSON.parse(readFileSync(join(root, "gh-argv.json"), "utf8"))).toEqual(["issue", "view", "42", "--repo", "github.com/owner/repo", "--json", "number,title,body,labels,state"]);
    const utility = JSON.parse(readFileSync(join(root, "utility-argv.json"), "utf8")); expect(utility.slice(0, 5)).toEqual(["intent-create", "--scope", "feature", "--label", "budget-api"]); expect(utility.filter((value: string) => value === "intent-create")).toHaveLength(1);
    // The real bounded host owns and releases this transferred claim. Simulate
    // that terminal release before the next independent poll.
    unlinkSync(join(root, ".aidlc", "issue-autopilot", "claims", "issue-42.json"));
    const second = spawnSync(process.execPath, [cli, "--project-dir", root, "--repo", "https://github.com/owner/repo.git", "--gh-executable", gh, "--active-stages", "requirements-analysis,domain-design,units-generation", "42"], { cwd: root, encoding: "utf8" });
    expect(second.status).toBe(0); expect(JSON.parse(second.stdout).attempts).toBe(0); expect(readFileSync(join(root, "utility-count"), "utf8")).toBe("1");
  });

  test("exact binding does not confuse Issue #1 with #10", () => {
    const root = mkdtempSync(join(tmpdir(), "d-auto-cli-")), tools = join(root, ".claude", "tools"); mkdirSync(tools, { recursive: true });
    writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ auto: { enabled: true, labelAllowlist: ["aidlc-auto"] }, issueAutopilot: { enabled: true } }));
    mkdirSync(join(root, "aidlc/spaces/default/intents/ten"), { recursive: true });
    writeFileSync(join(root, "aidlc/spaces/default/intents/ten/project-description.json"), JSON.stringify({ description: "Implement GitHub issue #10: Ten" }));
    const gh = join(root, "fake-gh.ts"); executable(gh, `console.log(JSON.stringify({number:1,title:"One",body:"Build one",labels:[{name:"aidlc-auto"}],state:"OPEN"}));`);
    executable(join(tools, "aidlc-utility.ts"), `import {writeFileSync} from "node:fs"; writeFileSync("created","yes"); console.log(JSON.stringify({ok:true}));`);
    executable(join(tools, "aidlc-orchestrate.ts"), `console.log(JSON.stringify({kind:"ask",gate:true}));`);
    const result = spawnSync(process.execPath, [cli, "--project-dir", root, "--repo", "owner/repo", "--gh-executable", gh, "1"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ issueNumber: 1, attempts: 1 });
    expect(readFileSync(join(root, "created"), "utf8")).toBe("yes");
  });

  test("label polling skips an already-bound first Issue and selects the next", () => {
    const root = mkdtempSync(join(tmpdir(), "d-auto-cli-")), tools = join(root, ".claude", "tools"); mkdirSync(tools, { recursive: true });
    writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ auto: { enabled: true, labelAllowlist: ["aidlc-auto"] }, issueAutopilot: { enabled: true } }));
    mkdirSync(join(root, "aidlc/spaces/default/intents/one"), { recursive: true });
    const repository = "github.com/owner/repo", binding = { provider: "github", repository, issueNumber: 1, intakeKey: intakeBindingKey({ provider: "github", repository }, 1) };
    writeFileSync(join(root, "aidlc/spaces/default/intents/one/project-description.json"), JSON.stringify({ description: `Implement GitHub issue #1: One\nAIDLC-INTAKE: ${JSON.stringify(binding)}` }));
    writeFileSync(join(root, "aidlc/spaces/default/intents/one/aidlc-state.md"), "state"); writeFileSync(join(root, "aidlc/spaces/default/intents/active-intent"), "one\n");
    const gh = join(root, "fake-gh.ts"); executable(gh, `const args=process.argv.slice(2); if(args[1]==="list") console.log(JSON.stringify([{number:1,title:"One",labels:[{name:"aidlc-auto"}],state:"OPEN"},{number:2,title:"Two",labels:[{name:"aidlc-auto"}],state:"OPEN"}])); else console.log(JSON.stringify({number:2,title:"Two",body:"Build two",labels:[{name:"aidlc-auto"}],state:"OPEN"}));`);
    executable(join(tools, "aidlc-utility.ts"), `import {writeFileSync} from "node:fs"; writeFileSync("created-argv",JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({ok:true}));`);
    executable(join(tools, "aidlc-orchestrate.ts"), `console.log(JSON.stringify({kind:"ask",gate:true}));`);
    const result = spawnSync(process.execPath, [cli, "--project-dir", root, "--repo", "git@github.com:owner/repo.git", "--gh-executable", gh, "aidlc-auto"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ issueNumber: 2, attempts: 1 });
    expect(readFileSync(join(root, "created-argv"), "utf8")).toContain("GitHub issue #2");
  });

  test("partial intent state is reconcile-required and never creates again", () => {
    const root = mkdtempSync(join(tmpdir(), "d-auto-cli-")), tools = join(root, ".claude", "tools"); mkdirSync(tools, { recursive: true });
    writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ auto: { enabled: true, labelAllowlist: ["aidlc-auto"] }, issueAutopilot: { enabled: true } }));
    const repository = "owner/repo", canonicalRepository = "github.com/owner/repo", binding = { provider: "github", repository: canonicalRepository, issueNumber: 7, intakeKey: intakeBindingKey({ provider: "github", repository: canonicalRepository }, 7) };
    const record = join(root, "aidlc/spaces/default/intents/partial"); mkdirSync(record, { recursive: true });
    writeFileSync(join(record, "project-description.json"), JSON.stringify(`Implement GitHub issue #7: Seven\nAIDLC-INTAKE: ${JSON.stringify(binding)}`));
    const gh = join(root, "fake-gh.ts"); executable(gh, `console.log(JSON.stringify({number:7,title:"Seven",body:"Build seven",labels:[{name:"aidlc-auto"}],state:"OPEN"}));`);
    executable(join(tools, "aidlc-utility.ts"), `import {writeFileSync} from "node:fs"; writeFileSync("unexpected-create","yes"); console.log("{}");`);
    executable(join(tools, "aidlc-orchestrate.ts"), `console.log(JSON.stringify({kind:"ask",gate:true}));`);
    const result = spawnSync(process.execPath, [cli, "--project-dir", root, "--repo", repository, "--gh-executable", gh, "7"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ reason: "reconcile-required", attempts: 0, detail: expect.stringContaining("reconciliation required") });
    expect(() => readFileSync(join(root, "unexpected-create"), "utf8")).toThrow();
  });

  test("a later slash process resumes the durable owner before intake", () => {
    const root = mkdtempSync(join(tmpdir(), "d-auto-resume-")), tools = join(root, ".claude", "tools");
    mkdirSync(join(root, ".aidlc-engine"), { recursive: true }); mkdirSync(tools, { recursive: true });
    writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ auto: { enabled: true, sessionOnly: false, labelAllowlist: ["aidlc-auto"] }, issueAutopilot: { enabled: true } }));
    writeFileSync(join(root, ".aidlc-engine", "d-autopilot-session.json"), JSON.stringify({ startedAt: Date.now(), deadlineMs: 900000, maxSteps: 64, steps: 1, through: "functional-design", claim: { issueNumber: 42, owner: "original-owner", leaseMs: 900000 }, awaitingHuman: true }));
    const gh = join(root, "fake-gh.ts"); executable(gh, `import {writeFileSync} from "node:fs"; writeFileSync("gh-was-called","yes"); console.log("{}");`);
    executable(join(tools, "aidlc-orchestrate.ts"), `console.log(JSON.stringify({kind:"run-stage",stage:"functional-design",receipt:"resumed"}));`);
    executable(join(tools, "aidlc-utility.ts"), `throw new Error("intake must not run");`);
    const result = spawnSync(process.execPath, [cli, "--project-dir", root, "--repo", "owner/repo", "--gh-executable", gh, "42"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ reason: "session-resume", issueNumber: 42, hostControl: { claim: { owner: "original-owner" } }, directive: { receipt: "resumed" } });
    expect(() => readFileSync(join(root, "gh-was-called"), "utf8")).toThrow();
  });
});
