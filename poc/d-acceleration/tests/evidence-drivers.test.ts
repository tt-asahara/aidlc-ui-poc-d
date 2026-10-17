// The real-model evidence drivers must keep using today's interfaces even when
// they are not re-run: no removed core settler, no directive handoff to
// bootstrap, and a hook-recorded delegation turn before every grant.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const D = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(D, path), "utf8");

describe("delegated-question evidence drivers track current interfaces", () => {
  for (const driver of ["evidence/delegated-questions/run-e2e.ts", "evidence/delegated-questions/run-per-unit.ts"]) {
    test(driver, () => {
      const source = read(driver);
      expect(source).not.toMatch(/join\([\w.]+, "aidlc-ai-answers\.ts"\)/);
      expect(source).not.toContain('"bootstrap", "--directive-file"');
      expect(source).not.toContain('emitted === "AI_QUESTION_ANSWERED"');
      expect(source).toContain("ai-question-answers.ts");
      expect(source).toContain("record-human-turn");
      expect(source.indexOf("record-human-turn")).toBeLessThan(source.indexOf('"grant"'));
    });
  }
  test("docs mark the pre-restore records historical", () => {
    expect(read("evidence/model-routing/README.md")).toMatch(/`approvalAssessorLaunch`[^|]*historical, removed/);
    expect(read("delegated-questions.md")).toContain("**Historical record.**");
  });
});
