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
back to the judgment tier on any failure. It never starts or stops Clef.
