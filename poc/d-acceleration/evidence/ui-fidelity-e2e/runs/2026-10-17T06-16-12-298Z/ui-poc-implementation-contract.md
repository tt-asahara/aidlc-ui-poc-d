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
   "sha256": "b17b6acb35decbb1667dd572c905e4a61262cc4cdf6d519d3f0dabd667f24ce7"
  },
  {
   "path": "ui-poc-element-rule-matrix.json",
   "sha256": "a8d6a5057edb412c6e170ce5002741fd00571d5cc468818de77067e5e1b1081c"
  },
  {
   "path": "ui-poc-functional-contract.md",
   "sha256": "f21e5d71bf8c160ab960d5daaf2a6db7db4d2809bd69ea98d317601bf9659d81"
  },
  {
   "path": "implementation.html",
   "sha256": "45b2f89b81cba06d1d7d3c0c328055078fec23b47584efde22b25dab83efbf85"
  }
 ],
 "upstream": {
  "path": "ui-poc-refined-contract.md",
  "sha256": "79fbe6c5287fa0e77b070b4634b6450da9434a3e2b388c5c2db72cd47648f376",
  "stage": "refined-mockups"
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
  "functionalDesignContract": {
   "path": "ui-poc-functional-contract.md",
   "sha256": "f21e5d71bf8c160ab960d5daaf2a6db7db4d2809bd69ea98d317601bf9659d81"
  }
 }
}
```
