# Frontend Components: メモ帳 (SCREEN-NOTES)

## コンポーネント一覧

| ID | コンポーネント | 責務 | 対応ルール |
|---|---|---|---|
| FC-NOTE-TITLE | NoteTitle | タイトル表示 `買い物リスト` | FR-NOTE-TITLE |
| FC-MEMO-BODY | MemoBody（`#MEMO-BODY`） | 本文表示。既定は省略（max-height 1.4em, overflow hidden）、STATE-EXPANDED で解除 | FR-MEMO-TRUNC |
| FC-EXPAND-BUTTON | ExpandButton | `全文を表示`。action=EXPAND, target=MEMO-BODY, expected=STATE-EXPANDED | FR-EXPAND |
| FC-SAVE-BUTTON | SaveButton | `保存`。action=SAVE, expected=STATE-SAVED | FR-SAVE |
| FC-DELETE-BUTTON | DeleteButton | `削除`。action=DELETE, expected=STATE-CONFIRM-DELETE | FR-DELETE-REQ |
| FC-DELETE-DIALOG | DeleteDialog（role=alertdialog） | 確認ダイアログ。見出し `メモを削除しますか？`、詳細 `「買い物リスト」（2026/10/01 更新）を削除します。この操作は取り消せません。` | FR-DELETE-CONFIRM-TITLE, FR-DELETE-CONFIRM-DETAIL |
| FC-CONFIRM-DELETE | ConfirmDeleteButton | `削除する`。action=CONFIRM-DELETE, expected=STATE-DELETED | FR-DELETE-EXEC |
| FC-CANCEL-DELETE | CancelDeleteButton | `キャンセル`。action=CANCEL-DELETE, expected=STATE-LIST | FR-DELETE-CANCEL |
| FC-DELETE-COMPLETE | DeleteCompleteStatus（role=status） | `メモを削除しました` | FR-DELETE-DONE |
| FC-SAVE-COMPLETE | SaveCompleteStatus（role=status） | `✓ 保存しました` | FR-SAVE-DONE |
| FC-PRIVATE-GUIDE | PrivateModeNote（role=note） | `プライベートモードでは、メモはこのタブを閉じると消えます。残したいメモは通常モードで保存してください。` | FR-PRIVATE-GUIDE |
| FC-STORAGE-ERROR | StorageErrorAlert（role=alert） | `保存データを読み込めませんでした。ブラウザのストレージ設定を確認してから、再読み込みしてください。` | FR-STORAGE-ERR |
| FC-RETRY-LOAD | RetryLoadButton | `再読み込み`。再読み込みを実行 | FR-RETRY-LOAD |

## 状態ごとの表示

- STATE-LIST: FC-NOTE-TITLE, FC-MEMO-BODY, FC-EXPAND-BUTTON, FC-SAVE-BUTTON, FC-DELETE-BUTTON
- STATE-PRIVATE-MODE: 上記に加えて FC-PRIVATE-GUIDE
- STATE-CONFIRM-DELETE: FC-DELETE-DIALOG, FC-CONFIRM-DELETE, FC-CANCEL-DELETE
- STATE-DELETED: FC-DELETE-COMPLETE
- STATE-SAVED: FC-SAVE-COMPLETE
- STATE-STORAGE-ERROR: FC-STORAGE-ERROR, FC-RETRY-LOAD

## 実装メモ

- 状態は画面ルートの `data-ui-state` で表現し、アクションボタンの expected state へ遷移させる。
- 文言は functional-spec.md の承認文言を逐語で使う。
- FC-RETRY-LOAD の遷移は FR-RETRY-LOAD の追加定義に従う。
