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
               "chart_bar", "image", "before_after", "implication")
CHART_MODES = ("clustered", "stacked", "waterfall")
OPERATORS = ("×", "+", "−", "÷")
# Words that read as machine-written in a Japanese business deck: empty emphasis, katakana padding,
# slogans, stock openings and closings, and the names of thinking frameworks shown on the page.
AI_SMELL = ("非常に", "極めて", "圧倒的", "画期的", "革新的", "次世代の", "と言っても過言ではない", "に他なりません", "シームレス",
            "シナジー", "エンドツーエンド", "ブラッシュアップ", "寄り添", "伴走", "二人三脚", "邁進", "さらなる高み", "昨今",
            "変化の激しい時代", "現代において", "することが可能", "と言えるでしょう", "と考えられます", "詳細は別途", "追ってご連絡",
            "今後検討してまいります", "いかがでしたでしょうか", "Situation", "Complication", "Resolution", " — ")
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
    elif kind == "formula":
        terms, ops = block.get("terms") or [], block.get("ops") or []
        if len(terms) < 2 or len(terms) > 4 or len(ops) != len(terms) - 1 or any(op not in OPERATORS for op in ops):
            problems.append(f"{where}: formula needs 2 to 4 terms, one operator ({' '.join(OPERATORS)}) between each pair, and a result")
        if not (block.get("result") or {}).get("value") or any(not t.get("value") or not t.get("label") for t in terms):
            problems.append(f"{where}: every formula term and the result need a value and a label")
    elif kind == "chart_bar":
        categories, series = block.get("categories") or [], block.get("series") or []
        mode = block.get("mode", "clustered")
        if not categories or not series or any(len(s.get("values") or []) != len(categories) for s in series):
            problems.append(f"{where}: chart_bar needs categories and one value per category in every series")
        if mode not in CHART_MODES:
            problems.append(f"{where}: chart_bar mode must be one of {', '.join(CHART_MODES)}")
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
    found, kinds = [], []
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
        main = next((b.get("kind") for b in blocks if b.get("kind") != "implication"), None)
        kinds.append(main)
        if main and len(kinds) >= 3 and kinds[-1] == kinds[-2] == kinds[-3]:
            found.append(f"{pid}: the third page in a row drawn as {main}; vary the shape to fit what each page shows")
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
        elif title == topics.get(pid) or title.startswith(f"{topics.get(pid)}：") or title.startswith(f"{topics.get(pid)}:"):
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
        if len([b for b in blocks if b.get("kind") != "implication"]) > 3:
            problems.append(f"{pid}: at most 3 blocks besides the implication fit on one page")
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


