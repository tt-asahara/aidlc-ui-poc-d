# PdM サービス企画書（`/aidlc --deck`）

プロダクトマネージャーがサービスを作るときに検討する内容を、すべて 1 本の PowerPoint にまとめる。
戦略コンサルティングの資料のように、1 枚に 1 つの結論を置き、根拠を表・ツリー・マトリクス・図で
密に並べる。**情報が無い観点も、空のページ（未検討）として必ず作る**。どの検討が漏れているかを
見えるようにするためである。

ページの一覧と順番は `{{HARNESS_DIR}}/tools/d-acceleration/pdm-deck-catalog.json` が持つ（31 ページ、
9 章）。ページを足したり、順番を変えたり、省いたりしない。各ページの `blocks` は勧める部品、`shape` は
想定する見せ方。作る・検査する・描くのは `python3 -I {{HARNESS_DIR}}/tools/d-acceleration/pdm-deck.py` で、
あなたが書くのは内容の JSON（spec）だけ。配置・余白・文字の大きさ・ページ番号はツールが決める。

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
   テンプレートの既存スライドは使わず、スライドマスターとレイアウト（表紙・タイトルだけの本文
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
   `pdm-deck.py outline --spec <pdm-deck>/deck.json` の冒頭（P.n とタイトルの列）を見せ、AI-DLC の
   質問の流れで「この骨子で中身を書く」か「直す」かを聞く。人の答えに従う。
6. **中身を書く。** ページごとに `status`、`title`、`blocks`、`sources`、`gaps`、`notes` を書く。
   - `done`: 材料がそろっている。`partial`: 一部だけ。足りない論点を `gaps`（3 つまで）に書く。
     右の列に「未検討の論点」として出る。
     `missing`: 材料が無い。何も書かない（ツールが問い・埋めるための材料・想定する見せ方を描く）。
   - 迷ったら `missing` か `partial` にする。埋めるために推測しない。
   - 事実の部品（表・グラフ・ツリーなど）は左に、意味合いは `implication` ブロックに書く。右の列に
     三角つきで出る。タイトルの下に説明の行は置かない（`lead` は使わない）。
   - エグゼクティブサマリーは `summary` で、論点ごとに結論 1 文・根拠 2〜3 点・深掘りのページ（`ref` に
     ページ id。ツールが P.n に直す）を書く。
   - 試算・計画値は、前提と算式を `notes`（2 つまで）に書く。出典の上に「注：」として出る。式で示せる数字
     （市場規模、獲得数、単価）は `formula`、増減の内訳は `chart_bar` の `waterfall` で見せる。
     計算は暗算せず、コマンドで計算してから書く。ウォーターフォールは合計が合わないと検査で落ちる。
7. **検査して描く。** `pdm-deck.py check --spec <pdm-deck>/deck.json` の `findings` が無くなるまで直す。
   `warnings`（AI っぽい言い回し、です・ます、タイトルの数と本文の数の食い違い、示唆のないグラフ、
   同じ形のページが 3 枚続く、など）も既定では直す。残すときは理由を一行で言えるものだけにする。
   `pdm-deck.py build --spec <pdm-deck>/deck.json --out <pdm-deck>/deck.pptx [--template <pdm-deck>/template.pptx]`
   で描き、出力の `layout`（はみ出し・空きすぎのページ）を直す。直しは形（部品・分け方・統合）で行い、
   空きを埋めるために中身を足さない。
8. **レビューを通す。** `{{HARNESS_DIR}}/tools/d-acceleration/pdm-deck-review.md` に従い、作った文脈を
   持たないレビュアーに読ませ、指摘を直して `review.md` に残す。
9. **伝える。** 資料のパス、done／partial／missing の数、未検討の章とページを一行ずつ伝える。
   未検討は、どの AI-DLC ステージを通れば埋まるか（catalog の `sources`）も添える。レビューで直さなかった
   指摘があれば、その数と `review.md` の場所を添える。

## 書き方（コンサルティング資料の作法）

- **タイトルは結論。** 「競合比較」ではなく「競合はいずれも低価格帯に集中し、上位帯は空いている」。
  1 ページ 1 メッセージ、60 字以内、常体（です・ます にしない）。トピック名だけのタイトル、
  「競合比較：〜」のような前置き、他のページと同じタイトルは検査で落ちる。
