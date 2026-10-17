# Frontend Components: SCREEN-NOTES

HTML は証跡と相互作用仕様である。業務ルールは functional-spec.md の ID を参照する。

## コンポーネント一覧

### FC-NOTE-TITLE (NOTE-TITLE-1)
見出し要素。文言例: 買い物リスト。ルール: BR-LIST-TITLE-01。

### FC-MEMO-BODY (MEMO-BODY)
メモ本文領域。幅 280px、初期は max-height 1.4em で overflow hidden による省略表示。STATE-EXPANDED で max-height を解除する。ルール: BR-TRUNC-01, BR-EXPAND-01。

### FC-EXPAND-BUTTON (EXPAND-MEMO)
ボタン。文言: 全文を表示。action EXPAND, 遷移先 STATE-EXPANDED, 対象 MEMO-BODY。ルール: BR-EXPAND-01。

### FC-SAVE-BUTTON (SAVE-NOTE)
ボタン。文言: 保存。action SAVE, 遷移先 STATE-SAVED。ルール: BR-SAVE-01。

### FC-DELETE-BUTTON (DELETE-NOTE)
ボタン。文言: 削除。action DELETE, 遷移先 STATE-CONFIRM-DELETE。ルール: BR-DELETE-01。

### FC-PRIVATE-GUIDANCE (PRIVATE-MODE-GUIDANCE)
role=note の段落。文言: プライベートモードでは、メモはこのタブを閉じると消えます。残したいメモは通常モードで保存してください。ルール: BR-PRIVATE-01。

### FC-DELETE-DIALOG (DELETE-DIALOG)
role=alertdialog の領域。aria-labelledby でタイトルを参照する。固有の文言は持たず、子要素を内包する。
- タイトル (DELETE-CONFIRM-TITLE): メモを削除しますか？ (BR-DELETE-CONFIRM-TITLE-01)
- 詳細 (DELETE-CONFIRM-DETAIL): 「買い物リスト」（2026/10/01 更新）を削除します。この操作は取り消せません。 (BR-DELETE-CONFIRM-DETAIL-01)
- 確定ボタン (CONFIRM-DELETE): 削除する, action CONFIRM-DELETE, 遷移先 STATE-DELETED (BR-DELETE-EXEC-01)
- キャンセルボタン (CANCEL-DELETE): キャンセル, action CANCEL-DELETE, 遷移先 STATE-LIST (BR-DELETE-CANCEL-01)

### FC-DELETE-COMPLETE (DELETE-COMPLETE)
role=status。文言: メモを削除しました。ルール: BR-DELETE-MSG-01。

### FC-SAVE-COMPLETE (SAVE-COMPLETE)
role=status。文言: ✓ 保存しました。ルール: BR-SAVE-MSG-01。

### FC-STORAGE-ERROR (STORAGE-READ-ERROR)
role=alert。文言: 保存データを読み込めませんでした。ブラウザのストレージ設定を確認してから、再読み込みしてください。ルール: BR-STORAGE-ERR-01。

### FC-RETRY-BUTTON (RETRY-LOAD)
ボタン。文言: 再読み込み。承認済み HTML に action ID は無い。ルール: BR-RETRY-01。

## 状態と表示セクション
| 状態 | 表示 |
|---|---|
| STATE-LIST / STATE-EXPANDED | FC-NOTE-TITLE, FC-MEMO-BODY, FC-EXPAND-BUTTON, FC-SAVE-BUTTON, FC-DELETE-BUTTON |
| STATE-PRIVATE-MODE | 上記一覧 + FC-PRIVATE-GUIDANCE |
| STATE-CONFIRM-DELETE | FC-DELETE-DIALOG |
| STATE-DELETED | FC-DELETE-COMPLETE |
| STATE-SAVED | FC-SAVE-COMPLETE |
| STATE-STORAGE-ERROR | FC-STORAGE-ERROR, FC-RETRY-BUTTON |
