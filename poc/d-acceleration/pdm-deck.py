#!/usr/bin/env python3
"""A product manager's service proposal deck (PowerPoint), built from a JSON spec.

  python3 -I pdm-deck.py template --from company.pptx --deck-dir <pdm-deck folder>
  python3 -I pdm-deck.py ghost --out deck.json [--title T]
  python3 -I pdm-deck.py check --spec deck.json
  python3 -I pdm-deck.py outline --spec deck.json   (the titles top to bottom, then each page as text)
  python3 -I pdm-deck.py build --spec deck.json --out deck.pptx [--template company.pptx] [--only id,id]
    (--only builds just those pages, for a quick look; the deck itself is always every page)

The page list is pdm-deck-catalog.json: every page is built in catalog order.
A page the spec leaves without content is still built, marked 未検討, with the
questions it should answer, the stages that fill it and the intended shape, so a
missing consideration is visible rather than silently absent. The model writes
the spec; this tool owns layout, the page order, page numbers and the checks, so
the same spec always gives the same deck.

The look follows the consulting conventions: the conclusion is the title and
there is no subtitle line under it; facts sit on the left and the implication on
the right with a triangle between; tables show their axis with rules, not fills;
one highlight per page; no rounded corners; body text 12pt or larger; sources sit
on the line above the footer; a short page is centred, never stretched.

With --template, the deck is built on that file's slide masters and theme: its
existing slides are removed, its layouts (表紙, a title-only body page) are used,
and every colour is a theme slot, so the company's brand comes from its own file
and nothing of it is written here. Needs python-pptx.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, "pdm-deck-catalog.json")
STATUSES = ("done", "partial", "missing")
BLOCK_KINDS = ("summary", "bullets", "table", "cards", "stats", "steps", "formula", "callout", "tree", "matrix2x2", "timeline",
               "chart_bar", "image", "before_after", "implication", "journey", "persona", "ecosystem", "canvas", "funnel", "tornado",
               "scatter", "from_to", "two_tier", "chain", "options", "evidence", "qa", "house", "voices")
CHART_MODES = ("clustered", "stacked", "waterfall", "line")
# What each richer block must carry: (key, minimum count, maximum count); a count of 0 means the key is a single value.
SHAPES = {
    "journey": [("stages", 3, 7)], "persona": [("name", 0, 0)], "ecosystem": [("center", 0, 0), ("actors", 2, 6)],
    "canvas": [("cells", 0, 0)], "funnel": [("stages", 3, 7)], "tornado": [("items", 2, 8), ("base", 0, 0), ("unit", 0, 0)],
    "scatter": [("points", 2, 14), ("x", 0, 0), ("y", 0, 0)], "from_to": [("rows", 2, 6)], "two_tier": [("steps", 2, 6)],
    "chain": [("rows", 2, 6)], "options": [("question", 0, 0), ("options", 2, 4)], "evidence": [("items", 2, 6)],
    "qa": [("items", 2, 6)], "voices": [("items", 2, 6)], "house": [("roof", 0, 0), ("pillars", 2, 5), ("foundation", 0, 0)],
}
OPERATORS = ("×", "+", "−", "÷")
# Words that read as machine-written in a Japanese business deck: empty emphasis, katakana padding,
# slogans, stock openings and closings, and the names of thinking frameworks shown on the page.
AI_SMELL = ("非常に", "極めて", "圧倒的", "画期的", "革新的", "次世代の", "と言っても過言ではない", "に他なりません", "シームレス",
            "シナジー", "エンドツーエンド", "ブラッシュアップ", "寄り添", "伴走", "二人三脚", "邁進", "さらなる高み", "昨今",
            "変化の激しい時代", "現代において", "することが可能", "と言えるでしょう", "と考えられます", "詳細は別途", "追ってご連絡",
            "今後検討してまいります", "いかがでしたでしょうか", "Situation", "Complication", "Resolution", " — ",
            "という点において", "の観点から", "重要なポイント", "鍵となる", "肝となる", "な側面", "に資する", "させていただきます",
            "御社", "創出", "担保")
# Nouns that fold a verb away: a line ending in one says nobody does anything ("〜の強化").
FOLDED_ENDINGS = ("の強化", "の推進", "の向上", "の実現", "の最適化", "の効率化", "の活用", "の検討", "への対応", "の促進")
WORK_TITLES = ("を整理する", "に分解する", "について", "を示す", "を説明する", "をまとめる", "の整理", "の概要")
VAGUE_VERDICTS = ("十分", "限定的", "問題ない", "重要である", "大きい", "小さい")
CONNECTIVES = ("また", "さらに", "加えて", "このように", "したがって", "そのため")
PLACEHOLDERS = ("［要確認", "[要確認", "TODO", "TBD", "◯◯", "○○", "XX", "YYYY")
CHART_LIMITS = {"clustered": 3, "stacked": 5, "categories": 12}
UNITS = {"兆": 1e12, "億": 1e8, "万": 1e4, "千": 1e3}


def parse_number(value):
    """A number as a deck writes it ("約1,600万人", "26%", "980円"), or None."""
    import re
    text = str(value).replace(",", "").replace("，", "").strip()
    match = re.search(r"([-−]?[0-9]+(?:\.[0-9]+)?)\s*(兆|億|万|千)?\s*(%|％|pt)?", text)
    if not match:
        return None
    number = float(match.group(1).replace("−", "-")) * UNITS.get(match.group(2) or "", 1)
    return number / 100 if match.group(3) in ("%", "％") else number
TYPED_MARKS = ("・", "•", "■", "□", "- ", "－", "※")
COUNTERS = "つ本段階点層案件項目社"
KANJI_NUMBERS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
LIMITS = {"title": 60, "bullets": 8, "bullet": 80, "rows": 10, "cols": 6, "cell": 60, "cards": 4, "card_points": 5,
          "stats": 4, "steps": 6, "summary": 5, "details": 3, "implication": 5, "gaps": 3}
RATINGS = {"●": 1.0, "◕": 0.75, "◑": 0.5, "◔": 0.25, "○": 0.0}
RATING_LABELS = {"●": "満たす", "◕": "ほぼ満たす", "◑": "一部満たす", "◔": "わずか", "○": "満たさない"}
HEAT = ("高", "中", "低")


def load_catalog():
    with open(CATALOG, encoding="utf-8") as handle:
        return json.load(handle)


def ghost(title):
    catalog = load_catalog()
    return {
        "schema": 1, "title": title or "サービス企画書", "subtitle": "", "date": "", "organization": "",
        "pages": [{"id": p["id"], "status": "missing", "title": "", "blocks": [], "sources": [], "gaps": []} for p in catalog["pages"]],
    }


# ---------------------------------------------------------------------------
# check
# ---------------------------------------------------------------------------
def _len(value):
    return len(str(value or ""))


def _item_text(item):
    return item.get("text") if isinstance(item, dict) else item


def check_block(page_id, index, block, base_dir, page_ids, problems):
    where = f"{page_id} block {index + 1}"
    kind = block.get("kind")
    if kind not in BLOCK_KINDS:
        problems.append(f"{where}: kind must be one of {', '.join(BLOCK_KINDS)}")
        return
    items = block.get("items") or []

    def need_items(limit):
        if not items:
            problems.append(f"{where}: {kind} has no items")
        elif len(items) > LIMITS[limit]:
            problems.append(f"{where}: {len(items)} {kind} items; at most {LIMITS[limit]} fit")

    if kind in ("bullets", "implication"):
        need_items("bullets" if kind == "bullets" else "implication")
        if any(_len(_item_text(item)) > LIMITS["bullet"] for item in items):
            problems.append(f"{where}: a bullet is longer than {LIMITS['bullet']} characters; one point per line")
        if len(items) == 1 and kind == "bullets":
            problems.append(f"{where}: a single bullet is a sentence; use callout, or list two or more points")
    elif kind == "summary":
        need_items("summary")
        for item in items:
            if not item.get("text"):
                problems.append(f"{where}: every summary row needs text (the conclusion of one issue)")
            if len(item.get("details") or []) > LIMITS["details"]:
                problems.append(f"{where}: a summary row has more than {LIMITS['details']} details")
            if item.get("ref") and item["ref"] not in page_ids:
                problems.append(f"{where}: ref {item['ref']!r} is not a page id")
    elif kind == "table":
        columns, rows = block.get("columns") or [], block.get("rows") or []
        if not columns or not rows:
            problems.append(f"{where}: table needs columns and rows")
        if len(columns) > LIMITS["cols"] or len(rows) > LIMITS["rows"]:
            problems.append(f"{where}: table is larger than {LIMITS['rows']} rows x {LIMITS['cols']} columns; split the page or merge rows")
        if columns and not str(columns[0]).strip():
            problems.append(f"{where}: name the row axis in the first column heading (the top-left cell is never blank)")
        for row in rows:
            if len(row) != len(columns):
                problems.append(f"{where}: a row has {len(row)} cells for {len(columns)} columns")
                break
            if any(_len(cell) > LIMITS["cell"] for cell in row):
                problems.append(f"{where}: a cell is longer than {LIMITS['cell']} characters")
                break
        for col in block.get("heat") or []:
            if not isinstance(col, int) or not 0 < col < len(columns) or any(str(row[col]) not in HEAT for row in rows if len(row) == len(columns)):
                problems.append(f"{where}: heat column {col!r} must be a column index whose cells are 高, 中 or 低")
        highlight = block.get("highlight_row")
        if highlight is not None and not (isinstance(highlight, int) and 0 <= highlight < len(rows)):
            problems.append(f"{where}: highlight_row must be a row index")
        if block.get("total_row") and len(rows) >= 2:
            for c in range(1, len(columns)):
                values = [parse_number(row[c]) for row in rows if len(row) == len(columns)]
                if None not in values and abs(sum(values[:-1]) - values[-1]) > 0.01 * max(abs(values[-1]), 1.0):
                    problems.append(f"{where}: the total row does not add up in column {columns[c]!r}: the rows give {sum(values[:-1]):,.4g}, the total says {values[-1]:,.4g}")
    elif kind == "cards":
        need_items("cards")
        for item in items:
            points = item.get("points") or ([item["body"]] if item.get("body") else [])
            if not item.get("title") or not points:
                problems.append(f"{where}: every card needs a title and points")
            if len(points) > LIMITS["card_points"] or any(_len(point) > LIMITS["bullet"] for point in points):
                problems.append(f"{where}: a card has more than {LIMITS['card_points']} points or a point over {LIMITS['bullet']} characters")
    elif kind == "stats":
        need_items("stats")
        if any(not item.get("value") or not item.get("label") for item in items):
            problems.append(f"{where}: every stat needs a value and a label")
        if any(_len(item.get("value")) > 10 for item in items):
            problems.append(f"{where}: a stat value is longer than 10 characters; put the unit in the label")
    elif kind == "steps":
        need_items("steps")
        if any(not item.get("title") for item in items):
            problems.append(f"{where}: every step needs a title (a verb phrase)")
        if any(_len(item.get("title")) > 16 for item in items):
            problems.append(f"{where}: a step title is longer than 16 characters")
    elif kind == "callout":
        if not block.get("text"):
            problems.append(f"{where}: callout has no text")
    elif kind == "tree":
        children = block.get("children") or []
        if not block.get("root") or len(children) < 2:
            problems.append(f"{where}: tree needs a root and at least two children")
        if len([g for c in children for g in (c.get("children") or [None])]) > 8:
            problems.append(f"{where}: tree has more than 8 leaves; split it")
        if any(len(c.get("children") or []) == 1 for c in children):
            problems.append(f"{where}: a branch with one child is not a split; give it two or more, or none")
    elif kind == "matrix2x2":
        if not block.get("x") or not block.get("y") or len(block.get("quadrants") or []) != 4:
            problems.append(f"{where}: matrix2x2 needs x, y, and four quadrants (top-left, top-right, bottom-left, bottom-right)")
        if sum(1 for q in block.get("quadrants") or [] if q.get("highlight")) > 1:
            problems.append(f"{where}: highlight one quadrant at most")
    elif kind == "timeline":
        periods, lanes = block.get("periods") or [], block.get("lanes") or []
        if not periods or not lanes:
            problems.append(f"{where}: timeline needs periods and lanes")
        if len(periods) > 12:
            problems.append(f"{where}: timeline has more than 12 periods")
        for lane in lanes:
            for item in lane.get("items") or []:
                start, end = item.get("start", -1), item.get("end", -1)
                if not (isinstance(start, int) and isinstance(end, int) and 0 <= start <= end < len(periods)):
                    problems.append(f"{where}: timeline item {item.get('label')!r} must span period indexes 0..{len(periods) - 1}")
    elif kind in SHAPES:
        for key, low, high in SHAPES[kind]:
            value = block.get(key)
            if value in (None, "", [], {}):
                problems.append(f"{where}: {kind} needs {key}")
            elif high and not low <= len(value) <= high:
                problems.append(f"{where}: {kind} {key} must have {low} to {high} entries")
        if kind == "options" and sum(1 for o in block.get("options") or [] if o.get("recommended")) != 1:
            problems.append(f"{where}: mark exactly one option as recommended")
        if kind == "ecosystem":
            names = {"center"} | {a.get("label") for a in block.get("actors") or []}
            for flow in block.get("flows") or []:
                if flow.get("from") not in names or flow.get("to") not in names or "center" not in (flow.get("from"), flow.get("to")):
                    problems.append(f"{where}: a flow runs between the centre and one actor (from/to: center or an actor label)")
                    break
        if kind == "canvas" and not set(block.get("cells") or {}) <= {"partners", "activities", "resources", "value", "relationships", "channels", "segments", "costs", "revenue"}:
            problems.append(f"{where}: canvas cells are partners, activities, resources, value, relationships, channels, segments, costs, revenue")
        if kind == "journey" and any(not -2 <= float(s.get("emotion", 0)) <= 2 for s in block.get("stages") or []):
            problems.append(f"{where}: a journey stage's emotion runs from -2 (worst) to 2 (best)")
    elif kind == "formula":
        terms, ops = block.get("terms") or [], block.get("ops") or []
        if len(terms) < 2 or len(terms) > 4 or len(ops) != len(terms) - 1 or any(op not in OPERATORS for op in ops):
            problems.append(f"{where}: formula needs 2 to 4 terms, one operator ({' '.join(OPERATORS)}) between each pair, and a result")
        if not (block.get("result") or {}).get("value") or any(not t.get("value") or not t.get("label") for t in terms):
            problems.append(f"{where}: every formula term and the result need a value and a label")
        elif len(ops) == len(terms) - 1:
            numbers = [parse_number(t["value"]) for t in terms]
            result = parse_number(block["result"]["value"])
            if None not in numbers and result is not None:
                total = numbers[0]
                for op, number in zip(ops, numbers[1:]):
                    total = {"×": total * number, "+": total + number, "−": total - number, "÷": total / number if number else float("nan")}[op]
                if not abs(total - result) <= 0.05 * max(abs(result), 1e-9):
                    problems.append(f"{where}: the formula does not hold: the terms give {total:,.4g}, the result says {result:,.4g}")
    elif kind == "chart_bar":
        categories, series = block.get("categories") or [], block.get("series") or []
        mode = block.get("mode", "clustered")
        if not categories or not series or any(len(s.get("values") or []) != len(categories) for s in series):
            problems.append(f"{where}: chart_bar needs categories and one value per category in every series")
        if mode not in CHART_MODES:
            problems.append(f"{where}: chart_bar mode must be one of {', '.join(CHART_MODES)}")
        if mode in CHART_LIMITS and len(series) > CHART_LIMITS[mode]:
            problems.append(f"{where}: more than {CHART_LIMITS[mode]} series in a {mode} chart; split it into small charts or fold the rest into その他")
        if len(categories) > CHART_LIMITS["categories"]:
            problems.append(f"{where}: more than {CHART_LIMITS['categories']} categories; fold the small ones into その他")
        elif mode == "waterfall":
            values = (series[0].get("values") or []) if series else []
            if len(series) != 1 or len(values) < 3:
                problems.append(f"{where}: a waterfall has one series: the start, the changes, and the end")
            elif abs(sum(values[:-1]) - values[-1]) > 1e-6 * max(1.0, abs(values[-1])):
                problems.append(f"{where}: the waterfall does not add up: start plus changes is {sum(values[:-1]):g}, the end is {values[-1]:g}")
        if not block.get("unit"):
            problems.append(f"{where}: chart_bar needs unit (what is measured, the unit and the period, e.g. 売上、億円、年度)")
    elif kind == "image":
        path = block.get("path")
        if not path or not os.path.isfile(os.path.join(base_dir, path)):
            problems.append(f"{where}: image {path!r} does not exist (paths are relative to the spec)")
    elif kind == "before_after":
        for side in ("before", "after"):
            path = (block.get(side) or {}).get("path")
            if not path or not os.path.isfile(os.path.join(base_dir, path)):
                problems.append(f"{where}: {side} image {path!r} does not exist (paths are relative to the spec)")


def block_texts(block):
    """Every sentence a block puts on the page, for the wording checks and the outline."""
    out = []
    for key in ("heading", "text", "root", "unit", "x", "y"):
        if block.get(key):
            out.append(str(block[key]))
    for item in block.get("items") or []:
        if isinstance(item, dict):
            out += [str(item[k]) for k in ("text", "title", "label", "value", "caption", "body", "note") if item.get(k)]
            out += [str(v) for k in ("details", "points", "sub", "items") for v in item.get(k) or []]
        else:
            out.append(str(item))
    out += [str(c) for c in block.get("columns") or []] + [str(c) for row in block.get("rows") or [] for c in row]
    for child in block.get("children") or []:
        out.append(str(child.get("label", "")))
        out += [str(g.get("label", "")) for g in child.get("children") or []]
    for quad in block.get("quadrants") or []:
        out += [str(quad.get("label", ""))] + [str(i) for i in quad.get("items") or []]
    for lane in block.get("lanes") or []:
        out += [str(lane.get("label", ""))] + [str(i.get("label", "")) for i in lane.get("items") or []]
    for term in (block.get("terms") or []) + ([block["result"]] if block.get("result") else []):
        out += [str(term.get("value", "")), str(term.get("label", ""))]
    for side in ("before", "after"):
        out += [str(p) for p in (block.get(side) or {}).get("points") or []]
    return [t for t in out if t]


def counted(title):
    """The number a title promises ("3つの層", "4段階"), or None."""
    import re
    match = re.search(r"([0-9０-９]+|[一二三四五六七八九十])\s*(?:つ|本|段階|点|層|案|件|項目|社)", title)
    if not match:
        return None
    raw = match.group(1)
    return KANJI_NUMBERS.get(raw) or int(raw.translate(str.maketrans("０１２３４５６７８９", "0123456789")))


def main_count(block):
    kind = block.get("kind")
    if kind in ("cards", "steps", "summary", "stats"):
        return len(block.get("items") or [])
    if kind == "table":
        return len(block.get("rows") or [])
    if kind == "tree":
        return len(block.get("children") or [])
    return None


def warnings_for(spec):
    """Things a reader trips over that a rule cannot settle alone; build still runs."""
    found, kinds, figures = [], [], {}
    for page in spec.get("pages") or []:
        pid = page.get("id")
        if page.get("status") == "missing" or pid == "agenda":
            kinds.append(None)
            continue
        blocks = page.get("blocks") or []
        texts = [page.get("title") or ""] + [t for b in blocks for t in block_texts(b)] + list(page.get("notes") or [])
        smells = sorted({word.strip() for word in AI_SMELL for t in texts if word in t})
        if smells:
            found.append(f"{pid}: reads as machine-written ({'、'.join(smells)}); say it plainly")
        bullets_ = [str(i.get("text") if isinstance(i, dict) else i) for b in blocks if b.get("kind") in ("bullets", "implication") for i in b.get("items") or []]
        if any(t.rstrip("。").endswith(("です", "ます")) for t in bullets_):
            found.append(f"{pid}: write bullets in plain form (である調), not です・ます")
        listed = bullets_ + [str(v) for b in blocks for i in b.get("items") or [] if isinstance(i, dict) for k in ("details", "points", "sub") for v in i.get(k) or []]
        if any(t.lstrip().startswith(TYPED_MARKS) for t in listed):
            found.append(f"{pid}: a line starts with a typed mark (・ • ■ - ※); the tool draws the bullets")
        if any("。" in t.rstrip("。") for b in blocks if b.get("kind") == "table" for row in b.get("rows") or [] for t in map(str, row)):
            found.append(f"{pid}: one sentence per table cell")
        promised = counted(page.get("title") or "")
        actual = next((main_count(b) for b in blocks if main_count(b) is not None), None)
        if promised is not None and actual is not None and promised != actual:
            found.append(f"{pid}: the title says {promised} but the page shows {actual}; check that they count the same thing")
        if any(b.get("kind") == "chart_bar" for b in blocks) and not any(b.get("kind") == "implication" for b in blocks):
            found.append(f"{pid}: a chart page says what the chart means; add an implication block")
        lines = bullets_ + [str(v) for b in blocks for i in b.get("items") or [] if isinstance(i, dict) for k in ("details", "points") for v in i.get(k) or []]
        folded = [t for t in lines if t.rstrip("。").endswith(FOLDED_ENDINGS)]
        if folded:
            found.append(f"{pid}: say who does what instead of a folded noun (「{folded[0]}」)")
        if any(t.endswith("。") and t.count("。") == 1 for t in lines):
            found.append(f"{pid}: a one-sentence bullet ends without 「。」")
        for b in blocks:
            items = [str(i.get("text") if isinstance(i, dict) else i) for i in b.get("items") or [] if isinstance(i, (str, dict))]
            if sum(1 for t in items if t.startswith(CONNECTIVES)) >= 2:
                found.append(f"{pid}: bullets that start with また・さらに・加えて read as padding; cut the connective")
            plain = [t.rstrip("。") for t in items if t and b.get("kind") in ("bullets", "implication")]
            verbs = [t for t in plain if t.endswith(("る", "た", "い", "う", "く", "す", "つ", "む", "ぶ", "ぐ", "ない", "だ", "である"))]
            if len(plain) >= 3 and 0 < len(verbs) < len(plain):
                found.append(f"{pid}: the bullets mix sentence and noun endings; end them the same way")
        title = (page.get("title") or "").strip()
        if title.endswith(WORK_TITLES):
            found.append(f"{pid}: the title describes the work, not the finding; write what the page concludes")
        if any(word in title for word in VAGUE_VERDICTS) and not any(ch.isdigit() for ch in title):
            found.append(f"{pid}: the title judges (十分・限定的・大きい…) without a number; put the evidence in it")
        if any(mark in t for t in texts for mark in PLACEHOLDERS):
            found.append(f"{pid}: an unfinished mark (［要確認］, TODO, ◯◯) is still on the page")
        if pid == "next-steps":
            columns = [str(c) for b in blocks if b.get("kind") == "table" for c in b.get("columns") or []]
            if not any("担当" in c for c in columns) or not any("期限" in c or "時期" in c for c in columns):
                found.append(f"{pid}: every next step needs an owner (担当) and a date (期限)")
        if pid == "decisions" and not any(b.get("highlight_row") is not None for b in blocks if b.get("kind") == "table"):
            found.append(f"{pid}: mark the recommended option (highlight_row)")
        if pid == "risks" and not any("対策" in str(c) or "対応" in str(c) for b in blocks if b.get("kind") == "table" for c in b.get("columns") or []):
            found.append(f"{pid}: every risk needs its countermeasure (a 対策 column)")
        if pid == "executive-summary":
            refs = [i.get("ref") for b in blocks if b.get("kind") == "summary" for i in b.get("items") or []]
            if refs and "decisions" not in refs:
                found.append(f"{pid}: end the summary with what the reader is asked to decide (a row with ref decisions)")
        for b in blocks:
            for term in (b.get("terms") or []) + ([b["result"]] if b.get("result") else []) + [i for i in b.get("items") or [] if isinstance(i, dict) and b.get("kind") == "stats"]:
                label, value = str(term.get("label", "")).strip(), parse_number(term.get("value", ""))
                if label and value is not None:
                    figures.setdefault(label, {}).setdefault(value, pid)
        main = next((b.get("kind") for b in blocks if b.get("kind") != "implication"), None)
        kinds.append(main)
        if main and main != "persona" and len(kinds) >= 3 and kinds[-1] == kinds[-2] == kinds[-3]:  # personas are compared side by side on purpose
            found.append(f"{pid}: the third page in a row drawn as {main}; vary the shape to fit what each page shows")
    for label, values in figures.items():
        if len(values) > 1:
            where = "、".join(f"{pid} {value:,.4g}" for value, pid in values.items())
            found.append(f"the same figure 「{label}」 has different values across pages ({where})")
    return found


def check(spec, base_dir):
    catalog, problems = load_catalog(), []
    pages = spec.get("pages") or []
    expected = [p["id"] for p in catalog["pages"]]
    got = [p.get("id") for p in pages]
    if got != expected:
        missing = [i for i in expected if i not in got]
        unknown = [i for i in got if i not in expected]
        problems.append("pages must be every catalog page in catalog order" + (f"; missing: {', '.join(missing)}" if missing else "") + (f"; unknown: {', '.join(map(str, unknown))}" if unknown else ""))
    topics = {p["id"]: p["topic"] for p in catalog["pages"]}
    counts = {status: 0 for status in STATUSES}
    titles = {}
    for page in pages:
        pid, status = page.get("id"), page.get("status")
        if status not in STATUSES:
            problems.append(f"{pid}: status must be one of {', '.join(STATUSES)}")
            continue
        counts[status] += 1
        if page.get("lead"):
            problems.append(f"{pid}: lead is not used (no subtitle line under the title); put the so-what in the title or an implication block")
        if status == "missing" or pid == "agenda":
            continue
        title = (page.get("title") or "").strip()
        if not title:
            problems.append(f"{pid}: a {status} page needs an action title (the conclusion, not the topic)")
        elif pid != "executive-summary" and (title == topics.get(pid) or title.startswith(f"{topics.get(pid)}：") or title.startswith(f"{topics.get(pid)}:")):
            problems.append(f"{pid}: the title only names the topic; write the conclusion as the title")
        elif title in titles:
            problems.append(f"{pid}: the same title as {titles[title]}; every page says its own conclusion")
        titles.setdefault(title, pid)
        if title.endswith(("です", "ます", "です。", "ます。")):
            problems.append(f"{pid}: write the title in plain form (である調), not です・ます")
        if _len(title) > LIMITS["title"]:
            problems.append(f"{pid}: title is longer than {LIMITS['title']} characters")
        blocks = page.get("blocks") or []
        if not blocks:
            problems.append(f"{pid}: a {status} page needs at least one block")
        most = 4 if page.get("density") == "dense" else 3
        if len([b for b in blocks if b.get("kind") != "implication"]) > most:
            problems.append(f"{pid}: at most {most} blocks besides the implication fit on one page")
        if sum(1 for b in blocks if b.get("kind") == "implication") > 1:
            problems.append(f"{pid}: one implication block per page")
        if not page.get("sources"):
            problems.append(f"{pid}: a {status} page needs its sources (where each fact came from)")
        if status == "partial" and not page.get("gaps"):
            problems.append(f"{pid}: a partial page needs gaps (what is still not considered)")
        if len(page.get("gaps") or []) > LIMITS["gaps"]:
            problems.append(f"{pid}: at most {LIMITS['gaps']} gaps; move the rest to open-issues")
        if len(page.get("notes") or []) > 2 or any(_len(note) > 120 for note in page.get("notes") or []):
            problems.append(f"{pid}: at most 2 notes of 120 characters (assumptions and formulas behind the numbers)")
        for index, block in enumerate(blocks):
            check_block(pid, index, block, base_dir, expected, problems)
    return {"pass": not problems, "findings": problems, "warnings": warnings_for(spec), "counts": counts}


def slide_numbers(catalog):
    """The slide number of every page and of every chapter's divider: the cover is 1, and each chapter after
    the summary opens with a divider slide."""
    numbers, dividers, n, current = {}, {}, 1, None
    for meta in catalog["pages"]:
        if meta["section"] != current:
            current = meta["section"]
            if current != "summary":
                n += 1
                dividers[current] = n
        n += 1
        numbers[meta["id"]] = n
    return numbers, dividers


def outline(spec):
    """The deck as text: every page's number, status and title, then what it says. For reading the
    storyline top to bottom and for a reviewer who reads without the slides."""
    catalog = load_catalog()
    pages = {p.get("id"): p for p in spec.get("pages") or []}
    numbers, _ = slide_numbers(catalog)
    lines = [f"# {spec.get('title') or 'サービス企画書'}", ""]
    for index, meta in enumerate(catalog["pages"]):
        page = pages.get(meta["id"]) or {}
        status = page.get("status", "missing")
        mark = "" if meta["id"] == "agenda" else {"done": "", "partial": "【一部未検討】", "missing": "【未検討】"}[status if status in STATUSES else "missing"]
        title = page.get("title") or meta["topic"]
        lines.append(f"P.{numbers[meta['id']]} {mark}{title}")
    lines += ["", "---", ""]
    for index, meta in enumerate(catalog["pages"]):
        page = pages.get(meta["id"]) or {}
        if page.get("status", "missing") == "missing" or meta["id"] == "agenda":
            continue
        lines.append(f"## P.{numbers[meta['id']]} {page.get('title', '')}")
        for block in page.get("blocks") or []:
            lines.append(f"- [{block.get('kind')}] " + " / ".join(block_texts(block)))
        for gap in page.get("gaps") or []:
            lines.append(f"- 未検討の論点: {gap}")
        for note in page.get("notes") or []:
            lines.append(f"- 注: {note}")
        lines.append(f"- 出典: {'、'.join(page.get('sources') or [])}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# text measuring (CJK-aware estimate; PowerPoint's own wrapping decides the rest)
# ---------------------------------------------------------------------------
def text_units(value):
    return sum(0.55 if ord(ch) < 0x2E80 else 1.0 for ch in str(value).replace("**", ""))


def line_count(value, width_in, size_pt):
    per_line = max(1.0, (width_in * 72 - 10) / size_pt)
    return sum(max(1, math.ceil(text_units(part) / per_line)) for part in str(value).split("\n"))


def text_height(lines, size_pt, spacing=1.35):
    return lines * size_pt * spacing / 72


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def build(spec, base_dir, out, template, only=None):
    from pptx import Presentation
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
    from pptx.enum.dml import MSO_THEME_COLOR
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
    from pptx.oxml.ns import qn
    from pptx.util import Emu, Inches, Pt
    from lxml import etree
    import re

    # Theme slots: MAIN structures the page, HILITE marks the one thing to look at
    # (and 未検討), GREY and LIGHT are the neutrals.
    MAIN, HILITE, SUB, PALE, GREY, LIGHT, INK, PAPER = (
        MSO_THEME_COLOR.ACCENT_1, MSO_THEME_COLOR.TEXT_2, MSO_THEME_COLOR.ACCENT_2, MSO_THEME_COLOR.ACCENT_3,
        MSO_THEME_COLOR.ACCENT_5, MSO_THEME_COLOR.ACCENT_6, MSO_THEME_COLOR.TEXT_1, MSO_THEME_COLOR.BACKGROUND_1)
    SCHEME = {MAIN: "accent1", HILITE: "tx2", SUB: "accent2", PALE: "accent3", GREY: "accent5", LIGHT: "accent6", INK: "tx1", PAPER: "bg1"}

    prs = Presentation(template) if template else Presentation()
    if not template:
        prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    ids = prs.slides._sldIdLst  # the template's own slides are not part of the new deck
    for sld in list(ids):
        prs.part.drop_rel(sld.rId)
        ids.remove(sld)
    layouts = [layout for master in prs.slide_masters for layout in master.slide_layouts]

    def layout(*names, fallback):
        for name in names:
            for candidate in layouts:
                if candidate.name == name:
                    return candidate
        return layouts[fallback] if fallback < len(layouts) else layouts[0]

    cover_layout = layout("表紙", "Title Slide", fallback=0)
    body_layout = layout("標準ページ-テキストなし", "Title Only", fallback=5)
    W, H = prs.slide_width, prs.slide_height
    IN = 914400
    # The body area: inside the side margins, between the rule under the title and the source line.
    X0, X1 = Inches(0.45), W - Inches(0.45)
    Y0, Y1 = Inches(1.4), H - Inches(0.82)
    SOURCE_Y = H - Inches(0.74)

    # ---- primitives ----------------------------------------------------------
    def paint(target, theme, brightness=0.0):
        target.theme_color = theme
        if brightness:
            target.brightness = brightness

    def rect(slide, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE, line_width=0.75):
        box = slide.shapes.add_shape(shape, int(x), int(y), int(w), int(h))
        if fill is None:
            box.fill.background()
        else:
            box.fill.solid()
            paint(box.fill.fore_color, *fill)
        if line is None:
            box.line.fill.background()
        else:
            paint(box.line.color, *line)
            box.line.width = Pt(line_width)
        box.shadow.inherit = False
        if box.has_text_frame:
            box.text_frame.text = ""
        return box

    def rule(slide, x1, y1, x2, y2, theme=MAIN, width=1.0, brightness=0.0, dash=False):
        """An axis-aligned rule, drawn as a thin filled bar so every viewer renders it the same.
        A dashed rule is a row of short bars."""
        thick = int(Pt(width))
        horizontal = abs(y2 - y1) < abs(x2 - x1)
        start, end = (min(x1, x2), max(x1, x2)) if horizontal else (min(y1, y2), max(y1, y2))
        pieces = [(start, end)]
        if dash:
            step, on = int(Inches(0.09)), int(Inches(0.05))
            pieces = [(p, min(p + on, end)) for p in range(int(start), int(end), step)]
        for a, b in pieces:
            if horizontal:
                bar = rect(slide, a, y1 - thick // 2, b - a, thick, (theme, brightness))
            else:
                bar = rect(slide, x1 - thick // 2, a, thick, b - a, (theme, brightness))
        return bar

    def polygon(slide, points, theme):
        """A filled polygon from absolute points (a freeform, so no viewer has to honour a rotation)."""
        builder = slide.shapes.build_freeform(int(points[0][0]), int(points[0][1]))
        builder.add_line_segments([(int(px), int(py)) for px, py in points[1:]], close=True)
        shape = builder.convert_to_shape()
        shape.fill.solid()
        paint(shape.fill.fore_color, theme)
        shape.line.fill.background()
        shape.shadow.inherit = False
        return shape

    def arrow_head(slide, x, y, pointing, theme=GREY, size=0.12):
        half = Inches(size / 2)
        if pointing == "up":
            return polygon(slide, [(x - half, y + half), (x, y - half), (x + half, y + half)], theme)
        return polygon(slide, [(x - half, y - half), (x + half, y), (x - half, y + half)], theme)

    def bullet(paragraph, level=0, char="•"):
        pPr = paragraph._p.get_or_add_pPr()
        indent = 0.17 + 0.2 * level
        pPr.set("marL", str(int(Inches(indent))))
        pPr.set("indent", str(-int(Inches(0.15))))
        for tag in ("a:buNone", "a:buChar", "a:buFont"):
            for old in pPr.findall(qn(tag)):
                pPr.remove(old)
        font = etree.SubElement(pPr, qn("a:buFont"))
        font.set("typeface", "Arial")
        mark = etree.SubElement(pPr, qn("a:buChar"))
        mark.set("char", char)

    def write(frame, paragraphs, size=12, bold=False, theme=INK, align=PP_ALIGN.LEFT, spacing=1.15):
        """paragraphs: strings or dicts {text, size, bold, theme, bullet, level, before, align, brightness}."""
        first = True
        for item in paragraphs:
            item = item if isinstance(item, dict) else {"text": item}
            paragraph = frame.paragraphs[0] if first else frame.add_paragraph()
            first = False
            paragraph.alignment = item.get("align", align)
            paragraph.line_spacing = spacing
            if item.get("before"):
                paragraph.space_before = Pt(item["before"])
            if item.get("bullet"):
                bullet(paragraph, item.get("level", 0))
            # **key phrase** inside a line is set bold in the main colour, the way a reader skims a dense page.
            ink = item.get("theme", theme)
            for k, part in enumerate(str(item.get("text", "")).split("**")):
                if not part:
                    continue
                run = paragraph.add_run()
                run.text = part
                run.font.size = Pt(item.get("size", size))
                strong = k % 2 == 1
                run.font.bold = True if strong else item.get("bold", bold)
                paint(run.font.color, MAIN if strong and ink in (INK, GREY) else ink, 0.0 if strong else item.get("brightness", 0.0))

    def text(slide, x, y, w, h, paragraphs, size=12, bold=False, theme=INK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
             fill=None, line=None, margin=0.0, shape=None):
        if fill is None and line is None and shape is None:
            box = slide.shapes.add_textbox(int(x), int(y), int(w), int(h))
        else:
            box = rect(slide, x, y, w, h, fill, line, shape or MSO_SHAPE.RECTANGLE)
        frame = box.text_frame
        frame.word_wrap, frame.vertical_anchor = True, anchor
        frame.auto_size = None
        frame.margin_left = frame.margin_right = Inches(margin)
        frame.margin_top = frame.margin_bottom = Inches(0.02)
        write(frame, paragraphs if isinstance(paragraphs, list) else [paragraphs], size, bold, theme, align)
        return box

    def heading(slide, x, y, w, label, theme=MAIN, size=14):
        """A column heading: bold words over a rule the width of the column."""
        text(slide, x, y, w, Inches(0.34), label, size, True, theme, anchor=MSO_ANCHOR.BOTTOM)
        rule(slide, x, y + Inches(0.38), x + w, y + Inches(0.38), theme, 1.25)
        return Inches(0.5)

    def chip(slide, x, y, label, theme=MAIN, d=0.34, size=12):
        box = text(slide, x, y, Inches(d), Inches(d), str(label), size, True, PAPER, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE,
                   fill=(theme,), shape=MSO_SHAPE.OVAL)
        return box

    def triangle(slide, x, y, size=0.22, theme=PALE):
        """The right-pointing triangle between facts and their implication."""
        return polygon(slide, [(x, y - Inches(size)), (x + Inches(size), y), (x, y + Inches(size))], theme)

    def scheme_fill(parent, theme, brightness=0.0):
        fill = etree.SubElement(parent, qn("a:solidFill"))
        clr = etree.SubElement(fill, qn("a:schemeClr"))
        clr.set("val", SCHEME[theme])
        if brightness > 0:
            etree.SubElement(clr, qn("a:lumMod")).set("val", str(int((1 - brightness) * 100000)))
            etree.SubElement(clr, qn("a:lumOff")).set("val", str(int(brightness * 100000)))
        elif brightness < 0:
            etree.SubElement(clr, qn("a:lumMod")).set("val", str(int((1 + brightness) * 100000)))

    def cell_style(cell, borders, fill=None):
        """borders: {"L"|"R"|"T"|"B": (theme, width_pt, brightness) or None}. Lines come first in tcPr."""
        tcPr = cell._tc.get_or_add_tcPr()
        for child in list(tcPr):
            if child.tag in {qn(f"a:ln{s}") for s in "LRTB"} or child.tag in (qn("a:solidFill"), qn("a:noFill")):
                tcPr.remove(child)
        for index, side in enumerate("LRTB"):
            spec_ = borders.get(side)
            line = etree.Element(qn(f"a:ln{side}"))
            if spec_ is None:
                line.set("w", "0")
                etree.SubElement(line, qn("a:noFill"))
            else:
                theme, width, brightness = spec_[:3]
                line.set("w", str(int(Pt(width))))
                scheme_fill(line, theme, brightness)
                if len(spec_) > 3 and spec_[3]:
                    etree.SubElement(line, qn("a:prstDash")).set("val", "dash")
            tcPr.insert(index, line)
        if fill is None:
            etree.SubElement(tcPr, qn("a:noFill"))
        else:
            scheme_fill(tcPr, *fill)

    # ---- page frame ----------------------------------------------------------
    catalog = load_catalog()
    sections = {s["id"]: s["title"] for s in catalog["sections"]}
    stage_names = catalog.get("stages") or {}
    page_number, divider_number = slide_numbers(catalog)

    def title_box(slide):
        title = slide.shapes.title
        if title is not None:
            return title.left, title.top, title.width, title.height
        return Inches(0.3), Inches(0.2), W - Inches(0.6), Inches(0.8)

    def set_title(slide, value):
        if slide.shapes.title is not None:
            slide.shapes.title.text = value
            size = 22  # a long title wraps to two lines; it is never set smaller
            for paragraph in slide.shapes.title.text_frame.paragraphs:
                for run in paragraph.runs:
                    run.font.size = Pt(size)
            return
        left, top, width, height = title_box(slide)
        text(slide, left, top, width, height, value, 22, True, anchor=MSO_ANCHOR.MIDDLE)

    def frame(slide, title, section, sources, status, notes=(), sticker=""):
        set_title(slide, title)
        # The page's place in the deck, right-aligned under the title rule; the status chip sits before it.
        tag_w = Inches(3.2)
        text(slide, X1 - tag_w, Inches(1.03), tag_w, Inches(0.26), section, 10, False, GREY, PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)
        if status in ("missing", "partial"):
            label = "未検討" if status == "missing" else "一部未検討"
            cw = Inches(0.95 if status == "missing" else 1.2)
            used = Inches(text_units(section) * 10 / 72 + 0.15)
            text(slide, X1 - used - cw, Inches(1.03), cw, Inches(0.26), label, 10, True, PAPER, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, fill=(HILITE,))
        if sticker:
            sw = Inches(text_units(sticker) * 10 / 72 + 0.3)
            right = X1 - Inches(text_units(section) * 10 / 72 + 0.15) - (Inches(1.3) if status in ("missing", "partial") else 0)
            text(slide, right - sw - Inches(0.1), Inches(1.03), sw, Inches(0.26), sticker, 10, True, GREY, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, line=(GREY,))
        if notes:
            text(slide, X0, SOURCE_Y - Inches(0.24) * len(notes), W - Inches(2.4), Inches(0.24) * len(notes),
                 ["注：" + note for note in notes], 9, False, GREY, anchor=MSO_ANCHOR.BOTTOM)
        if sources:
            box = text(slide, X0, SOURCE_Y, W - Inches(2.4), Inches(0.24), "", 9, False, GREY, anchor=MSO_ANCHOR.MIDDLE)
            paragraph = box.text_frame.paragraphs[0]
            for i, source in enumerate(["出典："] + list(sources)):
                link = re.fullmatch(r"\[(.+?)\]\((https?://[^)\s]+)\)", source.strip()) if i else None
                run = paragraph.add_run()
                run.text = (link.group(1) if link else source) + ("／" if 0 < i < len(sources) else "")
                run.font.size = Pt(9)
                paint(run.font.color, GREY)
                if link:
                    run.hyperlink.address = link.group(2)

    # ---- block measuring: the natural height of a block at a width -----------
    def bullets_height(items, w_in, size):
        total = 0.0
        for item in items:
            total += text_height(line_count(_item_text(item), w_in - 0.2, size), size) + 0.06
            for sub in (item.get("sub") or [] if isinstance(item, dict) else []):
                total += text_height(line_count(sub, w_in - 0.4, size - 1), size - 1) + 0.04
        return total

    def table_metrics(block, w_in, size):
        columns, rows = block["columns"], block["rows"]
        weights = block.get("widths")
        widths = [w_in * weight / sum(weights) for weight in weights] if weights else default_widths(columns, rows, w_in, size)
        head = max(line_count(c, widths[i] - 0.16, size + 2) for i, c in enumerate(columns))
        heights = [text_height(head, size + 2, 1.2) + 0.16]
        for row in rows:
            lines = max(line_count(cell, widths[i] - 0.16, size) for i, cell in enumerate(row))
            heights.append(text_height(lines, size, 1.25) + 0.2)
        return widths, heights

    def default_widths(columns, rows, w_in, size):
        """Short columns get the width their longest value needs on one line; columns of one kind
        (all short: companies, months, plans) share one width; long columns share the rest by length."""
        longest = [max([text_units(column) * (size + 1) / size] + [text_units(row[i]) for row in rows if i < len(row)]) for i, column in enumerate(columns)]
        need = [value * size / 72 + 0.3 for value in longest]
        if len(columns) > 2 and all(value <= 8 for value in longest[1:]):
            first = min(need[0], w_in * 0.35)
            return [first] + [(w_in - first) / (len(columns) - 1)] * (len(columns) - 1)
        short = [i for i, value in enumerate(longest) if value <= 10]
        fixed = sum(need[i] for i in short)
        long_ = [i for i in range(len(columns)) if i not in short]
        if not long_ or fixed >= w_in * 0.7:
            return [w_in * value / sum(longest) for value in longest]
        spread = sum(min(longest[i], 30.0) for i in long_)
        return [need[i] if i in short else (w_in - fixed) * min(longest[i], 30.0) / spread for i in range(len(columns))]

    def short_column(rows, c):
        return all(text_units(row[c]) <= 6 for row in rows)

    def natural(block, w_in, size):
        kind = block["kind"]
        head = 0.5 if block.get("heading") else 0.0
        if kind == "bullets":
            return head + bullets_height(block["items"], w_in, size)
        if kind == "table":
            legend = 0.3 if table_marks(block) else 0.0
            return head + legend + sum(table_metrics(block, w_in, size)[1])
        if kind == "summary":
            return sum(summary_row_height(item, w_in, size) for item in block["items"])
        if kind == "cards":
            items = block["items"]
            cw = (w_in - 0.3 * (len(items) - 1)) / len(items)
            return 0.55 + max(bullets_height(card_points(item), cw, size) for item in items)
        if kind == "stats":
            n = len(block["items"])
            cw = w_in / n
            return 1.05 + max(text_height(line_count(item.get("label", ""), cw - 0.3, size + 1), size + 1)
                              + text_height(line_count(item.get("note", ""), cw - 0.3, size - 1), size - 1) for item in block["items"]) + 0.15
        if kind == "steps":
            n = len(block["items"])
            cw = (w_in - 0.08 * (n - 1)) / n
            body = max([bullets_height(step_points(item), cw - 0.1, size) for item in block["items"]] + [0])
            return 0.85 + (0.15 + body if body else 0)
        if kind == "formula":
            return 1.95
        if kind == "callout":
            return text_height(line_count(block["text"], w_in - 0.3, size + 3), size + 3) + 0.2
        if kind == "implication":
            return 0.5 + bullets_height(block["items"], w_in, size + 1)
        if kind == "timeline":
            return 0.5 + 0.62 * sum(timeline_rows(lane) for lane in block["lanes"])
        # The richer pictures that read better at their own height than stretched to the page.
        if kind == "house":
            pw = w_in / len(block["pillars"])
            return 0.85 + 0.7 + 0.3 + max(bullets_height(p.get("points") or [], pw - 0.24, size) for p in block["pillars"]) + 0.75
        if kind == "evidence":
            cols = 2 if len(block["items"]) <= 4 else 3
            rows = (len(block["items"]) + cols - 1) // cols
            cw = w_in / cols - 0.3
            card = max(0.55 + text_height(line_count(i["title"], cw, size + 1), size + 1)
                       + bullets_height(i.get("points") or ([i["body"]] if i.get("body") else []), cw, size)
                       + (text_height(line_count(i["so_what"], cw, size), size) + 0.1 if i.get("so_what") else 0) for i in block["items"])
            return rows * (card + 0.3)
        if kind == "options":
            return len(block["options"]) * 1.15
        if kind == "voices":
            cols = 2 if len(block["items"]) <= 4 else 3
            rows = (len(block["items"]) + cols - 1) // cols
            bw = w_in / cols - 1.0
            one = max(text_height(line_count(f"「{i['quote']}」", bw, size), size) + (0.3 if i.get("tag") else 0)
                      + (text_height(line_count(i["so_what"], bw, size - 1), size - 1) + 0.1 if i.get("so_what") else 0) for i in block["items"])
            return rows * max(1.3, one + 0.35) + 0.15 * (rows - 1)
        if kind == "two_tier":
            cw = (w_in - 1.15) / len(block["steps"])
            return 1.15 + 0.45 + max(bullets_height(st.get("back") or [], cw - 0.16, size) for st in block["steps"]) + 0.3
        if kind == "tornado":
            return 0.9 + 0.55 * len(block["items"])
        if kind == "funnel":
            return 0.75 * len(block["stages"])
        if kind == "qa":
            return sum(max(text_height(line_count(i["q"], w_in * 0.42 - 0.5, size + 0.5), size + 0.5),
                           bullets_height(i["a"] if isinstance(i["a"], list) else [i["a"]], w_in * 0.58 - 0.3, size)) + 0.25 for i in block["items"])
        if kind == "chain":
            cw = (w_in - 0.8) / 3
            return 0.55 + sum(max(text_height(line_count(c, cw - 0.1, size), size) for c in row) + 0.24 for row in block["rows"])
        if kind == "from_to":
            cw = (w_in - 0.7) / 2
            return 0.7 + sum(max(text_height(line_count(r["from"], cw - 0.4, size), size), text_height(line_count(r["to"], cw - 0.6, size), size)) + 0.22
                             for r in block["rows"])
        return None  # figures fill the space they are given

    def timeline_rows(lane):
        ends = []
        for item in sorted(lane.get("items") or [], key=lambda it: (it["start"], it["end"])):
            row = next((r for r, end in enumerate(ends) if end < item["start"]), len(ends))
            if row == len(ends):
                ends.append(item["end"])
            else:
                ends[row] = item["end"]
        return max(1, len(ends))

    def card_points(item):
        return item.get("points") or ([item["body"]] if item.get("body") else [])

    def step_points(item):
        return item.get("points") or ([item["body"]] if item.get("body") else [])

    def table_marks(block):
        marks = {cell for row in block["rows"] for cell in row if cell in RATINGS}
        return marks or bool(block.get("heat"))

    def summary_row_height(item, w_in, size):
        body_w = w_in - 0.6 - 0.8
        lines = text_height(line_count(item["text"], body_w, size + 2), size + 2)
        for detail in item.get("details") or []:
            lines += text_height(line_count(detail, body_w - 0.2, size), size) + 0.03
        return lines + 0.32

    # ---- blocks: each draws inside (x, y, w, h) at a body size ---------------
    def draw_heading(slide, block, x, y, w):
        if block.get("heading"):
            return heading(slide, x, y, w, block["heading"])
        return 0

    def bullets(slide, block, x, y, w, h, size):
        top = draw_heading(slide, block, x, y, w)
        paragraphs = []
        for item in block["items"]:
            paragraphs.append({"text": _item_text(item), "bullet": True, "before": 4})
            for sub in (item.get("sub") or [] if isinstance(item, dict) else []):
                paragraphs.append({"text": sub, "bullet": True, "level": 1, "size": size - 1, "theme": INK, "before": 2})
        text(slide, x, y + top, w, h - top, paragraphs, size)

    def table(slide, block, x, y, w, h, size):
        top = draw_heading(slide, block, x, y, w)
        columns, rows = block["columns"], block["rows"]
        heat = set(block.get("heat") or [])
        highlight = block.get("highlight_row")
        marks = sorted({cell for row in rows for cell in row if cell in RATINGS}, key=lambda m: -RATINGS[m])
        if marks or heat:
            legend = [f"{m} {RATING_LABELS[m]}" for m in marks] + (["高・中・低 ＝ 色の濃さ"] if heat else [])
            text(slide, x, y + top, w, Inches(0.26), "　".join(legend), 10, False, GREY, PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)
            top += Inches(0.3)
        widths, heights = table_metrics(block, w / IN, size)
        total = sum(heights)
        shape = slide.shapes.add_table(len(rows) + 1, len(columns), int(x), int(y + top), int(w), int(Inches(total)))
        tbl = shape.table
        tblPr = tbl._tbl.tblPr
        for attr in ("firstRow", "bandRow", "firstCol", "lastRow", "lastCol", "bandCol"):
            tblPr.set(attr, "0")
        style = tblPr.find(qn("a:tableStyleId"))
        if style is None:
            style = etree.SubElement(tblPr, qn("a:tableStyleId"))
        style.text = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"  # No Style, No Grid
        for i, width in enumerate(widths):
            tbl.columns[i].width = int(Inches(width))
        for r, height in enumerate(heights):
            tbl.rows[r].height = int(Inches(height))
        groups = []  # (first row, last row) of runs of the same row label
        for r in range(1, len(rows) + 1):
            label = rows[r - 1][0]
            if groups and label and rows[groups[-1][0] - 1][0] == label and groups[-1][1] == r - 1:
                groups[-1] = (groups[-1][0], r)
            else:
                groups.append((r, r))
        for r in range(len(rows) + 1):
            for c in range(len(columns)):
                cell = tbl.cell(r, c)
                value = str(columns[c] if r == 0 else rows[r - 1][c])
                cell.margin_left = cell.margin_right = Inches(0.08)
                cell.margin_top = cell.margin_bottom = Inches(0.06)
                cell.vertical_anchor = MSO_ANCHOR.BOTTOM if r == 0 else MSO_ANCHOR.MIDDLE
                frame_ = cell.text_frame
                frame_.word_wrap = True
                frame_.paragraphs[0].text = ""
                last = r == len(rows)
                borders = {}
                fill = None
                theme, bold, cell_size, align = INK, False, size, PP_ALIGN.LEFT
                if r == 0:
                    borders["B"] = (MAIN, 1.75, 0.0)
                    theme, bold, cell_size = MAIN, True, size + 2
                else:
                    group = next(g for g in groups if g[0] <= r <= g[1])
                    if not last:
                        borders["B"] = (LIGHT, 0.75, 0.0) if r == group[1] else (LIGHT, 0.5, 0.0, True)
                    if c == 0 and r > group[0]:
                        value = ""  # the group's label is shown once, in the merged cell
                    if c == 0:
                        borders["R"] = (MAIN, 1.0, 0.0)
                        bold, cell_size = True, size + 1
                    if highlight is not None and r - 1 == highlight:
                        fill = (HILITE, 0.85)
                    if value in RATINGS:
                        theme, cell_size, align = MAIN, size + 6, PP_ALIGN.CENTER
                    if c in heat and value in HEAT:
                        level = HEAT.index(value)
                        fill = (MAIN, (0.0, 0.55, 0.85)[level])
                        theme, bold, align = (PAPER if level == 0 else INK), True, PP_ALIGN.CENTER
                if c in heat and r == 0:
                    align = PP_ALIGN.CENTER
                if c > 0 and short_column(rows, c):
                    align = PP_ALIGN.CENTER
                cell_style(cell, borders, fill)
                write(frame_, [{"text": value, "align": align}], cell_size, bold, theme, spacing=1.1)
        for first, last in groups:
            if last > first:
                tbl.cell(first, 0).merge(tbl.cell(last, 0))
                tbl.cell(first, 0).vertical_anchor = MSO_ANCHOR.MIDDLE

    def summary(slide, block, x, y, w, h, size):
        cy = y
        for i, item in enumerate(block["items"]):
            row_h = Inches(summary_row_height(item, w / IN, size))
            chip(slide, x, cy + Inches(0.1), i + 1, MAIN, 0.36, 13)
            body_x, body_w = x + Inches(0.6), w - Inches(0.6) - Inches(0.8)
            paragraphs = [{"text": item["text"], "size": size + 2, "bold": True}]
            paragraphs += [{"text": d, "bullet": True, "before": 3} for d in item.get("details") or []]
            text(slide, body_x, cy + Inches(0.08), body_w, row_h - Inches(0.1), paragraphs, size)
            if item.get("ref"):
                text(slide, x + w - Inches(0.75), cy + Inches(0.1), Inches(0.75), Inches(0.3), f"P.{page_number[item['ref']]}",
                     11, True, MAIN, PP_ALIGN.RIGHT)
            cy += row_h
            if i < len(block["items"]) - 1:
                rule(slide, x, cy - Inches(0.06), x + w, cy - Inches(0.06), LIGHT, 0.75)

    def cards(slide, block, x, y, w, h, size):
        items = block["items"]
        gap = Inches(0.3)
        cw = int((w - gap * (len(items) - 1)) / len(items))
        for i, item in enumerate(items):
            cx = x + (cw + gap) * i
            theme = HILITE if item.get("highlight") else MAIN
            heading(slide, cx, y, cw, item["title"], theme)
            if item.get("caption"):
                text(slide, cx, y + Inches(0.5), cw, Inches(0.3), item["caption"], size - 1, False, GREY)
            off = Inches(0.85) if item.get("caption") else Inches(0.55)
            text(slide, cx, y + off, cw, h - off, [{"text": p, "bullet": True, "before": 4} for p in card_points(item)], size)

    def stats(slide, block, x, y, w, h, size):
        items = block["items"]
        cw = int(w / len(items))
        for i, item in enumerate(items):
            cx = x + cw * i
            if i:
                rule(slide, cx, y + Inches(0.1), cx, y + h - Inches(0.1), LIGHT, 1.0)
            pad = Inches(0.2) if i else 0
            theme = HILITE if item.get("highlight") else MAIN
            text(slide, cx + pad, y, cw - pad - Inches(0.1), Inches(0.85), item["value"], 36, True, theme, anchor=MSO_ANCHOR.BOTTOM)
            paragraphs = [{"text": item["label"], "size": size + 1, "bold": True}]
            if item.get("delta"):
                down = str(item["delta"]).startswith(("-", "−", "▼"))
                paragraphs.append({"text": ("▼ " if down else "▲ ") + str(item["delta"]).lstrip("▲▼ "), "size": size, "bold": True,
                                   "theme": HILITE if (down != bool(item.get("lower_is_better"))) else MAIN, "before": 3})
            if item.get("note"):
                paragraphs.append({"text": item["note"], "size": size - 1, "theme": GREY, "before": 4})
            text(slide, cx + pad, y + Inches(0.95), cw - pad - Inches(0.1), h - Inches(0.95), paragraphs, size)

    def steps(slide, block, x, y, w, h, size):
        items = block["items"]
        gap = Inches(0.08)
        cw = int((w - gap * (len(items) - 1)) / len(items))
        for i, item in enumerate(items):
            cx = x + (cw + gap) * i
            shape = MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON
            fill = (MAIN,) if item.get("highlight") else (LIGHT, 0.6)
            arrow = rect(slide, cx, y, cw + Inches(0.12), Inches(0.7), fill, shape=shape)
            try:
                arrow.adjustments[0] = 0.25
            except IndexError:
                pass
            ink = PAPER if item.get("highlight") else INK
            badge = chip(slide, cx + Inches(0.22 if i else 0.12), y + Inches(0.18), i + 1, PAPER if item.get("highlight") else MAIN, 0.34, 12)
            if item.get("highlight"):
                paint(badge.text_frame.paragraphs[0].runs[0].font.color, MAIN)
            text(slide, cx + Inches(0.62 if i else 0.52), y, cw - Inches(0.72), Inches(0.7), item["title"], min(size + 1, 13), True, ink, anchor=MSO_ANCHOR.MIDDLE)
            points = step_points(item)
            if points:
                text(slide, cx + Inches(0.05), y + Inches(0.85), cw - Inches(0.1), h - Inches(0.85),
                     [{"text": p, "bullet": True, "before": 3} for p in points], min(size, 13))

    def callout(slide, block, x, y, w, h, size):
        bh = Inches(natural(block, w / IN, size))
        rect(slide, x, y, Inches(0.07), bh, (MAIN,))
        text(slide, x + Inches(0.22), y, w - Inches(0.22), bh, block["text"], size + 3, True, MAIN, anchor=MSO_ANCHOR.MIDDLE)

    def implication(slide, block, x, y, w, h, size, gaps):
        top = heading(slide, x, y, w, block.get("heading") or "示唆") if block else 0
        paragraphs = [{"text": _item_text(item), "bullet": True, "before": 6} for item in (block or {}).get("items", [])]
        used = Inches(bullets_height((block or {}).get("items", []), w / IN, size + 1)) if block else 0
        if paragraphs:
            text(slide, x, y + top, w, used + Inches(0.1), paragraphs, size + 1)
        if gaps:
            gy = y + top + used + (Inches(0.35) if block else 0)
            gtop = heading(slide, x, gy, w, "未検討の論点", HILITE)
            text(slide, x, gy + gtop, w, y + h - gy - gtop, [{"text": g, "bullet": True, "before": 5} for g in gaps], size)

    def tree(slide, block, x, y, w, h, size):
        children = block["children"]
        deep = any(c.get("children") for c in children)
        cols = 3 if deep else 2
        gap = Inches(0.45)
        col_w = int((w - gap * (cols - 1)) / cols)
        leaves = [(c, g) for c in children for g in (c.get("children") or [None])]
        unit = min(int(h / max(1, len(leaves))), Inches(0.9))
        top = y + int((h - unit * len(leaves)) / 2)
        box_h = min(unit - Inches(0.14), Inches(0.62))

        def node(nx, ny, item, level):
            label = item.get("label", "") if isinstance(item, dict) else str(item)
            value = item.get("value") if isinstance(item, dict) else None
            hot = isinstance(item, dict) and item.get("highlight")
            if level == 0:
                text(slide, nx, ny, col_w, box_h, label, size + 1, True, PAPER, anchor=MSO_ANCHOR.MIDDLE, fill=(MAIN,), margin=0.12)
                return
            rect(slide, nx, ny, col_w, box_h, (PAPER,), (LIGHT,))
            rect(slide, nx, ny, Inches(0.06), box_h, (HILITE if hot else (MAIN if level == 1 else SUB),))
            value_w = Inches(1.1) if value else 0
            text(slide, nx + Inches(0.14), ny, col_w - Inches(0.2) - value_w, box_h, label, size if level == 2 else size + 0.5,
                 level == 1 or hot, INK, anchor=MSO_ANCHOR.MIDDLE)
            if value:
                text(slide, nx + col_w - value_w - Inches(0.06), ny, value_w, box_h, str(value), size, True, HILITE if hot else MAIN,
                     PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)

        def elbow(x1, y1, x2, ys):
            mid = x1 + int((x2 - x1) / 2)
            rule(slide, x1, y1, mid, y1, GREY, 1.0)
            rule(slide, mid, min(ys + [y1]), mid, max(ys + [y1]), GREY, 1.0)
            for yy in ys:
                rule(slide, mid, yy, x2, yy, GREY, 1.0)

        root_y = top + int(unit * len(leaves) / 2) - int(box_h / 2)
        node(x, root_y, {"label": block["root"]}, 0)
        child_mids, index = [], 0
        for child in children:
            grand = child.get("children") or [None]
            span_mid = top + unit * index + int(unit * len(grand) / 2)
            cx = x + col_w + gap
            node(cx, span_mid - int(box_h / 2), child, 1)
            child_mids.append(span_mid)
            leaf_mids = []
            for g in grand:
                if g is not None:
                    gy = top + unit * index + int(unit / 2)
                    node(cx + col_w + gap, gy - int(box_h / 2), g, 2)
                    leaf_mids.append(gy)
                index += 1
            if leaf_mids:
                elbow(cx + col_w, span_mid, cx + col_w + gap, leaf_mids)
        elbow(x + col_w, root_y + int(box_h / 2), x + col_w + gap, child_mids)

    def matrix(slide, block, x, y, w, h, size):
        axis = Inches(0.45)
        gx, gy, gw, gh = x + axis, y + Inches(0.3), w - axis, h - Inches(0.3) - axis
        qw, qh, gap = int(gw / 2), int(gh / 2), Inches(0.05)
        for i, quad in enumerate(block["quadrants"]):
            qx, qy = gx + qw * (i % 2), gy + qh * (i // 2)
            hot = quad.get("highlight")
            paragraphs = [{"text": quad.get("label", ""), "bold": True, "size": size + 1, "theme": PAPER if hot else MAIN}]
            paragraphs += [{"text": item, "bullet": True, "before": 3, "theme": PAPER if hot else INK} for item in quad.get("items") or []]
            text(slide, qx + gap, qy + gap, qw - gap * 2, qh - gap * 2, paragraphs, size, fill=(MAIN,) if hot else (LIGHT, 0.6), margin=0.15,
                 anchor=MSO_ANCHOR.TOP)
        # Axes: the y axis runs up the left edge, the x axis along the bottom, each with its name and both ends.
        ax, ay = gx - Inches(0.08), gy + gh + Inches(0.08)
        rule(slide, ax, ay, ax, gy, GREY, 1.25)
        arrow_head(slide, ax, gy - Inches(0.02), "up")
        rule(slide, ax, ay, gx + gw - Inches(0.04), ay, GREY, 1.25)
        arrow_head(slide, gx + gw, ay, "right")
        text(slide, gx, y, gw, Inches(0.26), f"{block['y']}（上ほど{block.get('y_high', '高い')}）", 11, True, GREY, anchor=MSO_ANCHOR.MIDDLE)
        text(slide, gx, gy + gh + Inches(0.12), gw, Inches(0.28), f"{block['x']}（右ほど{block.get('x_high', '高い')}）", 11, True, GREY,
             PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)

    def timeline(slide, block, x, y, w, h, size):
        periods, lanes = block["periods"], block["lanes"]
        label_w = Inches(1.7)
        col = int((w - label_w) / len(periods))
        head_h = Inches(0.36)
        text(slide, x, y, label_w, head_h, block.get("axis", "工程"), size + 1, True, MAIN, anchor=MSO_ANCHOR.BOTTOM)
        for i, period in enumerate(periods):
            text(slide, x + label_w + col * i, y, col, head_h, period, size + 1, True, MAIN, PP_ALIGN.CENTER, MSO_ANCHOR.BOTTOM)
        rule(slide, x, y + head_h + Inches(0.04), x + w, y + head_h + Inches(0.04), MAIN, 1.75)
        placed = []
        for lane in lanes:
            rows_end, slots = [], []
            for item in sorted(lane.get("items") or [], key=lambda it: (it["start"], it["end"])):
                row = next((r for r, end in enumerate(rows_end) if end < item["start"]), len(rows_end))
                if row == len(rows_end):
                    rows_end.append(item["end"])
                else:
                    rows_end[row] = item["end"]
                slots.append((row, item))
            placed.append((lane, max(1, len(rows_end)), slots))
        body_top = y + head_h + Inches(0.1)
        unit = min(Inches(0.62), int((h - head_h - Inches(0.1)) / max(1, sum(n for _, n, _ in placed))))
        body_h = unit * sum(n for _, n, _ in placed)
        for i in range(1, len(periods)):
            gx = x + label_w + col * i
            rule(slide, gx, body_top, gx, body_top + body_h, LIGHT, 0.75, dash=True)
        ly = body_top
        for li, (lane, rows_needed, slots) in enumerate(placed):
            lane_h = unit * rows_needed
            text(slide, x, ly, label_w - Inches(0.1), lane_h, lane.get("label", ""), size + 0.5, True, INK, anchor=MSO_ANCHOR.MIDDLE)
            for row, item in slots:
                by = ly + unit * row
                if item.get("milestone"):
                    cx = x + label_w + col * item["end"] + int(col / 2)
                    rect(slide, cx - Inches(0.13), by + int(unit / 2) - Inches(0.13), Inches(0.26), Inches(0.26), (HILITE,), shape=MSO_SHAPE.DIAMOND)
                    label_w = Inches(text_units(item.get("label", "")) * (size - 0.5) / 72 + 0.15)
                    room = x + w - (cx + Inches(0.16))
                    lx, align = (cx + Inches(0.16), PP_ALIGN.LEFT) if room >= label_w else (cx - Inches(0.16) - label_w, PP_ALIGN.RIGHT)
                    text(slide, lx, by, label_w, unit, item.get("label", ""), size - 0.5, True, HILITE, align, MSO_ANCHOR.MIDDLE)
                    continue
                bx = x + label_w + col * item["start"] + Inches(0.04)
                bw = col * (item["end"] - item["start"] + 1) - Inches(0.08)
                hot = item.get("highlight")
                text(slide, bx, by + Inches(0.07), bw, unit - Inches(0.14), item.get("label", ""), size - 1, hot, PAPER if hot else INK,
                     anchor=MSO_ANCHOR.MIDDLE, fill=(MAIN,) if hot else (PALE, 0.35), margin=0.08)
            ly += lane_h
            if li < len(placed) - 1:
                rule(slide, x, ly, x + w, ly, LIGHT, 0.75)

    def chart_bar(slide, block, x, y, w, h, size):
        text(slide, x, y, w, Inches(0.3), block["unit"], size, True, INK, anchor=MSO_ANCHOR.MIDDLE)
        rule(slide, x, y + Inches(0.34), x + w, y + Inches(0.34), MAIN, 1.0)
        mode = block.get("mode", "clustered")
        data = CategoryChartData()
        data.categories = block["categories"]
        if mode == "waterfall":
            # A bridge: an invisible base carries each change up to where the running total stands.
            values = block["series"][0]["values"]
            base, up, down, total, running = [], [], [], [], 0.0
            for i, value in enumerate(values):
                if i == 0 or i == len(values) - 1:
                    base.append(0); up.append(0); down.append(0); total.append(value)
                    running = value if i == 0 else running
                    continue
                low = running if value >= 0 else running + value
                base.append(low); up.append(max(value, 0)); down.append(max(-value, 0)); total.append(0)
                running += value
            for name, series_values in (("base", base), ("total", total), ("up", up), ("down", down)):
                data.add_series(name, series_values)
            kind = XL_CHART_TYPE.COLUMN_STACKED
        else:
            for series in block["series"]:
                data.add_series(series.get("name", ""), series["values"])
            if mode == "stacked":
                kind = XL_CHART_TYPE.BAR_STACKED if block.get("horizontal") else XL_CHART_TYPE.COLUMN_STACKED
            elif mode == "line":
                kind = XL_CHART_TYPE.LINE_MARKERS
            else:
                kind = XL_CHART_TYPE.BAR_CLUSTERED if block.get("horizontal") else XL_CHART_TYPE.COLUMN_CLUSTERED
        many = len(block["series"]) > 1
        top = Inches(0.45)
        chart = slide.shapes.add_chart(kind, int(x), int(y + top), int(w), int(h - top), data).chart
        chart.font.size = Pt(size)
        chart.has_legend = many and mode != "waterfall"
        if chart.has_legend:
            chart.legend.position, chart.legend.include_in_layout = XL_LEGEND_POSITION.TOP, False
            chart.legend.font.size = Pt(size - 1)
        value_axis = chart.value_axis
        value_axis.visible = False
        value_axis.has_major_gridlines = False
        category_axis = chart.category_axis
        category_axis.tick_labels.font.size = Pt(size)
        category_axis.format.line.fill.solid()
        paint(category_axis.format.line.fill.fore_color, GREY)
        value_axis.minimum_scale = 0 if mode != "line" else None  # bars start at zero, or their lengths lie
        if "%" in block["unit"] and mode != "waterfall":
            value_axis.maximum_scale = 1.0 if max(v for s in block["series"] for v in s["values"]) <= 1 else 100
        plot = chart.plots[0]
        if mode == "line":
            plot.has_data_labels = True
            plot.data_labels.font.size, plot.data_labels.font.bold = Pt(size - 1), True
            plot.data_labels.position = XL_LABEL_POSITION.ABOVE
            for i, series in enumerate(plot.series):
                paint(series.format.line.color, (MAIN, HILITE, GREY)[i % 3])
                series.format.line.width = Pt(2.5)
                series.smooth = False
            return
        plot.gap_width = 60
        if mode == "clustered":
            plot.overlap = -10 if many else 0
        else:
            plot.overlap = 100
        plot.has_data_labels = True
        labels = plot.data_labels
        labels.font.size, labels.font.bold = Pt(size), True
        if mode == "clustered":
            labels.position = XL_LABEL_POSITION.OUTSIDE_END
        number = block.get("number_format") or "#,##0"
        if block.get("number_format"):
            labels.number_format, labels.number_format_is_linked = block["number_format"], False
        if mode == "waterfall":
            looks = {"base": (None, None), "total": ((MAIN, 0.0), number + ";;"), "up": ((SUB, 0.0), '"+"' + number + ";;"),
                     "down": ((HILITE, 0.0), '"−"' + number + ";;")}
            for series, name in zip(plot.series, ("base", "total", "up", "down")):
                fill, fmt = looks[name]
                if fill is None:
                    series.format.fill.background()
                    series.format.line.fill.background()
                    series.data_labels.show_value = False
                    continue
                series.format.fill.solid()
                paint(series.format.fill.fore_color, *fill)
                series.format.line.fill.background()
                series.data_labels.number_format, series.data_labels.number_format_is_linked = fmt, False
                series.data_labels.position = XL_LABEL_POSITION.INSIDE_END if name != "total" else XL_LABEL_POSITION.INSIDE_END
                series.data_labels.font.size, series.data_labels.font.bold = Pt(size), True
                paint(series.data_labels.font.color, PAPER)
            return
        tones = [(MAIN, 0.0), (SUB, 0.0), (PALE, 0.0), (GREY, 0.0)] if mode == "stacked" else [(MAIN, 0.0), (GREY, 0.0), (PALE, 0.0)]
        for i, series in enumerate(plot.series):
            series.format.fill.solid()
            paint(series.format.fill.fore_color, *tones[i % len(tones)])
            series.format.line.fill.background()
        if mode == "stacked":
            labels.position = XL_LABEL_POSITION.CENTER
            for i, series in enumerate(plot.series):
                paint(series.data_labels.font.color, PAPER if i < 2 else INK)
        highlight = block.get("highlight")
        if not many and isinstance(highlight, int) and 0 <= highlight < len(block["categories"]):
            series = plot.series[0]
            for i in range(len(block["categories"])):
                point = series.points[i]
                point.format.fill.solid()
                paint(point.format.fill.fore_color, HILITE if i == highlight else GREY, 0.0 if i == highlight else 0.35)

    def formula(slide, block, x, y, w, h, size):
        """The calculation behind a number: terms with the operator between them, equal to the result."""
        terms, ops, result = block["terms"], block["ops"], block["result"]
        op_w = Inches(0.55)
        cols = len(terms) + 1
        cw = int((w - op_w * cols) / cols)
        top = y + int((h - Inches(1.95)) / 2) if h > Inches(1.95) else y
        # One number size for the whole line, the largest at which the longest value fits on one line.
        value_size = max(16, min(32, int((cw / IN * 72 - 8) / max(text_units(t["value"]) for t in list(terms) + [result]))))
        cx = x
        for i, term in enumerate(list(terms) + [result]):
            last = i == len(terms)
            if last:
                rect(slide, cx - Inches(0.1), top - Inches(0.1), cw + Inches(0.2), Inches(2.0), (HILITE, 0.88))
            text(slide, cx, top, cw, Inches(0.85), str(term["value"]), value_size, True, HILITE if last else MAIN, PP_ALIGN.CENTER, MSO_ANCHOR.BOTTOM)
            paragraphs = [{"text": term["label"], "size": min(size, 13), "bold": True, "align": PP_ALIGN.CENTER}]
            if term.get("note"):
                paragraphs.append({"text": term["note"], "size": min(size, 13) - 2, "theme": GREY, "before": 3, "align": PP_ALIGN.CENTER})
            text(slide, cx, top + Inches(0.95), cw, Inches(0.9), paragraphs, size)
            cx += cw
            if not last:
                text(slide, cx, top, op_w, Inches(0.85), ops[i] if i < len(ops) else "＝", 28, False, GREY, PP_ALIGN.CENTER, MSO_ANCHOR.BOTTOM)
                cx += op_w

    def image(slide, block, x, y, w, h, size):
        path = os.path.join(base_dir, block["path"])
        caption_h = Inches(0.32) if block.get("caption") else 0
        picture = slide.shapes.add_picture(path, int(x), int(y))
        scale = min(w / picture.width, (h - caption_h) / picture.height)
        picture.width, picture.height = int(picture.width * scale), int(picture.height * scale)
        picture.left, picture.top = int(x + (w - picture.width) / 2), int(y)
        picture.line.width = Pt(0.75)
        paint(picture.line.color, LIGHT)
        if caption_h:
            text(slide, x, y + picture.height + Inches(0.04), w, caption_h, block["caption"], size - 1, False, GREY, PP_ALIGN.CENTER)
        return y + picture.height + caption_h

    def before_after(slide, block, x, y, w, h, size):
        """Current and changed screens side by side; their notes start on one line under the taller picture."""
        mid = Inches(0.6)
        cw = int((w - mid) / 2)
        notes = [block[side].get("points") or [] for side in ("before", "after")]
        notes_h = Inches(max(bullets_height(n, cw / IN, size) for n in notes)) if any(notes) else 0
        bottoms = []
        for i, side in enumerate(("before", "after")):
            part = block[side]
            cx = x + (cw + mid) * i
            label = part.get("label") or ("現行" if side == "before" else "改修後")
            top = heading(slide, cx, y, cw, label, MAIN if side == "after" else GREY)
            bottoms.append(image(slide, {"path": part["path"], "caption": part.get("caption")}, cx, y + top + Inches(0.05), cw,
                                 h - top - notes_h - Inches(0.25), size))
        for i, points in enumerate(notes):
            if points:
                text(slide, x + (cw + mid) * i, max(bottoms) + Inches(0.15), cw, notes_h, [{"text": n, "bullet": True, "before": 3} for n in points], size)
        cy = y + int((max(bottoms) - y) / 2)
        text(slide, x + cw + int(mid / 2) - Inches(0.2), cy - Inches(0.2), Inches(0.4), Inches(0.4), "▶", 12, True, PAPER, PP_ALIGN.CENTER,
             MSO_ANCHOR.MIDDLE, fill=(MAIN,), shape=MSO_SHAPE.OVAL)

    # ---- richer pictures: journey, persona, service ecosystem, canvas ------------------------------
    def polyline(slide, points, theme=MAIN, width=2.25):
        """An open line through absolute points (a freeform with no fill)."""
        builder = slide.shapes.build_freeform(int(points[0][0]), int(points[0][1]))
        builder.add_line_segments([(int(px), int(py)) for px, py in points[1:]], close=False)
        shape = builder.convert_to_shape()
        shape.fill.background()
        paint(shape.line.color, theme)
        shape.line.width = Pt(width)
        shape.shadow.inherit = False
        return shape

    def arrow(slide, x1, y1, x2, y2, theme=GREY, width=1.5):
        """A straight horizontal or vertical arrow from (x1, y1) to (x2, y2)."""
        head = Inches(0.12)
        if abs(x2 - x1) >= abs(y2 - y1):
            step = head if x2 > x1 else -head
            rule(slide, x1, y1, x2 - step, y2, theme, width)
            polygon(slide, [(x2 - step, y2 - head / 2), (x2, y2), (x2 - step, y2 + head / 2)], theme)
        else:
            step = head if y2 > y1 else -head
            rule(slide, x1, y1, x2, y2 - step, theme, width)
            polygon(slide, [(x2 - head / 2, y2 - step), (x2, y2), (x2 + head / 2, y2 - step)], theme)

    def column_label(slide, x, y, w, h, label, size):
        text(slide, x, y, w, h, label, size, True, MAIN, anchor=MSO_ANCHOR.MIDDLE)

    def journey(slide, block, x, y, w, h, size):
        """Stages across; rows for what the customer does, feels (a curve), meets, suffers and where we can help."""
        stages = block["stages"]
        size = min(size, 11)
        label_w = Inches(1.15)
        gap = Inches(0.06)
        cw = int((w - label_w - gap * (len(stages) - 1)) / len(stages))
        col_x = [x + label_w + (cw + gap) * i for i in range(len(stages))]
        rows = [("actions", "行動"), ("emotion", "感情"), ("thoughts", "本音"), ("touchpoints", "接点"), ("pains", "課題"), ("opportunities", "機会")]
        rows = [r for r in rows if r[0] == "emotion" or any(s.get(r[0]) for s in stages)]
        head_h = Inches(0.5)
        for i, stage in enumerate(stages):
            shape = MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON
            box = rect(slide, col_x[i], y, cw + Inches(0.1), head_h, (MAIN,), shape=shape)
            try:
                box.adjustments[0] = 0.22
            except IndexError:
                pass
            text(slide, col_x[i] + Inches(0.18 if i else 0.08), y, cw - Inches(0.25), head_h, stage["name"], size + 1, True, PAPER,
                 PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
        def lines_of(stage, key):
            value = stage.get(key) or []
            return value if isinstance(value, list) else [value]
        need = {}
        for key, _ in rows:
            if key == "emotion":
                need[key] = Inches(1.05)
                continue
            most = max(bullets_height(lines_of(s, key), cw / IN - 0.1, size) for s in stages)
            need[key] = Inches(max(0.42, most + 0.12))
        free = h - head_h - Inches(0.08)
        total = sum(need.values())
        scale = min(1.0, free / total) if total else 1.0
        ry = y + head_h + Inches(0.08)
        for key, label in rows:
            rh = int(need[key] * scale) if total > free else need[key] + int((free - total) / len(rows))
            column_label(slide, x, ry, label_w - Inches(0.08), rh, label, size + 0.5)
            rule(slide, x, ry, x + w, ry, LIGHT, 0.75)
            if key == "emotion":
                mid = ry + int(rh / 2)
                rule(slide, x + label_w, mid, x + w, mid, LIGHT, 0.75, dash=True)
                text(slide, x + label_w - Inches(0.05), ry, Inches(0.3), Inches(0.25), "＋", size, True, GREY)
                text(slide, x + label_w - Inches(0.05), ry + rh - Inches(0.25), Inches(0.3), Inches(0.25), "－", size, True, GREY)
                points = []
                for i, stage in enumerate(stages):
                    score = max(-2, min(2, float(stage.get("emotion", 0))))
                    px = col_x[i] + int(cw / 2)
                    py = mid - int((rh / 2 - Inches(0.14)) * score / 2)
                    points.append((px, py))
                polyline(slide, points, MAIN, 2.25)
                for i, (px, py) in enumerate(points):
                    low = float(stages[i].get("emotion", 0)) <= -1
                    rect(slide, px - Inches(0.09), py - Inches(0.09), Inches(0.18), Inches(0.18), (HILITE if low else MAIN,), (PAPER,),
                         MSO_SHAPE.OVAL, 1.5)
            else:
                for i, stage in enumerate(stages):
                    items = lines_of(stage, key)
                    if not items:
                        continue
                    cx = col_x[i]
                    if key == "pains":
                        fill, ink = (HILITE, 0.88), INK
                    elif key == "opportunities":
                        fill, ink = (PALE, 0.55), MAIN
                    elif key == "touchpoints":
                        fill, ink = (LIGHT, 0.6), INK
                    else:
                        fill, ink = None, INK
                    paragraphs = [{"text": (f"「{t}」" if key == "thoughts" else t), "bullet": key not in ("thoughts",), "before": 2,
                                   "theme": ink, "bold": key == "opportunities"} for t in items]
                    text(slide, cx, ry + Inches(0.04), cw, rh - Inches(0.08), paragraphs, size, fill=fill, margin=0.06)
            ry += rh

    def persona(slide, block, x, y, w, h, size):
        """One person: who, in their words, what they want, what gets in the way, how they behave, and the numbers."""
        left_w = int(w * 0.3)
        gap = Inches(0.35)
        rx, rw = x + left_w + gap, w - left_w - gap
        # Who
        d = Inches(1.25)
        if block.get("image") and os.path.isfile(os.path.join(base_dir, block["image"])):
            pic = slide.shapes.add_picture(os.path.join(base_dir, block["image"]), int(x), int(y), int(d), int(d))
        else:
            rect(slide, x, y, d, d, (PALE, 0.35), shape=MSO_SHAPE.OVAL)
            text(slide, x, y, d, d, (block.get("initial") or block["name"][:1]), 40, True, MAIN, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
        tx = x + d + Inches(0.18)
        ny = y
        if block.get("tag"):
            text(slide, tx, y, Inches(text_units(block["tag"]) * 9 / 72 + 0.3), Inches(0.24), block["tag"], 9, True, PAPER, PP_ALIGN.CENTER,
                 MSO_ANCHOR.MIDDLE, fill=(HILITE if block.get("highlight") else MAIN,))
            ny = y + Inches(0.3)
        name_h = Inches(text_height(line_count(block["name"], (left_w - d) / IN - 0.2, 16), 16))
        text(slide, tx, ny, left_w - d - Inches(0.18), name_h, block["name"], 16, True, INK)
        if block.get("caption"):
            text(slide, tx, ny + name_h + Inches(0.04), left_w - d - Inches(0.18), Inches(0.62), block["caption"], size - 1, False, GREY)
        qy = y + d + Inches(0.2)
        if block.get("quote"):
            qh = Inches(text_height(line_count(block["quote"], left_w / IN - 0.35, size + 1), size + 1) + 0.25)
            rect(slide, x, qy, Inches(0.06), qh, (HILITE,))
            text(slide, x + Inches(0.18), qy, left_w - Inches(0.18), qh, f"「{block['quote']}」", size + 1, True, MAIN, anchor=MSO_ANCHOR.MIDDLE)
            qy += qh + Inches(0.15)
        facts = block.get("facts") or []
        if facts:
            top = heading(slide, x, qy, left_w, "プロフィール", MAIN, size + 1)
            fy = qy + top
            for fact in facts:
                text(slide, x, fy, Inches(1.1), Inches(0.3), fact["label"], size - 1, False, GREY, anchor=MSO_ANCHOR.MIDDLE)
                text(slide, x + Inches(1.1), fy, left_w - Inches(1.1), Inches(0.3), fact["value"], size - 0.5, True, INK, anchor=MSO_ANCHOR.MIDDLE)
                fy += Inches(0.3)
        # What they want, what blocks them, how they behave
        groups = [("goals", "目的・期待", MAIN), ("pains", "困りごと", HILITE), ("behaviors", "行動の特徴", GREY)]
        groups = [g for g in groups if block.get(g[0])]
        bars = block.get("bars") or []
        bars_h = Inches(0.42 * len(bars) + 0.55) if bars else 0
        cgap = Inches(0.25)
        cw = int((rw - cgap * (len(groups) - 1)) / max(1, len(groups)))
        lists_h = Inches(max([bullets_height(block[g[0]], cw / IN, size) for g in groups] + [0]) + 0.6)
        for i, (key, label, theme) in enumerate(groups):
            cx = rx + (cw + cgap) * i
            top = heading(slide, cx, y, cw, label, theme, size + 1)
            text(slide, cx, y + top, cw, lists_h - top, [{"text": t, "bullet": True, "before": 5} for t in block[key]], size)
        if bars:
            by = y + max(lists_h + Inches(0.3), int((h - bars_h) * 0.55))
            top = heading(slide, rx, by, rw, block.get("bars_heading", "利用の実態"), MAIN, size + 1)
            by += top
            label_w = Inches(2.2)
            track = rw - label_w - Inches(0.9)
            for bar in bars:
                ratio = max(0.0, min(1.0, float(bar.get("ratio", 0))))
                text(slide, rx, by, label_w, Inches(0.3), bar["label"], size - 0.5, False, INK, anchor=MSO_ANCHOR.MIDDLE)
                rect(slide, rx + label_w, by + Inches(0.08), track, Inches(0.16), (LIGHT, 0.6))
                rect(slide, rx + label_w, by + Inches(0.08), int(track * ratio) or 1, Inches(0.16), (HILITE if bar.get("highlight") else MAIN,))
                text(slide, rx + label_w + track + Inches(0.08), by, Inches(0.8), Inches(0.3), bar.get("value", f"{ratio:.0%}"), size - 0.5, True, INK,
                     anchor=MSO_ANCHOR.MIDDLE)
                by += Inches(0.42)

    def ecosystem(slide, block, x, y, w, h, size):
        """The service in the middle, the parties around it, and what flows between them (value, money, data)."""
        kinds = {"value": (MAIN, "価値・サービス"), "money": (HILITE, "お金"), "data": (SUB, "データ・送客")}
        legend_h = Inches(0.3)
        text(slide, x, y, w, legend_h, "", size)
        lx = x + w
        for key in ("data", "money", "value"):
            theme, label = kinds[key]
            lw = Inches(text_units(label) * 10 / 72 + 0.45)
            lx -= lw
            rule(slide, lx, y + legend_h / 2, lx + Inches(0.25), y + legend_h / 2, theme, 2.0)
            text(slide, lx + Inches(0.3), y, lw - Inches(0.3), legend_h, label, 10, False, GREY, anchor=MSO_ANCHOR.MIDDLE)
        y, h = y + legend_h + Inches(0.05), h - legend_h - Inches(0.05)
        cwid, chei = int(w * 0.3), int(h * 0.36)
        cx, cy = x + int((w - cwid) / 2), y + int((h - chei) / 2)
        center = block["center"]
        paragraphs = [{"text": center["label"], "size": size + 4, "bold": True, "theme": PAPER, "align": PP_ALIGN.CENTER}]
        paragraphs += [{"text": p, "bullet": True, "before": 3, "theme": PAPER, "size": size} for p in center.get("points") or []]
        text(slide, cx, cy, cwid, chei, paragraphs, size, fill=(MAIN,), anchor=MSO_ANCHOR.MIDDLE, margin=0.15)
        boxes = {"center": (cx, cy, cwid, chei, "center")}
        aw, ah = int(w * 0.22), int(h * 0.27)
        by_side = {}
        for actor in block["actors"]:
            by_side.setdefault(actor.get("side", "left"), []).append(actor)
        for side, actors in by_side.items():
            for i, actor in enumerate(actors):
                n = len(actors)
                if side in ("left", "right"):
                    ax = x if side == "left" else x + w - aw
                    span = h - ah
                    ay = y + (int(span * (i + 0.5) / n) if n > 1 else int(span / 2))
                    ay = y + int((h - ah) / 2) if n == 1 else y + int((h - ah) * i / (n - 1))
                else:
                    ay = y if side == "top" else y + h - ah
                    ax = x + int((w - aw) / 2) if n == 1 else x + int(w * 0.24) + int((w * 0.52 - aw) * i / (n - 1))
                rect(slide, ax, ay, aw, ah, (PAPER,), (LIGHT,), line_width=1.0)
                rect(slide, ax, ay, aw, Inches(0.07), (HILITE if actor.get("highlight") else SUB,))
                paragraphs = [{"text": actor["label"], "size": size + 1, "bold": True}]
                paragraphs += [{"text": p, "bullet": True, "before": 2, "size": size - 1} for p in actor.get("points") or []]
                text(slide, ax, ay + Inches(0.1), aw, ah - Inches(0.1), paragraphs, size, margin=0.1, anchor=MSO_ANCHOR.MIDDLE)
                boxes[actor["label"]] = (ax, ay, aw, ah, side)
        pairs = {}
        for flow in block.get("flows") or []:
            key = frozenset((flow["from"], flow["to"]))
            pairs.setdefault(key, []).append(flow)
        for key, flows in pairs.items():
            for k, flow in enumerate(flows):
                a, b = boxes.get(flow["from"]), boxes.get(flow["to"])
                if not a or not b:
                    continue
                theme = kinds.get(flow.get("kind", "value"), kinds["value"])[0]
                actor = a if a[4] != "center" else b
                side = actor[4]
                offset = Inches(0.16) * (k - (len(flows) - 1) / 2) * 2
                if side in ("left", "right"):
                    ly = max(cy + Inches(0.15), min(cy + chei - Inches(0.15), actor[1] + int(actor[3] / 2))) + offset
                    ax_ = actor[0] + actor[2] if side == "left" else actor[0]
                    cx_ = cx if side == "left" else cx + cwid
                    start, end = ((ax_, ly), (cx_, ly)) if a is actor else ((cx_, ly), (ax_, ly))
                    arrow(slide, start[0], start[1], end[0], end[1], theme, 2.0)
                    tx0, tx1 = min(ax_, cx_), max(ax_, cx_)
                    text(slide, tx0, ly - Inches(0.27) if offset <= 0 else ly + Inches(0.03), tx1 - tx0, Inches(0.24), flow.get("label", ""),
                         size - 1.5, True, theme, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
                else:
                    lx_ = max(cx + Inches(0.2), min(cx + cwid - Inches(0.2), actor[0] + int(actor[2] / 2))) + offset
                    ay_ = actor[1] + actor[3] if side == "top" else actor[1]
                    cy_ = cy if side == "top" else cy + chei
                    start, end = ((lx_, ay_), (lx_, cy_)) if a is actor else ((lx_, cy_), (lx_, ay_))
                    arrow(slide, start[0], start[1], end[0], end[1], theme, 2.0)
                    ty0 = min(ay_, cy_)
                    text(slide, lx_ + Inches(0.06) if offset >= 0 else lx_ - Inches(1.66), ty0, Inches(1.6), abs(cy_ - ay_), flow.get("label", ""),
                         size - 1.5, True, theme, PP_ALIGN.LEFT if offset >= 0 else PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)

    CANVAS = [("partners", "主要パートナー"), ("activities", "主要活動"), ("resources", "主要資源"), ("value", "提供価値"),
              ("relationships", "顧客との関係"), ("channels", "チャネル"), ("segments", "顧客セグメント"), ("costs", "コスト構造"),
              ("revenue", "収益の流れ")]

    def canvas(slide, block, x, y, w, h, size):
        """The nine-box business model canvas, the value proposition in the middle highlighted."""
        cells = block["cells"]
        size = min(size, 11)
        g = Inches(0.05)
        col = (w - g * 4) / 5
        top_h = int(h * 0.66)
        half = int((top_h - g) / 2)
        bottom = h - top_h - g
        def cell(key, cx, cy, cw, ch):
            label = dict(CANVAS)[key]
            hot = key == "value"
            rect(slide, cx, cy, cw, ch, (MAIN,) if hot else (LIGHT, 0.65))
            paragraphs = [{"text": label, "bold": True, "size": size + 0.5, "theme": PAPER if hot else MAIN}]
            paragraphs += [{"text": t, "bullet": True, "before": 3, "theme": PAPER if hot else INK} for t in cells.get(key) or []]
            text(slide, cx, cy, cw, ch, paragraphs, size, margin=0.1)
        c = [x + int((col + g) * i) for i in range(5)]
        cw = int(col)
        cell("partners", c[0], y, cw, top_h)
        cell("activities", c[1], y, cw, half)
        cell("resources", c[1], y + half + g, cw, half)
        cell("value", c[2], y, cw, top_h)
        cell("relationships", c[3], y, cw, half)
        cell("channels", c[3], y + half + g, cw, half)
        cell("segments", c[4], y, cw, top_h)
        bw = int((w - g) / 2)
        cell("costs", x, y + top_h + g, bw, bottom)
        cell("revenue", x + bw + g, y + top_h + g, w - bw - g, bottom)

    # ---- numbers in pictures: funnel, tornado, scatter ---------------------------------------------
    def funnel(slide, block, x, y, w, h, size):
        """Stages from the widest to the narrowest, the rate between each, the biggest leak marked."""
        stages = block["stages"]
        values = [parse_number(s["value"]) or 0 for s in stages]
        top = max(values) or 1
        label_w, rate_w = Inches(2.0), Inches(1.9)
        track = w - label_w - rate_w
        rows = len(stages)
        rh = min(Inches(0.75), int(h / rows))
        oy = y + int((h - rh * rows) / 2)
        rates = [values[i + 1] / values[i] if values[i] else 0 for i in range(rows - 1)]
        worst = min(range(len(rates)), key=lambda i: rates[i]) if rates else None
        for i, stage in enumerate(stages):
            ry = oy + rh * i
            bw = max(int(track * values[i] / top), Inches(0.5))
            bx = x + label_w + int((track - bw) / 2)
            text(slide, x, ry, label_w - Inches(0.1), rh, stage["label"], size, True, INK, anchor=MSO_ANCHOR.MIDDLE)
            text(slide, bx, ry + Inches(0.05), bw, rh - Inches(0.1), str(stage["value"]), size + 1, True, PAPER, PP_ALIGN.CENTER,
                 MSO_ANCHOR.MIDDLE, fill=(MAIN, 0.0 if i == 0 else min(0.5, 0.12 * i)))
            if i < rows - 1:
                hot = i == worst
                label = stages[i + 1].get("rate") or f"{rates[i]:.0%}"
                text(slide, x + w - rate_w + Inches(0.1), ry + int(rh / 2), rate_w - Inches(0.1), rh, f"↓ {label}", size, True,
                     HILITE if hot else GREY, anchor=MSO_ANCHOR.MIDDLE)
        if worst is not None and block.get("note"):
            text(slide, x + w - rate_w + Inches(0.1), oy + rh * rows - Inches(0.3), rate_w, Inches(0.6), block["note"], size - 1, False, HILITE)

    def tornado(slide, block, x, y, w, h, size):
        """What moves the result most: each assumption's low and high case around the base, widest first."""
        items = sorted(block["items"], key=lambda it: -abs(float(it["high"]) - float(it["low"])))
        base = float(block["base"])
        lows = [float(i["low"]) for i in items]
        highs = [float(i["high"]) for i in items]
        span = max(abs(base - min(lows + [base])), abs(max(highs + [base]) - base)) or 1
        label_w = Inches(2.7)
        text(slide, x, y, w, Inches(0.3), block["unit"], size, True, INK, anchor=MSO_ANCHOR.MIDDLE)
        rule(slide, x, y + Inches(0.34), x + w, y + Inches(0.34), MAIN, 1.0)
        top = y + Inches(0.5)
        track = w - label_w - Inches(0.2)
        mid = x + label_w + int(track / 2)
        rh = min(Inches(0.55), int((h - Inches(0.8)) / max(1, len(items))))
        for i, item in enumerate(items):
            ry = top + rh * i
            text(slide, x, ry, label_w - Inches(0.1), rh, item["label"], size, True, INK, anchor=MSO_ANCHOR.MIDDLE)
            lo, hi = float(item["low"]), float(item["high"])
            lx = mid - int(track / 2 * (base - lo) / span)
            hx = mid + int(track / 2 * (hi - base) / span)
            if lx < mid:
                rect(slide, lx, ry + Inches(0.1), mid - lx, rh - Inches(0.2), (HILITE, 0.2))
                vx = max(lx - Inches(0.9), x + label_w)
                text(slide, vx, ry, lx - vx - Inches(0.05) if lx - vx > Inches(0.4) else Inches(0.85), rh, item.get("low_label", f"{lo:g}"), size - 1,
                     False, PAPER if lx - vx <= Inches(0.4) else INK, PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)
            if hx > mid:
                rect(slide, mid, ry + Inches(0.1), hx - mid, rh - Inches(0.2), (MAIN,))
                text(slide, hx + Inches(0.05), ry, Inches(0.9), rh, item.get("high_label", f"{hi:g}"), size - 1, False, INK, anchor=MSO_ANCHOR.MIDDLE)
        rule(slide, mid, top - Inches(0.05), mid, top + rh * len(items) + Inches(0.05), INK, 1.25)
        text(slide, mid - Inches(1.5), top + rh * len(items) + Inches(0.05), Inches(3.0), Inches(0.28),
             f"{block.get('base_label', '基本ケース')}：{block.get('base_text', f'{base:g}')}", size - 1, True, INK, PP_ALIGN.CENTER)

    def scatter(slide, block, x, y, w, h, size):
        """Two measured axes, each point named, the averages as dashed lines, the corners named."""
        pts = block["points"]
        pad_l, pad_b = Inches(0.5), Inches(0.45)
        gx, gy, gw, gh = x + pad_l, y + Inches(0.3), w - pad_l - Inches(0.2), h - Inches(0.3) - pad_b
        xs = [float(p["x"]) for p in pts]
        ys = [float(p["y"]) for p in pts]
        x0, x1 = block.get("x_range", [min(xs), max(xs)])
        y0, y1 = block.get("y_range", [min(ys), max(ys)])
        x0, x1 = x0 - (x1 - x0) * 0.08, x1 + (x1 - x0) * 0.08
        y0, y1 = y0 - (y1 - y0) * 0.1, y1 + (y1 - y0) * 0.1
        X = lambda v: gx + int(gw * (v - x0) / ((x1 - x0) or 1))
        Y = lambda v: gy + gh - int(gh * (v - y0) / ((y1 - y0) or 1))
        rule(slide, gx, gy, gx, gy + gh, GREY, 1.25)
        rule(slide, gx, gy + gh, gx + gw, gy + gh, GREY, 1.25)
        arrow_head(slide, gx, gy - Inches(0.02), "up")
        arrow_head(slide, gx + gw, gy + gh, "right")
        text(slide, gx + Inches(0.1), y, gw, Inches(0.26), f"{block['y']}（上ほど{block.get('y_high', '高い')}）", 11, True, GREY, anchor=MSO_ANCHOR.MIDDLE)
        text(slide, gx, gy + gh + Inches(0.1), gw, Inches(0.28), f"{block['x']}（右ほど{block.get('x_high', '高い')}）", 11, True, GREY, PP_ALIGN.RIGHT)
        if block.get("x_ref") is not None:
            rule(slide, X(float(block["x_ref"])), gy, X(float(block["x_ref"])), gy + gh, SUB, 1.0, dash=True)
        if block.get("y_ref") is not None:
            rule(slide, gx, Y(float(block["y_ref"])), gx + gw, Y(float(block["y_ref"])), SUB, 1.0, dash=True)
        for corner, (cx_, cy_, align) in zip(block.get("corners") or [], [(gx + Inches(0.1), gy, PP_ALIGN.LEFT), (gx + gw - Inches(2.6), gy, PP_ALIGN.RIGHT),
                                                                       (gx + Inches(0.1), gy + gh - Inches(0.3), PP_ALIGN.LEFT), (gx + gw - Inches(2.6), gy + gh - Inches(0.3), PP_ALIGN.RIGHT)]):
            if corner:
                text(slide, cx_, cy_, Inches(2.5), Inches(0.3), corner, size - 1, True, SUB, align, MSO_ANCHOR.MIDDLE)
        for p in pts:
            d = Inches(0.16 + 0.2 * float(p.get("size", 0.3)))
            px, py = X(float(p["x"])), Y(float(p["y"]))
            hot = p.get("highlight")
            rect(slide, px - d / 2, py - d / 2, d, d, (HILITE if hot else MAIN, 0.0 if hot else 0.25), (PAPER,), MSO_SHAPE.OVAL, 1.0)
            lw = Inches(text_units(p["label"]) * (size - 0.5) / 72 + 0.15)
            right = px + d / 2 + Inches(0.05) + lw <= gx + gw
            text(slide, px + d / 2 + Inches(0.05) if right else px - d / 2 - Inches(0.05) - lw, py - Inches(0.15), lw, Inches(0.3), p["label"],
                 size - 0.5, bool(hot), HILITE if hot else INK, PP_ALIGN.LEFT if right else PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)

    # ---- comparisons and flows in words ------------------------------------------------------------
    def from_to(slide, block, x, y, w, h, size):
        """Today and the target, row against row, with the arrow in the middle."""
        rows = block["rows"]
        mid = Inches(0.7)
        cw = int((w - mid) / 2)
        heights = [Inches(max(text_height(line_count(r["from"], cw / IN - 0.4, size), size), text_height(line_count(r["to"], cw / IN - 0.6, size), size)) + 0.22)
                   for r in rows]
        body = sum(heights)
        head = Inches(0.55)
        for i, (label, theme) in enumerate(((block.get("from_label", "現状"), GREY), (block.get("to_label", "目指す姿"), MAIN))):
            px = x + (cw + mid) * i
            rect(slide, px, y, cw, head + body + Inches(0.15), (PAPER,), (theme,), line_width=1.5 if i else 0.75)
            text(slide, px + Inches(0.15), y + Inches(0.05), cw - Inches(0.3), Inches(0.42), label, size + 2, True, theme, anchor=MSO_ANCHOR.MIDDLE)
            rule(slide, px + Inches(0.15), y + Inches(0.5), px + cw - Inches(0.15), y + Inches(0.5), theme, 1.0)
        ry = y + head
        for k, (row, rh) in enumerate(zip(rows, heights)):
            text(slide, x + Inches(0.15), ry, cw - Inches(0.3), rh, row["from"], size, False, INK, anchor=MSO_ANCHOR.MIDDLE)
            chip(slide, x + cw + mid + Inches(0.12), ry + int(rh / 2) - Inches(0.14), chr(65 + k), MAIN, 0.28, 10)
            text(slide, x + cw + mid + Inches(0.5), ry, cw - Inches(0.65), rh, row["to"], size, True, INK, anchor=MSO_ANCHOR.MIDDLE)
            if k < len(rows) - 1:
                rule(slide, x + Inches(0.15), ry + rh, x + cw - Inches(0.15), ry + rh, LIGHT, 0.75)
                rule(slide, x + cw + mid + Inches(0.15), ry + rh, x + w - Inches(0.15), ry + rh, LIGHT, 0.75)
            ry += rh
        cy = y + int((head + body) / 2)
        text(slide, x + cw + int(mid / 2) - Inches(0.22), cy - Inches(0.22), Inches(0.44), Inches(0.44), "▶", 13, True, PAPER, PP_ALIGN.CENTER,
             MSO_ANCHOR.MIDDLE, fill=(MAIN,), shape=MSO_SHAPE.OVAL)

    def two_tier(slide, block, x, y, w, h, size):
        """What the customer does, step by step, and below each step what runs behind it."""
        steps_ = block["steps"]
        label_w = Inches(1.15)
        gap = Inches(0.08)
        cw = int((w - label_w - gap * (len(steps_) - 1)) / len(steps_))
        labels = block.get("labels") or ["利用者の体験", "裏側の処理"]
        front_h = Inches(1.15)
        text(slide, x, y, label_w - Inches(0.1), front_h, labels[0], size + 0.5, True, MAIN, anchor=MSO_ANCHOR.MIDDLE)
        back_y = y + front_h + Inches(0.45)
        back_h = h - front_h - Inches(0.45)
        text(slide, x, back_y, label_w - Inches(0.1), back_h, labels[1], size + 0.5, True, MAIN, anchor=MSO_ANCHOR.MIDDLE)
        rule(slide, x, back_y - Inches(0.22), x + w, back_y - Inches(0.22), LIGHT, 0.75, dash=True)
        for i, step in enumerate(steps_):
            cx = x + label_w + (cw + gap) * i
            hot = step.get("highlight")
            shape = MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON
            box = rect(slide, cx, y, cw + Inches(0.1), front_h, (MAIN,) if hot else (LIGHT, 0.6), shape=shape)
            try:
                box.adjustments[0] = 0.18
            except IndexError:
                pass
            paragraphs = [{"text": f"{i + 1}", "size": size + 2, "bold": True, "theme": PAPER if hot else HILITE},
                          {"text": step["title"], "size": size + 1, "bold": True, "theme": PAPER if hot else INK}]
            paragraphs += [{"text": t, "size": size - 1, "theme": PAPER if hot else INK, "before": 2} for t in step.get("front") or []]
            text(slide, cx + Inches(0.32 if i else 0.12), y, cw - Inches(0.42 if i else 0.3), front_h, paragraphs, size, anchor=MSO_ANCHOR.MIDDLE)
            polygon(slide, [(cx + int(cw / 2) - Inches(0.14), y + front_h + Inches(0.08)), (cx + int(cw / 2) + Inches(0.14), y + front_h + Inches(0.08)),
                            (cx + int(cw / 2), y + front_h + Inches(0.3))], PALE)
            back = step.get("back") or []
            text(slide, cx, back_y, cw, back_h, [{"text": t, "bullet": True, "before": 3, "bold": hot and j == 0} for j, t in enumerate(back)],
                 size, fill=(PALE, 0.75) if hot else None, margin=0.08)

    def chain(slide, block, x, y, w, h, size):
        """Rows that read left to right: the problem, why it happens, what we do about it."""
        labels = block.get("columns") or ["課題", "原因", "打ち手"]
        rows = block["rows"]
        mid = Inches(0.4)
        cw = int((w - mid * 2) / 3)
        cols = [x, x + cw + mid, x + (cw + mid) * 2]
        for i, label in enumerate(labels):
            heading(slide, cols[i], y, cw, label, (GREY, GREY, MAIN)[i], size + 1)
            if i < 2:
                polygon(slide, [(cols[i] + cw + Inches(0.12), y + Inches(0.12)), (cols[i] + cw + Inches(0.3), y + Inches(0.25)), (cols[i] + cw + Inches(0.12), y + Inches(0.38))], PALE)
        ry = y + Inches(0.55)
        for k, row in enumerate(rows):
            rh = Inches(max(text_height(line_count(c, cw / IN - 0.1, size), size) for c in row) + 0.24)
            for i, cell_ in enumerate(row[:3]):
                text(slide, cols[i], ry, cw, rh, cell_, size, i == 2, MAIN if i == 2 else INK, anchor=MSO_ANCHOR.MIDDLE)
            if k < len(rows) - 1:
                rule(slide, x, ry + rh, x + w, ry + rh, LIGHT, 0.75, dash=True)
            ry += rh

    def options(slide, block, x, y, w, h, size):
        """The question on the left; the options branch to the right, the recommended one framed."""
        left_w = int(w * 0.36)
        gap = Inches(0.45)
        rect(slide, x, y, Inches(0.08), h, (MAIN,))
        paragraphs = [{"text": block.get("label", "決めていただきたいこと"), "size": size - 1, "theme": GREY, "bold": True},
                      {"text": block["question"], "size": size + 6, "bold": True, "theme": INK, "before": 6}]
        paragraphs += [{"text": t, "size": size - 0.5, "bullet": True, "before": 4} for t in block.get("context") or []]
        text(slide, x + Inches(0.25), y, left_w - Inches(0.25), h, paragraphs, size, anchor=MSO_ANCHOR.MIDDLE)
        opts = block["options"]
        ox = x + left_w + gap
        ow = w - left_w - gap
        oh = int((h - Inches(0.15) * (len(opts) - 1)) / len(opts))
        trunk = ox - Inches(0.22)
        rule(slide, trunk, y + int(oh / 2), trunk, y + h - int(oh / 2), LIGHT, 1.25)
        for i, opt in enumerate(opts):
            oy = y + (oh + Inches(0.15)) * i
            rec = opt.get("recommended")
            rule(slide, trunk, oy + int(oh / 2), ox, oy + int(oh / 2), MAIN if rec else LIGHT, 2.0 if rec else 1.25)
            rect(slide, ox, oy, ow, oh, (PAPER,), (MAIN if rec else LIGHT,), line_width=2.0 if rec else 1.0)
            if rec:
                text(slide, ox + ow - Inches(0.85), oy + Inches(0.08), Inches(0.75), Inches(0.26), "推奨", 10, True, PAPER, PP_ALIGN.CENTER,
                     MSO_ANCHOR.MIDDLE, fill=(HILITE,))
            paragraphs = [{"text": opt["name"], "size": size + 1, "bold": True, "theme": MAIN if rec else INK}]
            if opt.get("body"):
                paragraphs.append({"text": opt["body"], "size": size - 0.5, "before": 3})
            if opt.get("result"):
                paragraphs.append({"text": "→ " + opt["result"], "size": size - 1, "bold": True, "theme": GREY, "before": 3})
            text(slide, ox + Inches(0.12), oy, ow - Inches(1.0), oh, paragraphs, size, anchor=MSO_ANCHOR.MIDDLE)

    def evidence(slide, block, x, y, w, h, size):
        """Dated evidence cards, two by two: what kind, when, what happened, what it means."""
        items = block["items"]
        cols = 2 if len(items) <= 4 else 3
        rows = (len(items) + cols - 1) // cols
        g = Inches(0.15)
        cw, ch = int((w - g * (cols - 1)) / cols), int((h - g * (rows - 1)) / rows)
        for i, item in enumerate(items):
            cx, cy = x + (cw + g) * (i % cols), y + (ch + g) * (i // cols)
            rect(slide, cx, cy, cw, ch, (LIGHT, 0.7))
            tw = Inches(text_units(item.get("tag", "")) * 9 / 72 + 0.3)
            text(slide, cx + Inches(0.15), cy + Inches(0.12), tw, Inches(0.24), item.get("tag", ""), 9, True, PAPER, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE,
                 fill=(HILITE if item.get("highlight") else MAIN,))
            text(slide, cx + Inches(0.25) + tw, cy + Inches(0.12), cw - tw - Inches(0.4), Inches(0.24), item.get("date", ""), 9, False, GREY, anchor=MSO_ANCHOR.MIDDLE)
            paragraphs = [{"text": item["title"], "size": size + 1, "bold": True}]
            paragraphs += [{"text": t, "bullet": True, "before": 3} for t in (item.get("points") or ([item["body"]] if item.get("body") else []))]
            if item.get("so_what"):
                paragraphs.append({"text": "→ " + item["so_what"], "bold": True, "theme": MAIN, "before": 5})
            text(slide, cx + Inches(0.15), cy + Inches(0.45), cw - Inches(0.3), ch - Inches(0.55), paragraphs, size)

    def qa(slide, block, x, y, w, h, size):
        """Questions in the asker's words, each answered conclusion first."""
        items = block["items"]
        qw = int(w * 0.42)
        aw = w - qw - Inches(0.3)
        heights = [Inches(max(text_height(line_count(it["q"], qw / IN - 0.5, size + 0.5), size + 0.5),
                              bullets_height(it["a"] if isinstance(it["a"], list) else [it["a"]], aw / IN, size)) + 0.25) for it in items]
        scale = min(1.0, h / sum(heights)) if heights else 1
        ry = y
        for k, (item, rh) in enumerate(zip(items, heights)):
            rh = int(rh * scale)
            text(slide, x, ry + Inches(0.08), Inches(0.4), Inches(0.3), f"Q{k + 1}", size + 1, True, HILITE)
            text(slide, x + Inches(0.45), ry, qw - Inches(0.5), rh, f"「{item['q']}」", size + 0.5, True, INK, anchor=MSO_ANCHOR.MIDDLE)
            rule(slide, x + qw + Inches(0.15), ry + Inches(0.08), x + qw + Inches(0.15), ry + rh - Inches(0.08), LIGHT, 1.0, dash=True)
            answers = item["a"] if isinstance(item["a"], list) else [item["a"]]
            text(slide, x + qw + Inches(0.3), ry, aw, rh, [{"text": t, "bullet": len(answers) > 1, "before": 3, "bold": j == 0} for j, t in enumerate(answers)],
                 size, anchor=MSO_ANCHOR.MIDDLE)
            ry += rh
            if k < len(items) - 1:
                rule(slide, x, ry, x + w, ry, LIGHT, 0.75)

    def voices(slide, block, x, y, w, h, size):
        """What customers said, in their words: a face, who they are, a speech balloon, and what it shows."""
        items = block["items"]
        cols = 2 if len(items) <= 4 else 3
        rows = (len(items) + cols - 1) // cols
        g = Inches(0.25)
        cw = int((w - g * (cols - 1)) / cols)
        ch = int((h - Inches(0.15) * (rows - 1)) / rows)
        face = Inches(0.62)
        for i, item in enumerate(items):
            cx, cy = x + (cw + g) * (i % cols), y + (ch + Inches(0.15)) * (i // cols)
            hot = item.get("highlight")
            rect(slide, cx, cy + Inches(0.05), face, face, (HILITE if hot else PALE, 0.0 if hot else 0.3), shape=MSO_SHAPE.OVAL)
            text(slide, cx, cy + Inches(0.05), face, face, item.get("initial") or str(item.get("who", "?"))[:1], 18, True, PAPER if hot else MAIN,
                 PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
            text(slide, cx - Inches(0.1), cy + face + Inches(0.08), face + Inches(0.2), ch - face - Inches(0.1), item.get("who", ""), size - 3, False, GREY,
                 PP_ALIGN.CENTER)
            bx, bw = cx + face + Inches(0.25), cw - face - Inches(0.25)
            balloon = rect(slide, bx, cy, bw, ch - Inches(0.05), (PALE, 0.65) if hot else (LIGHT, 0.6), shape=MSO_SHAPE.RECTANGULAR_CALLOUT)
            try:
                balloon.adjustments[0] = -0.5 - 0.22 * IN / bw
                balloon.adjustments[1] = -0.5 + 0.38 * IN / (ch - Inches(0.05))
            except IndexError:
                pass
            paragraphs = []
            if item.get("tag"):
                paragraphs.append({"text": item["tag"], "size": size - 2, "bold": True, "theme": HILITE if hot else SUB})
            paragraphs.append({"text": f"「{item['quote']}」", "size": size, "bold": False, "before": 2})
            if item.get("so_what"):
                paragraphs.append({"text": "→ " + item["so_what"], "size": size - 1, "bold": True, "theme": MAIN, "before": 4})
            text(slide, bx + Inches(0.12), cy, bw - Inches(0.24), ch - Inches(0.05), paragraphs, size, anchor=MSO_ANCHOR.MIDDLE)

    def house(slide, block, x, y, w, h, size):
        """The aim as the roof, the pillars that carry it, the shared foundation underneath."""
        roof_h, base_h = Inches(0.85), Inches(0.7)
        polygon(slide, [(x, y + roof_h), (x + int(w / 2), y), (x + w, y + roof_h)], MAIN)
        text(slide, x + int(w * 0.2), y + Inches(0.25), int(w * 0.6), roof_h - Inches(0.25), block["roof"], size + 3, True, PAPER, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
        pillars = block["pillars"]
        g = Inches(0.12)
        py = y + roof_h + Inches(0.1)
        ph = h - roof_h - base_h - Inches(0.2)
        pw = int((w - g * (len(pillars) - 1)) / len(pillars))
        for i, p in enumerate(pillars):
            px = x + (pw + g) * i
            rect(slide, px, py, pw, ph, (LIGHT, 0.6))
            rect(slide, px, py, pw, Inches(0.06), (HILITE if p.get("highlight") else SUB,))
            paragraphs = [{"text": p["title"], "size": size + 1, "bold": True, "theme": MAIN}]
            paragraphs += [{"text": t, "bullet": True, "before": 4} for t in p.get("points") or []]
            text(slide, px, py + Inches(0.1), pw, ph - Inches(0.1), paragraphs, size, margin=0.12)
        by = py + ph + Inches(0.1)
        text(slide, x, by, w, base_h, block["foundation"], size + 1, True, PAPER, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, fill=(INK,))

    RENDER = {"summary": summary, "bullets": bullets, "table": table, "cards": cards, "stats": stats, "steps": steps,
              "formula": formula, "callout": callout, "tree": tree, "matrix2x2": matrix, "timeline": timeline, "chart_bar": chart_bar,
              "image": image, "before_after": before_after, "journey": journey, "persona": persona, "ecosystem": ecosystem,
              "canvas": canvas, "funnel": funnel, "tornado": tornado, "scatter": scatter, "from_to": from_to, "two_tier": two_tier,
              "chain": chain, "options": options, "evidence": evidence, "qa": qa, "house": house, "voices": voices}

    # ---- page layout: left facts stacked, right implication ------------------
    def body_size(blocks, w_in, h_in):
        """12pt by default; a short page reads at 13-14pt instead of leaving the bottom empty."""
        for size in (14, 13, 12):
            heights = [natural(b, w_in, size) for b in blocks]
            if any(height is None for height in heights):
                return 12
            if sum(heights) + 0.25 * (len(blocks) - 1) <= h_in * 0.75:
                return size
        return 12

    def right_height(block, gaps, w_in, size):
        used = 0.0
        if block:
            used += 0.5 + bullets_height(block["items"], w_in, size + 1)
        if gaps:
            used += (0.35 if block else 0) + 0.5 + bullets_height(gaps, w_in, size)
        return used

    def lay_out(slide, blocks, gaps, x, y, w, h, columns=False, dense=False):
        right = next((b for b in blocks if b["kind"] == "implication"), None)
        left = [b for b in blocks if b["kind"] != "implication"]
        right_w = int(w * 0.3) if right or gaps else 0
        left_w = w - right_w - (Inches(0.5) if right_w else 0)
        size = (11 if dense else body_size(left, left_w / IN, h / IN)) if left else 12
        if columns and len(left) > 1:
            gap = Inches(0.35)
            cw = int((left_w - gap * (len(left) - 1)) / len(left))
            naturals = [natural(b, cw / IN, size) for b in left]
            flexible = any(n is None for n in naturals)
            used = h if flexible else Inches(max(naturals))
            slots = [(x + (cw + gap) * i, 0, cw, used) for i in range(len(left))]
        else:
            gap = Inches(0.3)
            naturals = [natural(b, left_w / IN, size) for b in left]
            flexible = any(n is None for n in naturals)
            fixed = sum(Inches(n) for n in naturals if n is not None)
            free = h - fixed - gap * (len(left) - 1)
            count = sum(1 for n in naturals if n is None)
            heights = [Inches(n) if n is not None else int(free / count) for n in naturals]
            used = sum(heights) + gap * (len(left) - 1)
            if used > h:
                spare = h - gap * (len(left) - 1)
                heights = [int(height * spare / (used - gap * (len(left) - 1))) for height in heights]
                used = h
            slots, offset = [], 0
            for height in heights:
                slots.append((x, offset, left_w, height))
                offset += height + gap
        # Both columns start on one line; a short page is centred as a whole, never stretched.
        group = max(used, Inches(right_height(right, gaps, right_w / IN, size))) if right_w else used
        squeezed = (sum(Inches(n) for n in naturals if n is not None) if not (columns and len(left) > 1) else 0) > h
        if squeezed or (right_w and Inches(right_height(right, gaps, right_w / IN, size)) > h):
            layout_notes.append(f"{current[0]}: more than the page holds; split it or cut rows")
        elif not flexible and group < h * 0.35:
            layout_notes.append(f"{current[0]}: the page is mostly empty; merge it with a neighbour or add material, never padding")
        top = y if flexible or group >= h * 0.7 else y + int((h - group) / 2)
        for block, (bx, by, bw, bh) in zip(left, slots):
            RENDER[block["kind"]](slide, block, bx, top + by, bw, bh, size)
        if right_w:
            rx = x + left_w + Inches(0.5)
            if right:  # the triangle reads "therefore"; gaps alone are not an implication
                triangle(slide, x + left_w + Inches(0.16), top + int(min(group, h) / 2))
            implication(slide, right, rx, top, right_w, h - (top - y), size, gaps)

    layout_notes, current = [], [""]
    pages = {p.get("id"): p for p in spec.get("pages") or []}
    statuses = {pid: (page.get("status") or "missing") for pid, page in pages.items()}

    # ---- the agenda: every chapter, its pages and how far each is considered --
    def agenda(slide, x, y, w, h):
        chapters = [s for s in catalog["sections"] if s["id"] != "summary"]
        legend_w = Inches(5.5)
        mark = Inches(0.17)
        lx = x + w - legend_w
        for i, (label, fill, line) in enumerate((("検討済み", (MAIN,), None), ("一部未検討", (PALE,), None), ("未検討", None, (HILITE,)))):
            cx = lx + Inches(1.8) * i + Inches(0.6)
            rect(slide, cx, y + Inches(0.05), mark, mark, fill, line, line_width=1.25)
            text(slide, cx + Inches(0.24), y, Inches(1.4), Inches(0.27), label, 10, False, GREY, anchor=MSO_ANCHOR.MIDDLE)
        top = y + Inches(0.42)
        columns = [("章", Inches(2.9)), ("ページ", w - Inches(2.9) - Inches(2.6) - Inches(1.0)), ("検討状況", Inches(2.6)), ("ページ番号", Inches(1.0))]
        cx = x
        for label, cw in columns:
            text(slide, cx, top, cw, Inches(0.32), label, 13, True, MAIN, PP_ALIGN.RIGHT if label == "ページ番号" else PP_ALIGN.LEFT, MSO_ANCHOR.BOTTOM)
            cx += cw
        rule(slide, x, top + Inches(0.37), x + w, top + Inches(0.37), MAIN, 1.75)
        row_h = min(Inches(0.62), int((h - Inches(0.85)) / len(chapters)))
        ry = top + Inches(0.42)
        for ci, chapter in enumerate(chapters):
            members = [p for p in catalog["pages"] if p["section"] == chapter["id"]]
            text(slide, x, ry, columns[0][1], row_h, chapter["title"], 13, True, INK, anchor=MSO_ANCHOR.MIDDLE)
            # The chapter's pages in one or two lines; a long chapter ends with how many more it holds.
            room = 2 * ((columns[1][1] - Inches(0.3)) / IN * 72 / 10)
            shown, used_units = [], 0.0
            for m in members:
                need = text_units(m["topic"]) + 1
                if used_units + need > room - 5 and shown:
                    break
                shown.append(m["topic"])
                used_units += need
            listing = "・".join(shown) + (f" ほか{len(members) - len(shown)}ページ" if len(shown) < len(members) else "")
            text(slide, x + columns[0][1], ry, columns[1][1] - Inches(0.2), row_h, listing, 10, False, INK, anchor=MSO_ANCHOR.MIDDLE)
            sx = x + columns[0][1] + columns[1][1]
            missing = 0
            step = min(Inches(0.3), int((columns[2][1] - Inches(1.0)) / max(1, len(members))))
            for mi, member in enumerate(members):
                state = statuses.get(member["id"], "missing")
                missing += state == "missing"
                fill = (MAIN,) if state == "done" else (PALE,) if state == "partial" else None
                rect(slide, sx + step * mi, ry + int(row_h / 2) - int(mark / 2), min(mark, step - Inches(0.04)), min(mark, step - Inches(0.04)), fill,
                     (HILITE,) if state == "missing" else None, line_width=1.25)
            if missing:
                text(slide, sx + step * len(members) + Inches(0.05), ry, Inches(1.0), row_h, f"未検討 {missing}", 10, True, HILITE,
                     anchor=MSO_ANCHOR.MIDDLE)
            numbers = [divider_number.get(chapter["id"], page_number[members[0]["id"]])] + [page_number[p["id"]] for p in members]
            span = f"P.{numbers[0]}" if len(numbers) == 1 else f"P.{numbers[0]}–{numbers[-1]}"
            text(slide, x + w - columns[3][1], ry, columns[3][1], row_h, span, 11, False, GREY, PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)
            ry += row_h
            if ci < len(chapters) - 1:
                rule(slide, x, ry, x + w, ry, LIGHT, 0.75)

    # ---- a page without material: its questions, where they get answered, the intended shape --
    def missing_page(slide, meta, x, y, w, h):
        right_w = int(w * 0.33)
        left_w = w - right_w - Inches(0.5)
        questions = meta.get("questions") or []
        top = heading(slide, x, y, left_w, "このページで答える問い")
        qy = y + top + Inches(0.05)
        row_h = int((h - top - Inches(0.05)) / max(1, len(questions))) if questions else 0
        for i, question in enumerate(questions):
            chip(slide, x, qy + Inches(0.06), i + 1, MAIN, 0.34, 12)
            text(slide, x + Inches(0.5), qy, left_w - Inches(0.5), Inches(0.46), question, 14, True, INK, anchor=MSO_ANCHOR.MIDDLE)
            text(slide, x + Inches(0.5), qy + Inches(0.5), left_w - Inches(0.5), row_h - Inches(0.68), "検討結果を記入", 10, False, GREY,
                 fill=(LIGHT, 0.75), margin=0.1)
            qy += row_h
        rx = x + left_w + Inches(0.5)
        top = heading(slide, rx, y, right_w, "埋めるための材料", HILITE)
        stages = meta.get("sources") or []
        names = [{"text": stage_names.get(s, s), "bullet": True, "before": 5} for s in stages] or [{"text": "—"}]
        text(slide, rx, y + top, right_w, Inches(0.4) * len(names) + Inches(0.1), names, 13)
        sy = y + top + Inches(0.4) * len(names) + Inches(0.45)
        top = heading(slide, rx, sy, right_w, "想定する見せ方", GREY)
        text(slide, rx, sy + top, right_w, Inches(1.2), meta.get("shape", ""), 13, False, INK)

    # ---- a chapter's divider: the chapters with this one lit, and what this chapter answers --
    def divider(slide, chapter):
        chapters = [s for s in catalog["sections"] if s["id"] != "summary"]
        x, y, w, h = X0, Y0, X1 - X0, Y1 - Y0
        left_w = int(w * 0.36)
        row_h = min(Inches(0.42), int(h / len(chapters)))
        for i, c in enumerate(chapters):
            cy = y + row_h * i
            here = c["id"] == chapter["id"]
            text(slide, x, cy + Inches(0.03), left_w, row_h - Inches(0.06), c["title"], 13 if here else 12, here, PAPER if here else GREY,
                 anchor=MSO_ANCHOR.MIDDLE, fill=(MAIN,) if here else None, margin=0.12)
        rx = x + left_w + Inches(0.5)
        rw = w - left_w - Inches(0.5)
        top = heading(slide, rx, y, rw, "この章で答えること")
        members = [p for p in catalog["pages"] if p["section"] == chapter["id"]]
        py = y + top + Inches(0.05)
        titles = [((pages.get(m["id"]) or {}).get("title") if statuses.get(m["id"], "missing") != "missing" else "") or m["topic"] for m in members]
        font = 12
        while font > 9:
            heights = [Inches(text_height(line_count(t, (rw - Inches(1.8)) / IN, font), font) + 0.14) for t in titles]
            if sum(heights) <= h - top - Inches(0.05):
                break
            font -= 1
        for m, title_, ph in zip(members, titles, heights):
            state = statuses.get(m["id"], "missing")
            text(slide, rx, py, Inches(0.7), ph, f"P.{page_number[m['id']]}", font - 1, True, GREY, anchor=MSO_ANCHOR.MIDDLE)
            text(slide, rx + Inches(0.7), py, rw - Inches(1.8), ph, [{"text": title_, "size": font, "bold": state != "missing"}], font,
                 anchor=MSO_ANCHOR.MIDDLE)
            if state != "done":
                text(slide, rx + rw - Inches(1.05), py + int(ph / 2) - Inches(0.12), Inches(1.05), Inches(0.24), "未検討" if state == "missing" else "一部未検討",
                     9, True, PAPER, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, fill=(HILITE,))
            py += ph
            rule(slide, rx, py, rx + rw, py, LIGHT, 0.5)

    # ---- the deck ------------------------------------------------------------

    cover = prs.slides.add_slide(cover_layout)
    set_title(cover, spec.get("title") or "サービス企画書")
    for placeholder in cover.placeholders:
        idx = placeholder.placeholder_format.idx
        if idx == 1:
            placeholder.text = spec.get("organization") or spec.get("subtitle") or ""
        elif idx not in (0, 1) and placeholder.has_text_frame:
            placeholder.text = spec.get("date") or ""

    opened = None
    for meta in catalog["pages"]:
        if only and meta["id"] not in only:
            continue
        if meta["section"] != opened:
            opened = meta["section"]
            if opened != "summary" and not only:
                chapter = next(c for c in catalog["sections"] if c["id"] == opened)
                cover_slide = prs.slides.add_slide(body_layout)
                set_title(cover_slide, chapter["title"])
                divider(cover_slide, chapter)
        page = pages.get(meta["id"]) or {"status": "missing"}
        status = page.get("status", "missing")
        section = sections[meta["section"]]
        slide = prs.slides.add_slide(body_layout)
        x, y, w, h = X0, Y0, X1 - X0, Y1 - Y0
        if meta["id"] == "agenda":
            frame(slide, page.get("title") or "目次", section, [], "done")
            agenda(slide, x, y, w, h)
            continue
        if status == "missing":
            frame(slide, f"{meta['topic']}：未検討", section, [], "missing")
            missing_page(slide, meta, x, y, w, h)
            continue
        frame(slide, page.get("title", ""), section, page.get("sources") or [], status, page.get("notes") or [], page.get("sticker") or "")
        current[0] = f"P.{page_number[meta['id']]} {meta['id']}"
        h -= Inches(0.24) * len(page.get("notes") or [])  # the notes sit above the source line
        gaps = page.get("gaps") if status == "partial" else []
        lay_out(slide, page.get("blocks") or [], gaps, x, y, w, h, page.get("layout") == "columns", page.get("density") == "dense")

    prs.save(out)
    return {"out": out, "slides": len(prs.slides), "layout": layout_notes}



def adopt_template(source, deck_dir):
    """Keep the company's template in the product's deck folder, after checking it is a deck with layouts."""
    from pptx import Presentation
    import shutil
    layouts = [layout.name for master in Presentation(source).slide_masters for layout in master.slide_layouts]
    if not layouts:
        raise ValueError("the template has no slide layouts")
    os.makedirs(deck_dir, exist_ok=True)
    target = os.path.join(deck_dir, "template.pptx")
    shutil.copyfile(source, target)
    return {"template": target, "layouts": layouts}


def main(argv):
    if argv and argv[0] == "template":
        flags = dict(zip(argv[1::2], argv[2::2]))
        try:
            if not flags.get("--from") or not flags.get("--deck-dir"):
                raise ValueError("usage: pdm-deck.py template --from <company.pptx> --deck-dir <pdm-deck folder>")
            if not flags["--from"].lower().endswith((".pptx", ".potx")) or not os.path.isfile(flags["--from"]):
                raise ValueError("--from must be an existing .pptx or .potx file")
            print(json.dumps(adopt_template(flags["--from"], flags["--deck-dir"]), ensure_ascii=False))
            return 0
        except ModuleNotFoundError:
            sys.stderr.write("pdm-deck: python-pptx is not installed; install it with `python3 -m pip install python-pptx`\n")
            return 2
        except (ValueError, OSError) as error:
            sys.stderr.write(f"pdm-deck: {error}\n")
            return 2
    if not argv or argv[0] not in ("ghost", "check", "build", "outline"):
        sys.stderr.write(__doc__)
        return 2
    args, flags = argv[1:], {}
    for i, arg in enumerate(args):
        if arg.startswith("--") and i + 1 < len(args):
            flags[arg] = args[i + 1]
    try:
        if argv[0] == "ghost":
            out = flags.get("--out")
            if not out:
                raise ValueError("--out is required")
            if os.path.exists(out):
                raise ValueError(f"{out} exists; ghost never overwrites a spec")
            with open(out, "w", encoding="utf-8") as handle:
                json.dump(ghost(flags.get("--title")), handle, ensure_ascii=False, indent=2)
            print(json.dumps({"out": out, "pages": len(load_catalog()["pages"])}, ensure_ascii=False))
            return 0
        spec_path = flags.get("--spec")
        if not spec_path:
            raise ValueError("--spec is required")
        with open(spec_path, encoding="utf-8") as handle:
            spec = json.load(handle)
        base = os.path.dirname(os.path.abspath(spec_path))
        result = check(spec, base)
        if argv[0] == "outline":
            print(outline(spec))
            return 0
        if argv[0] == "check":
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if result["pass"] else 1
        if not result["pass"]:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1
        out = flags.get("--out")
        if not out:
            raise ValueError("--out is required")
        template = flags.get("--template")
        if template and not os.path.isfile(template):
            raise ValueError(f"template {template} does not exist")
        only = [item for item in (flags.get("--only") or "").split(",") if item]
        print(json.dumps({**build(spec, base, out, template, only or None), "counts": result["counts"], "warnings": result["warnings"],
                          **({"preview": only} if only else {})}, ensure_ascii=False))
        return 0
    except ModuleNotFoundError:
        sys.stderr.write("pdm-deck: python-pptx is not installed; install it with `python3 -m pip install python-pptx`\n")
        return 2
    except (ValueError, OSError, json.JSONDecodeError) as error:
        sys.stderr.write(f"pdm-deck: {error}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
