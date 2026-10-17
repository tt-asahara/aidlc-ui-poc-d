# Dogfood UI contract (refined-mockups)

## Artifact References

## Screen State Acceptance Mapping

## Approval Evidence

SYNTHETIC operator approval for a scripted dogfood; not a human gate.

## Testing Brief

```ui-poc-contract
{
 "arm": "C",
 "schema": 2,
 "mappings": [
  {
   "screen": "SCREEN-NOTES",
   "state": "STATE-LIST",
   "ac": "AC-NOTE-001",
   "asset": "notes.html",
   "check": "renderer capture of STATE-LIST"
  },
  {
   "screen": "SCREEN-NOTES",
   "state": "STATE-CONFIRM-DELETE",
   "ac": "AC-NOTE-002",
   "asset": "notes.html",
   "check": "renderer capture of STATE-CONFIRM-DELETE"
  },
  {
   "screen": "SCREEN-NOTES",
   "state": "STATE-DELETED",
   "ac": "AC-NOTE-003",
   "asset": "notes.html",
   "check": "renderer capture of STATE-DELETED"
  },
  {
   "screen": "SCREEN-NOTES",
   "state": "STATE-SAVED",
   "ac": "AC-NOTE-004",
   "asset": "notes.html",
   "check": "renderer capture of STATE-SAVED"
  },
  {
   "screen": "SCREEN-NOTES",
   "state": "STATE-STORAGE-ERROR",
   "ac": "AC-NOTE-005",
   "asset": "notes.html",
   "check": "renderer capture of STATE-STORAGE-ERROR"
  },
  {
   "screen": "SCREEN-NOTES",
   "state": "STATE-PRIVATE-MODE",
   "ac": "AC-NOTE-006",
   "asset": "notes.html",
   "check": "renderer capture of STATE-PRIVATE-MODE"
  }
 ],
 "requiredMappings": [
  "SCREEN-NOTES/STATE-LIST/AC-NOTE-001",
  "SCREEN-NOTES/STATE-CONFIRM-DELETE/AC-NOTE-002",
  "SCREEN-NOTES/STATE-DELETED/AC-NOTE-003",
  "SCREEN-NOTES/STATE-SAVED/AC-NOTE-004",
  "SCREEN-NOTES/STATE-STORAGE-ERROR/AC-NOTE-005",
  "SCREEN-NOTES/STATE-PRIVATE-MODE/AC-NOTE-006"
 ],
 "stage": "refined-mockups",
 "assets": [
  {
   "path": "notes.html",
   "sha256": "7e99c672bf11d84448f49b9bb8c605565a95330a3095420cb7e7229cc1b28ffc"
  },
  {
   "path": "ui-semantic-snapshot.json",
   "sha256": "b17b6acb35decbb1667dd572c905e4a61262cc4cdf6d519d3f0dabd667f24ce7"
  }
 ],
 "fidelity": {
  "approvedSnapshot": {
   "path": "ui-semantic-snapshot.json",
   "sha256": "b17b6acb35decbb1667dd572c905e4a61262cc4cdf6d519d3f0dabd667f24ce7"
  },
  "dispositions": []
 }
}
```
