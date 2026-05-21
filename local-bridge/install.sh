#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-$HOME/.huggingclaw/local-bridge}"
mkdir -p "$TARGET_DIR"

cp "$(dirname "$0")/daemon.py" "$TARGET_DIR/daemon.py"
chmod +x "$TARGET_DIR/daemon.py"

if [ -z "${HC_LOCAL_BRIDGE_PROVISIONING_TOKEN:-}" ]; then
  HC_LOCAL_BRIDGE_PROVISIONING_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
)"
fi

cat > "$TARGET_DIR/policy.json" <<'JSON'
{
  "allow_shell": true,
  "allow_read": true,
  "allow_write": false,
  "allow_delete": false,
  "allowlist_cmd_prefixes": ["pwd", "ls", "echo", "cat", "python3 --version"],
  "allowed_paths": ["~/.huggingclaw", "~/Downloads", "~/Documents"],
  "deny_paths": ["~/.ssh", "~/.gnupg", "~/.aws", "~/.config/Google", "~/.config/chromium"],
  "max_output_chars": 12000,
  "max_write_bytes": 200000
}
JSON

cat > "$TARGET_DIR/.env" <<ENV
HC_LOCAL_BRIDGE_MODE=paired
HC_LOCAL_BRIDGE_HOST=127.0.0.1
HC_LOCAL_BRIDGE_PORT=4317
HC_LOCAL_BRIDGE_PROVISIONING_TOKEN=${HC_LOCAL_BRIDGE_PROVISIONING_TOKEN}
ENV

cat > "$TARGET_DIR/start-local-bridge.sh" <<'RUN'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a
. ./.env
set +a
python3 daemon.py
RUN
chmod +x "$TARGET_DIR/start-local-bridge.sh"

echo "Installed local bridge in: $TARGET_DIR"
echo "Start command: $TARGET_DIR/start-local-bridge.sh"
echo "Provisioning token saved to: $TARGET_DIR/.env"
