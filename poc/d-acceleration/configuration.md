# D acceleration configuration

正式名 `<project>/.claude/d-acceleration.jsonc` を読み、その各フィールドを
`<project>/.claude/d-acceleration.local.jsonc` で上書きします。したがって
local が project より優先されます。モデルの明示CLI引数だけは両ファイルより
優先されます。

旧 `.json` 名も後方互換として読みます。同じレイヤーに `.jsonc` と `.json` が
両方ある場合は、曖昧な選択をせず明示エラーで停止します。両ファイルはstrict JSONと
JSONC（行・ブロックコメント、末尾カンマ）に対応します。
従来のroot直下 `fast`、`balanced`、`judgment` 形式も互換です。全schemaと安全な
既定値は `d-acceleration.example.jsonc` を参照してください。

追加feature、Issue autopilot、自動進行はすべて既定OFFです。OFF時は追加の
モデル呼出し・成果物・レビューを要求しません。自動進行は既定でセッション内に
限定し、不明点で停止します。空の `labelAllowlist` は全許可ではなく許可対象なしです。

全boolean切替の直前には、日本語で対象stageまたは実行時点、役割、ON/OFF時の
挙動、既定値、利用場面、親スイッチや別コマンド依存を記載しています。setupが
配布する `.claude/tools/d-acceleration/d-acceleration.example.jsonc` はこのひな形と
byte-identicalです。機能7の永続化前secret scanは必須で、無効化スイッチはありません。

## UI fidelity image settings

`features.mockupPngGeneration` と `features.visualRegression` は独立した既定OFFの
設定です。承認前の有効な基準PNG生成は両者の論理ORなので、画像比較をONにすると
必要な基準PNG生成も有効になります。Build and Testで基準を初回生成または更新しては
いけません。両方OFFでもschema 2のsemantic DOM renderingは必須であり、これらは
PNG撮影と画像比較だけを切り替えます。

画像比較ON時は同じviewport、renderer/font環境、承認済みbaseline hashが必要です。
browser、baseline、状態再現、互換環境のいずれかがなければNOT-READYであり、passへ
縮退しません。決定論laneが保証するのは観測可能なDOM事実とrendered PNG bytesの
一致です。自然文仕様の意味的同値が必要な場合だけ既存`specGrounding`を使用します。
