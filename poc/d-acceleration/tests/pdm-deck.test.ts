// The PdM service proposal deck: every catalog page is built in order, a page
// without material is still built as 未検討, the check refuses a topic-only
// title and other overflows, and the template's own slides never reach the deck.
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tool = join(import.meta.dir, "..", "pdm-deck.py");
const catalog = JSON.parse(readFileSync(join(import.meta.dir, "..", "pdm-deck-catalog.json"), "utf8")) as { sections: { id: string }[]; pages: { id: string; section: string; topic: string }[] };
const hasPptx = spawnSync("python3", ["-c", "import pptx"]).status === 0;
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "pdm-deck-")); temps.push(dir); return dir; };
const run = (...args: string[]) => spawnSync("python3", ["-I", tool, ...args], { encoding: "utf8" });

function ghostSpec(dir: string) {
  const spec = join(dir, "deck.json");
  expect(run("ghost", "--out", spec, "--title", "テスト企画書").status).toBe(0);
  return spec;
}
const edit = (spec: string, change: (pages: Record<string, any>) => void) => {
  const value = JSON.parse(readFileSync(spec, "utf8"));
  change(Object.fromEntries(value.pages.map((page: any) => [page.id, page])));
  writeFileSync(spec, JSON.stringify(value));
};

describe("PdM deck catalog", () => {
  test("every page belongs to a known section and ids are unique", () => {
    const sections = new Set(catalog.sections.map((s) => s.id));
    expect(catalog.pages.every((p) => sections.has(p.section))).toBeTrue();
    expect(new Set(catalog.pages.map((p) => p.id)).size).toBe(catalog.pages.length);
  });
});

describe("PdM deck tool", () => {
  test("ghost writes every catalog page as missing, never overwrites, and a ghost spec passes the check", () => {
    const dir = temp(), spec = ghostSpec(dir);
    const value = JSON.parse(readFileSync(spec, "utf8"));
    expect(value.pages.map((p: any) => p.id)).toEqual(catalog.pages.map((p) => p.id));
    expect(value.pages.every((p: any) => p.status === "missing")).toBeTrue();
    expect(run("ghost", "--out", spec).status).toBe(2);
    const check = run("check", "--spec", spec);
    expect(check.status).toBe(0);
    expect(JSON.parse(check.stdout).counts.missing).toBe(catalog.pages.length);
  });

  test("the check refuses a topic-only title, a missing source, an oversized table, a bad timeline, and a reordered deck", () => {
    const dir = temp(), spec = ghostSpec(dir);
    edit(spec, (pages) => {
      Object.assign(pages["competitors"], { status: "done", title: "競合比較", lead: "", blocks: [{ kind: "table", columns: ["a"], rows: Array.from({ length: 13 }, () => ["x"]) }], sources: [] });
      Object.assign(pages["roadmap"], { status: "partial", title: "段階的に出す", blocks: [{ kind: "timeline", periods: ["1月"], lanes: [{ label: "開発", items: [{ label: "x", start: 0, end: 3 }] }] }], sources: ["plan.md"] });
    });
    const findings = JSON.parse(run("check", "--spec", spec).stdout).findings.join("\n");
    expect(findings).toContain("competitors: the title only names the topic");
    expect(findings).toContain("competitors: a done page needs its sources");
    expect(findings).toContain("table is larger than 12 rows");
    expect(findings).toContain("roadmap: a partial page needs gaps");
    expect(findings).toContain("must span period indexes 0..0");
    const value = JSON.parse(readFileSync(spec, "utf8"));
    value.pages.reverse();
    writeFileSync(spec, JSON.stringify(value));
    expect(JSON.parse(run("check", "--spec", spec).stdout).findings[0]).toContain("every catalog page in catalog order");
  });

  test.skipIf(!hasPptx)("build makes the cover, a divider per section, and every page, with 未検討 pages for missing material", () => {
    const dir = temp(), spec = ghostSpec(dir), out = join(dir, "deck.pptx");
    edit(spec, (pages) => Object.assign(pages["executive-summary"], {
      status: "done", title: "上位プランで高利用層の単価を上げ ARPU を改善する", lead: "単一価格では上位層の価値を収益化できない", sources: ["intent-statement.md"],
      blocks: [{ kind: "cards", items: [{ title: "状況", body: "a" }, { title: "課題", body: "b" }] }, { kind: "bullets", items: ["付議事項"] }],
    }));
    const result = run("build", "--spec", spec, "--out", out);
    expect(result.status).toBe(0);
    const built = JSON.parse(result.stdout);
    const dividers = catalog.sections.filter((s) => s.id !== "summary").length;
    expect(built.slides).toBe(1 + dividers + catalog.pages.length);
    const text = spawnSync("python3", ["-I", "-c", `from pptx import Presentation\nimport sys\np=Presentation(sys.argv[1])\nprint("\\n".join(sh.text_frame.text for s in p.slides for sh in s.shapes if sh.has_text_frame))`, out], { encoding: "utf8" }).stdout;
    expect(text).toContain("上位プランで高利用層の単価を上げ ARPU を改善する");
    expect(text).toContain("背景と現状：未検討");
    expect(text).toContain("「背景と現状」はまだ検討されていません");
  });

  test.skipIf(!hasPptx)("a template's own slides are dropped and its layouts are used; template adoption checks the file", () => {
    const dir = temp(), template = join(dir, "company.pptx");
    // A template with one slide of its own content.
    spawnSync("python3", ["-I", "-c", `from pptx import Presentation\nimport sys\np=Presentation()\ns=p.slides.add_slide(p.slide_layouts[1])\ns.shapes.title.text="CONFIDENTIAL OLD SLIDE"\np.save(sys.argv[1])`, template]);
    const adopted = run("template", "--from", template, "--deck-dir", join(dir, "pdm-deck"));
    expect(adopted.status).toBe(0);
    expect(existsSync(join(dir, "pdm-deck", "template.pptx"))).toBeTrue();
    expect(run("template", "--from", join(dir, "nope.txt"), "--deck-dir", dir).status).toBe(2);
    const spec = ghostSpec(dir), out = join(dir, "deck.pptx");
    expect(run("build", "--spec", spec, "--out", out, "--template", join(dir, "pdm-deck", "template.pptx")).status).toBe(0);
    const titles = spawnSync("python3", ["-I", "-c", `from pptx import Presentation\nimport sys\np=Presentation(sys.argv[1])\nprint("\\n".join(s.shapes.title.text for s in p.slides if s.shapes.title is not None))`, out], { encoding: "utf8" }).stdout;
    expect(titles).not.toContain("CONFIDENTIAL OLD SLIDE");
    expect(titles).toContain("テスト企画書");
  });
});
