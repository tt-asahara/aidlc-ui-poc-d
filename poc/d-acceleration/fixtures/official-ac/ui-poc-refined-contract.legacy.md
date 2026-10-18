# UI 証跡の受け渡し — 詳細モックアップ（fixture: dogfood-3 の抜粋、架空データ）

## Artifact References

| 種類 | パス | 役割 |
|---|---|---|
| 上流の成果物 | `stories.md` | US1.1〜US6.3、受入条件 |

## Screen State Acceptance Mapping

受入条件の ID は `AC1.2.3` を `AC-1-2-3` と書く（旧形式）。

```ui-poc-contract
{
  "schema": 2,
  "stage": "refined-mockups",
  "arm": "C",
  "assets": [
    {
      "path": "refined-app.html",
      "sha256": "9359ce9844df5bb7a9e8df18b3b72fb98102b92ee635931639b4f91b3bfa4ebb"
    },
    {
      "path": "refined-snapshot.json",
      "sha256": "71eefafdab25344be168a8eb0209f5bc615133fe33cc2f6158ee319f603c8967"
    }
  ],
  "mappings": [
    {
      "screen": "SCREEN-HOME",
      "state": "STATE-OPERATOR",
      "ac": "AC-1-1-3",
      "asset": "refined-app.html",
      "check": "The three-way role switch is shown at the top and no login screen exists"
    },
    {
      "screen": "SCREEN-HOME",
      "state": "STATE-LEADER",
      "ac": "AC-1-1-1",
      "asset": "refined-app.html",
      "check": "The leader role button is pressed and the leader home is shown"
    },
    {
      "screen": "SCREEN-HOME",
      "state": "STATE-LOADING",
      "ac": "AC-1-2-3",
      "asset": "refined-app.html",
      "check": "A status line says saved records are loading while the counts show placeholders"
    },
    {
      "screen": "SCREEN-HOME",
      "state": "STATE-OFFLINE",
      "ac": "AC-1-2-1",
      "asset": "refined-app.html",
      "check": "With no network the home still renders and a status banner says there is no signal"
    },
    {
      "screen": "SCREEN-HOME",
      "state": "STATE-OFFLINE",
      "ac": "AC-1-2-4",
      "asset": "refined-app.html",
      "check": "The offline banner says records are kept on the device and all features remain usable, with no error"
    },
    {
      "screen": "SCREEN-HOME",
      "state": "STATE-STORAGE-UNAVAILABLE",
      "ac": "AC-1-3-1",
      "asset": "refined-app.html",
      "check": "An alert banner shows exactly この環境ではデータを保存できません。通常モードで開いてください"
    },
    {
      "screen": "SCREEN-HOME",
      "state": "STATE-LOAD-FAILED",
      "ac": "AC-1-4-1",
      "asset": "refined-app.html",
      "check": "An alertdialog shows exactly 保存データを読み込めませんでした。サンプルデータで再開しますか？ with buttons 再開する and 閉じる"
    },
    {
      "screen": "SCREEN-EQUIPMENT-LIST",
      "state": "STATE-DEFAULT",
      "ac": "AC-1-5-1",
      "asset": "refined-app.html",
      "check": "Twelve fictional machines across three lines are listed"
    },
    {
      "screen": "SCREEN-EQUIPMENT-LIST",
      "state": "STATE-READ-ONLY",
      "ac": "AC-1-3-2",
      "asset": "refined-app.html",
      "check": "In a storage-unavailable environment the list is still browsable under a read-only banner"
    },
    {
      "screen": "SCREEN-EQUIPMENT-DETAIL",
      "state": "STATE-INSPECTED",
      "ac": "AC-3-1-4",
      "asset": "refined-app.html",
      "check": "After inspection today's status reads 点検済み"
    },
    {
      "screen": "SCREEN-EQUIPMENT-DETAIL",
      "state": "STATE-CORRECTED",
      "ac": "AC-3-3-2",
      "asset": "refined-app.html",
      "check": "After a correction today's status reads 修正済み with the correction time"
    },
    {
      "screen": "SCREEN-EQUIPMENT-DETAIL",
      "state": "STATE-READ-ONLY",
      "ac": "AC-1-3-3",
      "asset": "refined-app.html",
      "check": "In read-only mode the inspect and report actions are not shown"
    },
    {
      "screen": "SCREEN-INSPECTION",
      "state": "STATE-INPUT",
      "ac": "AC-3-1-1",
      "asset": "refined-app.html",
      "check": "Every checklist item offers OK, 要注意 and NG buttons"
    },
    {
      "screen": "SCREEN-INSPECTION",
      "state": "STATE-INPUT",
      "ac": "AC-3-2-2",
      "asset": "refined-app.html",
      "check": "Only the NG item offers the report-anomaly link"
    },
    {
      "screen": "SCREEN-INSPECTION",
      "state": "STATE-INPUT",
      "ac": "AC-1-5-2",
      "asset": "refined-app.html",
      "check": "The sample checklist has six items"
    },
    {
      "screen": "SCREEN-INSPECTION",
      "state": "STATE-INCOMPLETE",
      "ac": "AC-3-1-2",
      "asset": "refined-app.html",
      "check": "With an unrecorded item the submit button is disabled and the remaining count is shown"
    },
    {
      "screen": "SCREEN-INSPECTION",
      "state": "STATE-RECORDED",
      "ac": "AC-3-1-3",
      "asset": "refined-app.html",
      "check": "A status notice shows exactly 点検結果を記録しました"
    },
    {
      "screen": "SCREEN-INSPECTION",
      "state": "STATE-ALREADY-RECORDED",
      "ac": "AC-3-3-1",
      "asset": "refined-app.html",
      "check": "A second inspection shows the earlier result and says the change is recorded as a correction"
    },
    {
      "screen": "SCREEN-ANOMALY-FORM",
      "state": "STATE-FROM-NG",
      "ac": "AC-3-2-1",
      "asset": "refined-app.html",
      "check": "Opened from the NG item the equipment and source item are prefilled"
    },
    {
      "screen": "SCREEN-ANOMALY-LIST",
      "state": "STATE-DEFAULT",
      "ac": "AC-3-2-3",
      "asset": "refined-app.html",
      "check": "The anomaly reported from the NG item appears in the open list"
    },
    {
      "screen": "SCREEN-ANOMALY-LIST",
      "state": "STATE-REOPENED",
      "ac": "AC-6-2-6",
      "asset": "refined-app.html",
      "check": "After the completed work order is deleted the anomaly is back in the list tagged as reopened"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-LEADER",
      "ac": "AC-6-1-1",
      "asset": "refined-app.html",
      "check": "History lists work, anomaly and inspection records newest first with kind, time and summary"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-LEADER",
      "ac": "AC-6-2-1",
      "asset": "refined-app.html",
      "check": "The leader sees a delete button on every record"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-LEADER",
      "ac": "AC-6-2-4",
      "asset": "refined-app.html",
      "check": "After cancel the full list remains unchanged"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-TECHNICIAN",
      "ac": "AC-6-2-2",
      "asset": "refined-app.html",
      "check": "A technician sees no delete buttons"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-EMPTY",
      "ac": "AC-6-1-2",
      "asset": "refined-app.html",
      "check": "A machine with no records shows that there are none yet"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-DELETE-CONFIRM",
      "ac": "AC-6-2-3",
      "asset": "refined-app.html",
      "check": "The confirmation shows equipment, record time and kind with buttons 削除する and キャンセル"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-DELETED",
      "ac": "AC-6-2-5",
      "asset": "refined-app.html",
      "check": "After 削除する the record is gone from the list and a status says it was deleted"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-DELETED",
      "ac": "AC-6-3-3",
      "asset": "refined-app.html",
      "check": "Once the referencing record is deleted the earlier record can be deleted"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-BLOCKED-BY-WORK-ORDER",
      "ac": "AC-6-3-1",
      "asset": "refined-app.html",
      "check": "Deleting a referenced anomaly shows exactly 関連する作業指示があるため削除できません and nothing is removed"
    },
    {
      "screen": "SCREEN-HISTORY",
      "state": "STATE-BLOCKED-BY-ANOMALY",
      "ac": "AC-6-3-2",
      "asset": "refined-app.html",
      "check": "Deleting a referenced inspection shows exactly 関連する異常報告があるため削除できません and nothing is removed"
    }
  ],
  "requiredMappings": [
    "SCREEN-HOME/STATE-OPERATOR/AC-1-1-3",
    "SCREEN-HOME/STATE-LEADER/AC-1-1-1",
    "SCREEN-HOME/STATE-LOADING/AC-1-2-3",
    "SCREEN-HOME/STATE-OFFLINE/AC-1-2-1",
    "SCREEN-HOME/STATE-OFFLINE/AC-1-2-4",
    "SCREEN-HOME/STATE-STORAGE-UNAVAILABLE/AC-1-3-1",
    "SCREEN-HOME/STATE-LOAD-FAILED/AC-1-4-1",
    "SCREEN-EQUIPMENT-LIST/STATE-DEFAULT/AC-1-5-1",
    "SCREEN-EQUIPMENT-LIST/STATE-READ-ONLY/AC-1-3-2",
    "SCREEN-EQUIPMENT-DETAIL/STATE-INSPECTED/AC-3-1-4",
    "SCREEN-EQUIPMENT-DETAIL/STATE-CORRECTED/AC-3-3-2",
    "SCREEN-EQUIPMENT-DETAIL/STATE-READ-ONLY/AC-1-3-3",
    "SCREEN-INSPECTION/STATE-INPUT/AC-3-1-1",
    "SCREEN-INSPECTION/STATE-INPUT/AC-3-2-2",
    "SCREEN-INSPECTION/STATE-INPUT/AC-1-5-2",
    "SCREEN-INSPECTION/STATE-INCOMPLETE/AC-3-1-2",
    "SCREEN-INSPECTION/STATE-RECORDED/AC-3-1-3",
    "SCREEN-INSPECTION/STATE-ALREADY-RECORDED/AC-3-3-1",
    "SCREEN-ANOMALY-FORM/STATE-FROM-NG/AC-3-2-1",
    "SCREEN-ANOMALY-LIST/STATE-DEFAULT/AC-3-2-3",
    "SCREEN-ANOMALY-LIST/STATE-REOPENED/AC-6-2-6",
    "SCREEN-HISTORY/STATE-LEADER/AC-6-1-1",
    "SCREEN-HISTORY/STATE-LEADER/AC-6-2-1",
    "SCREEN-HISTORY/STATE-LEADER/AC-6-2-4",
    "SCREEN-HISTORY/STATE-TECHNICIAN/AC-6-2-2",
    "SCREEN-HISTORY/STATE-EMPTY/AC-6-1-2",
    "SCREEN-HISTORY/STATE-DELETE-CONFIRM/AC-6-2-3",
    "SCREEN-HISTORY/STATE-DELETED/AC-6-2-5",
    "SCREEN-HISTORY/STATE-DELETED/AC-6-3-3",
    "SCREEN-HISTORY/STATE-BLOCKED-BY-WORK-ORDER/AC-6-3-1",
    "SCREEN-HISTORY/STATE-BLOCKED-BY-ANOMALY/AC-6-3-2"
  ],
  "fidelity": {
    "approvedSnapshot": {
      "path": "refined-snapshot.json",
      "sha256": "71eefafdab25344be168a8eb0209f5bc615133fe33cc2f6158ee319f603c8967"
    },
    "dispositions": []
  }
}
```

## Approval Evidence

この契約自体は承認の記録を作りません。

## Testing Brief

引き継ぐテスト契約はまだありません。