- **タイトルだけを通して読むと話がつながる。** 主語と対象を省かず、「この」「その」で他のページを指さない。
- **左に事実、右に意味合い。** 意味合いは `implication` に 2〜5 点。So what を書き、事実の言い換えにしない。
- **MECE。** 分解は漏れなくダブりなく。ツリーの枝は 2 つ以上に分け、表の行・列の切り口をそろえる。
- **表は「軸のある表」。** 行＝項目、列＝観点。左上のセルには行の軸の名前を書く。評価は ●◕◑◔○、
  高中低は `heat` に列番号を入れると濃淡になる（凡例はツールが付ける）。
- **強調は 1 ページ 1 か所。** `highlight`（行・カード・枝・段階・棒・象限）は、目を向けたい 1 か所だけ。
- **数字には単位・時点・出典。** グラフは `unit` に「何の量、単位、期間」を書く。すべてのページの
  `sources` に、材料にした成果物やページを書く。公開資料は `[資料名](URL)` と書くとリンクになる
  （URL は実在を確かめたものだけ）。グラフに描くのは原典の数字だけ。
- **グラフの形は主張で選ぶ。** 推移・比較は縦棒（`clustered`）、構成は積み上げ（`stacked`）、
  「何がどれだけ効いたか」はウォーターフォール（`waterfall`）、項目名が長い順位は横棒（`horizontal`）。
  グラフのページには必ず `implication` を付ける。
- **AI っぽい言い回しを使わない。** 「非常に」「シームレス」「シナジー」「〜することが可能」「昨今」
  「〜と考えられます」などの空の強調・カタカナ盛り・定型句は、素の動詞と具体の数字に直す。
  Situation／Complication のような考え方の名前を紙面に出さない。
- **密に、ただし読める量で。** 表は 10 行 × 6 列、箇条書きは 8 個、1 点 80 字まで。量が少ないページは
  ツールが文字を大きくして中央に置く。埋めるために中身を足さない。
- 色・フォントは指定しない（テンプレートのテーマが決める）。

## ブロック

| kind | 書くもの |
|---|---|
| `summary` | `items`（`{"text", "details": [...], "ref": ページ id}`、5 個まで） |
| `implication` | `items`（文字列、5 個まで）、任意で `heading`（既定は「示唆」） |
| `bullets` | `items`（文字列、または `{"text", "sub": [...]}`、2〜8 個）、任意で `heading` |
| `table` | `columns`（先頭は行の軸の名前）、`rows`、任意で `heading`・`widths`・`highlight_row`・`heat`（列番号の配列） |
| `cards` | `items`（`{"title", "caption", "points": [...], "highlight"}`、4 個まで。ペルソナ・柱） |
| `stats` | `items`（`{"value", "label", "note", "highlight"}`、4 個まで。value は 10 字以内） |
| `steps` | `items`（`{"title", "points": [...], "highlight"}`、6 個まで。title は動詞を含む 16 字以内） |
| `formula` | `terms`（`{"value", "label", "note"}`、2〜4 個）、`ops`（× + − ÷ を項の間の数だけ）、`result`（`{"value", "label", "note"}`） |
| `callout` | `text`（強調したい一文） |
| `tree` | `root`、`children`（`{"label", "value", "highlight", "children": [{"label", "value"}]}`、葉は 8 個まで） |
| `matrix2x2` | `x`、`y`（軸の名前）、任意で `x_high`・`y_high`、`quadrants`（左上・右上・左下・右下の 4 つ、`{"label", "items", "highlight"}`） |
| `timeline` | `periods`（列）、`lanes`（`{"label", "items": [{"label", "start", "end", "milestone", "highlight"}]}`、start/end は列の番号）、任意で `axis` |
| `chart_bar` | `unit`、`categories`、`series`（`{"name", "values"}`）、任意で `mode`（`clustered`・`stacked`・`waterfall`）・`highlight`（棒の番号）・`horizontal`・`number_format`。`waterfall` は 1 系列で、最初が起点、間が増減、最後が着地 |
| `image` | `path`（spec からの相対パス、例 `figures/Web-13.png`）、`caption` |
| `before_after` | `before`・`after`（`{"path", "label", "points": [...]}`） |

ページの `layout` を `"columns"` にすると、左の部品を縦でなく横に並べる。
