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
   "sha256": "b17b6acb35decbb1667dd572c905e4a61262cc4cdf6d519d3f0dabd667f24ce7"
  },
  {
   "path": "ui-poc-element-rule-matrix.json",
   "sha256": "a8d6a5057edb412c6e170ce5002741fd00571d5cc468818de77067e5e1b1081c"
  },
  {
   "path": "actual-snapshot.json",
   "sha256": "94f2bbd4c3e5c0aa8fcfe5e36cc8011e12d82b964305114a1cb3e7f35d9c7e8b"
  },
  {
   "path": "ui-poc-element-test-matrix.json",
   "sha256": "b0372a6279fe267bd3f0fa143461fa69a1fee7dc14647dfa9e17b6d67f5da44b"
  }
 ],
 "upstream": {
  "path": "ui-poc-implementation-contract.md",
  "sha256": "c81d8ba70e2447726f177ea3752ee0e056c976312ee24a886c1f91cc91270483",
  "stage": "code-generation"
 },
 "fidelity": {
  "approvedSnapshot": {
   "path": "ui-semantic-snapshot.json",
   "sha256": "b17b6acb35decbb1667dd572c905e4a61262cc4cdf6d519d3f0dabd667f24ce7"
  },
  "dispositions": [],
  "elementRuleMatrix": {
   "path": "ui-poc-element-rule-matrix.json",
   "sha256": "a8d6a5057edb412c6e170ce5002741fd00571d5cc468818de77067e5e1b1081c"
  },
  "actualSnapshot": {
   "path": "actual-snapshot.json",
   "sha256": "94f2bbd4c3e5c0aa8fcfe5e36cc8011e12d82b964305114a1cb3e7f35d9c7e8b"
  },
  "elementTestMatrix": {
   "path": "ui-poc-element-test-matrix.json",
   "sha256": "b0372a6279fe267bd3f0fa143461fa69a1fee7dc14647dfa9e17b6d67f5da44b"
  }
 }
}
```
