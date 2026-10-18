/**
 * Feature 21: the one owner of "which official acceptance-criteria IDs does the
 * approved stories artifact define".
 *
 * The official user-stories stage (core 6a378b53,
 * `aidlc-common/stages/inception/user-stories.md` Step 8) gives each criterion a
 * three-segment `AC{story-group}.{story-seq}.{criterion-seq}` ID, for example
 * `AC1.1.1`; the core traceability sensor and `aidlc-shared/verification.md`
 * use the same grammar. This parser accepts exactly that ASCII grammar and
 * never normalizes, renumbers, or guesses: no LLM, no similarity, no case or
 * width folding.
 *
 * Block structure comes from the one Markdown interpreter (`markdownBlocks` in
 * core `aidlc-lib.ts`). An ID is DEFINED when it is the first token of a
 * definition position: the first line of a list item, a heading, or the first
 * cell of a table row. Anything else (prose, continuation lines, fenced or
 * indented code, HTML, comments) is a reference and is ignored, so a story that
 * mentions another story's criterion ("US6.2 の AC6.2.6 は …") is not a second
 * definition. The parser does not depend on heading wording, so English
 * "Acceptance Criteria" and Japanese "受入条件" stories parse identically.
 *
 * Lookalikes at a definition position are findings, never IDs: full-width
 * `ＡＣ１.１.１` / `AC1．1．1`, lower-case `ac1.1.1`, legacy `AC-1-1-1`, and
 * wrong segment counts such as `AC1.1` or `AC1.1.1.1` (NFKC and case folding
 * are used only to DETECT such a token, never to accept it).
 */
import { markdownBlocks } from "../../core/tools/aidlc-lib.ts";

/** The official grammar, anchored. ASCII digits only. */
export const OFFICIAL_AC_ID = /^AC[0-9]+\.[0-9]+\.[0-9]+$/;

export interface OfficialAcFinding {
  code: "DUPLICATE_OFFICIAL_AC" | "MALFORMED_OFFICIAL_AC";
  value: string;
  line: number;
}

export interface OfficialAcceptanceCriteria {
  /** Defined IDs in document order, each once. */
  ids: string[];
  findings: OfficialAcFinding[];
}

// Wrappers allowed around the leading token: emphasis and code spans.
const WRAPPER = /^(?:\*\*|__|\*|_|`)+/;
// The leading token of a definition position: everything up to whitespace,
// a closing wrapper, or a separator.
const TOKEN = /^[^\s*_`:：|()（）\[\]、,]+/;
// After NFKC + upper-casing, something that is trying to be an AC ID.
const LOOKS_LIKE_AC = /^AC[-.]?[0-9]/;

function leadingToken(text: string): string | null {
  const unwrapped = text.trimStart().replace(WRAPPER, "");
  const match = TOKEN.exec(unwrapped);
  if (!match) return null;
  // A sentence-final period after the ID ("AC1.1.1. Given …") is punctuation.
  return match[0].replace(/\.$/, "");
}

function definitionText(raw: string, kind: string, contentStart: number): string | null {
  const content = raw.slice(contentStart);
  if (kind === "heading") return content.replace(/^\s{0,3}#{1,6}(?=\s|$)/, "");
  if (kind === "table") {
    const row = content.trim();
    if (/^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(row)) return null; // delimiter row
    return row.replace(/^\|/, "").split("|")[0] ?? "";
  }
  return content;
}

export function parseOfficialAcceptanceCriteria(markdown: string): OfficialAcceptanceCriteria {
  const blocks = markdownBlocks(markdown);
  const raw = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const ids: string[] = [];
  const seen = new Set<string>();
  const findings: OfficialAcFinding[] = [];
  const startedItems = new Set<number>();
  let previousBlock = Number.NaN;

  raw.forEach((source, index) => {
    const line = blocks.lines[index];
    const blockStart = line.block !== previousBlock;
    previousBlock = line.block;
    if (!["paragraph", "heading", "table"].includes(line.kind)) return;
    const item = [...line.containers].reverse().find((container) => container.kind === "listItem");
    let position = false;
    if (line.kind === "heading" || line.kind === "table") position = true;
    else if (item && item.kind === "listItem" && !startedItems.has(item.id) && blockStart) position = true;
    if (item && item.kind === "listItem") startedItems.add(item.id);
    if (!position) return;
    // Inline HTML comments are invisible; drop them before reading the token.
    let visible = source;
    for (const span of [...line.invisible].reverse()) {
      if (span.kind === "htmlComment" && span.tokenStartLine === index && span.tokenEndLine === index) visible = visible.slice(0, span.start) + " ".repeat(span.end - span.start) + visible.slice(span.end);
    }
    const text = definitionText(visible, line.kind, line.contentStart);
    if (text === null) return;
    const token = leadingToken(text);
    if (!token) return;
    if (OFFICIAL_AC_ID.test(token)) {
      if (seen.has(token)) findings.push({ code: "DUPLICATE_OFFICIAL_AC", value: token, line: index + 1 });
      else { seen.add(token); ids.push(token); }
      return;
    }
    if (LOOKS_LIKE_AC.test(token.normalize("NFKC").toUpperCase())) findings.push({ code: "MALFORMED_OFFICIAL_AC", value: token, line: index + 1 });
  });
  return { ids, findings };
}
