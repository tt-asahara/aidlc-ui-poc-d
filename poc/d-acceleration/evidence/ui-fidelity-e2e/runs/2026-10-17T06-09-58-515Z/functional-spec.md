# Functional Spec: メモ帳 (SCREEN-NOTES)

## 1. 位置づけ
承認済み refined HTML と ui-poc-refined-contract.md は、画面・状態・操作の証跡および相互作用仕様として扱う。業務ルールとドメイン設計の境界は本書で定義する。承認済み Testing Contract は変更しない。

## 2. ドメインモデル
- Note: id, title, body, updatedAt
- NoteStore: 保存先ストレージ。通常モードでは永続ストレージ、プライベートモードではタブ内の一時ストレージ。
- 画面状態: STATE-LIST, STATE-EXPANDED, STATE-PRIVATE-MODE, STATE-CONFIRM-DELETE, STATE-DELETED, STATE-SAVED, STATE-STORAGE-ERROR

## 3. 状態遷移 (screen / state / action)
| 現在状態 | アクション | 遷移先 | ルール |
|---|---|---|---|
| STATE-LIST / STATE-PRIVATE-MODE | EXPAND | STATE-EXPANDED | BR-EXPAND-01 |
| STATE-LIST / STATE-PRIVATE-MODE | SAVE | STATE-SAVED | BR-SAVE-01 |
| STATE-LIST / STATE-PRIVATE-MODE | DELETE | STATE-CONFIRM-DELETE | BR-DELETE-01 |
| STATE-CONFIRM-DELETE | CONFIRM-DELETE | STATE-DELETED | BR-DELETE-EXEC-01 |
| STATE-CONFIRM-DELETE | CANCEL-DELETE | STATE-LIST | BR-DELETE-CANCEL-01 |

STATE-EXPANDED は MEMO-BODY の省略解除のみを表し、承認済みスナップショット上に固有の要素行は無い。

## 4. ルール定義

### BR-LIST-TITLE-01 メモタイトル表示
メモ一覧ではタイトルを加工せず表示する。承認済み文言の例: 買い物リスト

### BR-TRUNC-01 メモ本文の省略表示
本文は初期状態では 1 行分の高さに切り詰めて表示する (省略必須)。全文は BR-EXPAND-01 で表示する。承認済み本文例: 牛乳、卵、食パン、トマト、玉ねぎ、鶏むね肉、ヨーグルト、コーヒー豆、洗剤、ティッシュペーパーを週末までに買う。

### BR-EXPAND-01 全文表示
ボタン文言は 全文を表示。押下すると MEMO-BODY の省略を解除し STATE-EXPANDED へ遷移する。本文データは変更しない。

### BR-SAVE-01 保存操作
ボタン文言は 保存。押下で Note を NoteStore に書き込み、成功したら STATE-SAVED へ遷移する。通常モードでは永続ストレージ、プライベートモードでは一時ストレージへ保存する。

### BR-SAVE-MSG-01 保存完了メッセージ
STATE-SAVED では status として次を表示する: ✓ 保存しました

### BR-DELETE-01 削除操作
ボタン文言は 削除。押下しても即時削除せず、STATE-CONFIRM-DELETE へ遷移して確認ダイアログ (alertdialog) を表示する。

### BR-DELETE-CONFIRM-TITLE-01 削除確認タイトル
確認ダイアログのタイトル: メモを削除しますか？

### BR-DELETE-CONFIRM-DETAIL-01 削除確認詳細
テンプレート: 「{title}」（{updatedAt:YYYY/MM/DD} 更新）を削除します。この操作は取り消せません。
承認済みの描画例: 「買い物リスト」（2026/10/01 更新）を削除します。この操作は取り消せません。

### BR-DELETE-EXEC-01 削除実行
ボタン文言は 削除する。押下で対象 Note を NoteStore から削除し STATE-DELETED へ遷移する。削除は取り消せない。

### BR-DELETE-CANCEL-01 削除キャンセル
ボタン文言は キャンセル。押下で何も削除せず STATE-LIST へ戻る。

### BR-DELETE-MSG-01 削除完了メッセージ
STATE-DELETED では status として次を表示する: メモを削除しました

### BR-PRIVATE-01 プライベートモード案内
プライベートモード (STATE-PRIVATE-MODE) では一覧に加えて note として次を表示する: プライベートモードでは、メモはこのタブを閉じると消えます。残したいメモは通常モードで保存してください。
一覧の各要素 (タイトル・本文・全文を表示・保存・削除) は通常モードと同一ルール (BR-LIST-TITLE-01, BR-TRUNC-01, BR-EXPAND-01, BR-SAVE-01, BR-DELETE-01) に従う。

### BR-STORAGE-ERR-01 ストレージ読み込みエラー
NoteStore の読み込みに失敗した場合 STATE-STORAGE-ERROR へ遷移し、alert として次を表示する: 保存データを読み込めませんでした。ブラウザのストレージ設定を確認してから、再読み込みしてください。

### BR-RETRY-01 再読み込み
STATE-STORAGE-ERROR のボタン文言は 再読み込み。押下で NoteStore の読み込みをやり直す。承認済み HTML には遷移先 (expectedState) の指定が無いため、本書でも遷移先は固定しない。再試行結果に応じて BR-STORAGE-ERR-01 または一覧表示となる。

## 5. 非機能・境界
- 文言は全て承認済み文言と逐語一致させる。
- 削除と保存の業務判断は本書のルール、画面の見た目は frontend-components.md の責務とする。
