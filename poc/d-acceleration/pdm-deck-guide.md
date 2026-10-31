# PdM サービス企画書（`/aidlc --deck`）

プロダクトマネージャーがサービスを作るときに検討する内容を、すべて 1 本の PowerPoint にまとめる。
戦略コンサルティングの資料のように、1 枚に 1 つの結論を置き、根拠を表・ツリー・マトリクス・図で
密に並べる。**情報が無い観点も、空のページ（未検討）として必ず作る**。どの検討が漏れているかを
見えるようにするためである。

ページの一覧と順番は `{{HARNESS_DIR}}/tools/d-acceleration/pdm-deck-catalog.json` が持つ（31 ページ、
9 章）。ページを足したり、順番を変えたり、省いたりしない。作る・検査する・描くのは
`python3 -I {{HARNESS_DIR}}/tools/d-acceleration/pdm-deck.py` で、あなたが書くのは内容の JSON（spec）だけ。

## 置き場所（プロダクトのリポジトリ）

すべて space の `aidlc/spaces/<space>/pdm-deck/` に置く。

- `template.pptx` … 会社のテンプレート（あれば）
- `deck.json` … 内容（spec）
- `figures/` … 画面・遷移図のスクリーンショット
- `deck.pptx` … 出来上がった資料

## 手順

1. **python-pptx。** `pdm-deck.py` は python-pptx が無いと、入れ方を一行で示して止まる。そのときは
   その一行を伝えて止まる（自分で入れない）。
2. **テンプレート。** `pdm-deck/template.pptx` があれば使う。無ければ AI-DLC の質問の流れで一度だけ聞く:
   「会社のテンプレート（.pptx）を使う」と「テンプレートなしで作る」。使うと答えたら、その絶対パスを聞き、
   `pdm-deck.py template --from <パス> --deck-dir <pdm-deck>` でプロダクトに取り込む。パスは記録に残さない。
   テンプレートの既存スライドは使わず、スライドマスターとレイアウト（表紙・中表紙・タイトルだけの本文
   ページ）とテーマの色・フォントだけを使う。
3. **材料を集める。** `bun {{HARNESS_DIR}}/tools/d-acceleration/design-document.ts doc-manifest --json
   --project-dir "$PWD"` の各 `record_root` の成果物（ideation の intent-capture・market-research・
   feasibility・scope-definition・approval-handoff、inception の requirements-analysis・user-stories・
   delivery-planning など）と、あれば `design-document/` を読む。各ページの `sources`（catalog）は
   どのステージが材料になるかの目安。**材料に無い事実・数字を作らない。**
4. **画面と遷移。** 画面・遷移図・ユーザーフローは、プロダクトの `design-baseline`（manifest の
   `design_baselines`）と、intent の 2.5 の写し（`baseline_copies`、変更一覧つき）から使う。
   `bun {{HARNESS_DIR}}/tools/ui-poc-baseline.cjs shot --page <ページ> --out <pdm-deck>/figures/<名前>.png`
   で撮り、`image` ブロックに入れる。改修した画面は現行と改修後を並べる。描き起こさない。
5. **骨子（ゴーストデッキ）を作り、人に確かめる。** `pdm-deck.py ghost --out <pdm-deck>/deck.json
   --title <資料名>` で全ページの spec を作る（既にあれば作らない）。材料のあるページに、結論の
   タイトル（action title）だけを書く。ページ順にタイトルだけ読めば話がつながるように書き、
   AI-DLC の質問の流れで「この骨子で中身を書く」か「直す」かを聞く。人の答えに従う。
6. **中身を書く。** ページごとに `status`、`title`、`lead`、`blocks`、`sources`、`gaps` を書く。
   - `done`: 材料がそろっている。`partial`: 一部だけ。足りない論点を `gaps` に書く。
     `missing`: 材料が無い。何も書かない（ツールが「未検討」のページと検討すべき問いを描く）。
   - 迷ったら `missing` か `partial` にする。埋めるために推測しない。
7. **検査して描く。** `pdm-deck.py check --spec <pdm-deck>/deck.json` が通るまで直し、
   `pdm-deck.py build --spec <pdm-deck>/deck.json --out <pdm-deck>/deck.pptx [--template <pdm-deck>/template.pptx]`
   で描く。
8. **伝える。** 資料のパス、done／partial／missing の数、未検討の章とページを一行ずつ伝える。
   未検討は、どの AI-DLC ステージを通れば埋まるか（catalog の `sources`）も添える。

## 書き方（コンサルティング資料の作法）

- **タイトルは結論。** 「競合比較」ではなく「競合はいずれも低価格帯に集中し、上位帯は空いている」。
  1 ページ 1 メッセージ、60 字以内。トピック名だけのタイトルは検査で落ちる。
- **リードは so-what。** タイトルを支える一文（140 字以内）。
- **MECE。** 分解は漏れなくダブりなく。ツリー・表の切り口をそろえる。
- **数字には単位・時点・出典。** すべてのページの `sources` に、材料にした成果物やページを書く。
- **密に、ただし読める量で。** 1 ページにブロックは 1〜4。表は 12 行 × 7 列、箇条書きは 9 個まで。
  文章を長く書くより、表・ツリー・マトリクス・タイムライン・グラフに整理する。
- 色・フォントは指定しない（テンプレートのテーマが決める）。

## ブロック

| kind | 書くもの |
|---|---|
| `bullets` | `items`（文字列、または `{"text", "sub": [...]}`）、任意で `heading` |
| `table` | `columns`、`rows`（各行は列と同じ数）、任意で `heading`・`widths`（列幅の比） |
| `cards` | `items`（`{"title", "body"}`、6 個まで） |
| `callout` | `text`（強調したい一文） |
| `tree` | `root`、`children`（`{"label", "children": [{"label"}]}`、2 段まで） |
| `matrix2x2` | `x`、`y`（軸の名前）、`quadrants`（4 つ、`{"label", "items", "highlight"}`） |
| `timeline` | `periods`（列）、`lanes`（`{"label", "items": [{"label", "start", "end", "milestone"}]}`、start/end は列の番号） |
| `chart_bar` | `categories`、`series`（`{"name", "values"}`） |
| `image` | `path`（spec からの相対パス、例 `figures/Web-13.png`）、`caption` |
