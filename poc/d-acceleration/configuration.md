# D acceleration configuration

`<project>/.claude/d-acceleration.json` を読み、その各フィールドを
`<project>/.claude/d-acceleration.local.json` で上書きします。したがって
local が project より優先されます。モデルの明示CLI引数だけは両ファイルより
優先されます。

両ファイルはstrict JSONとJSONC（行・ブロックコメント、末尾カンマ）に対応します。
従来のroot直下 `fast`、`balanced`、`judgment` 形式も互換です。全schemaと安全な
既定値は `d-acceleration.example.jsonc` を参照してください。

追加feature、Issue autopilot、自動進行はすべて既定OFFです。OFF時は追加の
モデル呼出し・成果物・レビューを要求しません。自動進行は既定でセッション内に
限定し、不明点で停止します。空の `labelAllowlist` は全許可ではなく許可対象なしです。
