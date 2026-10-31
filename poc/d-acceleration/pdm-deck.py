#!/usr/bin/env python3
"""A product manager's service proposal deck (PowerPoint), built from a JSON spec.

  python3 -I pdm-deck.py template --from company.pptx --deck-dir <pdm-deck folder>
  python3 -I pdm-deck.py ghost --out deck.json [--title T]
  python3 -I pdm-deck.py check --spec deck.json
  python3 -I pdm-deck.py build --spec deck.json --out deck.pptx [--template company.pptx] [--only id,id]
    (--only builds just those pages, for a quick look; the deck itself is always every page)

The page list is pdm-deck-catalog.json: every page is built in catalog order.
A page the spec leaves without content is still built, stamped 未検討 with the
questions it should answer, so a missing consideration is visible rather than
silently absent. The model writes the spec; this tool owns layout, the page
order, and the checks, so the same spec always gives the same deck.

With --template, the deck is built on that file's slide masters and theme:
its existing slides are removed, its layouts (表紙, 中表紙, a title-only body
page) are used, and every colour is a theme slot, so the company's brand comes
from its own file and nothing of it is written here. Needs python-pptx.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, "pdm-deck-catalog.json")
STATUSES = ("done", "partial", "missing")
BLOCK_KINDS = ("bullets", "table", "cards", "callout", "tree", "matrix2x2", "timeline", "chart_bar", "image")
LIMITS = {"title": 60, "lead": 140, "bullets": 9, "bullet": 90, "rows": 12, "cols": 7, "cell": 60, "cards": 6, "card": 160}


def load_catalog():
    with open(CATALOG, encoding="utf-8") as handle:
        return json.load(handle)


def ghost(title):
    catalog = load_catalog()
    return {
        "schema": 1, "title": title or "サービス企画書", "subtitle": "", "date": "", "organization": "",
        "pages": [{"id": p["id"], "status": "missing", "title": "", "lead": "", "blocks": [], "sources": [], "gaps": []} for p in catalog["pages"]],
    }


# ---------------------------------------------------------------------------
# check
# ---------------------------------------------------------------------------
def _text_len(value):
    return len(str(value or ""))


def check_block(page_id, index, block, base_dir, problems):
    where = f"{page_id} block {index + 1}"
    kind = block.get("kind")
    if kind not in BLOCK_KINDS:
        problems.append(f"{where}: kind must be one of {', '.join(BLOCK_KINDS)}")
        return
    if kind == "bullets":
        items = block.get("items") or []
        if not items:
            problems.append(f"{where}: bullets has no items")
        if len(items) > LIMITS["bullets"]:
            problems.append(f"{where}: {len(items)} bullets; at most {LIMITS['bullets']} fit")
        for item in items:
            text = item.get("text") if isinstance(item, dict) else item
            if _text_len(text) > LIMITS["bullet"]:
                problems.append(f"{where}: a bullet is longer than {LIMITS['bullet']} characters")
    elif kind == "table":
        columns, rows = block.get("columns") or [], block.get("rows") or []
        if not columns or not rows:
            problems.append(f"{where}: table needs columns and rows")
        if len(columns) > LIMITS["cols"] or len(rows) > LIMITS["rows"]:
            problems.append(f"{where}: table is larger than {LIMITS['rows']} rows x {LIMITS['cols']} columns")
        for row in rows:
            if len(row) != len(columns):
                problems.append(f"{where}: a row has {len(row)} cells for {len(columns)} columns")
                break
            if any(_text_len(cell) > LIMITS["cell"] for cell in row):
                problems.append(f"{where}: a cell is longer than {LIMITS['cell']} characters")
                break
    elif kind == "cards":
        items = block.get("items") or []
        if not items or len(items) > LIMITS["cards"]:
            problems.append(f"{where}: cards needs 1 to {LIMITS['cards']} items")
        if any(_text_len(item.get("body")) > LIMITS["card"] for item in items):
            problems.append(f"{where}: a card body is longer than {LIMITS['card']} characters")
    elif kind == "callout":
        if not block.get("text"):
            problems.append(f"{where}: callout has no text")
    elif kind == "tree":
        if not block.get("root") or not block.get("children"):
            problems.append(f"{where}: tree needs a root and children")
    elif kind == "matrix2x2":
        if not block.get("x") or not block.get("y") or len(block.get("quadrants") or []) != 4:
            problems.append(f"{where}: matrix2x2 needs x, y, and four quadrants")
    elif kind == "timeline":
        periods, lanes = block.get("periods") or [], block.get("lanes") or []
        if not periods or not lanes:
            problems.append(f"{where}: timeline needs periods and lanes")
        for lane in lanes:
            for item in lane.get("items") or []:
                start, end = item.get("start", -1), item.get("end", -1)
                if not (isinstance(start, int) and isinstance(end, int) and 0 <= start <= end < len(periods)):
                    problems.append(f"{where}: timeline item {item.get('label')!r} must span period indexes 0..{len(periods) - 1}")
    elif kind == "chart_bar":
        categories, series = block.get("categories") or [], block.get("series") or []
        if not categories or not series or any(len(s.get("values") or []) != len(categories) for s in series):
            problems.append(f"{where}: chart_bar needs categories and one value per category in every series")
    elif kind == "image":
        path = block.get("path")
        if not path or not os.path.isfile(os.path.join(base_dir, path)):
            problems.append(f"{where}: image {path!r} does not exist (paths are relative to the spec)")


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
    for page in pages:
        pid, status = page.get("id"), page.get("status")
        if status not in STATUSES:
            problems.append(f"{pid}: status must be one of {', '.join(STATUSES)}")
            continue
        counts[status] += 1
        if status == "missing" or pid == "agenda":
            continue
        title = page.get("title") or ""
        if not title.strip():
            problems.append(f"{pid}: a {status} page needs an action title (the conclusion, not the topic)")
        elif title.strip() == topics.get(pid):
            problems.append(f"{pid}: the title only names the topic; write the conclusion as the title")
        if _text_len(title) > LIMITS["title"]:
            problems.append(f"{pid}: title is longer than {LIMITS['title']} characters")
        if _text_len(page.get("lead")) > LIMITS["lead"]:
            problems.append(f"{pid}: lead is longer than {LIMITS['lead']} characters")
        if not page.get("blocks"):
            problems.append(f"{pid}: a {status} page needs at least one block")
        if len(page.get("blocks") or []) > 4:
            problems.append(f"{pid}: at most 4 blocks fit on one page")
        if not page.get("sources"):
            problems.append(f"{pid}: a {status} page needs its sources (where each fact came from)")
        if status == "partial" and not page.get("gaps"):
            problems.append(f"{pid}: a partial page needs gaps (what is still not considered)")
        for index, block in enumerate(page.get("blocks") or []):
            check_block(pid, index, block, base_dir, problems)
    return {"pass": not problems, "findings": problems, "counts": counts}


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def build(spec, base_dir, out, template, only=None):
    from pptx import Presentation
    from pptx.chart.data import CategoryChartData
    from pptx.dml.color import RGBColor
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
    from pptx.enum.dml import MSO_THEME_COLOR
    from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
    from pptx.util import Emu, Inches, Pt

    MAIN, ACCENT, SUB, GREY, LIGHT, INK = (MSO_THEME_COLOR.ACCENT_1, MSO_THEME_COLOR.TEXT_2, MSO_THEME_COLOR.ACCENT_2,
                                            MSO_THEME_COLOR.ACCENT_5, MSO_THEME_COLOR.ACCENT_6, MSO_THEME_COLOR.TEXT_1)

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
    section_layout = layout("中表紙", "Section Header", fallback=2)
    body_layout = layout("標準ページ-テキストなし", "Title Only", fallback=5)
    W, H = prs.slide_width, prs.slide_height

    def color(target, theme, brightness=0.0):
        target.theme_color = theme
        if brightness:
            target.brightness = brightness

    def text(slide, left, top, width, height, value, size=10, bold=False, theme=INK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, fill=None, line=None):
        box = slide.shapes.add_textbox(left, top, width, height) if fill is None and line is None else slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
        if fill is not None:
            box.fill.solid(); color(box.fill.fore_color, *fill)
        elif hasattr(box, "fill") and line is not None:
            box.fill.background()
        if line is not None:
            color(box.line.color, *line); box.line.width = Pt(0.75)
        elif fill is not None:
            box.line.fill.background()
        frame = box.text_frame
        frame.word_wrap, frame.vertical_anchor = True, anchor
        frame.margin_left = frame.margin_right = Inches(0.06)
        frame.margin_top = frame.margin_bottom = Inches(0.03)
        lines = value if isinstance(value, list) else [value]
        for i, item in enumerate(lines):
            paragraph = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
            paragraph.alignment = align
            run = paragraph.add_run()
            run.text = str(item)
            run.font.size, run.font.bold = Pt(size), bold
            color(run.font.color, theme)
        return box

    def title_area(slide):
        title = slide.shapes.title
        if title is not None:
            return title.left, title.top, title.width, title.height
        return Inches(0.3), Inches(0.2), W - Inches(0.6), Inches(0.8)

    def set_title(slide, value, size=None):
        if slide.shapes.title is not None:
            slide.shapes.title.text = value
            if size:
                for paragraph in slide.shapes.title.text_frame.paragraphs:
                    for run in paragraph.runs:
                        run.font.size = Pt(size)
            return
        left, top, width, height = title_area(slide)
        text(slide, left, top, width, height, value, size=20, bold=True)

    # ---- block renderers: each draws inside (x, y, w, h) -------------------
    def bullets(slide, block, x, y, w, h):
        items = block.get("items") or []
        if block.get("heading"):
            text(slide, x, y, w, Inches(0.28), block["heading"], 11, True, MAIN)
            y, h = y + Inches(0.3), h - Inches(0.3)
        box = slide.shapes.add_textbox(x, y, w, h)
        frame = box.text_frame
        frame.word_wrap = True
        first = True
        for item in items:
            entries = [(0, item.get("text") if isinstance(item, dict) else item)] + [(1, sub) for sub in (item.get("sub") or [] if isinstance(item, dict) else [])]
            for level, value in entries:
                paragraph = frame.paragraphs[0] if first else frame.add_paragraph()
                first = False
                run = paragraph.add_run()
                run.text = ("■ " if level == 0 else "　－ ") + str(value)
                run.font.size = Pt(11 if level == 0 else 10)
                color(run.font.color, INK)
                paragraph.space_after = Pt(3)

    def table(slide, block, x, y, w, h):
        columns, rows = block.get("columns") or [], block.get("rows") or []
        if block.get("heading"):
            text(slide, x, y, w, Inches(0.28), block["heading"], 11, True, MAIN)
            y, h = y + Inches(0.3), h - Inches(0.3)
        row_h = min(Inches(0.42), int(h / max(1, len(rows) + 1)))
        shape = slide.shapes.add_table(len(rows) + 1, len(columns), x, y, w, row_h * (len(rows) + 1))
        grid = shape.table
        weights = block.get("widths") or [1] * len(columns)
        for i, weight in enumerate(weights[:len(columns)]):
            grid.columns[i].width = int(w * weight / sum(weights[:len(columns)]))
        for r in range(len(rows) + 1):
            for c in range(len(columns)):
                cell = grid.cell(r, c)
                cell.margin_left = cell.margin_right = Inches(0.05)
                cell.margin_top = cell.margin_bottom = Inches(0.02)
                value = columns[c] if r == 0 else rows[r - 1][c]
                cell.text = str(value)
                run = cell.text_frame.paragraphs[0].runs[0] if cell.text_frame.paragraphs[0].runs else cell.text_frame.paragraphs[0].add_run()
                run.font.size = Pt(10 if r == 0 else 9)
                run.font.bold = r == 0 or c == 0
                cell.fill.solid()
                if r == 0:
                    color(cell.fill.fore_color, MAIN); color(run.font.color, MSO_THEME_COLOR.BACKGROUND_1)
                else:
                    color(cell.fill.fore_color, MAIN, 0.9 if r % 2 else 0.95); color(run.font.color, INK)

    def cards(slide, block, x, y, w, h):
        items = block.get("items") or []
        per_row = (len(items) if len(items) <= 4 else 3) or 1
        rows = (len(items) + per_row - 1) // per_row
        gap = Inches(0.12)
        cw, ch = int((w - gap * (per_row - 1)) / per_row), int((h - gap * (rows - 1)) / max(1, rows))
        for i, item in enumerate(items):
            cx, cy = x + (cw + gap) * (i % per_row), y + (ch + gap) * (i // per_row)
            text(slide, cx, cy, cw, Inches(0.36), item.get("title", ""), 11, True, MSO_THEME_COLOR.BACKGROUND_1, fill=(MAIN,), anchor=MSO_ANCHOR.MIDDLE)
            text(slide, cx, cy + Inches(0.36), cw, ch - Inches(0.36), item.get("body", ""), 10, False, INK, line=(MAIN, 0.5))

    def callout(slide, block, x, y, w, h):
        text(slide, x, y, w, min(h, Inches(0.7)), block.get("text", ""), 12, True, MAIN, fill=(SUB, 0.8), anchor=MSO_ANCHOR.MIDDLE)

    def tree(slide, block, x, y, w, h):
        children = block.get("children") or []
        depth = 3 if any(c.get("children") for c in children) else 2
        col_w, gap = int((w - Inches(0.3) * (depth - 1)) / depth), Inches(0.3)
        leaves = [(c, g) for c in children for g in (c.get("children") or [None])]
        unit = int(h / max(1, len(leaves)))
        root = text(slide, x, y + int(h / 2) - Inches(0.35), col_w, Inches(0.7), block["root"], 11, True, MSO_THEME_COLOR.BACKGROUND_1, fill=(MAIN,), anchor=MSO_ANCHOR.MIDDLE)
        index = 0
        for child in children:
            grand = child.get("children") or [None]
            top = y + unit * index
            span = unit * len(grand)
            node = text(slide, x + col_w + gap, top + int(span / 2) - Inches(0.28), col_w, Inches(0.56), child.get("label", ""), 10, True, MAIN, fill=(MAIN, 0.85), anchor=MSO_ANCHOR.MIDDLE)
            slide.shapes.add_connector(MSO_CONNECTOR.ELBOW, root.left + root.width, root.top + int(root.height / 2), node.left, node.top + int(node.height / 2))
            for g in grand:
                if g is not None:
                    gy = y + unit * index + int(unit / 2) - Inches(0.22)
                    leaf = text(slide, x + (col_w + gap) * 2, gy, col_w, Inches(0.44), g.get("label", "") if isinstance(g, dict) else g, 9, False, INK, line=(MAIN, 0.5), anchor=MSO_ANCHOR.MIDDLE)
                    slide.shapes.add_connector(MSO_CONNECTOR.ELBOW, node.left + node.width, node.top + int(node.height / 2), leaf.left, leaf.top + int(leaf.height / 2))
                index += 1

    def matrix(slide, block, x, y, w, h):
        pad = Inches(0.35)
        qw, qh = int((w - pad) / 2), int((h - pad) / 2)
        for i, quad in enumerate(block.get("quadrants") or []):
            qx, qy = x + pad + qw * (i % 2), y + qh * (i // 2)
            highlight = quad.get("highlight")
            text(slide, qx, qy, qw - Inches(0.04), qh - Inches(0.04), [quad.get("label", "")] + list(quad.get("items") or []), 10, highlight, MAIN if highlight else INK, fill=(MAIN, 0.6) if highlight else (MAIN, 0.92))
        text(slide, x + pad, y + qh * 2, w - pad, pad, f"{block['x']} →", 9, True, GREY, align=PP_ALIGN.CENTER)
        axis = text(slide, x + int(pad / 2) - qh, y + qh - int(pad / 2), qh * 2, pad, f"{block['y']} →", 9, True, GREY, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        axis.rotation = 270

    def timeline(slide, block, x, y, w, h):
        periods, lanes = block.get("periods") or [], block.get("lanes") or []
        label_w = Inches(1.6)
        col = int((w - label_w) / len(periods))
        for i, period in enumerate(periods):
            text(slide, x + label_w + col * i, y, col - Inches(0.02), Inches(0.3), period, 9, True, MSO_THEME_COLOR.BACKGROUND_1, align=PP_ALIGN.CENTER, fill=(MAIN,), anchor=MSO_ANCHOR.MIDDLE)
        # Items that overlap in time get their own row inside the lane.
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
        unit = min(Inches(0.42), int((h - Inches(0.35)) / max(1, sum(n for _, n, _ in placed))))
        ly = y + Inches(0.35)
        for lane, rows_needed, slots in placed:
            lane_h = unit * rows_needed
            text(slide, x, ly, label_w - Inches(0.05), lane_h - Inches(0.04), lane.get("label", ""), 10, True, MAIN, fill=(MAIN, 0.9), anchor=MSO_ANCHOR.MIDDLE)
            for row, item in slots:
                bx = x + label_w + col * item["start"]
                bw = col * (item["end"] - item["start"] + 1) - Inches(0.04)
                text(slide, bx, ly + unit * row + Inches(0.04), bw, unit - Inches(0.08), item.get("label", ""), 9, item.get("milestone", False), INK, fill=(ACCENT, 0.6) if item.get("milestone") else (SUB, 0.6), anchor=MSO_ANCHOR.MIDDLE)
            ly += lane_h

    def chart_bar(slide, block, x, y, w, h):
        data = CategoryChartData()
        data.categories = block["categories"]
        for series in block["series"]:
            data.add_series(series.get("name", ""), series["values"])
        chart = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, x, y, w, h, data).chart
        chart.has_legend = len(block["series"]) > 1
        if chart.has_legend:
            chart.legend.position, chart.legend.include_in_layout = XL_LEGEND_POSITION.BOTTOM, False
        chart.font.size = Pt(9)
        plot = chart.plots[0]
        plot.has_data_labels = True
        plot.data_labels.font.size = Pt(8)
        for i, series in enumerate(plot.series):
            series.format.fill.solid()
            color(series.format.fill.fore_color, (MAIN, SUB, GREY)[i % 3])

    def image(slide, block, x, y, w, h):
        path = os.path.join(base_dir, block["path"])
        caption_h = Inches(0.3) if block.get("caption") else 0
        picture = slide.shapes.add_picture(path, x, y)
        scale = min(w / picture.width, (h - caption_h) / picture.height, 1.0)
        picture.width, picture.height = int(picture.width * scale), int(picture.height * scale)
        picture.left, picture.top = x + int((w - picture.width) / 2), y
        if caption_h:
            text(slide, x, y + picture.height + Inches(0.03), w, caption_h, block["caption"], 9, False, GREY, align=PP_ALIGN.CENTER)

    RENDER = {"bullets": bullets, "table": table, "cards": cards, "callout": callout, "tree": tree, "matrix2x2": matrix,
              "timeline": timeline, "chart_bar": chart_bar, "image": image}

    def frame(slide, page_title, number, sources, status):
        set_title(slide, page_title, 18 if len(page_title) > 34 else 22)
        if status in ("missing", "partial"):
            label, theme = ("未検討", ACCENT) if status == "missing" else ("一部未検討", SUB)
            left, top, width, height = title_area(slide)
            text(slide, left + width - Inches(1.5), top + height - Inches(0.02), Inches(1.5), Inches(0.28), label, 10, True, MSO_THEME_COLOR.BACKGROUND_1, align=PP_ALIGN.CENTER, fill=(theme,), anchor=MSO_ANCHOR.MIDDLE)
        footer = "出典：" + "／".join(sources) if sources else ""
        if footer:
            text(slide, Inches(0.3), H - Inches(0.62), W - Inches(2.2), Inches(0.26), footer, 8, False, GREY)
        text(slide, W - Inches(1.9), H - Inches(0.62), Inches(0.5), Inches(0.26), str(number), 8, False, GREY, align=PP_ALIGN.RIGHT)

    def body_box(slide):
        left, top, width, height = title_area(slide)
        return left + Inches(0.1), top + height + Inches(0.32), width - Inches(0.2), H - (top + height) - Inches(1.0)

    def place(blocks, x, y, w, h):
        gap = Inches(0.18)
        if len(blocks) == 1:
            return [(x, y, w, h)]
        if len(blocks) == 2:
            kinds = [block.get("kind") for block in blocks]
            # Cards, timelines and callouts read across the page, so they stack.
            if any(kind in ("cards", "timeline", "callout") for kind in kinds):
                share = {"callout": 0.2, "bullets": 0.35, "cards": 0.5, "table": 0.5}
                top = int((h - gap) * (1 - share.get(kinds[1], 0.45)))
                return [(x, y, w, top), (x, y + top + gap, w, h - top - gap)]
            wide = kinds[0] in ("table", "tree", "image", "matrix2x2", "chart_bar") and kinds[1] in ("bullets", "callout")
            first = int((w - gap) * (0.62 if wide else 0.5))
            return [(x, y, first, h), (x + first + gap, y, w - first - gap, h)]
        half_w, half_h = int((w - gap) / 2), int((h - gap) / 2)
        return [(x + (half_w + gap) * (i % 2), y + (half_h + gap) * (i // 2), half_w, half_h) for i in range(len(blocks))]

    catalog = load_catalog()
    sections = {s["id"]: s["title"] for s in catalog["sections"]}
    pages = {p.get("id"): p for p in spec.get("pages") or []}
    number = 1

    cover = prs.slides.add_slide(cover_layout)
    set_title(cover, spec.get("title") or "サービス企画書")
    for placeholder in cover.placeholders:
        if placeholder.placeholder_format.idx == 1:
            placeholder.text = spec.get("organization") or spec.get("subtitle") or ""
        elif placeholder.placeholder_format.idx not in (0, 1) and placeholder.has_text_frame:
            placeholder.text = spec.get("date") or ""

    shown_section = None
    for meta in catalog["pages"]:
        if only and meta["id"] not in only:
            continue
        page = pages.get(meta["id"]) or {"status": "missing"}
        if meta["section"] != "summary" and meta["section"] != shown_section:
            shown_section = meta["section"]
            divider = prs.slides.add_slide(section_layout)
            set_title(divider, sections[shown_section])
            number += 1
        slide = prs.slides.add_slide(body_layout)
        number += 1
        status = page.get("status", "missing")
        x, y, w, h = body_box(slide)
        if meta["id"] == "agenda":
            frame(slide, page.get("title") or "目次", number, [], "done")
            done = {p.get("id"): p.get("status") for p in spec.get("pages") or []}
            rows = [[s["title"], "、".join(p["topic"] for p in catalog["pages"] if p["section"] == s["id"]),
                     f"{sum(1 for p in catalog['pages'] if p['section'] == s['id'] and done.get(p['id']) == 'missing')} / {sum(1 for p in catalog['pages'] if p['section'] == s['id'])}"]
                    for s in catalog["sections"] if s["id"] != "summary"]
            table(slide, {"columns": ["章", "ページ", "未検討"], "rows": rows, "widths": [2, 7, 1]}, x, y, w, h)
            continue
        if status == "missing":
            frame(slide, page.get("title") or f"{meta['topic']}：未検討", number, [], "missing")
            text(slide, x, y, w, Inches(0.55), f"「{meta['topic']}」はまだ検討されていません。下の問いに答えると、このページが埋まります。", 13, True, ACCENT, fill=(ACCENT, 0.85), anchor=MSO_ANCHOR.MIDDLE)
            rows = [[q, "、".join(meta.get("sources") or []) or "—", ""] for q in meta.get("questions") or []] or [["（問いなし）", "—", ""]]
            table(slide, {"columns": ["検討すべき問い", "情報源（AI-DLC のステージ）", "検討結果"], "rows": rows, "widths": [5, 3, 4]}, x, y + Inches(0.75), w, h - Inches(0.75))
            continue
        frame(slide, page.get("title", ""), number, page.get("sources") or [], status)
        if page.get("lead"):
            text(slide, x, y, w, Inches(0.42), page["lead"], 12, True, MAIN, anchor=MSO_ANCHOR.MIDDLE)
            line = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x, y + Inches(0.44), x + w, y + Inches(0.44))
            color(line.line.color, MAIN)
            y, h = y + Inches(0.52), h - Inches(0.52)
        if status == "partial" and page.get("gaps"):
            gap_h = Inches(0.32) * min(3, len(page["gaps"])) + Inches(0.1)
            text(slide, x, y + h - gap_h, w, gap_h, ["未検討の論点：" + g for g in page["gaps"][:3]], 10, True, ACCENT, fill=(ACCENT, 0.88))
            h -= gap_h + Inches(0.08)
        blocks = page.get("blocks") or []
        for block, (bx, by, bw, bh) in zip(blocks, place(blocks, x, y, w, h)):
            RENDER[block["kind"]](slide, block, bx, by, bw, bh)

    prs.save(out)
    return {"out": out, "slides": len(prs.slides)}


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
    if not argv or argv[0] not in ("ghost", "check", "build"):
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
        print(json.dumps({**build(spec, base, out, template, only or None), "counts": result["counts"], **({"preview": only} if only else {})}, ensure_ascii=False))
        return 0
    except ModuleNotFoundError:
        sys.stderr.write("pdm-deck: python-pptx is not installed; install it with `python3 -m pip install python-pptx`\n")
        return 2
    except (ValueError, OSError, json.JSONDecodeError) as error:
        sys.stderr.write(f"pdm-deck: {error}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
