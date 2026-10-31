# D model routing

D worker tiers are separate from the official per-agent model policy.
Explicit D CLI overrides take priority, then the optional local configuration,
then the optional project configuration. An unspecified tier resolves to `opus`.

The optional local file is `{{HARNESS_DIR}}/d-acceleration.local.jsonc`; the optional
project file is `{{HARNESS_DIR}}/d-acceleration.jsonc`. Legacy `.json` names remain
readable. Do not create these files just to read defaults. A layer containing
both names is rejected as ambiguous. The installed `d-acceleration.example.jsonc`
documents the fields and defaults; configuration changes remain the person's.

Native D commands use the dedicated `aidlc d <tool>` namespace. Its fixed tool
inventory is separate from the trusted core engine namespace. GitHub-facing
commands retain the host permission prompt and are not auto-approved.
