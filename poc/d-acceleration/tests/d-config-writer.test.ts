// Setup's D configuration: a fresh file holds every key of the commented
// example with the setup defaults or the person's answers; an existing file
// keeps every value and gains only missing keys, at the value the project
// already runs with; a file setup cannot rewrite safely is left alone.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETUP_SWITCHES, templateLeaves, writeDConfig } from "../d-config-writer.ts";
import { parseDJsonc, resolveDAutomation, resolveDFeatureFlags, resolveDGitPersistence, resolveDParallel } from "../d-config.ts";

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function product() { const dir = mkdtempSync(join(tmpdir(), "d-config-writer-")); temps.push(dir); mkdirSync(join(dir, ".claude")); return dir; }
const template = readFileSync(join(import.meta.dir, "..", "d-acceleration.example.jsonc"), "utf8");
const file = (P: string) => join(P, ".claude", "d-acceleration.jsonc");

describe("setup D configuration", () => {
  test("every asked switch is a key of the template", () => {
    const leaves = templateLeaves(template);
    for (const key of Object.keys(SETUP_SWITCHES)) expect(leaves.has(key)).toBeTrue();
  });

  test("a fresh file holds every template key and comment, with the setup defaults", () => {
    const P = product();
    const result = writeDConfig(P, ".claude");
    expect(result.action).toBe("written");
    expect(result.added.length).toBe(templateLeaves(template).size);
    const text = readFileSync(file(P), "utf8");
    expect(text.split("\n").filter((line) => line.trim().startsWith("//"))).toEqual(template.split("\n").filter((line) => line.trim().startsWith("//")));
    expect(resolveDFeatureFlags(P)).toMatchObject({ requirementIdValidation: true, mockupPngGeneration: true, prLensReview: false, visualRegression: false });
    expect(resolveDGitPersistence(P)).toMatchObject({ enabled: true, push: false });
    expect(resolveDAutomation(P)).toMatchObject({ enabled: true, sessionOnly: true, assumptionLedger: true });
    expect(resolveDParallel(P).enabled).toBeTrue();
  });

  test("the person's answers replace the defaults, and an unknown switch is refused", () => {
    const P = product();
    writeDConfig(P, ".claude", { "auto.enabled": false, "features.prLensReview": true });
    expect(resolveDAutomation(P).enabled).toBeFalse();
    expect(resolveDFeatureFlags(P).prLensReview).toBeTrue();
    expect(() => writeDConfig(product(), ".claude", { "auto.sessionOnly": false })).toThrow(/unknown setup switch auto.sessionOnly/);
  });

  test("an existing file keeps its values and gains missing keys at the value already in effect", () => {
    const P = product();
    writeFileSync(file(P), '{ "uiDesign": { "refinedMockupSkill": "impeccable" }, "features": { "visualRegression": true } }\n');
    const result = writeDConfig(P, ".claude", { "auto.enabled": true });
    expect(result.action).toBe("completed");
    expect(result.added).toContain("auto.enabled");
    expect(result.added).not.toContain("uiDesign.refinedMockupSkill");
    const value = parseDJsonc(readFileSync(file(P), "utf8")) as Record<string, any>;
    expect(value.uiDesign.refinedMockupSkill).toBe("impeccable");
    expect(value.features.visualRegression).toBeTrue();
    // Completing never switches anything on: these were OFF before the file named them.
    expect(value.auto.enabled).toBeFalse();
    expect(value.gitPersistence.enabled).toBeFalse();
    expect(writeDConfig(P, ".claude").action).toBe("unchanged");
  });

  test("a file with keys outside the standard layout, or a legacy .json, is left exactly as it is", () => {
    const P = product();
    const custom = '{ "gitPersistence": { "enabled": true, "branch": "release" } }\n';
    writeFileSync(file(P), custom);
    const result = writeDConfig(P, ".claude");
    expect(result.action).toBe("left-as-is");
    expect(result.reason).toContain("gitPersistence.branch");
    expect(readFileSync(file(P), "utf8")).toBe(custom);
    const legacy = product();
    writeFileSync(join(legacy, ".claude", "d-acceleration.json"), "{}");
    expect(writeDConfig(legacy, ".claude").action).toBe("left-as-is");
    expect(existsSync(file(legacy))).toBeFalse();
  });

  test("update completes a file but never creates one", () => {
    const P = product();
    expect(writeDConfig(P, ".claude", {}, { create: false }).action).toBe("unchanged");
    expect(existsSync(file(P))).toBeFalse();
  });

  test("other harnesses write into their own directory", () => {
    const P = product();
    mkdirSync(join(P, ".kiro"));
    expect(writeDConfig(P, ".kiro").path).toBe(".kiro/d-acceleration.jsonc");
    expect(existsSync(join(P, ".kiro", "d-acceleration.jsonc"))).toBeTrue();
  });
});
