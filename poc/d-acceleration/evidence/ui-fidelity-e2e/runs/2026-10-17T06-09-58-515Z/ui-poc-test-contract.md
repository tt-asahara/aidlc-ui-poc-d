# Dogfood UI contract (build-and-test)

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
 "stage": "build-and-test",
 "assets": [
  {
   "path": "notes.html",
   "sha256": "7e99c672bf11d84448f49b9bb8c605565a95330a3095420cb7e7229cc1b28ffc"
  },
  {
   "path": "ui-semantic-snapshot.json",
   "sha256": "1a77d95b4c3a20a3eef02d102405fc063326f37d675c892445227d67e15b1d2f"
  },
  {
   "path": "ui-poc-element-rule-matrix.json",
   "sha256": "9719b7911f77901ac911bc5136cc7a560b368688b63ce7aa27789d713f82f10b"
  },
  {
   "path": "actual-snapshot.json",
   "sha256": "904458ab848ed43b7a6deff9787ce7db379c7d8a6f98c79d15d63a4a97865a8b"
  },
  {
   "path": "ui-poc-element-test-matrix.json",
   "sha256": "fa236e772e072794a612807e32b7e30cea54181001384c6244f9cdd6dff30e3a"
  }
 ],
 "upstream": {
  "path": "ui-poc-implementation-contract.md",
  "sha256": "13a20b8b68785b0f7c8e6dbdb92f0c9d3e1440ca48e01dacf4e2cd68b5e2aefd",
  "stage": "code-generation"
 },
 "fidelity": {
  "approvedSnapshot": {
   "path": "ui-semantic-snapshot.json",
   "sha256": "1a77d95b4c3a20a3eef02d102405fc063326f37d675c892445227d67e15b1d2f"
  },
  "dispositions": [],
  "elementRuleMatrix": {
   "path": "ui-poc-element-rule-matrix.json",
   "sha256": "9719b7911f77901ac911bc5136cc7a560b368688b63ce7aa27789d713f82f10b"
  },
  "actualSnapshot": {
   "path": "actual-snapshot.json",
   "sha256": "904458ab848ed43b7a6deff9787ce7db379c7d8a6f98c79d15d63a4a97865a8b"
  },
  "elementTestMatrix": {
   "path": "ui-poc-element-test-matrix.json",
   "sha256": "fa236e772e072794a612807e32b7e30cea54181001384c6244f9cdd6dff30e3a"
  }
 }
}
```
