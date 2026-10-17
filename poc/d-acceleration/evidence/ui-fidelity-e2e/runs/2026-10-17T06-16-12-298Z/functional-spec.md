# Functional Spec: メモ帳 (SCREEN-NOTES)

## 1. 目的と境界

- 本書は承認済み refined UI（意味スナップショット）を機能設計の入力として取り込み、画面・状態・AC の対応をルール ID に落とし込む。
- HTML は証跡兼インタラクション仕様であり、コアのビジネスルール／ドメイン設計と承認済み Testing Contract を置き換えない。
- ドメイン概念: Note（id, title, body, updatedAt）、StorageMode（normal / private）、保存データの読み込み結果（成功 / 失敗）。

## 2. 状態一覧

| 状態 | 説明 |
|---|---|
| STATE-LIST | 通常モードのメモ一覧 |
| STATE-EXPANDED | メモ本文を全文表示した状態 |
| STATE-PRIVATE-MODE | プライベートモードのメモ一覧 |
| STATE-CONFIRM-DELETE | 削除確認ダイアログ表示 |
| STATE-DELETED | 削除完了 |
| STATE-SAVED | 保存完了 |
| STATE-STORAGE-ERROR | 保存データ読み込み失敗 |

## 3. 状態遷移

| アクション | 遷移元 | 遷移先 |
|---|---|---|
| EXPAND | STATE-LIST / STATE-PRIVATE-MODE | STATE-EXPANDED |
| SAVE | STATE-LIST / STATE-PRIVATE-MODE | STATE-SAVED |
| DELETE | STATE-LIST / STATE-PRIVATE-MODE | STATE-CONFIRM-DELETE |
| CONFIRM-DELETE | STATE-CONFIRM-DELETE | STATE-DELETED |
| CANCEL-DELETE | STATE-CONFIRM-DELETE | STATE-LIST |

## 4. ルール定義

### 一覧（STATE-LIST / STATE-PRIVATE-MODE）

- **FR-NOTE-TITLE**: メモのタイトルを見出しとして表示する。承認文言の例: 「買い物リスト」→ `買い物リスト`。
- **FR-MEMO-TRUNC**: メモ本文は一覧では省略表示（1 行で切り詰め）を必須とする。本文は完全な文字列を保持し、表示のみ切り詰める。承認サンプル本文: `牛乳、卵、食パン、トマト、玉ねぎ、鶏むね肉、ヨーグルト、コーヒー豆、洗剤、ティッシュペーパーを週末までに買う。`
- **FR-EXPAND**: ボタン `全文を表示` を押すと対象 MEMO-BODY の省略を解除し STATE-EXPANDED へ遷移する。
- **FR-SAVE**: ボタン `保存` を押すとメモを保存し STATE-SAVED へ遷移する。通常モードは永続ストレージ、プライベートモードはタブ寿命のストレージに保存する。
- **FR-DELETE-REQ**: ボタン `削除` を押すと即時削除せず STATE-CONFIRM-DELETE へ遷移する。

### 保存完了

- **FR-SAVE-DONE**: 保存成功時に状態通知（role=status）として `✓ 保存しました` を表示する。

### 削除確認・実行

- **FR-DELETE-CONFIRM-TITLE**: 確認ダイアログ（role=alertdialog）の見出しは `メモを削除しますか？`。
- **FR-DELETE-CONFIRM-DETAIL**: 詳細文はテンプレート `「{title}」（{updatedAt:yyyy/MM/dd} 更新）を削除します。この操作は取り消せません。` とする。承認済みレンダリング例: `「買い物リスト」（2026/10/01 更新）を削除します。この操作は取り消せません。`
- **FR-DELETE-EXEC**: ボタン `削除する` を押すと対象メモを削除し STATE-DELETED へ遷移する。削除は取り消せない。
- **FR-DELETE-CANCEL**: ボタン `キャンセル` を押すと削除せず STATE-LIST へ戻る。
- **FR-DELETE-DONE**: 削除成功時に状態通知（role=status）として `メモを削除しました` を表示する。

### プライベートモード

- **FR-PRIVATE-GUIDE**: プライベートモードでは注記（role=note）として `プライベートモードでは、メモはこのタブを閉じると消えます。残したいメモは通常モードで保存してください。` を表示する。

### ストレージエラー

- **FR-STORAGE-ERR**: 保存データの読み込み失敗時、警告（role=alert）として `保存データを読み込めませんでした。ブラウザのストレージ設定を確認してから、再読み込みしてください。` を表示する。
- **FR-RETRY-LOAD**: ボタン `再読み込み` を押すと保存データの読み込みを再試行する。承認 HTML には遷移定義（action / expected state）が無いため、挙動は機能設計での追加定義とする: 成功時は STATE-LIST、失敗時は STATE-STORAGE-ERROR に留まる。レビューで確認が必要。

## 5. 対象外・注意

- STATE-EXPANDED は CSS 上の状態であり、承認スナップショットに専用の要素行は無い。
- 承認スナップショット内の自動採番テキスト要素（AUTO-821a485e）はルール不要。
- スナップショットからの意図的な省略・逸脱はない。
