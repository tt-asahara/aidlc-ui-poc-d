# 機能仕様 — メモ帳 Unit（合成フィクスチャ）

承認済み Refined Mockups（SCREEN-NOTES）の意味スナップショットから生成した要素→ルール対応表
（ui-poc-element-rule-matrix.json）の各ルール ID を、本書で定義する。

## 業務ルール

- **BR-NOTE-TITLE**: 一覧と確認ダイアログは、メモのタイトルをそのまま表示する。
- **BR-NOTE-TRUNCATE**: 長いメモ本文は 1 行に省略表示し、「全文を表示」操作で全文に展開する（STATE-LIST → STATE-EXPANDED）。
- **BR-NOTE-SAVE**: 保存操作の完了後は STATE-SAVED に遷移し、完了文言を表示する。
- **BR-NOTE-DELETE-CONFIRM**: 削除操作は即時に削除せず、対象メモのタイトルと最終更新日、取り消せない旨を示す確認ダイアログ（STATE-CONFIRM-DELETE）を表示する。「削除する」で STATE-DELETED、「キャンセル」で STATE-LIST に戻る。
- **BR-NOTE-DELETE-COMPLETE**: 削除完了後は STATE-DELETED に遷移し、完了文言を表示する。
- **BR-PRIVATE-MODE**: ブラウザのプライベートモードを検出した場合、一覧の上に保存されない旨の案内を表示する（STATE-PRIVATE-MODE）。
- **BR-STORAGE-READ-FAILURE**: 保存データの読み込みに失敗した場合、一覧を表示せずエラー文言と「再読み込み」を表示する（STATE-STORAGE-ERROR）。

## 文言（承認済みモックアップから逐語）

| ID | 文言 |
| --- | --- |
| COPY-EXPAND | 全文を表示 |
| COPY-SAVE | 保存 |
| COPY-DELETE | 削除 |
| COPY-DELETE-CONFIRM-TITLE | メモを削除しますか？ |
| COPY-DELETE-CONFIRM-DETAIL | 「{title}」（{updated} 更新）を削除します。この操作は取り消せません。 |
| COPY-CONFIRM-DELETE | 削除する |
| COPY-CANCEL | キャンセル |
| COPY-DELETE-COMPLETE | メモを削除しました |
| COPY-SAVE-COMPLETE | ✓ 保存しました |
| COPY-STORAGE-READ-ERROR | 保存データを読み込めませんでした。ブラウザのストレージ設定を確認してから、再読み込みしてください。 |
| COPY-RETRY | 再読み込み |
| COPY-PRIVATE-MODE | プライベートモードでは、メモはこのタブを閉じると消えます。残したいメモは通常モードで保存してください。 |

COPY-DELETE-CONFIRM-DETAIL の承認済み表示例（テンプレートの逐語確認用）:
「買い物リスト」（2026/10/01 更新）を削除します。この操作は取り消せません。

一覧のサンプルデータ（承認済み表示例）: 買い物リスト

## Traceability

AC-NOTE-001〜AC-NOTE-006 を SCREEN-NOTES の各状態に対応付ける（Refined Mockups 契約の requiredMappings と同一）。
