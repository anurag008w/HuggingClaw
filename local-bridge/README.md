# Local Bridge (Consent-Gated)

This module provides a **consent-gated local daemon** for HuggingClaw/OpenClaw using a real cloud+local flow:

- HuggingClaw/OpenClaw in cloud orchestrates actions.
- Local bridge on user PC executes actions.
- Persistent consent is granted via provisioning token (no pairing-code screen flow).

## Access modes

Set `HC_LOCAL_BRIDGE_MODE`:

- `disabled`: daemon refuses privileged requests.
- `paired`: provisioning-token based grant creates trusted session token(s).
- `trusted`: same as paired, but for dedicated single-user boxes where persistent consent is intended.

## One-command setup

```bash
python3 -m pip install --user flask && bash local-bridge/install.sh
```

Then start locally:

```bash
~/.huggingclaw/local-bridge/start-local-bridge.sh
```

## Cloud-to-local consent flow (no pairing code)

1. Cloud service/admin obtains provisioning token from local `.env` created by installer.
2. Cloud calls grant endpoint once to mint trusted token:

```bash
curl -s -X POST http://127.0.0.1:4317/consent/grant \
  -H "x-hc-provisioning-token: <provisioning-token>" \
  -H 'content-type: application/json' \
  -d '{"label":"openclaw-cloud"}'
```

3. Cloud stores returned trusted token and uses it for tool calls:

```bash
curl -s -X POST http://127.0.0.1:4317/execute \
  -H 'content-type: application/json' \
  -H 'x-hc-bridge-token: <trusted-token>' \
  -d '{"action":"shell.run","cmd":"pwd"}'
```

## Supported actions

- `shell.run` (policy allowlist applies)
- `file.read`
- `file.write`
- `file.delete`

## Policy controls

Edit `~/.huggingclaw/local-bridge/policy.json`:

- `allow_shell`, `allow_read`, `allow_write`, `allow_delete`
- `allowlist_cmd_prefixes`
- `allowed_paths` (scope where read/write/delete is permitted)
- `deny_paths` (always blocked)
- `max_output_chars`, `max_write_bytes`

## Localhost and real connectivity

By default bridge binds `127.0.0.1` for safety. For real cloud-to-local connectivity, keep bridge local and expose it using a secure tunnel/proxy you control, then forward requests from OpenClaw tool adapter.

## Fully wired in HuggingClaw proxy

HuggingClaw now supports optional local-bridge passthrough at `/local-bridge/*` from the main server.
Set these HF secrets/variables:

- `HC_LOCAL_BRIDGE_URL` → bridge endpoint reachable by HuggingClaw runtime.
- `HC_LOCAL_BRIDGE_TOKEN` → trusted token minted from `/consent/grant`.

Then OpenClaw-side callers can hit:

- `POST /local-bridge/execute`
- `GET /local-bridge/consent/status`
- `POST /local-bridge/consent/revoke_all` (if you route provisioning token separately)

Requests are protected by HuggingClaw gateway auth + bridge trusted token header injection.
