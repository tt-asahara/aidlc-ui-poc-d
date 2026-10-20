// The packager's D projection guard, exercised against real trees: a D runtime
// file may never land on, or share a name with, a file the core projection wrote.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { D_ACCELERATION_RUNTIME, dProjectionCollisions, dProjectionPath, projectDAcceleration, projectedPaths } from "../d-projection.ts";

const repo = join(import.meta.dir, "..", "..", "..");
function tree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "d-projection-"));
  for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); }
  return root;
}
const source = tree({ "run.ts": "export const run = 1;\n", "reader.ts": 'import { latestPersonTurn } from "../../core/tools/aidlc-lib.ts";\nexport { latestPersonTurn };\n', "aidlc-lib.ts": "export {};\n", "policy.json": "{}\n" });

describe("D acceleration projection guard", () => {
  test("refuses a D file whose destination the core projection already wrote, and writes nothing", () => {
    const projected = tree({ "tools/aidlc-lib.ts": "core\n", "tools/d-acceleration/run.ts": "core-owned\n" });
    expect(() => projectDAcceleration(projected, source, ["policy.json", "run.ts"])).toThrow("tools/d-acceleration/run.ts (path already projected)");
    expect(readFileSync(join(projected, "tools/d-acceleration/run.ts"), "utf8")).toBe("core-owned\n");
    expect(existsSync(join(projected, "tools/d-acceleration/policy.json"))).toBeFalse();
  });

  test("refuses a D file that shares a basename with a projected core file", () => {
    const projected = tree({ "tools/aidlc-lib.ts": "core\n" });
    expect(() => projectDAcceleration(projected, source, ["aidlc-lib.ts"])).toThrow("same name as projected tools/aidlc-lib.ts");
    expect(existsSync(join(projected, "tools/d-acceleration"))).toBeFalse();
  });

  test("projects a collision-free runtime and points core imports at the sibling engine", () => {
    const projected = tree({ "tools/aidlc-lib.ts": "core\n" });
    projectDAcceleration(projected, source, ["run.ts", "reader.ts", "policy.json"]);
    expect(readFileSync(join(projected, "tools/d-acceleration/reader.ts"), "utf8")).toContain('from "../aidlc-lib.ts"');
    expect(readFileSync(join(projected, "tools/d-acceleration/run.ts"), "utf8")).toBe("export const run = 1;\n");
  });

  test("D hook adapters cannot overwrite a core hook and resolve their D module inside the runtime", () => {
    const source = tree({ "hooks/aidlc-d-example.ts": 'export { run } from "../example.ts";\n', "example.ts": "export const run = () => 0;\n" });
    const occupied = tree({ "hooks/aidlc-d-example.ts": "core-owned\n" });
    expect(() => projectDAcceleration(occupied, source, ["example.ts", "hooks/aidlc-d-example.ts"])).toThrow("path already projected");
    expect(existsSync(join(occupied, "tools/d-acceleration/example.ts"))).toBeFalse();
    const projected = tree({ "hooks/aidlc-write-audit-log.ts": "core\n" });
    projectDAcceleration(projected, source, ["example.ts", "hooks/aidlc-d-example.ts"]);
    expect(readFileSync(join(projected, "hooks/aidlc-d-example.ts"), "utf8")).toContain('from "../tools/d-acceleration/example.ts"');
    expect(readFileSync(join(projected, "hooks/aidlc-write-audit-log.ts"), "utf8")).toBe("core\n");
  });

  const built = join(repo, "dist", "claude", ".claude");
  test.skipIf(!existsSync(built))("the shipped runtime does not collide with the real built core projection", () => {
    const owned = new Set(D_ACCELERATION_RUNTIME.map(dProjectionPath));
    const core = projectedPaths(built).filter((path) => !owned.has(path));
    expect(core).toContain("tools/aidlc-lib.ts");
    expect(dProjectionCollisions(core, D_ACCELERATION_RUNTIME)).toEqual([]);
    expect(dProjectionCollisions(core, [...D_ACCELERATION_RUNTIME, "aidlc-orchestrate.ts"])).toEqual(["tools/d-acceleration/aidlc-orchestrate.ts (same name as projected tools/aidlc-orchestrate.ts)"]);
  });
});
