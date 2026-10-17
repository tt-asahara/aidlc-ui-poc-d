# Dogfood UI contract (code-generation)

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
 "stage": "code-generation",
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
   "path": "ui-poc-functional-contract.md",
   "sha256": "ac5d36b00f075762de05b35d5b942d031be355386b4d67873e2ea4f0d925cb6a"
  },
  {
   "path": "implementation.html",
   "sha256": "d18a95edc48bcb33d7b3dd1aff58faf2937cfea62085c8f7a1b67657716d3ee5"
  }
 ],
 "upstream": {
  "path": "ui-poc-refined-contract.md",
  "sha256": "39e3d1cb9f5b535ad1b26c1299bd7643a918fb45a044ed9bfdb385514f612891",
  "stage": "refined-mockups"
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
  "functionalDesignContract": {
   "path": "ui-poc-functional-contract.md",
   "sha256": "ac5d36b00f075762de05b35d5b942d031be355386b4d67873e2ea4f0d925cb6a"
  }
 }
}
```
