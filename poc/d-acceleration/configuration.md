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
`deadlineMs` はDの作業時間を測り、人の考える時間は含めません。claimなしのgeneric autoでは、
公式human gate（`ask`）で待つ時間に加えて、stage内の質問待ちも除外します。質問待ちとは、
現在stageの正規 `<stage>-questions.md` に空の `[Answer]:` が残り、委任AI経路が答えられない
状態です（grantなし、決定的precheckで対象外、または同じbytesへのblock記録あり）。
AI委任で答えられる質問は時計を止めません。待ちは開始/終了時刻付きでsession journal
（`humanWaits[]`）に記録されるため、待機中のcrashやresumeでも二重計上や消失は起きません。
作業時間は数え続けるので、暴走は引き続き `deadline-exceeded` で停止します。claimなしsessionに
別の壁時計上限はなく、`maxSteps`・`through`・no-progressが残りの上限です。Issue claim付き
sessionは壁時計のままです。詳細はREADMEの「Bounded-run deadline」を参照してください。
Feature 11のIssue判定は`models.judgment`を使う固定argvのClaude subprocessです。
session永続化、MCP、slash command、全toolを無効化し、入力・出力・実行時間を制限します。
`halt`は未解決点を残し、`assume`は低riskの仮定だけを台帳へ渡し、`research`は与えられた
Issueと安定した一般知識だけから得た事実を台帳へ渡します。現在情報・外部情報・project証拠が
必要な点は未解決のままです。モデル不可、timeout、余分なapproval fieldを含む不正schemaは
intent作成前にfail-closedで停止し、approval recordを作成しません。

`aiApproval.mode` は既定 `human` です。`stage-gates` は、利用者の事前委任
（`AI-DLC delegate-ai-approvals ...` の完全一致文。host記録の最新human turn
（`latestPersonTurn`）と一致する場合のみ `grant` が作成され、そのturnのTimestamp/Sessionを
grantに束縛し、controllerとsettlerの双方が公式auditの `HUMAN_TURN` 行を再確認します）を
hash-bound grantとしてactive Intentへ保存した場合に限り、`[AI-Autonomy]: low-risk-reversible` を付けた通常stage質問だけをAIが
回答できるようにします。stage gateのAI承認は廃止しました: core/ を上流AI-DLC v2.11.0
（`6a378b53`）と同一に保つため、承認は常に人が公式gateで行います（`ai-approval-controller.ts`
は `grant` のみ、`evaluate`/`verify` は1行のblockを返して停止）。AI回答は
`decisions/ai-question-answers.jsonl`（Dの台帳。公式auditではない）と質問ファイルの
`[Answer Source]`/`[AI Decision ID]` にだけ記録され、`HUMAN_TURN`・`QUESTION_ANSWERED`・
人間の `User Input` を作りません。`minConfidence` は質問回答の最低confidenceです。
`decisionRecordPath` はdecision summaryが読む台帳のpathとしてだけ残ります（AI承認が廃止
されたため、新しい行は書かれません）。
`stage-gates` の実モデル実行は通常、親processの `PATH` から絶対directoryだけを調べ、
realpath化したproject外のnative `claude` だけを使用します。相対/CWD、project内実体、
script、別名dispatcherは拒否します。より厳格な固定が必要な環境だけ、host process環境の
`AIDLC_CLAUDE_EXECUTABLE_PATH` と `AIDLC_CLAUDE_EXECUTABLE_SHA256` を両方指定できます。
片方だけ、またはdigest不一致はfail-closedです。通常起動で実体自身からdigestを再計算して
信頼扱いすることはしません。

`decisionIssueSummary.enabled` は正本からIntent単位のGitHub Issue要約payloadを生成する
既定OFFの機能です。外部送信にはrepository・active Intent・生成payload hashを完全一致で
指定した最新のhost記録済み人間permissionが必要です（D側で、engine自身の読み取り専用
`latestPersonTurn` を使って照合します）。許可後もpending receiptを検索・照合してから同じIssueを更新し、
未解決事項の別Issueを自動作成しません。
`send: true` には同様にhost process環境の `AIDLC_GH_EXECUTABLE_PATH` と
`AIDLC_GH_EXECUTABLE_SHA256` が必要です。
これらは外部送信許可を代替せず、payload-boundな最新の人間permissionも引き続き必須です。
`repository` は `owner/name`(github.com)または `HOST/owner/name`(例:
`github.kddi.com/owner/name` のGitHub Enterprise)です。host省略時はgithub.comで、
継承した `GH_HOST` は使わず対象hostへ固定します。

