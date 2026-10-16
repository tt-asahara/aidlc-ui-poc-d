import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const cli = join(import.meta.dir, "..", "issue-autopilot-cli.ts");
const executable = (path: string, source: string) => { writeFileSync(path, `#!/usr/bin/env bun\n${source}`); chmodSync(path, 0o755); };

describe("packaged Issue autopilot command routing", () => {
  test("exact Issue reaches fixed GH argv and official intent-create adapter once", () => {
    const root = mkdtempSync(join(tmpdir(), "d-auto-cli-")), tools = join(root, ".claude", "tools"); mkdirSync(tools, { recursive: true });
    writeFileSync(join(root, ".claude", "d-acceleration.json"), JSON.stringify({ auto: { enabled: true, sessionOnly: false, through: "inception", labelAllowlist: ["aidlc-auto"] }, issueAutopilot: { enabled: true } }));
    const gh = join(root, "fake-gh.ts"); executable(gh, `import {writeFileSync} from "node:fs"; writeFileSync("gh-argv.json", JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({number:42,title:"Budget API",body:"Build the budget API",labels:[{name:"aidlc-auto"}],state:"OPEN"}));`);
    executable(join(tools, "aidlc-utility.ts"), `import {mkdirSync,readFileSync,writeFileSync} from "node:fs"; const count=Number((()=>{try{return readFileSync("utility-count","utf8")}catch{return "0"}})())+1; writeFileSync("utility-count",String(count)); writeFileSync("utility-argv.json", JSON.stringify(process.argv.slice(2))); mkdirSync("aidlc/spaces/default/intents/fixture/.aidlc-engine",{recursive:true}); writeFileSync("aidlc/spaces/default/intents/fixture/project-description.json",JSON.stringify({description:"GitHub issue #42"})); console.log(JSON.stringify({ok:true}));`);
    executable(join(tools, "aidlc-orchestrate.ts"), `console.log(JSON.stringify({kind:"ask",gate:true,stage:"workspace-detection"}));`);
    const result = spawnSync(process.execPath, [cli, "--project-dir", root, "--gh-executable", gh, "--active-stages", "requirements-analysis,domain-design,units-generation", "42"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ reason: "intent-created", issueNumber: 42, attempts: 1, hostControl: { through: "units-generation" }, directive: { kind: "ask", gate: true } });
    expect(JSON.parse(readFileSync(join(root, "gh-argv.json"), "utf8"))).toEqual(["issue", "view", "42", "--json", "number,title,body,labels,state"]);
    const utility = JSON.parse(readFileSync(join(root, "utility-argv.json"), "utf8")); expect(utility.slice(0, 5)).toEqual(["intent-create", "--scope", "feature", "--label", "budget-api"]); expect(utility.filter((value: string) => value === "intent-create")).toHaveLength(1);
    const second = spawnSync(process.execPath, [cli, "--project-dir", root, "--gh-executable", gh, "--active-stages", "requirements-analysis,domain-design,units-generation", "42"], { cwd: root, encoding: "utf8" });
    expect(second.status).toBe(0); expect(JSON.parse(second.stdout).attempts).toBe(0); expect(readFileSync(join(root, "utility-count"), "utf8")).toBe("1");
  });
});