def outline(spec):
    """The deck as text: every page's number, status and title, then what it says. For reading the
    storyline top to bottom and for a reviewer who reads without the slides."""
    catalog = load_catalog()
    pages = {p.get("id"): p for p in spec.get("pages") or []}
    lines = [f"# {spec.get('title') or 'サービス企画書'}", ""]
    for index, meta in enumerate(catalog["pages"]):
        page = pages.get(meta["id"]) or {}
        status = page.get("status", "missing")
        mark = "" if meta["id"] == "agenda" else {"done": "", "partial": "【一部未検討】", "missing": "【未検討】"}[status if status in STATUSES else "missing"]
        title = page.get("title") or meta["topic"]
        lines.append(f"P.{index + 2} {mark}{title}")
    lines += ["", "---", ""]
    for index, meta in enumerate(catalog["pages"]):
        page = pages.get(meta["id"]) or {}
        if page.get("status", "missing") == "missing" or meta["id"] == "agenda":
            continue
        lines.append(f"## P.{index + 2} {page.get('title', '')}")
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
    return sum(0.55 if ord(ch) < 0x2E80 else 1.0 for ch in str(value))


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
            run = paragraph.add_run()
            run.text = str(item.get("text", ""))
            run.font.size = Pt(item.get("size", size))
            run.font.bold = item.get("bold", bold)
            paint(run.font.color, item.get("theme", theme), item.get("brightness", 0.0))

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
                theme, width, brightness = spec_
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
    page_number = {p["id"]: i + 2 for i, p in enumerate(catalog["pages"])}  # slide 1 is the cover

    def title_box(slide):
        title = slide.shapes.title
        if title is not None:
            return title.left, title.top, title.width, title.height
        return Inches(0.3), Inches(0.2), W - Inches(0.6), Inches(0.8)

    def set_title(slide, value):
        if slide.shapes.title is not None:
            slide.shapes.title.text = value
            size = 22 if text_units(value) <= 40 else 20
            for paragraph in slide.shapes.title.text_frame.paragraphs:
                for run in paragraph.runs:
                    run.font.size = Pt(size)
            return
        left, top, width, height = title_box(slide)
        text(slide, left, top, width, height, value, 22, True, anchor=MSO_ANCHOR.MIDDLE)

    def frame(slide, title, section, sources, status, notes=()):
        set_title(slide, title)
        # The page's place in the deck, right-aligned under the title rule; the status chip sits before it.
        tag_w = Inches(3.2)
        text(slide, X1 - tag_w, Inches(1.03), tag_w, Inches(0.26), section, 10, False, GREY, PP_ALIGN.RIGHT, MSO_ANCHOR.MIDDLE)
        if status in ("missing", "partial"):
            label = "未検討" if status == "missing" else "一部未検討"
            cw = Inches(0.95 if status == "missing" else 1.2)
            used = Inches(text_units(section) * 10 / 72 + 0.15)
            text(slide, X1 - used - cw, Inches(1.03), cw, Inches(0.26), label, 10, True, PAPER, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, fill=(HILITE,))
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
        head = max(line_count(c, widths[i] - 0.16, size + 1) for i, c in enumerate(columns))
        heights = [text_height(head, size + 1, 1.2) + 0.16]
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
                    theme, bold, cell_size = MAIN, True, size + 1
                else:
                    if not last:
                        borders["B"] = (LIGHT, 0.75, 0.0)
                    if c == 0:
                        borders["R"] = (MAIN, 1.0, 0.0)
                        bold, cell_size = True, size + 0.5
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
        plot = chart.plots[0]
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

    RENDER = {"summary": summary, "bullets": bullets, "table": table, "cards": cards, "stats": stats, "steps": steps,
              "formula": formula, "callout": callout, "tree": tree, "matrix2x2": matrix, "timeline": timeline, "chart_bar": chart_bar,
              "image": image, "before_after": before_after}

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

    def lay_out(slide, blocks, gaps, x, y, w, h, columns=False):
        right = next((b for b in blocks if b["kind"] == "implication"), None)
        left = [b for b in blocks if b["kind"] != "implication"]
        right_w = int(w * 0.3) if right or gaps else 0
        left_w = w - right_w - (Inches(0.5) if right_w else 0)
        size = body_size(left, left_w / IN, h / IN) if left else 12
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
        row_h = int((h - Inches(0.85)) / len(chapters))
        ry = top + Inches(0.42)
        for ci, chapter in enumerate(chapters):
            members = [p for p in catalog["pages"] if p["section"] == chapter["id"]]
            text(slide, x, ry, columns[0][1], row_h, chapter["title"], 13, True, INK, anchor=MSO_ANCHOR.MIDDLE)
            text(slide, x + columns[0][1], ry, columns[1][1] - Inches(0.2), row_h, "・".join(p["topic"] for p in members), 11, False, INK,
                 anchor=MSO_ANCHOR.MIDDLE)
            sx = x + columns[0][1] + columns[1][1]
            missing = 0
            for mi, member in enumerate(members):
                state = statuses.get(member["id"], "missing")
                missing += state == "missing"
                fill = (MAIN,) if state == "done" else (PALE,) if state == "partial" else None
                rect(slide, sx + Inches(0.3) * mi, ry + int(row_h / 2) - int(mark / 2), mark, mark, fill,
                     (HILITE,) if state == "missing" else None, line_width=1.25)
            if missing:
                text(slide, sx + Inches(0.3) * len(members) + Inches(0.05), ry, Inches(1.3), row_h, f"未検討 {missing}", 11, True, HILITE,
                     anchor=MSO_ANCHOR.MIDDLE)
            numbers = [page_number[p["id"]] for p in members]
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

    # ---- the deck ------------------------------------------------------------

    cover = prs.slides.add_slide(cover_layout)
    set_title(cover, spec.get("title") or "サービス企画書")
    for placeholder in cover.placeholders:
        idx = placeholder.placeholder_format.idx
        if idx == 1:
            placeholder.text = spec.get("organization") or spec.get("subtitle") or ""
        elif idx not in (0, 1) and placeholder.has_text_frame:
            placeholder.text = spec.get("date") or ""

    for meta in catalog["pages"]:
        if only and meta["id"] not in only:
            continue
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
        frame(slide, page.get("title", ""), section, page.get("sources") or [], status, page.get("notes") or [])
        current[0] = f"P.{page_number[meta['id']]} {meta['id']}"
        h -= Inches(0.24) * len(page.get("notes") or [])  # the notes sit above the source line
        gaps = page.get("gaps") if status == "partial" else []
        lay_out(slide, page.get("blocks") or [], gaps, x, y, w, h, page.get("layout") == "columns")

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