GitHub CLI認証preflight: issue autopilot(`--repo` またはoriginのURLからhostを判定)と
decision summary送信は、GitHubへ触れる前に固定argvの `gh auth status --hostname <host>`
を実行します。そのhostにloginがなければ `gh-auth-required` で停止し、次の1手
`gh auth login --hostname <host>` を返します。別host(例: GHEだけにlogin)の認証は
満たしません。GitHub読み取り失敗は `github-read-failed` で停止し、claimやintentを残しません。
ローカルsandbox検証(fake gh + bare remote)は `tests/external-sandbox.integration.test.ts`、
実GitHub sandbox repoでの手順は `scripts/real-github-sandbox-runbook.sh`(既定dry-run)です。

全boolean切替の直前には、日本語で対象stageまたは実行時点、役割、ON/OFF時の
挙動、既定値、利用場面、親スイッチや別コマンド依存を記載しています。setupが
配布する `.claude/tools/d-acceleration/d-acceleration.example.jsonc` はこのひな形と
byte-identicalです。機能7の永続化前secret scanは必須で、無効化スイッチはありません。

## Grounding snapshot上限 (`featureInputs.groundingLimits`)

機能27 `sourceGrounding` / 機能28 `specGrounding` は、worker起動前にtoolが作る
snapshot（成果物と証拠rootの全file、hash付き）を1つのpromptへ埋め込みます。上限は
laneごとに次の2つで、未設定時は従来どおり200 file・1,000,000 byteです。

```jsonc
"featureInputs": {
  "groundingLimits": { "maxEvidenceFiles": 200, "maxInputBytes": 1000000 }
}
```

| key | 既定値 | 許容範囲 |
| --- | --- | --- |
| `maxEvidenceFiles` | 200 | 1〜5000の整数 |
| `maxInputBytes`（成果物+証拠の合計） | 1,000,000 | 1〜4,000,000の整数 |

- local がproject よりfield単位で優先します（片方のkeyだけ上書き可能）。
- 0・負数・小数・文字列・未知key・上限超過は丸めずにfail-closedです。D入口
  （`d-feature-checks.ts`、`run.ts --preflight`）は終了コード2で、keyと許容範囲を
  示す1行 `D configuration invalid: invalid featureInputs.groundingLimits.<key>: <値> (allowed: integer 1..<上限>) in <path>`
  を出して停止します。
- 上限の根拠: snapshot全体が1つのworker promptに入るため、byte数がpromptサイズと
  費用を直接決めます。4,000,000 byteは最大worker modelの1M token context
  （約4 byte/token）相当で、これを超えるsnapshotは1 promptに収まらず費用を払った後に
  失敗するだけです。5,000 fileはwalk/hash時間とfileごとのprompt見出しをその範囲内に
  抑えます。引上げは各grounding stageの費用増に直結するため、先にrootを絞ってください。
- 実効値は `run.ts --preflight` の `optional.featureInputs.groundingLimits` と、
  証拠JSONの各lane結果の `limits` に記録されます。上限超過時の `grounding-failed`
  のerrorも該当keyと上限を示します。
- promptはworkerのstdinで渡します（argvはmacOSで1 MiB、Linuxで1引数128 KiBが上限）。
  詳細は `grounding-integration.md` を参照してください。

## 並列実行の親スイッチ (`parallel.enabled`)

既定はONです。OFFはD全体の同時worker数を1にします。対象は、公式engineが発行済みの
設計wave（retry・tier昇格を含む）、read-only fanout、再起動・再開後の再発行waveです。
既存Intentの公式 `Construction Execution` が `swarm` の場合は、次のD境界
（run.ts / conductor、generic auto・Issue autopilotのcheckpoint、`invoke-swarm` 前の
`parallel-guard.ts`）で公式setter `aidlc-state.ts set-construction-execution serial`
だけを使って `serial` へ移します。state fileを直接編集しません。公式setterの判定が
優先され、Construction前は適用、Construction中の無人実行は拒否、対話実行は本人の
依頼が必要です。拒否中もD自身の処理は逐次で続け、公式swarmへのhand-offは
`parallel-off-action-required` / `stop` と1行の `recovery` で止めます。

反映時期: OFFは即時です。各D境界とworker起動ごとに設定を読み直すため、wave途中で
OFFにすると以後の起動はすべて逐次になります（実行中workerは完了まで継続）。ONは
進行中のrun/waveを広げず、次のD起動から有効です。読めない設定はOFF扱いです。
ONへ戻してもDはIntentを `swarm` へ戻しません。`AIDLC_USE_SWARM` と `flags.swarm`
（env > local > project > machine）は発行済み `invoke-swarm` の実行方式選択だけで、
D OFF中にswarmを再有効化しません。

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
