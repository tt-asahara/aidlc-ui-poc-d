# フロントエンド部品 — メモ帳 Unit（合成フィクスチャ）

- NotesScreen（data-ui-screen="SCREEN-NOTES"）: 状態は data-ui-state で表す。BR-NOTE-TITLE, BR-NOTE-TRUNCATE, BR-NOTE-SAVE。
- MemoBody（data-ui-id="MEMO-BODY"）: 省略表示必須（data-ui-require-truncation）。EXPAND-MEMO の操作対象。BR-NOTE-TRUNCATE。
- DeleteDialog（data-ui-id="DELETE-DIALOG", role="alertdialog"）: BR-NOTE-DELETE-CONFIRM。
- StatusMessage（role="status"）: BR-NOTE-SAVE / BR-NOTE-DELETE-COMPLETE の完了文言。
- StorageErrorPanel（role="alert"）: BR-STORAGE-READ-FAILURE。
- PrivateModeNotice（role="note"）: BR-PRIVATE-MODE。

重要要素の data-ui-id は承認済みモックアップと同一に保つ。文言は functional-spec.md の COPY-* を唯一の出典とする。
