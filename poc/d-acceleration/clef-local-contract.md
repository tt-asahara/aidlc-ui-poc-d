# Local Clef contract observed on 2026-10-16

Source inspected: `/Users/cb-329/work/cloudflare/clef/local/README.md` and the
adjacent non-secret `start.sh` / `test.sh`. No environment-variable values,
tokens, credentials, or model contents were read.

## Runtime and lifecycle

- Python: `/Users/cb-329/work/cloudflare/clef/.venv/bin/python`
- Model: `local/models/clef-4bit` (about 15 GB on disk)
- Listen address: `127.0.0.1:18742`; unauthenticated and loopback-only
- Start: `cd /Users/cb-329/work/cloudflare/clef/local && ./start.sh`
- Test: `./test.sh`
- Stop: `./stop.sh`, which checks that the PID belongs to `clef_mlx.py serve`
- Expected footprint: about 16.4 GB unified memory; one GPU means inference is
  serialized by the service.

No new installation, download, subscription, API key, or external request was
needed. The service was initially left stopped because starting a 16 GB process
is a material local resource action. After explicit authorization it was
started temporarily with the existing runtime and synthetic fixture.

## HTTP I/O

- `GET /health` -> `{ "status": "ok", "model": "clef" }`
- `GET /v1/models` -> a list containing model ID `clef`
- `POST /v1/systemone` accepts `model`, a string or JSON `state`, and named
  typed `questions`. `choice` questions contain `criteria`.
- A choice answer contains `choice`, `confidence`, and `probabilities`; usage
  contains `input_tokens`, `output_tokens`, and `latency_ms`.
- Errors use `{ "error": { "message": ... } }`.

Observed synthetic smoke result: HTTP 200, severity `high`, confidence
`0.9156`, latency `485.6 ms`. This proves local I/O compatibility, not task
quality or end-to-end acceleration.

The adapter permits only `http://127.0.0.1`, rejects redirects, applies a
timeout and confidence threshold, validates the returned choice, and falls
back to the task's conservative fallback tier on any failure. The planner
enforces a `balanced` floor for official design-wave stages and design tasks
over both Clef answers and fallbacks. It never sends approval, security, or
compliance tasks, or any stage whose policy says `clef: "never"`, to Clef. The
human-decision controllers (question/approval assessors) and the Issue
ambiguity assessor have no Clef path at all. Each route
records `attempted`, `available`, `used`, the loopback endpoint, and a bounded
outcome (`selected`, `unavailable`, `timeout`, `invalid-response`,
`low-confidence`, or `not-eligible`). Malformed JSON is `invalid-response`. Availability never implies that Clef's answer was used. It
never starts or stops Clef.

## Ordinary `/aidlc` configuration

Clef remains off when omitted. To enable an already-running loopback service,
save this as `.claude/d-acceleration.jsonc` for the project or
`.claude/d-acceleration.local.jsonc` for a personal override:

```json
{
  "clef": {
    "enabled": true,
    "url": "http://127.0.0.1:18742",
    "lowRiskUnits": ["explicit-unit-slug"]
  }
}
```

Local fields override project fields. Only `http://127.0.0.1` is accepted.
Enabling Clef never starts it and never makes every Unit eligible; each
low-risk Unit must be named explicitly. If the service is stopped, the route
records `attempted:true`, `available:false`, `used:false`, and
`outcome:"unavailable"`, then uses the conservative fallback tier.

## Availability check on 2026-10-17

`curl --fail http://127.0.0.1:18742/health` failed with exit code 7 (connection
refused). The `model-routing` workstream does not start Clef, so real
availability, accuracy, throughput, and speed-up remain **未検証**. Fallback
behaviour was measured instead. See `evidence/model-routing/README.md` for
the results and the exact live procedure (`clef-eval.ts`).
