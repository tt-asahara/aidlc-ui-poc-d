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
Issue一覧とlabel pollingの候補はproviderの返却順に依存せずIssue番号昇順に正規化し、
自動選択結果には候補・選択番号・選択理由を記録します。`/aidlc --auto status` は
session/claim/heartbeatを変更しない観測専用で、回復処理はstopまたは次の実行開始時に行います。
同じ `auto.enabled` は generic `/aidlc --auto <description>` の親スイッチでもあります。
`sessionOnly: true` では generic と Issue のどちらもIntent作成後に停止し、bounded継続には
明示的な `sessionOnly: false` と `through` / `maxSteps` / `deadlineMs` の上限が必要です。
Feature 11のIssue判定は`models.judgment`を使う固定argvのClaude subprocessです。
session永続化、MCP、slash command、全toolを無効化し、入力・出力・実行時間を制限します。
`halt`は未解決点を残し、`assume`は低riskの仮定だけを台帳へ渡し、`research`は与えられた
Issueと安定した一般知識だけから得た事実を台帳へ渡します。現在情報・外部情報・project証拠が
必要な点は未解決のままです。モデル不可、timeout、余分なapproval fieldを含む不正schemaは
intent作成前にfail-closedで停止し、approval recordを作成しません。

`aiApproval.mode` は既定 `human` です。`stage-gates` は、利用者の事前委任を
hash-bound grantとしてactive Intentへ保存した限定実行でだけ通常stage gateをAI判定します。
判定正本は `decisionRecordPath` のversioned JSONLで、決定主体、理由、公式directive、
workflow state、委任証拠、成果物のSHA-256を結合します。scope/route/Plan Approval、
summary/skeleton、operation、sensor/reviewer不合格、未検証・不確実・外部/公開/認証/権限/
破壊操作は委任対象外で停止します。AI判定は `HUMAN_TURN` や人間の `User Input` を作りません。
`stage-gates` の実モデル実行は通常、親processの `PATH` から絶対directoryだけを調べ、
realpath化したproject外のnative `claude` だけを使用します。相対/CWD、project内実体、
script、別名dispatcherは拒否します。より厳格な固定が必要な環境だけ、host process環境の
`AIDLC_CLAUDE_EXECUTABLE_PATH` と `AIDLC_CLAUDE_EXECUTABLE_SHA256` を両方指定できます。
片方だけ、またはdigest不一致はfail-closedです。通常起動で実体自身からdigestを再計算して
信頼扱いすることはしません。

`decisionIssueSummary.enabled` は正本からIntent単位のGitHub Issue要約payloadを生成する
既定OFFの機能です。外部送信にはrepository・active Intent・生成payload hashを完全一致で
指定した最新のhost記録済み人間permissionが必要です。許可後もpending receiptを検索・照合してから同じIssueを更新し、
未解決事項の別Issueを自動作成しません。
`send: true` には同様にhost process環境の `AIDLC_GH_EXECUTABLE_PATH` と
`AIDLC_GH_EXECUTABLE_SHA256` が必要です。
これらは外部送信許可を代替せず、payload-boundな最新の人間permissionも引き続き必須です。

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
縮退しません。renderer版・OS・viewport・deviceScaleFactor・font指紋・起動flag・
visual policyのいずれかが基準と異なる場合、比較自体を拒否(NOT-READY)します。
画素比較は承認済みpolicyの閾値・anti-alias許容・mask(理由必須)で行い、基準と
policyはBuild and Testで生成・緩和できません。決定論laneが保証するのは観測可能な
DOM事実と、記録済み環境・承認済みpolicy下のrendered PNG一致です。自然文仕様の意味的同値が必要な場合だけ既存`specGrounding`を使用します。
