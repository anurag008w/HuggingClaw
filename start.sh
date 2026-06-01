#!/bin/bash
set -euo pipefail

umask 0077

# ════════════════════════════════════════════════════════════════
# HuggingClaw — OpenClaw Gateway for HF Spaces
# ════════════════════════════════════════════════════════════════

# ── Startup Banner ──
trim_var() {
  # Trim leading/trailing whitespace from a value.
  printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

hc_is_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

load_env_bundle() {
  # HUGGINGCLAW_ENV_BUNDLE is a single base64url-encoded JSON object generated
  # by /env-builder. Existing individual env vars win over bundled values.
  local bundle="${HUGGINGCLAW_ENV_BUNDLE:-${ENV_BUNDLE:-}}"
  [ -n "$bundle" ] || return 0
  eval "$(HUGGINGCLAW_ENV_BUNDLE="$bundle" python3 - <<'PYBUNDLE'
import base64, json, os, re, shlex, sys

raw = os.environ.get("HUGGINGCLAW_ENV_BUNDLE", "").strip()
try:
    if raw.startswith("{"):
        data = json.loads(raw)
    else:
        padded = raw + "=" * (-len(raw) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    if not isinstance(data, dict):
        raise ValueError("bundle must decode to a JSON object")
    for key, value in data.items():
        if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", str(key)):
            continue
        if str(key) in {"HUGGINGCLAW_ENV_BUNDLE", "ENV_BUNDLE"}:
            continue
        existing = os.environ.get(str(key), "")
        if str(key) == "OPENCLAW_VERSION":
            # Docker bakes OPENCLAW_VERSION=latest as a default ENV, which used to
            # make env-builder/bundled OPENCLAW_VERSION=beta or a pinned version
            # get ignored. Treat only a non-latest existing value as a true
            # individual override for this key.
            if existing and existing.strip() != "latest":
                continue
        elif existing:
            continue
        if value is None or isinstance(value, (dict, list)):
            continue
        print(f"export {key}={shlex.quote(str(value))}")
except Exception as exc:
    print(f"Warning: invalid HUGGINGCLAW_ENV_BUNDLE ignored: {exc}", file=sys.stderr)
PYBUNDLE
)"
}

load_env_bundle

# Normalize core env values so accidental surrounding spaces in HF Variables
# do not block updates or cause stale comparisons/merges.
LLM_MODEL="$(trim_var "${LLM_MODEL:-}")"
LLM_FALLBACK_MODELS="$(trim_var "${LLM_FALLBACK_MODELS:-}")"
GATEWAY_TOKEN="$(trim_var "${GATEWAY_TOKEN:-}")"
OPENCLAW_PASSWORD="$(trim_var "${OPENCLAW_PASSWORD:-}")"
LLM_API_KEY="$(trim_var "${LLM_API_KEY:-}")"
CLOUDFLARE_PROXY_URL="$(trim_var "${CLOUDFLARE_PROXY_URL:-}")"

OPENCLAW_VERSION="$(trim_var "${OPENCLAW_VERSION:-latest}")"
OPENCLAW_RUNTIME_UPGRADE="$(trim_var "${OPENCLAW_RUNTIME_UPGRADE:-true}")"
OPENCLAW_BROWSER_PROFILE="$(trim_var "${OPENCLAW_BROWSER_PROFILE:-openclaw}")"
OPENCLAW_BROWSER_CDP_URL="$(trim_var "${OPENCLAW_BROWSER_CDP_URL:-${BROWSER_CDP_URL:-}}")"
OPENCLAW_BROWSER_ATTACH_ONLY="$(trim_var "${OPENCLAW_BROWSER_ATTACH_ONLY:-auto}")"
APP_BASE="$(trim_var "${APP_BASE:-/app}")"
JUPYTER_BASE="$(trim_var "${JUPYTER_BASE:-/terminal}")"
PORT="$(trim_var "${PORT:-7861}")"
GATEWAY_PORT="$(trim_var "${GATEWAY_PORT:-7860}")"
JUPYTER_PORT="$(trim_var "${JUPYTER_PORT:-8888}")"
BACKUP_DATASET_NAME="$(trim_var "${BACKUP_DATASET_NAME:-${BACKUP_DATASET:-huggingclaw-backup}}")"
SPACE_AUTHOR_NAME="$(trim_var "${SPACE_AUTHOR_NAME:-}")"
SPACE_HOST="$(trim_var "${SPACE_HOST:-}")"
OPENCLAW_APP_DIR="/home/node/.openclaw/openclaw-app"
IFRAME_FIX_PRELOAD="/home/node/app/iframe-fix.cjs"
KEY_ROTATOR_PRELOAD="/home/node/app/multi-provider-key-rotator.cjs"
OPENCLAW_RUNTIME_VERSION=""
OPENCLAW_FILE_LOG_LEVEL_CONFIGURED=false
OPENCLAW_CONSOLE_LOG_LEVEL_CONFIGURED=false
OPENCLAW_CONSOLE_LOG_STYLE_CONFIGURED=false
[ "${OPENCLAW_FILE_LOG_LEVEL+x}" = "x" ] && OPENCLAW_FILE_LOG_LEVEL_CONFIGURED=true
[ "${OPENCLAW_CONSOLE_LOG_LEVEL+x}" = "x" ] && OPENCLAW_CONSOLE_LOG_LEVEL_CONFIGURED=true
[ "${OPENCLAW_CONSOLE_LOG_STYLE+x}" = "x" ] && OPENCLAW_CONSOLE_LOG_STYLE_CONFIGURED=true
WHATSAPP_ENABLED="${WHATSAPP_ENABLED:-false}"
WHATSAPP_ENABLED_NORMALIZED=$(printf '%s' "$WHATSAPP_ENABLED" | tr '[:upper:]' '[:lower:]')
DEV_MODE_RAW="${DEV_MODE:-false}"
DEV_MODE_NORMALIZED=$(printf '%s' "$DEV_MODE_RAW" | tr '[:upper:]' '[:lower:]')
DEV_MODE_ENABLED=false
if hc_is_true "$DEV_MODE_NORMALIZED"; then
  DEV_MODE_ENABLED=true
fi
# Auto-enable DEV_MODE when GATEWAY_TOKEN is set and DEV_MODE was not explicitly configured.
# GATEWAY_TOKEN doubles as JUPYTER_TOKEN (see start_jupyter_once) — no extra secret required.
if [ "$DEV_MODE_ENABLED" != "true" ] && [ -z "${DEV_MODE:-}" ] && [ -n "${GATEWAY_TOKEN:-}" ]; then
  DEV_MODE_ENABLED=true
  : # auto-enable is silent; set DEV_MODE=false to opt out
fi
if [ "$DEV_MODE_ENABLED" = "true" ]; then
  export DEV_MODE=true
else
  export DEV_MODE=false
fi
SYNC_INTERVAL="$(trim_var "${SYNC_INTERVAL:-180}")"
DEVDATA_DATASET_NAME="$(trim_var "${DEVDATA_DATASET_NAME:-huggingclaw-devdata}")"
DEVDATA_SYNC_INTERVAL="$(trim_var "${DEVDATA_SYNC_INTERVAL:-180}")"
DEVDATA_RAW="$(trim_var "${DEVDATA:-on}")"
DEVDATA_NORMALIZED=$(printf '%s' "$DEVDATA_RAW" | tr '[:upper:]' '[:lower:]')
DEVDATA_ENABLED=true
if ! hc_is_true "$DEVDATA_NORMALIZED"; then
  DEVDATA_ENABLED=false
fi
# On HF Spaces, browser is disabled by default (no display server).
# To enable local managed browser: set BROWSER_PLUGIN_MODE=enabled.
# To avoid local Chromium on constrained Spaces: set BROWSER_PLUGIN_MODE=remote
# and OPENCLAW_BROWSER_CDP_URL to a remote Chromium CDP endpoint.
# WARNING: local managed browser requires at least CPU Upgrade tier (2 vCPU / 16GB RAM).
if [ -n "${BROWSER_ENABLED:-}" ] && [ -z "${BROWSER_PLUGIN_MODE:-}" ]; then
  if hc_is_true "$(trim_var "${BROWSER_ENABLED}")"; then
    BROWSER_PLUGIN_MODE="enabled"
  else
    BROWSER_PLUGIN_MODE="disabled"
  fi
fi

if [ -n "${SPACE_HOST:-}" ]; then
  OPENCLAW_CONSOLE_LOG_LEVEL="${OPENCLAW_CONSOLE_LOG_LEVEL:-warn}"
  OPENCLAW_FILE_LOG_LEVEL="${OPENCLAW_FILE_LOG_LEVEL:-info}"
  OPENCLAW_CONSOLE_LOG_STYLE="${OPENCLAW_CONSOLE_LOG_STYLE:-compact}"
  BROWSER_PLUGIN_MODE="${BROWSER_PLUGIN_MODE:-disabled}"
  ACP_PLUGIN_MODE="${ACP_PLUGIN_MODE:-disabled}"
  # HF Spaces does not benefit from Bonjour discovery, and the retries add noise.
  export OPENCLAW_DISABLE_BONJOUR="${OPENCLAW_DISABLE_BONJOUR:-1}"
  # HF Spaces IPv6 routing is unreliable and causes ECONNRESET on outbound
  # WebSocket connections (WhatsApp, Telegram, etc.) which triggers gateway
  # channel restarts and floods logs with "ws closed before connect" (1006)
  # errors. Force IPv4 globally for ALL channels on this Space.
  # Previously this was only set inside the Telegram block — meaning
  # WhatsApp-only deployments never got this fix and suffered ECONNRESET drops.
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first"
  export OPENCLAW_WHATSAPP_DISABLE_AUTO_SELECT_FAMILY="${OPENCLAW_WHATSAPP_DISABLE_AUTO_SELECT_FAMILY:-1}"
  export OPENCLAW_WHATSAPP_DNS_RESULT_ORDER="${OPENCLAW_WHATSAPP_DNS_RESULT_ORDER:-ipv4first}"
else
  OPENCLAW_CONSOLE_LOG_LEVEL="${OPENCLAW_CONSOLE_LOG_LEVEL:-info}"
  OPENCLAW_FILE_LOG_LEVEL="${OPENCLAW_FILE_LOG_LEVEL:-info}"
  OPENCLAW_CONSOLE_LOG_STYLE="${OPENCLAW_CONSOLE_LOG_STYLE:-pretty}"
  BROWSER_PLUGIN_MODE="${BROWSER_PLUGIN_MODE:-auto}"
  ACP_PLUGIN_MODE="${ACP_PLUGIN_MODE:-auto}"
fi
BROWSER_PLUGIN_MODE="$(trim_var "$BROWSER_PLUGIN_MODE" | tr '[:upper:]' '[:lower:]')"
case "$BROWSER_PLUGIN_MODE" in
  true|1|yes|on) BROWSER_PLUGIN_MODE="enabled" ;;
  false|0|no|off) BROWSER_PLUGIN_MODE="disabled" ;;
  enabled|disabled|auto|remote) ;;
  *)
    echo "Warning: invalid BROWSER_PLUGIN_MODE='$BROWSER_PLUGIN_MODE'; using disabled on HF Spaces and auto elsewhere." >&2
    if [ -n "${SPACE_HOST:-}" ]; then BROWSER_PLUGIN_MODE="disabled"; else BROWSER_PLUGIN_MODE="auto"; fi
    ;;
esac
ACP_PLUGIN_MODE="$(trim_var "$ACP_PLUGIN_MODE" | tr '[:upper:]' '[:lower:]')"
case "$ACP_PLUGIN_MODE" in
  true|1|yes|on) ACP_PLUGIN_MODE="enabled" ;;
  false|0|no|off) ACP_PLUGIN_MODE="disabled" ;;
  enabled|disabled|auto) ;;
  *) ACP_PLUGIN_MODE="auto" ;;
esac

case "$OPENCLAW_BROWSER_PROFILE" in
  ""|*[!a-z0-9-]*)
    echo "Warning: invalid OPENCLAW_BROWSER_PROFILE='$OPENCLAW_BROWSER_PROFILE' (use lowercase letters, numbers, hyphens); using openclaw." >&2
    OPENCLAW_BROWSER_PROFILE="openclaw"
    ;;
esac
if [ "$BROWSER_PLUGIN_MODE" = "remote" ]; then
  case "$OPENCLAW_BROWSER_CDP_URL" in
    ws://*|wss://*|http://*|https://*) ;;
    "")
      echo "Warning: BROWSER_PLUGIN_MODE=remote requires OPENCLAW_BROWSER_CDP_URL; disabling browser plugin for this boot." >&2
      BROWSER_PLUGIN_MODE="disabled"
      ;;
    *)
      echo "Warning: invalid OPENCLAW_BROWSER_CDP_URL (must start with ws://, wss://, http://, or https://); disabling browser plugin for this boot." >&2
      BROWSER_PLUGIN_MODE="disabled"
      ;;
  esac
fi
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     🦞 HuggingClaw + 💻 JupyterLab     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Validate required secrets ──
ERRORS=""
if [ -z "$LLM_API_KEY" ]; then
  ERRORS="${ERRORS}  - LLM_API_KEY is not set\n"
fi
if [ -z "$LLM_MODEL" ]; then
  ERRORS="${ERRORS}  - LLM_MODEL is not set (e.g. google/gemini-3.5-flash, anthropic/claude-sonnet-4-6, openai/gpt-5.4)\n"
fi
if [ -z "$GATEWAY_TOKEN" ]; then
  ERRORS="${ERRORS}  - GATEWAY_TOKEN is not set (generate: openssl rand -hex 32)\n"
fi
if [ -n "$ERRORS" ]; then
  echo "Missing required secrets:"
  echo -e "$ERRORS"
  echo "Add them in HF Spaces → Settings → Secrets"
  exit 1
fi

# Resolve the actual bundled OpenClaw version so the banner reflects what is
# inside the image, not just the requested tag.
if [ -f "$OPENCLAW_APP_DIR/package.json" ]; then
  OPENCLAW_RUNTIME_VERSION=$(node -p "require('$OPENCLAW_APP_DIR/package.json').version" 2>/dev/null || true)
fi

# ── Runtime OpenClaw upgrade ──
# If OPENCLAW_VERSION is set (via HF Variable, Secret, or env bundle) and
# differs from what is baked in the image, upgrade openclaw at container start.
# This means users NO LONGER need to rebuild the image to change the version —
# just set OPENCLAW_VERSION=1.2.3 (or "latest") in their HF Space Variables/
# Secrets or in the env-builder, and the new version is installed on next boot.
#
# Set OPENCLAW_RUNTIME_UPGRADE=false to opt out of this behaviour.
_do_runtime_upgrade=false
_requested_ver="$(trim_var "${OPENCLAW_VERSION:-latest}")"
_resolved_requested_ver=""

if hc_is_true "$OPENCLAW_RUNTIME_UPGRADE"; then
  if [ "$_requested_ver" = "latest" ]; then
    # Avoid reinstalling OpenClaw on every boot when the bundled/runtime version
    # already matches npm's latest tag. This keeps startup logs quiet and avoids
    # the repeated "added packages" delay while still upgrading when latest moves.
    _resolved_requested_ver=$(npm view openclaw@latest version --silent 2>/dev/null || true)
    if [ -n "$_resolved_requested_ver" ] && [ "$_resolved_requested_ver" != "$OPENCLAW_RUNTIME_VERSION" ]; then
      _do_runtime_upgrade=true
    elif [ -z "$_resolved_requested_ver" ] && [ -z "$OPENCLAW_RUNTIME_VERSION" ]; then
      _do_runtime_upgrade=true
    fi
  elif [ "$_requested_ver" != "$OPENCLAW_RUNTIME_VERSION" ]; then
    # A specific version/tag was requested and it differs from what's installed.
    _do_runtime_upgrade=true
  fi
fi

if [ "$_do_runtime_upgrade" = "true" ]; then
  echo "OpenClaw : upgrading to openclaw@${_requested_ver} (bundled: ${OPENCLAW_RUNTIME_VERSION:-unknown})..."
  _upgrade_pkg="openclaw"
  [ "$_requested_ver" != "latest" ] && _upgrade_pkg="openclaw@${_requested_ver}"

  # npm install -g respects NPM_CONFIG_PREFIX which is set later in start.sh,
  # so use the user-writable prefix explicitly to avoid needing sudo.
  _npm_prefix="${NPM_CONFIG_PREFIX:-/home/node/.local}"
  if NPM_CONFIG_PREFIX="$_npm_prefix" npm install -g "$_upgrade_pkg" --prefer-online 2>/tmp/openclaw-upgrade.log; then
    # Re-read version from the installed package under the explicit prefix
    _new_ver=$(node -p "require('${_npm_prefix}/lib/node_modules/openclaw/package.json').version" 2>/dev/null || true)
    # PATH already has /home/node/.local/bin before /usr/local/bin (set in
    # Dockerfile ENV), so the newly installed binary is picked up automatically
    # by 'command openclaw' without needing to update /usr/local/bin/openclaw.
    echo "OpenClaw : upgraded to ${_new_ver:-${_requested_ver}} ✓"
    OPENCLAW_RUNTIME_VERSION="${_new_ver:-$OPENCLAW_RUNTIME_VERSION}"
  else
    echo "Warning: openclaw runtime upgrade to '${_requested_ver}' failed (bundled version will be used):" >&2
    tail -5 /tmp/openclaw-upgrade.log >&2
  fi
fi
unset _do_runtime_upgrade _requested_ver _resolved_requested_ver _upgrade_pkg _new_ver _npm_prefix

if [ -n "$OPENCLAW_RUNTIME_VERSION" ]; then
  OPENCLAW_DISPLAY_VERSION="$OPENCLAW_RUNTIME_VERSION"
  if [ "$OPENCLAW_VERSION" != "latest" ] && [ "$OPENCLAW_VERSION" != "$OPENCLAW_RUNTIME_VERSION" ]; then
    OPENCLAW_DISPLAY_VERSION="$OPENCLAW_RUNTIME_VERSION (tag: $OPENCLAW_VERSION)"
  fi
else
  OPENCLAW_DISPLAY_VERSION="$OPENCLAW_VERSION"
fi

# ── Set LLM env based on model name ──

# Auto-correct Gemini models to use google/ prefix if anthropic/ was mistakenly used
if [[ "$LLM_MODEL" == "anthropic/gemini"* ]]; then
  LLM_MODEL=$(echo "$LLM_MODEL" | sed 's/^anthropic\//google\//')
  echo "Note: corrected model from anthropic/gemini* to google/gemini*"
fi

# Extract provider prefix from model name (e.g. "google/gemini-2.5-flash" → "google")
LLM_PROVIDER=$(echo "$LLM_MODEL" | cut -d'/' -f1)

# ── Build fallback model JSON array from LLM_FALLBACK_MODELS ──
# LLM_FALLBACK_MODELS is a comma-separated list of model refs, e.g.:
#   LLM_FALLBACK_MODELS="anthropic/claude-sonnet-4-6,openai/gpt-4o,google/gemini-2.5-flash"
# Each fallback provider's API key must be set separately (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY).
LLM_FALLBACK_MODELS_JSON="[]"
if [ -n "$LLM_FALLBACK_MODELS" ]; then
  LLM_FALLBACK_MODELS_JSON=$(printf '%s' "$LLM_FALLBACK_MODELS" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | grep -v '^$' \
    | jq -R . \
    | jq -s .)
fi

# Map provider prefix to the correct API key environment variable
# Based on OpenClaw provider system: /usr/local/lib/node_modules/openclaw/docs/concepts/model-providers.md
# Note: OpenClaw normalizes some prefixes (z-ai → zai, z.ai → zai, etc.)
case "$LLM_PROVIDER" in
  # ── Core Providers ──
  anthropic)                    export ANTHROPIC_API_KEY="$LLM_API_KEY" ;;
  openai|openai-codex)          export OPENAI_API_KEY="$LLM_API_KEY" ;;
  google|google-vertex)         export GEMINI_API_KEY="$LLM_API_KEY" ;;
  deepseek)                     export DEEPSEEK_API_KEY="$LLM_API_KEY" ;;
  # ── OpenCode Providers ──
  opencode)                     export OPENCODE_API_KEY="$LLM_API_KEY" ;;
  opencode-go)                  export OPENCODE_API_KEY="$LLM_API_KEY" ;;
  # ── Gateway/Router Providers ──
  openrouter)                   export OPENROUTER_API_KEY="$LLM_API_KEY" ;;
  kilocode)                     export KILOCODE_API_KEY="$LLM_API_KEY" ;;
  vercel-ai-gateway)            export AI_GATEWAY_API_KEY="$LLM_API_KEY" ;;
  # ── Chinese/Asian Providers ──
  zai|z-ai|z.ai|zhipu)          export ZAI_API_KEY="$LLM_API_KEY" ;;
  moonshot)                     export MOONSHOT_API_KEY="$LLM_API_KEY" ;;
  kimi-coding)                  export KIMI_API_KEY="$LLM_API_KEY" ;;
  minimax)                      export MINIMAX_API_KEY="$LLM_API_KEY" ;;
  qwen|modelstudio)             export MODELSTUDIO_API_KEY="$LLM_API_KEY" ;;
  xiaomi)                       export XIAOMI_API_KEY="$LLM_API_KEY" ;;
  volcengine|volcengine-plan)   export VOLCANO_ENGINE_API_KEY="$LLM_API_KEY" ;;
  byteplus|byteplus-plan)       export BYTEPLUS_API_KEY="$LLM_API_KEY" ;;
  qianfan)                      export QIANFAN_API_KEY="$LLM_API_KEY" ;;
  # ── Western Providers ──
  mistral)                      export MISTRAL_API_KEY="$LLM_API_KEY" ;;
  xai|x-ai)                     export XAI_API_KEY="$LLM_API_KEY" ;;
  nvidia)                       export NVIDIA_API_KEY="$LLM_API_KEY" ;;
  cohere)                       export COHERE_API_KEY="$LLM_API_KEY" ;;
  groq)                         export GROQ_API_KEY="$LLM_API_KEY" ;;
  together)                     export TOGETHER_API_KEY="$LLM_API_KEY" ;;
  huggingface)                  export HUGGINGFACE_HUB_TOKEN="$LLM_API_KEY" ;;
  cerebras)                     export CEREBRAS_API_KEY="$LLM_API_KEY" ;;
  venice)                       export VENICE_API_KEY="$LLM_API_KEY" ;;
  synthetic)                    export SYNTHETIC_API_KEY="$LLM_API_KEY" ;;
  github-copilot)               export COPILOT_GITHUB_TOKEN="$LLM_API_KEY" ;;
  llama-3.*|llama-4.*|mixtral-*|gemma-*)
    export GROQ_API_KEY="$LLM_API_KEY"
    echo "Note: bare Groq model '$LLM_MODEL' detected; mapped LLM_API_KEY → GROQ_API_KEY. Use 'groq/${LLM_MODEL}' prefix to be explicit." ;;
  mistral-*|codestral-*|devstral-*|voxtral-*)
    export MISTRAL_API_KEY="$LLM_API_KEY"
    echo "Note: bare Mistral model '$LLM_MODEL' detected; mapped LLM_API_KEY → MISTRAL_API_KEY. Use 'mistral/${LLM_MODEL}' prefix to be explicit." ;;
  moonshotai|meta-llama|deepseek-ai|MiniMaxAI|minimax-ai|Qwen|zai-org|mistralai|google)
    echo "Warning: LLM_MODEL='$LLM_MODEL' uses sub-provider prefix '$LLM_PROVIDER'. This is a router-namespaced model (Together/OpenRouter). Mapping LLM_API_KEY → TOGETHER_API_KEY. If using OpenRouter, also set OPENROUTER_API_KEY as a separate secret."
    export TOGETHER_API_KEY="${TOGETHER_API_KEY:-$LLM_API_KEY}" ;;
  # ── Fallback: Anthropic (default) ──
  *)
    echo "Warning: Unknown provider prefix '$LLM_PROVIDER' in LLM_MODEL='$LLM_MODEL'. Defaulting to ANTHROPIC_API_KEY. If using a router-namespaced model (e.g. moonshotai/Kimi-K2.6), set TOGETHER_API_KEY or OPENROUTER_API_KEY as a separate secret."
    export ANTHROPIC_API_KEY="$LLM_API_KEY"
    ;;
esac

# Ensure OpenClaw provider discovery can see per-provider keys even when users
# configure only *_API_KEYS pools. Mirror first pool key into singular env.
promote_first_pool_key() {
  local singular_var="$1"
  local pool_var="$2"
  local singular_val="${!singular_var:-}"
  local pool_val="${!pool_var:-}"

  [ -n "$singular_val" ] && return 0
  [ -n "$pool_val" ] || return 0

  local first
  first=$(printf '%s' "$pool_val" | tr ',\r' '\n\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | awk 'NF{print; exit}')
  [ -n "$first" ] || return 0
  export "${singular_var}=$first"
}

normalize_key_aliases() {
  local canonical_pool_var="$1"
  local canonical_key_var="$2"
  shift 2
  local alias
  for alias in "$@"; do
    case "$alias" in
      *_API_KEYS|*_TOKENS|*_TOKEN_POOL)
        if [ -z "${!canonical_pool_var:-}" ] && [ -n "${!alias:-}" ]; then
          export "${canonical_pool_var}=${!alias}"
        fi
        ;;
      *)
        if [ -z "${!canonical_key_var:-}" ] && [ -n "${!alias:-}" ]; then
          export "${canonical_key_var}=${!alias}"
        fi
        ;;
    esac
  done
}

promote_first_pool_key "ANTHROPIC_API_KEY" "ANTHROPIC_API_KEYS"
promote_first_pool_key "OPENAI_API_KEY" "OPENAI_API_KEYS"
# Accept common provider aliases used by SDK docs and existing Spaces, then
# normalize them into canonical envs so OpenClaw config and the key rotator agree.
normalize_key_aliases "GEMINI_API_KEYS" "GEMINI_API_KEY" \
  GOOGLE_API_KEYS GOOGLE_GENERATIVE_AI_API_KEYS GOOGLE_AI_API_KEYS GOOGLE_GENAI_API_KEYS \
  GOOGLE_API_KEY GOOGLE_GENERATIVE_AI_API_KEY GOOGLE_AI_API_KEY GOOGLE_GENAI_API_KEY
promote_first_pool_key "GEMINI_API_KEY" "GEMINI_API_KEYS"
promote_first_pool_key "DEEPSEEK_API_KEY" "DEEPSEEK_API_KEYS"
promote_first_pool_key "OPENROUTER_API_KEY" "OPENROUTER_API_KEYS"
promote_first_pool_key "KILOCODE_API_KEY" "KILOCODE_API_KEYS"
promote_first_pool_key "OPENCODE_API_KEY" "OPENCODE_API_KEYS"
normalize_key_aliases "ZAI_API_KEYS" "ZAI_API_KEY" \
  ZHIPU_API_KEYS BIGMODEL_API_KEYS ZHIPU_API_KEY BIGMODEL_API_KEY
promote_first_pool_key "ZAI_API_KEY" "ZAI_API_KEYS"
promote_first_pool_key "MOONSHOT_API_KEY" "MOONSHOT_API_KEYS"
promote_first_pool_key "MINIMAX_API_KEY" "MINIMAX_API_KEYS"
promote_first_pool_key "XIAOMI_API_KEY" "XIAOMI_API_KEYS"
normalize_key_aliases "VOLCANO_ENGINE_API_KEYS" "VOLCANO_ENGINE_API_KEY" \
  VOLCENGINE_API_KEYS ARK_API_KEYS VOLCENGINE_API_KEY ARK_API_KEY
promote_first_pool_key "VOLCANO_ENGINE_API_KEY" "VOLCANO_ENGINE_API_KEYS"
promote_first_pool_key "BYTEPLUS_API_KEY" "BYTEPLUS_API_KEYS"
promote_first_pool_key "QIANFAN_API_KEY" "QIANFAN_API_KEYS"
normalize_key_aliases "MODELSTUDIO_API_KEYS" "MODELSTUDIO_API_KEY" \
  DASHSCOPE_API_KEYS QWEN_API_KEYS ALIBABA_CLOUD_API_KEYS \
  DASHSCOPE_API_KEY QWEN_API_KEY ALIBABA_CLOUD_API_KEY
promote_first_pool_key "MODELSTUDIO_API_KEY" "MODELSTUDIO_API_KEYS"
promote_first_pool_key "KIMI_API_KEY" "KIMI_API_KEYS"
promote_first_pool_key "MISTRAL_API_KEY" "MISTRAL_API_KEYS"
promote_first_pool_key "XAI_API_KEY" "XAI_API_KEYS"
promote_first_pool_key "NVIDIA_API_KEY" "NVIDIA_API_KEYS"
promote_first_pool_key "GROQ_API_KEY" "GROQ_API_KEYS"
promote_first_pool_key "COHERE_API_KEY" "COHERE_API_KEYS"
promote_first_pool_key "TOGETHER_API_KEY" "TOGETHER_API_KEYS"
promote_first_pool_key "CEREBRAS_API_KEY" "CEREBRAS_API_KEYS"
promote_first_pool_key "VENICE_API_KEY" "VENICE_API_KEYS"
promote_first_pool_key "SYNTHETIC_API_KEY" "SYNTHETIC_API_KEYS"
normalize_key_aliases "COPILOT_GITHUB_TOKENS" "COPILOT_GITHUB_TOKEN" \
  GITHUB_COPILOT_TOKENS GITHUB_COPILOT_API_KEYS GITHUB_COPILOT_TOKEN GITHUB_COPILOT_API_KEY
promote_first_pool_key "COPILOT_GITHUB_TOKEN" "COPILOT_GITHUB_TOKENS"
normalize_key_aliases "AI_GATEWAY_API_KEYS" "AI_GATEWAY_API_KEY" \
  VERCEL_AI_GATEWAY_API_KEYS VERCEL_AI_GATEWAY_API_KEY VERCEL_OIDC_TOKEN
promote_first_pool_key "AI_GATEWAY_API_KEY" "AI_GATEWAY_API_KEYS"

# kimi-coding uses Moonshot AI endpoint (api.moonshot.cn).
# If KIMI_API_KEY is set but MOONSHOT_API_KEY is not, mirror it so the
# provider key rotator (which matches on api.moonshot.cn) injects it.
if [ -z "${MOONSHOT_API_KEY:-}" ] && [ -n "${KIMI_API_KEY:-}" ]; then
  export MOONSHOT_API_KEY="$KIMI_API_KEY"
fi
normalize_key_aliases "HUGGINGFACE_HUB_TOKENS" "HUGGINGFACE_HUB_TOKEN" \
  HUGGINGFACE_API_KEYS HUGGINGFACE_HUB_API_KEYS HF_TOKEN_POOL \
  HUGGINGFACE_API_KEY HUGGINGFACE_HUB_API_KEY HF_TOKEN
promote_first_pool_key "HUGGINGFACE_HUB_TOKEN" "HUGGINGFACE_HUB_TOKENS"

# ── Setup directories ──
mkdir -p /home/node/.openclaw/agents/main/sessions
mkdir -p /home/node/.openclaw/credentials
mkdir -p /home/node/.openclaw/memory
mkdir -p /home/node/.openclaw/extensions
mkdir -p /home/node/.openclaw/workspace
mkdir -p /home/node/.local/bin /home/node/.local/lib /home/node/.npm-global
chmod 700 /home/node/.openclaw
chmod 700 /home/node/.openclaw/credentials

# User-installed packages are intentionally ephemeral in the container. Keep
# npm/pip installs in user-writable locations, make apt noninteractive,
# and persist only a tiny replay script in the synced workspace so packages
# are re-installed after restart.
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/home/node/.local}"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
export PYTHONUSERBASE="${PYTHONUSERBASE:-/home/node/.local}"
export DEBIAN_FRONTEND="${DEBIAN_FRONTEND:-noninteractive}"
# Show current working directory in terminal prompt (JupyterLab terminals can
# otherwise display only "$" when PS1 is unset/minimal).
if [ -z "${PS1:-}" ] || [ "$PS1" = "$ " ]; then
  export PS1='\u@\h:\w\$ '
fi
STARTUP_FILE="/home/node/.openclaw/workspace/startup.sh"

# ── Restore workspace/state from HF Dataset ──
BACKUP_DATASET="${BACKUP_DATASET_NAME:-huggingclaw-backup}"
if [ -n "${HF_TOKEN:-}" ]; then
  echo "Restoring workspace from HF Dataset..."
  python3 /home/node/app/openclaw-sync.py restore || true
else
  echo "HF_TOKEN not set — running without dataset persistence."
fi

CLOUDFLARE_WORKERS_TOKEN="${CLOUDFLARE_WORKERS_TOKEN:-}"
export CLOUDFLARE_WORKERS_TOKEN
CF_PROXY_ENV_FILE="/tmp/huggingclaw-cloudflare-proxy.env"
if [ -n "${CLOUDFLARE_WORKERS_TOKEN:-}" ] || [ -n "${CLOUDFLARE_PROXY_URL:-}" ]; then
  # Default debug off for production. Set CLOUDFLARE_PROXY_DEBUG=true in HF
  # Space secrets to surface per-request "Redirecting" + error-cause logs.
  export CLOUDFLARE_PROXY_DEBUG="${CLOUDFLARE_PROXY_DEBUG:-false}"
  echo "Preparing Cloudflare outbound proxy..."
  python3 /home/node/app/cloudflare-proxy-setup.py || true
  if [ -f "$CF_PROXY_ENV_FILE" ]; then
    . "$CF_PROXY_ENV_FILE"
  fi
fi

# Never send local Gateway/CDP traffic through HTTP(S)/ALL proxy settings. OpenClaw
# probes Chrome on 127.0.0.1; proxying that loopback request causes false
# http_unreachable browser-launch failures in Docker/HF environments.
_NO_PROXY_LOCAL="localhost,127.0.0.1,::1,0.0.0.0"
export NO_PROXY="${NO_PROXY:+$NO_PROXY,}${_NO_PROXY_LOCAL}"
export no_proxy="${no_proxy:+$no_proxy,}${_NO_PROXY_LOCAL}"
unset _NO_PROXY_LOCAL

# ── Build config ──
CONFIG_JSON=$(cat <<'CONFIGEOF'
{
  "gateway": {
    "mode": "local",
    "port": "${GATEWAY_PORT}",
    "bind": "lan",
    "auth": {
      "token": ""
    },
    "controlUi": {
      "allowInsecureAuth": true,
      "basePath": "/app"
    },
    "trustedProxies": ["127.0.0.1/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  },
  "channels": {},
  "plugins": {
    "entries": {}
  },
  "logging": {
    "level": "info",
    "consoleLevel": "warn",
    "consoleStyle": "compact"
  }
}
CONFIGEOF
)

# Apply gateway token, model, and logging in a single jq pass.
# Uses --arg so values containing quotes/backslashes can't break the JSON or
# inject jq filters (relevant for OPENCLAW_PASSWORD/GATEWAY_TOKEN below too).
# When LLM_FALLBACK_MODELS is set, agents.defaults.model is written as an
# object { primary, fallbacks } so OpenClaw can chain through backup models
# automatically on rate-limit, auth failure, or provider outage.
CONFIG_JSON=$(jq \
  --arg token "$GATEWAY_TOKEN" \
  --arg model "$LLM_MODEL" \
  --argjson fallbacks "$LLM_FALLBACK_MODELS_JSON" \
  --arg fileLevel "$OPENCLAW_FILE_LOG_LEVEL" \
  --arg consoleLevel "$OPENCLAW_CONSOLE_LOG_LEVEL" \
  --arg consoleStyle "$OPENCLAW_CONSOLE_LOG_STYLE" \
  --arg port "$GATEWAY_PORT" \
  --arg appBase "$APP_BASE" \
  '.gateway.auth.token = $token
   | .agents.defaults.model = (if ($fallbacks | length) > 0
       then {"primary": $model, "fallbacks": $fallbacks}
       else $model
     end)
   | .gateway.port = ($port | tonumber)
   | .gateway.controlUi.basePath = $appBase
   | .logging.level = $fileLevel
   | .logging.consoleLevel = $consoleLevel
   | .logging.consoleStyle = $consoleStyle' <<<"$CONFIG_JSON")

# Optional: dynamic custom OpenAI-compatible provider registration
CUSTOM_PROVIDER_NAME="${CUSTOM_PROVIDER_NAME:-}"
CUSTOM_BASE_URL="${CUSTOM_BASE_URL:-}"
CUSTOM_MODEL_ID="${CUSTOM_MODEL_ID:-}"
CUSTOM_MODEL_NAME="${CUSTOM_MODEL_NAME:-$CUSTOM_MODEL_ID}"
CUSTOM_API_KEY="${CUSTOM_API_KEY:-$LLM_API_KEY}"
CUSTOM_API_TYPE="${CUSTOM_API_TYPE:-openai-completions}"
CUSTOM_CONTEXT_WINDOW="${CUSTOM_CONTEXT_WINDOW:-128000}"
CUSTOM_MAX_TOKENS="${CUSTOM_MAX_TOKENS:-8192}"

if [ -n "$CUSTOM_PROVIDER_NAME" ] || [ -n "$CUSTOM_BASE_URL" ] || [ -n "$CUSTOM_MODEL_ID" ]; then
  CUSTOM_PROVIDER_NORMALIZED=$(printf '%s' "$CUSTOM_PROVIDER_NAME" | tr '[:upper:]' '[:lower:]')
  CUSTOM_BASE_URL_NORMALIZED="${CUSTOM_BASE_URL%/}"
  CUSTOM_PROVIDER_OK=true

  if [ -z "$CUSTOM_PROVIDER_NAME" ] || [ -z "$CUSTOM_BASE_URL" ] || [ -z "$CUSTOM_MODEL_ID" ]; then
    echo "Warning: custom provider skipped: set CUSTOM_PROVIDER_NAME, CUSTOM_BASE_URL, and CUSTOM_MODEL_ID together."
    CUSTOM_PROVIDER_OK=false
  fi

  case "$CUSTOM_PROVIDER_NORMALIZED" in
    anthropic|openai|openai-codex|google|google-vertex|deepseek|opencode|opencode-go|openrouter|kilocode|vercel-ai-gateway|zai|z-ai|z.ai|zhipu|moonshot|kimi-coding|minimax|qwen|modelstudio|xiaomi|volcengine|volcengine-plan|byteplus|byteplus-plan|qianfan|mistral|mistralai|xai|x-ai|nvidia|cohere|groq|together|huggingface|cerebras|venice|synthetic|github-copilot)
      echo "Warning: custom provider skipped: CUSTOM_PROVIDER_NAME='$CUSTOM_PROVIDER_NAME' conflicts with a built-in provider."
      CUSTOM_PROVIDER_OK=false
      ;;
  esac

  if [[ "$CUSTOM_BASE_URL_NORMALIZED" == */chat/completions ]] || [[ "$CUSTOM_BASE_URL_NORMALIZED" == */completions ]]; then
    echo "Warning: custom provider skipped: CUSTOM_BASE_URL should be the API base URL, not a completions endpoint."
    CUSTOM_PROVIDER_OK=false
  fi

  if ! [[ "$CUSTOM_CONTEXT_WINDOW" =~ ^[0-9]+$ ]] || ! [[ "$CUSTOM_MAX_TOKENS" =~ ^[0-9]+$ ]]; then
    echo "Warning: custom provider skipped: CUSTOM_CONTEXT_WINDOW and CUSTOM_MAX_TOKENS must be whole numbers."
    CUSTOM_PROVIDER_OK=false
  fi

  if [ "$CUSTOM_PROVIDER_OK" = "true" ]; then
    echo "Registering custom provider: $CUSTOM_PROVIDER_NAME -> $CUSTOM_BASE_URL_NORMALIZED"
    CONFIG_JSON=$(jq \
      --arg provider "$CUSTOM_PROVIDER_NAME" \
      --arg baseUrl "$CUSTOM_BASE_URL_NORMALIZED" \
      --arg apiKey "$CUSTOM_API_KEY" \
      --arg apiType "$CUSTOM_API_TYPE" \
      --arg modelId "$CUSTOM_MODEL_ID" \
      --arg modelName "$CUSTOM_MODEL_NAME" \
      --argjson contextWindow "$CUSTOM_CONTEXT_WINDOW" \
      --argjson maxTokens "$CUSTOM_MAX_TOKENS" \
      '.models.mode = "merge" |
       .models.providers[$provider] = {
         "baseUrl": $baseUrl,
         "apiKey": $apiKey,
         "api": $apiType,
         "models": [{
           "id": $modelId,
           "name": $modelName,
           "contextWindow": $contextWindow,
           "maxTokens": $maxTokens
         }]
       }' <<<"$CONFIG_JSON")

    if [[ "$LLM_MODEL" != "$CUSTOM_PROVIDER_NAME/"* ]]; then
      echo "Warning: custom provider registered, but LLM_MODEL='$LLM_MODEL' does not start with '$CUSTOM_PROVIDER_NAME/'."
    fi
  fi
fi

# Optional: explicitly expose provider model lists in Control UI when
# provider keys are configured. Format:
#   NVIDIA_MODELS=model1,model2
#   OPENAI_MODELS=gpt-4o-mini,gpt-4.1
# This helps when provider auto-discovery does not populate models reliably.
# Default catalogs (used when *_MODELS env is not set but key IS configured).
# These let multi-key pool users see models without having to also set *_MODELS.
_DEFAULT_ANTHROPIC_MODELS="anthropic/claude-opus-4-7,anthropic/claude-sonnet-4-6,anthropic/claude-haiku-4-5,anthropic/claude-opus-4-0,anthropic/claude-sonnet-4-0,anthropic/claude-3-7-sonnet-latest,anthropic/claude-3-5-haiku-latest"
_DEFAULT_OPENAI_MODELS="openai/gpt-5.5,openai/gpt-5.4,openai/gpt-5.4-mini,openai/gpt-5.4-nano,openai/gpt-4.1,openai/gpt-4.1-mini,openai/o3,openai/gpt-5.4-chat-latest,openai/gpt-5.5-chat-latest"
_DEFAULT_GEMINI_MODELS="google/gemini-3.5-flash,google/gemini-3.1-pro-preview,google/gemini-3.1-flash-lite,google/gemini-2.5-pro,google/gemini-2.5-flash,google/gemini-2.5-flash-lite,google/gemini-flash-latest,google/gemini-pro-latest,google/gemini-3.5-flash-latest,google/gemini-2.5-pro-latest"
_DEFAULT_VERTEX_MODELS="google-vertex/gemini-3.5-flash,google-vertex/gemini-3.1-pro-preview,google-vertex/gemini-2.5-pro,google-vertex/gemini-2.5-flash,google-vertex/gemini-2.5-flash-lite,google-vertex/gemini-flash-latest,google-vertex/gemini-pro-latest,google-vertex/gemini-2.5-pro-latest"
_DEFAULT_DEEPSEEK_MODELS="deepseek/deepseek-v4-pro,deepseek/deepseek-v4-flash,deepseek/deepseek-r1,deepseek/deepseek-r1-0528,deepseek/deepseek-chat,deepseek/deepseek-reasoner"
_DEFAULT_OPENROUTER_MODELS="openrouter/auto,openrouter/anthropic/claude-opus-4-7,openrouter/openai/gpt-5.4,openrouter/google/gemini-3.5-flash,openrouter/deepseek/deepseek-v4-pro,openrouter/moonshotai/kimi-k2.6"
_DEFAULT_GROQ_MODELS="groq/compound,groq/compound-mini,groq/openai/gpt-oss-120b,groq/moonshotai/kimi-k2-instruct-0905,groq/qwen/qwen3-32b"
_DEFAULT_MISTRAL_MODELS="mistral/mistral-large-latest,mistral/mistral-medium-3.5,mistral/codestral-latest,mistral/mistral-small-latest,mistral/devstral-2,mistral/mistral-latest"
_DEFAULT_XAI_MODELS="xai/grok-4.20,xai/grok-4.3,xai/grok-4.1,xai/grok-latest,xai/grok-4.3-latest,xai/grok-build-0.1"
_DEFAULT_COHERE_MODELS="cohere/command-a,cohere/command-a-03-2025,cohere/command-a-reasoning-08-2025,cohere/command-r-plus-08-2024"
_DEFAULT_TOGETHER_MODELS="together/moonshotai/Kimi-K2.6,together/deepseek-ai/DeepSeek-V4-Pro,together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput,together/meta-llama/Llama-3.3-70B-Instruct-Turbo"
_DEFAULT_CEREBRAS_MODELS="cerebras/zai-glm-4.7,cerebras/gpt-oss-120b,cerebras/deepseek-r1,cerebras/qwen3-32b"
_DEFAULT_NVIDIA_MODELS="nvidia/nemotron-3-super-120b-a12b,nvidia/nemotron-4-340b-instruct,nvidia/llama-3.1-nemotron-70b-instruct,nvidia/stepfun-ai/step-3.7-flash"
_DEFAULT_KILOCODE_MODELS="kilocode/kilo/auto,kilocode/anthropic/claude-opus-4.7,kilocode/openai/gpt-5.4,kilocode/google/gemini-2.5-pro"
_DEFAULT_MOONSHOT_MODELS="moonshot/kimi-k2.6,moonshot/kimi-k2.6-thinking,moonshot/kimi-k2-thinking"
_DEFAULT_MINIMAX_MODELS="minimax/MiniMax-M2.7,minimax/minimax-m1.5"
_DEFAULT_ZAI_MODELS="zai/glm-5,zai/glm-5-turbo,zai/glm-4.7,zai/glm-4.7-flash"
_DEFAULT_MODELSTUDIO_MODELS="modelstudio/qwen3-max,modelstudio/qwen3-coder,modelstudio/qwen3-32b"
_DEFAULT_VENICE_MODELS="venice/gpt-5,venice/llama-3.3-70b,venice/deepseek-r1"
_DEFAULT_OPENCODE_MODELS="opencode/claude-opus-4-7,opencode/gpt-5.4,opencode-go/kimi-k2.6,opencode-go/qwen3-32b"
_DEFAULT_HUGGINGFACE_MODELS="huggingface/deepseek-ai/DeepSeek-R1,huggingface/moonshotai/Kimi-K2.6,huggingface/Qwen/Qwen3-32B,huggingface/meta-llama/Llama-3.3-70B-Instruct"
_DEFAULT_GITHUB_COPILOT_MODELS="github-copilot/gpt-5,github-copilot/gpt-4.1,github-copilot/gpt-4.1-mini"

INJECTED_MODELS_PROVIDERS='{}'
# Tracks providers configured with a key pool (GEMINI_API_KEYS etc.).
# These providers must NOT have a static apiKey in the OpenClaw config —
# the provider key rotator injects the correct rotated key per-request.
# On restore, any stale apiKey saved from a previous single-key run is cleared.
POOL_API_KEY_PROVIDERS='[]'
inject_provider_models_from_env() {
  local provider="$1"
  local models_env="$2"
  local key_env_single="$3"
  local key_env_pool="$4"
  local default_models_env="${5:-}"          # Optional 5th arg: fallback default models var name
  local default_base_url="${6:-}"            # Optional 6th arg: hardcoded default base URL
  local api_type="${7:-}"                    # Optional 7th arg: API type (e.g. openai-completions)
  local models_csv="${!models_env:-}"
  local single_key="${!key_env_single:-}"
  local pool_keys="${!key_env_pool:-}"

  # Need at least one configured key
  if [ -z "$single_key" ] && [ -z "$pool_keys" ]; then
    return 0
  fi

  # If no explicit model list but a default var was provided, fall back to it
  if [ -z "$models_csv" ] && [ -n "$default_models_env" ]; then
    models_csv="${!default_models_env:-}"
  fi

  # Still nothing to inject
  if [ -z "$models_csv" ]; then
    return 0
  fi

  # Resolve base URL: runtime env var (<KEY_ENV>_BASE_URL) overrides hardcoded default.
  # e.g. NVIDIA_API_KEY → NVIDIA_BASE_URL; HUGGINGFACE_HUB_TOKEN → HUGGINGFACE_HUB_TOKEN_BASE_URL
  # Use a cleaner derived name: strip _API_KEY/_API_KEYS suffix → add _BASE_URL.
  local base_url_env_name
  base_url_env_name=$(printf '%s' "$key_env_single" \
    | sed 's/_API_KEY$//' \
    | sed 's/_HUB_TOKEN$//' \
    | sed 's/_GITHUB_TOKEN$//')_BASE_URL
  local resolved_base_url="${!base_url_env_name:-$default_base_url}"

  # Only inject apiKey when NOT using a pool (pool rotation is handled by OpenClaw
  # reading the pool env var directly; injecting a static key would bypass rotation).
  local inject_api_key=""
  if [ -z "$pool_keys" ] && [ -n "$single_key" ]; then
    inject_api_key="$single_key"
  fi

  local models_json
  models_json=$(printf '%s' "$models_csv" \
    | tr ',' '\n' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
    | awk 'NF' \
    | jq -R . \
    | jq -s --arg provider "$provider" '
        map(
          if contains("/") then
            # Fix cross-prefix: strip only the first "/" segment (the foreign provider
            # prefix) and reapply the correct one. Using `last` was a bug for 3-part IDs:
            # e.g. "openai/gpt-oss-120b" injected into "groq" would become
            #      "groq/gpt-oss-120b" instead of "groq/openai/gpt-oss-120b".
            # Examples:
            #   "google/gemini-2.5-pro"        → "google-vertex/gemini-2.5-pro"
            #   "openai/gpt-oss-120b"          → "groq/openai/gpt-oss-120b"
            #   "moonshotai/kimi-k2.6"         → "nvidia/moonshotai/kimi-k2.6"
            if startswith($provider + "/") then .
            else ($provider + "/" + (split("/") | .[1:] | join("/")))
            end
          else
            ($provider + "/" + .)
          end
        )
        | map({id: ., name: .})
        | unique_by(.id)')

  # Build provider patch: always inject models; conditionally inject apiKey, baseUrl, api.
  # Existing saved config wins on merge (see config-patch jq below), so this only fills
  # in missing fields — it never overwrites what the user already configured manually.
  CONFIG_JSON=$(jq \
    --arg provider "$provider" \
    --argjson models "$models_json" \
    --arg apiKey "$inject_api_key" \
    --arg baseUrl "$resolved_base_url" \
    --arg apiType "$api_type" \
    '.models.mode = "merge"
     | .models.providers[$provider] = (
         (.models.providers[$provider] // {})
         + (if $apiKey  != "" then {apiKey:  $apiKey}  else {} end)
         + (if $baseUrl != "" then {baseUrl: $baseUrl} else {} end)
         + (if $apiType != "" then {api:     $apiType} else {} end)
         + {models: $models}
       )' <<<"$CONFIG_JSON")

  INJECTED_MODELS_PROVIDERS=$(jq \
    --arg provider "$provider" \
    --argjson models "$models_json" \
    '.[$provider] = ((.[$provider] // {}) + {models: $models})' <<<"$INJECTED_MODELS_PROVIDERS")

  # Track providers using key-pool so restored config's stale apiKey can be cleared.
  if [ -n "$pool_keys" ]; then
    POOL_API_KEY_PROVIDERS=$(jq \
      --arg provider "$provider" \
      '. + [$provider] | unique' <<<"$POOL_API_KEY_PROVIDERS")
  fi
}

# ── Google Vertex AI credentials setup ──
# Vertex AI uses GCP project + location, NOT a simple Gemini API key.
# Set GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, and optionally
# GOOGLE_APPLICATION_CREDENTIALS_JSON (base64-encoded service account JSON).
if [ -n "${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}" ]; then
  _VERTEX_CREDS_FILE="/tmp/gcp-service-account.json"
  printf '%s' "$GOOGLE_APPLICATION_CREDENTIALS_JSON" | base64 -d > "$_VERTEX_CREDS_FILE" 2>/dev/null \
    || printf '%s' "$GOOGLE_APPLICATION_CREDENTIALS_JSON" > "$_VERTEX_CREDS_FILE"
  export GOOGLE_APPLICATION_CREDENTIALS="$_VERTEX_CREDS_FILE"
  echo "Note: GOOGLE_APPLICATION_CREDENTIALS written from GOOGLE_APPLICATION_CREDENTIALS_JSON"
fi
[ -n "${GOOGLE_CLOUD_PROJECT:-}" ]  && export GOOGLE_CLOUD_PROJECT
[ -n "${GOOGLE_CLOUD_LOCATION:-}" ] && export GOOGLE_CLOUD_LOCATION

# Built-in provider model envs (optional)
inject_provider_models_from_env "anthropic" "ANTHROPIC_MODELS" "ANTHROPIC_API_KEY" "ANTHROPIC_API_KEYS" "_DEFAULT_ANTHROPIC_MODELS"
inject_provider_models_from_env "openai" "OPENAI_MODELS" "OPENAI_API_KEY" "OPENAI_API_KEYS" "_DEFAULT_OPENAI_MODELS"
inject_provider_models_from_env "openai-codex" "OPENAI_MODELS" "OPENAI_API_KEY" "OPENAI_API_KEYS" "_DEFAULT_OPENAI_MODELS"
inject_provider_models_from_env "google" "GEMINI_MODELS" "GEMINI_API_KEY" "GEMINI_API_KEYS" "_DEFAULT_GEMINI_MODELS"
# google-vertex: uses VERTEX_MODELS (with google-vertex/ prefix) separately from GEMINI_MODELS.
# The "key" check uses GOOGLE_CLOUD_PROJECT so it only injects when Vertex is actually configured.
# google-vertex: inject when GOOGLE_CLOUD_PROJECT is configured.
# Pool key uses a dummy var (_VERTEX_POOL_UNUSED) so that only GOOGLE_CLOUD_PROJECT
# gates injection — Vertex uses GCP project auth, not Gemini API key rotation.
inject_provider_models_from_env "google-vertex" "VERTEX_MODELS" "GOOGLE_CLOUD_PROJECT" "_VERTEX_POOL_UNUSED" "_DEFAULT_VERTEX_MODELS"
inject_provider_models_from_env "deepseek" "DEEPSEEK_MODELS" "DEEPSEEK_API_KEY" "DEEPSEEK_API_KEYS" "_DEFAULT_DEEPSEEK_MODELS"
inject_provider_models_from_env "openrouter" "OPENROUTER_MODELS" "OPENROUTER_API_KEY" "OPENROUTER_API_KEYS" "_DEFAULT_OPENROUTER_MODELS"
inject_provider_models_from_env "kilocode" "KILOCODE_MODELS" "KILOCODE_API_KEY" "KILOCODE_API_KEYS" "_DEFAULT_KILOCODE_MODELS"
inject_provider_models_from_env "opencode" "OPENCODE_MODELS" "OPENCODE_API_KEY" "OPENCODE_API_KEYS" "_DEFAULT_OPENCODE_MODELS"
inject_provider_models_from_env "opencode-go" "OPENCODE_MODELS" "OPENCODE_API_KEY" "OPENCODE_API_KEYS" "_DEFAULT_OPENCODE_MODELS"
inject_provider_models_from_env "zai" "ZAI_MODELS" "ZAI_API_KEY" "ZAI_API_KEYS" "_DEFAULT_ZAI_MODELS"
inject_provider_models_from_env "z-ai" "ZAI_MODELS" "ZAI_API_KEY" "ZAI_API_KEYS" "_DEFAULT_ZAI_MODELS"
inject_provider_models_from_env "z.ai" "ZAI_MODELS" "ZAI_API_KEY" "ZAI_API_KEYS" "_DEFAULT_ZAI_MODELS"
inject_provider_models_from_env "zhipu" "ZAI_MODELS" "ZAI_API_KEY" "ZAI_API_KEYS" "_DEFAULT_ZAI_MODELS"
inject_provider_models_from_env "moonshot" "MOONSHOT_MODELS" "MOONSHOT_API_KEY" "MOONSHOT_API_KEYS" "_DEFAULT_MOONSHOT_MODELS" "https://api.moonshot.cn/v1" "openai-completions"
inject_provider_models_from_env "kimi-coding" "KIMI_MODELS" "KIMI_API_KEY" "KIMI_API_KEYS"
inject_provider_models_from_env "minimax" "MINIMAX_MODELS" "MINIMAX_API_KEY" "MINIMAX_API_KEYS" "_DEFAULT_MINIMAX_MODELS"
inject_provider_models_from_env "modelstudio" "MODELSTUDIO_MODELS" "MODELSTUDIO_API_KEY" "MODELSTUDIO_API_KEYS" "_DEFAULT_MODELSTUDIO_MODELS"
inject_provider_models_from_env "qwen" "MODELSTUDIO_MODELS" "MODELSTUDIO_API_KEY" "MODELSTUDIO_API_KEYS" "_DEFAULT_MODELSTUDIO_MODELS"
inject_provider_models_from_env "xiaomi" "XIAOMI_MODELS" "XIAOMI_API_KEY" "XIAOMI_API_KEYS" "" "https://api.mimoai.xiaomi.com/v1" "openai-completions"
inject_provider_models_from_env "volcengine" "VOLCANO_ENGINE_MODELS" "VOLCANO_ENGINE_API_KEY" "VOLCANO_ENGINE_API_KEYS" "" "https://ark.cn-beijing.volces.com/api/v3" "openai-completions"
inject_provider_models_from_env "volcengine-plan" "VOLCANO_ENGINE_MODELS" "VOLCANO_ENGINE_API_KEY" "VOLCANO_ENGINE_API_KEYS" "" "https://ark.cn-beijing.volces.com/api/v3" "openai-completions"
inject_provider_models_from_env "byteplus" "BYTEPLUS_MODELS" "BYTEPLUS_API_KEY" "BYTEPLUS_API_KEYS" "" "https://ark.ap-southeast.bytepluses.com/api/v3" "openai-completions"
inject_provider_models_from_env "byteplus-plan" "BYTEPLUS_MODELS" "BYTEPLUS_API_KEY" "BYTEPLUS_API_KEYS" "" "https://ark.ap-southeast.bytepluses.com/api/v3" "openai-completions"
inject_provider_models_from_env "qianfan" "QIANFAN_MODELS" "QIANFAN_API_KEY" "QIANFAN_API_KEYS" "" "https://qianfan.baidubce.com/v2" "openai-completions"
inject_provider_models_from_env "groq" "GROQ_MODELS" "GROQ_API_KEY" "GROQ_API_KEYS" "_DEFAULT_GROQ_MODELS"
inject_provider_models_from_env "mistral" "MISTRAL_MODELS" "MISTRAL_API_KEY" "MISTRAL_API_KEYS" "_DEFAULT_MISTRAL_MODELS"
inject_provider_models_from_env "mistralai" "MISTRAL_MODELS" "MISTRAL_API_KEY" "MISTRAL_API_KEYS" "_DEFAULT_MISTRAL_MODELS"
inject_provider_models_from_env "xai" "XAI_MODELS" "XAI_API_KEY" "XAI_API_KEYS" "_DEFAULT_XAI_MODELS"
inject_provider_models_from_env "x-ai" "XAI_MODELS" "XAI_API_KEY" "XAI_API_KEYS" "_DEFAULT_XAI_MODELS"
inject_provider_models_from_env "nvidia" "NVIDIA_MODELS" "NVIDIA_API_KEY" "NVIDIA_API_KEYS" "_DEFAULT_NVIDIA_MODELS" "https://integrate.api.nvidia.com/v1" "openai-completions"
inject_provider_models_from_env "cohere" "COHERE_MODELS" "COHERE_API_KEY" "COHERE_API_KEYS" "_DEFAULT_COHERE_MODELS" "https://api.cohere.ai/compatibility/v1" "openai-completions"
inject_provider_models_from_env "together" "TOGETHER_MODELS" "TOGETHER_API_KEY" "TOGETHER_API_KEYS" "_DEFAULT_TOGETHER_MODELS" "https://api.together.xyz/v1" "openai-completions"
inject_provider_models_from_env "cerebras" "CEREBRAS_MODELS" "CEREBRAS_API_KEY" "CEREBRAS_API_KEYS" "_DEFAULT_CEREBRAS_MODELS"
inject_provider_models_from_env "huggingface" "HUGGINGFACE_MODELS" "HUGGINGFACE_HUB_TOKEN" "HUGGINGFACE_HUB_TOKENS" "_DEFAULT_HUGGINGFACE_MODELS" "https://api-inference.huggingface.co/v1" "openai-completions"
inject_provider_models_from_env "venice" "VENICE_MODELS" "VENICE_API_KEY" "VENICE_API_KEYS" "_DEFAULT_VENICE_MODELS" "https://api.venice.ai/api/v1" "openai-completions"
inject_provider_models_from_env "synthetic" "SYNTHETIC_MODELS" "SYNTHETIC_API_KEY" "SYNTHETIC_API_KEYS" "" "https://api.synthetic.ai/v1" "openai-completions"
inject_provider_models_from_env "github-copilot" "GITHUB_COPILOT_MODELS" "COPILOT_GITHUB_TOKEN" "COPILOT_GITHUB_TOKENS" "_DEFAULT_GITHUB_COPILOT_MODELS"

# Browser configuration (managed local Chromium in HF/Docker)
BROWSER_EXECUTABLE_PATH=""
BROWSER_WRAPPER_PATH=""
HAS_FILE_CMD=false
if command -v file >/dev/null 2>&1; then
  HAS_FILE_CMD=true
fi

ensure_chromium_for_browser_plugin() {
  # Enforce Chromium availability only for local managed browser mode.
  [ "$BROWSER_PLUGIN_MODE" = "enabled" ] || return 0
  for candidate in \
      /usr/lib/chromium/chromium \
      /usr/bin/chromium \
      /usr/bin/chromium-browser \
      /usr/bin/google-chrome \
      /usr/bin/google-chrome-stable \
      /snap/bin/chromium; do
    [ -x "$candidate" ] && return 0
  done
  if [ "$HAS_FILE_CMD" != "true" ]; then
    echo "BROWSER_PLUGIN_MODE=enabled and 'file' command is missing; attempting runtime install..."
    if _hc_apt_install file; then
      HAS_FILE_CMD=true
      echo "'file' command installed via apt-get."
    else
      echo "Warning: could not install 'file'; continuing with executable-path fallback checks."
    fi
  fi
  echo "BROWSER_PLUGIN_MODE=enabled but Chromium is missing; attempting runtime install..."
  if _hc_apt_install chromium; then
    echo "Chromium installed via apt-get."
    return 0
  fi
  if _hc_apt_install chromium-browser; then
    echo "Chromium browser package installed via apt-get."
    return 0
  fi
  echo "ERROR: Browser plugin is enabled, but Chromium install failed. Disable browser plugin or rebuild image with Chromium preinstalled." >&2
  return 1
}
HC_STARTUP_FAILURES=0
ensure_chromium_for_browser_plugin || HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))

# On Debian/Ubuntu, /usr/bin/chromium is often a shell wrapper while the real
# ELF binary lives under /usr/lib/chromium/*. Prefer a real ELF binary, then
# fall back to wrapper launchers (Playwright/OpenClaw can execute those too).
for candidate in \
    /usr/lib/chromium/chromium \
    /usr/lib/chromium-browser/chromium-browser \
    /usr/bin/chromium \
    /usr/bin/chromium-browser \
    /usr/bin/google-chrome \
    /usr/bin/google-chrome-stable \
    /snap/bin/chromium; do
  if [ -x "$candidate" ]; then
    if [ "$HAS_FILE_CMD" = "true" ]; then
      if file "$candidate" 2>/dev/null | grep -q "ELF"; then
        BROWSER_EXECUTABLE_PATH="$candidate"
        break
      fi
    else
      # Minimal images may not ship `file`; accept the first executable path.
      BROWSER_EXECUTABLE_PATH="$candidate"
      break
    fi
    if [ -z "$BROWSER_WRAPPER_PATH" ]; then
      BROWSER_WRAPPER_PATH="$candidate"
    fi
  fi
done
if [ -z "$BROWSER_EXECUTABLE_PATH" ] && [ -n "$BROWSER_WRAPPER_PATH" ]; then
  BROWSER_EXECUTABLE_PATH="$BROWSER_WRAPPER_PATH"
  echo "No ELF Chromium binary found; using launcher wrapper at $BROWSER_EXECUTABLE_PATH"
elif [ -n "$BROWSER_EXECUTABLE_PATH" ] && [ "$HAS_FILE_CMD" != "true" ]; then
  echo "Detected Chromium executable at $BROWSER_EXECUTABLE_PATH (ELF probe skipped: 'file' command not installed)"
fi
if [ -z "$BROWSER_EXECUTABLE_PATH" ] && [ "$BROWSER_PLUGIN_MODE" != "remote" ]; then
  echo "Warning: Chromium executable not found. Browser plugin will be disabled."
fi

BROWSER_SHOULD_ENABLE=false
if [ "$BROWSER_PLUGIN_MODE" = "remote" ] && [ -n "$OPENCLAW_BROWSER_CDP_URL" ]; then
  BROWSER_SHOULD_ENABLE=true
elif [ "$BROWSER_PLUGIN_MODE" = "enabled" ] && [ -n "$BROWSER_EXECUTABLE_PATH" ] && [ -x "$BROWSER_EXECUTABLE_PATH" ]; then
  BROWSER_SHOULD_ENABLE=true
elif [ "$BROWSER_PLUGIN_MODE" = "auto" ] && [ -n "$BROWSER_EXECUTABLE_PATH" ] && [ -x "$BROWSER_EXECUTABLE_PATH" ]; then
  BROWSER_SHOULD_ENABLE=true
fi

# Plugin allow/deny rationale:
#   ALLOW: device-pair, phone-control, talk-voice are the minimum bundled
#          plugins that the Control UI/dashboard needs to render correctly
#          on HF Spaces. Without these the UI shows blank panels.
#          telegram/whatsapp/browser/acpx are added conditionally below.
#          Do not create a disabled acpx entry when the plugin is absent;
#          OpenClaw reports that as a config warning on HF Spaces.
#   DENY:  lmstudio crashes on boot when no local server is reachable;
#          xai PLUGIN (separate from the xai model PROVIDER) is broken in
#          current OpenClaw releases and prevents gateway start. Disabling
#          the plugin does NOT affect xai-as-a-model-provider.
PLUGIN_ALLOW_JSON='["device-pair","phone-control","talk-voice"]'
if [ "$ACP_PLUGIN_MODE" = "enabled" ] || [ "$ACP_PLUGIN_MODE" = "auto" ]; then
  PLUGIN_ALLOW_JSON=$(jq '. + ["acpx"]' <<<"$PLUGIN_ALLOW_JSON")
fi
if [ "$BROWSER_SHOULD_ENABLE" = "true" ]; then
  PLUGIN_ALLOW_JSON=$(jq '. + ["browser"]' <<<"$PLUGIN_ALLOW_JSON")
fi
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  PLUGIN_ALLOW_JSON=$(jq '. + ["telegram"]' <<<"$PLUGIN_ALLOW_JSON")
fi
if [ "$WHATSAPP_ENABLED_NORMALIZED" = "true" ]; then
  PLUGIN_ALLOW_JSON=$(jq '. + ["whatsapp"]' <<<"$PLUGIN_ALLOW_JSON")
fi

# Apply plugin allow/deny + per-entry toggles in one jq pass.
BROWSER_DISABLED=true
if [ "$BROWSER_SHOULD_ENABLE" = "true" ]; then BROWSER_DISABLED=false; fi

CONFIG_JSON=$(jq \
  --argjson allow "$PLUGIN_ALLOW_JSON" \
  --argjson browserDisabled "$BROWSER_DISABLED" \
  '.plugins.allow = $allow
   | .plugins.deny = ["lmstudio","xai"]
   | .plugins.entries.lmstudio.enabled = false
   | .plugins.entries.xai.enabled = false
   | del(.plugins.entries.acpx)
   | (if $browserDisabled then
        .plugins.entries.browser.enabled = false | .browser.enabled = false
      else . end)' <<<"$CONFIG_JSON")

if [ "$BROWSER_SHOULD_ENABLE" = "true" ]; then
  if [ "$BROWSER_PLUGIN_MODE" = "remote" ]; then
    # Remote CDP mode avoids launching local Chromium in HF Spaces. This is useful
    # on free-tier Spaces where managed Chromium is unstable/heavy. OpenClaw still
    # controls a Chromium-family browser, but that browser runs outside this Space.
    _BROWSER_ATTACH_ONLY=false
    if hc_is_true "$OPENCLAW_BROWSER_ATTACH_ONLY"; then
      _BROWSER_ATTACH_ONLY=true
    elif [ "$OPENCLAW_BROWSER_ATTACH_ONLY" = "auto" ]; then
      case "$OPENCLAW_BROWSER_CDP_URL" in
        ws://127.0.0.1:*|ws://localhost:*|http://127.0.0.1:*|http://localhost:*)
          _BROWSER_ATTACH_ONLY=true
          ;;
      esac
    fi
    CONFIG_JSON=$(jq \
      --arg profile "$OPENCLAW_BROWSER_PROFILE" \
      --arg cdpUrl "$OPENCLAW_BROWSER_CDP_URL" \
      --argjson attachOnly "$_BROWSER_ATTACH_ONLY" \
      '.browser = {
         "enabled": true,
         "defaultProfile": $profile,
         "profiles": {
           ($profile): {
             "cdpUrl": $cdpUrl,
             "attachOnly": $attachOnly
           }
         }
       }
       | .agents.defaults.sandbox.browser.allowHostControl = true' <<<"$CONFIG_JSON")
    unset _BROWSER_ATTACH_ONLY
  else
    # NOTE: do NOT add executablePath, localLaunchTimeoutMs, or localCdpReadyTimeoutMs
    # here — those are protected keys managed internally by OpenClaw and will be
    # rejected/ignored if set from the outside config (intentionally removed in
    # commit "Avoid protected browser config keys in generated OpenClaw config").
    CONFIG_JSON=$(jq \
      --arg profile "$OPENCLAW_BROWSER_PROFILE" \
      '.browser = {
         "enabled": true,
         "defaultProfile": $profile,
         "headless": true,
         "noSandbox": true,
         "extraArgs": [
           "--headless=new",
           "--no-sandbox",
           "--disable-setuid-sandbox",
           "--no-zygote",
           "--disable-dev-shm-usage",
           "--disable-gpu",
           "--remote-debugging-address=127.0.0.1",
           "--remote-allow-origins=*",
           "--disable-features=UseDBus,MediaRouter,VizDisplayCompositor,BlinkGenPropertyTrees",
           "--disable-dbus",
           "--disable-background-media-suspend",
           "--password-store=basic",
           "--no-first-run",
           "--disable-background-networking",
           "--disable-sync",
           "--disable-translate",
           "--disable-notifications",
           "--disable-speech-api",
           "--disable-extensions",
           "--mute-audio",
           "--metrics-recording-only"
         ]
       }
       | .agents.defaults.sandbox.browser.allowHostControl = true' <<<"$CONFIG_JSON")
  fi
fi
# Control UI origin (allow HF Space URL for web UI access).
# Disable device auth (pairing) for headless Docker — token-only auth.
# Combined into one jq pass; --arg keeps password/host injection-safe.
CONFIG_JSON=$(jq \
  --arg spaceHost "${SPACE_HOST:-}" \
  --arg password "${OPENCLAW_PASSWORD:-}" \
  '.gateway.controlUi.dangerouslyDisableDeviceAuth = true
   | (if $spaceHost != "" then
        .gateway.controlUi.allowedOrigins = ["https://" + $spaceHost]
      else . end)
   | (if ($password != "" and (.gateway.auth.token // "") == "") then
        .gateway.auth.mode = "password" | .gateway.auth.password = $password
      else . end)' <<<"$CONFIG_JSON")

# Trusted proxies (optional — fixes "Proxy headers detected from untrusted address" on HF Spaces)
# Set TRUSTED_PROXIES as comma-separated IPs/CIDRs, e.g. "10.20.31.87,10.20.26.157"
# Loopback proxies stay trusted by default so the local dashboard reverse proxy works correctly.
if [ -n "${TRUSTED_PROXIES:-}" ]; then
  PROXIES_JSON=$(echo "$TRUSTED_PROXIES" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | jq -R . | jq -s .)
  CONFIG_JSON=$(echo "$CONFIG_JSON" | jq ".gateway.trustedProxies += $PROXIES_JSON | .gateway.trustedProxies |= unique")
fi

# Allowed origins (optional — add extra origins for external OpenClaw clients)
# Set ALLOWED_ORIGINS as comma-separated URLs, e.g. "https://app.openclaw.ai"
# These are MERGED with the Space host origin (which is always allowed).
if [ -n "${ALLOWED_ORIGINS:-}" ]; then
  ORIGINS_JSON=$(echo "$ALLOWED_ORIGINS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | jq -R . | jq -s .)
  CONFIG_JSON=$(echo "$CONFIG_JSON" | jq ".gateway.controlUi.allowedOrigins += $ORIGINS_JSON | .gateway.controlUi.allowedOrigins |= unique")
fi

resolve_telegram_api_root() {
  local candidate="$(trim_var "${TELEGRAM_API_ROOT:-}")"
  if [ -z "$candidate" ]; then
    candidate="$(trim_var "${CLOUDFLARE_PROXY_URL:-}")"
  fi
  if [ -n "$candidate" ]; then
    case "$candidate" in
      http://*|https://*)
        printf '%s' "$candidate"
        return 0
        ;;
      *)
        echo "Warning: invalid Telegram API/proxy root '$candidate' (must start with http:// or https://); falling back to direct Telegram API." >&2
        ;;
    esac
  fi
  printf '%s' "https://api.telegram.org"
}
TELEGRAM_API_ROOT="$(resolve_telegram_api_root)"


# Telegram (supports multiple user IDs, comma-separated)
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  CONFIG_JSON=$(echo "$CONFIG_JSON" | jq '.plugins.entries.telegram = {"enabled": true}')
  # Trim spaces and ensure it is exported for the plugin
  CLEAN_TG_TOKEN=$(echo "$TELEGRAM_BOT_TOKEN" | tr -d '[:space:]')
  export TELEGRAM_BOT_TOKEN="$CLEAN_TG_TOKEN"
  
  export OPENCLAW_TELEGRAM_DISABLE_AUTO_SELECT_FAMILY=1
  export OPENCLAW_TELEGRAM_DNS_RESULT_ORDER=ipv4first
  # Note: --dns-result-order=ipv4first is now set globally for all HF Space
  # channels in the SPACE_HOST block above; no need to set NODE_OPTIONS here.
  
  CONFIG_JSON=$(echo "$CONFIG_JSON" | jq --arg token "$CLEAN_TG_TOKEN" --arg proxy_url "$TELEGRAM_API_ROOT" '
    .channels.telegram.enabled = true
    | .channels.telegram.botToken = $token
    | .channels.telegram.commands.native = false
    | .channels.telegram.timeoutSeconds = 60
    | (if $proxy_url != "" then .channels.telegram.apiRoot = $proxy_url else . end)
    | .channels.telegram.retry = {
        "attempts": 5,
        "minDelayMs": 800,
        "maxDelayMs": 30000,
        "jitter": 0.2
      }
  ')
  
  if [ -n "${TELEGRAM_ALLOWED_USERS:-}" ]; then
    # Convert comma-separated IDs to JSON array (already safe — jq -R parses).
    IDS_JSON=$(echo "$TELEGRAM_ALLOWED_USERS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | jq -R . | jq -s .)
    CONFIG_JSON=$(jq \
      --argjson ids "$IDS_JSON" \
      '.channels.telegram += {"dmPolicy": "allowlist", "allowFrom": $ids}' <<<"$CONFIG_JSON")
  elif [ -n "${TELEGRAM_USER_IDS:-}" ]; then
    # Convert comma-separated IDs to JSON array (already safe — jq -R parses).
    IDS_JSON=$(echo "$TELEGRAM_USER_IDS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | jq -R . | jq -s .)
    CONFIG_JSON=$(jq \
      --argjson ids "$IDS_JSON" \
      '.channels.telegram += {"dmPolicy": "allowlist", "allowFrom": $ids}' <<<"$CONFIG_JSON")
  elif [ -n "${TELEGRAM_USER_ID:-}" ]; then
    # Single user (backward compatible). --arg keeps quotes/odd chars safe.
    CONFIG_JSON=$(jq \
      --arg userId "$TELEGRAM_USER_ID" \
      '.channels.telegram += {"dmPolicy": "allowlist", "allowFrom": [$userId]}' <<<"$CONFIG_JSON")
  fi
fi

# WhatsApp (optional)
if [ "$WHATSAPP_ENABLED_NORMALIZED" = "true" ]; then
  CONFIG_JSON=$(echo "$CONFIG_JSON" | jq '.plugins.entries.whatsapp = {"enabled": true}')
  CONFIG_JSON=$(echo "$CONFIG_JSON" | jq '.channels.whatsapp = {"dmPolicy": "pairing"}')
fi


validate_json_file() {
  local file="$1"
  [ -f "$file" ] || return 1
  jq -e . "$file" >/dev/null 2>&1
}

write_json_atomic() {
  local dest="$1"
  local payload="$2"
  local tmp
  tmp="${dest}.tmp.$$"
  printf '%s\n' "$payload" > "$tmp" || { rm -f "$tmp"; return 1; }
  if ! jq -e . "$tmp" >/dev/null 2>&1; then
    echo "ERROR: refusing to write invalid JSON to $dest" >&2
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$dest"
}

backup_config_copy() {
  local src="$1"
  [ -f "$src" ] || return 0
  local stamp backup
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="${src}.backup.${stamp}"
  cp -a "$src" "$backup" 2>/dev/null || cp "$src" "$backup" 2>/dev/null || true
}

# Write config
EXISTING_CONFIG="/home/node/.openclaw/openclaw.json"
WHATSAPP_CONFIG_ENABLED=false
if [ "$WHATSAPP_ENABLED_NORMALIZED" = "true" ]; then
  WHATSAPP_CONFIG_ENABLED=true
fi
TELEGRAM_CONFIG_ENABLED=false
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  TELEGRAM_CONFIG_ENABLED=true
fi
if [ -f "$EXISTING_CONFIG" ]; then
  echo "Restored config found — patching required fields and runtime channel/plugin toggles..."
  PATCHED=$(jq \
    --arg token "$GATEWAY_TOKEN" \
    --arg model "$LLM_MODEL" \
    --argjson fallbacks "$LLM_FALLBACK_MODELS_JSON" \
    --arg fileLevel "$OPENCLAW_FILE_LOG_LEVEL" \
    --arg consoleLevel "$OPENCLAW_CONSOLE_LOG_LEVEL" \
    --arg consoleStyle "$OPENCLAW_CONSOLE_LOG_STYLE" \
    --argjson desired "$CONFIG_JSON" \
    --argjson injectedModelsProviders "$INJECTED_MODELS_PROVIDERS" \
    --argjson poolApiKeyProviders "$POOL_API_KEY_PROVIDERS" \
    --argjson fileLogConfigured "$OPENCLAW_FILE_LOG_LEVEL_CONFIGURED" \
    --argjson consoleLogConfigured "$OPENCLAW_CONSOLE_LOG_LEVEL_CONFIGURED" \
    --argjson consoleStyleConfigured "$OPENCLAW_CONSOLE_LOG_STYLE_CONFIGURED" \
    --argjson whatsappEnabled "$WHATSAPP_CONFIG_ENABLED" \
    --argjson telegramConfigured "$TELEGRAM_CONFIG_ENABLED" \
    --argjson browserEnabled "$BROWSER_SHOULD_ENABLE" \
    '(.channels.whatsapp // {}) as $existingWhatsapp
     | (.channels.telegram // {}) as $existingTelegram
     | .gateway.auth.token = $token
     | .agents.defaults.model = (if ($fallbacks | length) > 0
         then {"primary": $model, "fallbacks": $fallbacks}
         elif ((.agents.defaults.model | type) == "object" and ((.agents.defaults.model.fallbacks // []) | length) > 0)
         then (.agents.defaults.model | .primary = $model)
         else $model
       end)
     | .gateway.port = ($desired.gateway.port // .gateway.port)
     | .gateway.controlUi.basePath = ($desired.gateway.controlUi.basePath // .gateway.controlUi.basePath)
     | .gateway.controlUi.dangerouslyDisableDeviceAuth = true
     | (if ($desired.gateway.controlUi.allowedOrigins // [] | length) > 0 then
            .gateway.controlUi.allowedOrigins = (
              ((.gateway.controlUi.allowedOrigins // []) + ($desired.gateway.controlUi.allowedOrigins // []))
              | unique
            )
          else . end)
     | (if ($desired.gateway.auth.mode // "") != "" then
            .gateway.auth.mode = $desired.gateway.auth.mode
            | .gateway.auth.password = ($desired.gateway.auth.password // "")
          else . end)
     | .gateway.trustedProxies = (
           ((.gateway.trustedProxies // []) + ($desired.gateway.trustedProxies // []))
           | unique
         )
     | if $fileLogConfigured then .logging.level = $fileLevel else . end
     | if $consoleLogConfigured then .logging.consoleLevel = $consoleLevel else . end
     | if $consoleStyleConfigured then .logging.consoleStyle = $consoleStyle else . end
     | .models = ((.models // {}) + {"mode": (($desired.models.mode // .models.mode) // "merge")})
     | if (($injectedModelsProviders | length) > 0) then
         ($injectedModelsProviders | to_entries) as $entries
         | reduce $entries[] as $e (.;
             (($desired.models.providers[$e.key] // {}) * {models: (($e.value.models // []) | unique_by(.id))}) as $desiredProvider
             | .models.providers[$e.key] = ((.models.providers[$e.key] // {}) * $desiredProvider)
           )
       else
         .
       end
     | if (($desired.models.providers // {} | length) > 0) then
         reduce ($desired.models.providers // {} | to_entries)[] as $pe (.;
           # Propagate custom/new providers from desired config that are absent in existing.
           # For known providers that already exist, merge in baseUrl/apiKey/api from env.
           # ENV WINS over existing config: if an env var supplies a value it always takes
           # effect (e.g. rotating an API key in HF Secrets is immediately reflected).
           # If the env var is unset/empty the existing config value is preserved.
           if .models.providers[$pe.key] == null then
             .models.providers[$pe.key] = $pe.value
           else
             .models.providers[$pe.key] = (
               (.models.providers[$pe.key] // {})
               * (
                   {"baseUrl": $pe.value.baseUrl, "apiKey": $pe.value.apiKey, "api": $pe.value.api}
                   | with_entries(select(.value != null and .value != ""))
                 )
             )
           end
         )
       else
         .
       end
     | if (($poolApiKeyProviders | length) > 0) then
         # BUG FIX: Pool providers must NOT have a static apiKey in the OpenClaw config.
         # The provider key rotator injects the correct rotated key per-request.
         # If a previous single-key run saved an apiKey for this provider, clear it now
         # so OpenClaw does not keep using that one key and ignoring the rotation pool.
         reduce $poolApiKeyProviders[] as $prov (.;
           if .models.providers[$prov] != null then
             del(.models.providers[$prov].apiKey)
           else . end
         )
       else
         .
       end
     | .channels = ((.channels // {}) * ($desired.channels // {}))
     | .plugins.allow = (((.plugins.allow // []) + ($desired.plugins.allow // [])) | unique | map(select(startswith("clawhub:") | not)))
     | .plugins.deny = (((.plugins.deny // []) + ($desired.plugins.deny // [])) | unique)
     | .plugins.entries = ((.plugins.entries // {}) * ($desired.plugins.entries // {}))
     | del(.plugins.entries.acpx)
     | (if $browserEnabled then
          .browser = ($desired.browser // .browser)
        else
          .browser.enabled = false
          | .plugins.entries.browser.enabled = false
        end)
     | if $whatsappEnabled then
         ($desired.channels.whatsapp // {"dmPolicy": "pairing"}) as $desiredWhatsapp
         | .plugins.entries.whatsapp.enabled = true
         | .channels.whatsapp = (($existingWhatsapp * $desiredWhatsapp)
             | if ($existingWhatsapp | has("dmPolicy")) then .dmPolicy = $existingWhatsapp.dmPolicy else . end
             | if ($existingWhatsapp | has("allowFrom")) then .allowFrom = $existingWhatsapp.allowFrom else . end)
       else
         .
       end
     | if $telegramConfigured then
         # Merge: existing * desired → desired (env-driven) wins for runtime fields
         # (apiRoot from CLOUDFLARE_PROXY_URL, commands.native, timeoutSeconds, retry).
         # Then re-apply user-editable fields from saved $existingTelegram so UI
         # customizations (dmPolicy, allowFrom) survive across reboots.
         .channels.telegram = ($existingTelegram * ($desired.channels.telegram // {}))
         | (if ($existingTelegram | has("dmPolicy"))  then .channels.telegram.dmPolicy  = $existingTelegram.dmPolicy  else . end)
         | (if ($existingTelegram | has("allowFrom")) then .channels.telegram.allowFrom = $existingTelegram.allowFrom else . end)
       else
         del(.channels.telegram)
         | .plugins.entries.telegram.enabled = false
       end' \
    "$EXISTING_CONFIG" 2>/dev/null)

  if [ -n "$PATCHED" ]; then
    backup_config_copy "$EXISTING_CONFIG"
    if write_json_atomic "$EXISTING_CONFIG" "$PATCHED"; then
      echo "Config patched successfully."
    else
      echo "Patch produced invalid JSON — writing fresh config."
      write_json_atomic "$EXISTING_CONFIG" "$CONFIG_JSON" || { echo "ERROR: could not write valid fallback config" >&2; exit 1; }
    fi
  else
    echo "Patch failed."
    # Validate only on patch failure (as requested). If restored config is invalid,
    # quarantine it and regenerate from runtime config; otherwise keep it untouched.
    if ! validate_json_file "$EXISTING_CONFIG"; then
      echo "Restored config is invalid JSON — backing up and regenerating from runtime config."
      cp "$EXISTING_CONFIG" "${EXISTING_CONFIG}.invalid.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
      backup_config_copy "$EXISTING_CONFIG"
      write_json_atomic "$EXISTING_CONFIG" "$CONFIG_JSON" || { echo "ERROR: could not write valid fallback config" >&2; exit 1; }
    else
      echo "Patch failed but restored config is valid — keeping existing config unchanged."
    fi
  fi
else
  echo "No restored config — writing fresh config..."
  write_json_atomic "$EXISTING_CONFIG" "$CONFIG_JSON" || { echo "ERROR: could not write valid config" >&2; exit 1; }
fi
chmod 600 "$EXISTING_CONFIG"

# ── Enable Gateway Preload Fixes ──
# These preload scripts keep iframe embedding working on HF Spaces and enable
# provider key rotation for gateway traffic. Keep paths centralized so future
# rotator renames do not leave stale NODE_OPTIONS references behind.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require ${IFRAME_FIX_PRELOAD} --require ${KEY_ROTATOR_PRELOAD}"

# ── Startup Summary ──
echo ""
echo "Version   : ${OPENCLAW_DISPLAY_VERSION}"
echo "Model     : ${LLM_MODEL}"
if [ -n "${LLM_FALLBACK_MODELS:-}" ]; then
  echo "Fallbacks : ${LLM_FALLBACK_MODELS}"
fi
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Telegram  : enabled"
else
  echo "Telegram  : not configured"
fi
if [ "$WHATSAPP_ENABLED_NORMALIZED" = "true" ]; then
  echo "WhatsApp  : enabled"
else
  echo "WhatsApp  : disabled"
fi
echo "Browser   : ${BROWSER_PLUGIN_MODE} (${BROWSER_SHOULD_ENABLE})"
if [ "$BROWSER_PLUGIN_MODE" = "remote" ]; then
  echo "BrowserCDP: configured (${OPENCLAW_BROWSER_PROFILE})"
fi
if [ -n "${HF_TOKEN:-}" ]; then
  echo "Backup    : ${BACKUP_DATASET:-huggingclaw-backup} (every ${SYNC_INTERVAL:-180}s)"
else
  echo "Backup    : disabled"
fi
if [ -n "${CLOUDFLARE_PROXY_URL:-}" ]; then
  echo "Proxy     : ${CLOUDFLARE_PROXY_URL}"
fi
# HUGGINGCLAW_JUPYTER_ENABLED env var se override allow karo
# (env-builder "Enable Jupyter terminal" toggle yahi set karta hai)
if hc_is_true "${HUGGINGCLAW_JUPYTER_ENABLED:-false}"; then
  RUNTIME_JUPYTER_ENABLED=true
else
  RUNTIME_JUPYTER_ENABLED="$DEV_MODE_ENABLED"
fi
# Add user bin to PATH for jupyter-lab (installed in Dockerfile when DEV_MODE=true)
export PATH="$HOME/.local/bin:$PATH"

# Runtime install fallback: only attempt if DEV_MODE is enabled but install failed during build
if [ "$DEV_MODE_ENABLED" = "true" ] && ! python3 -c "import jupyterlab" >/dev/null 2>&1; then
  echo "Terminal  : installing JupyterLab..."
  if python3 -m pip install -q --user --no-cache-dir --break-system-packages "jupyterlab>=4.2,<5" "tornado>=6.3" "ipywidgets>=8.1" >/dev/null 2>&1; then
    echo "Terminal  : installed"
    python3 -c "from pathlib import Path; import shutil, jupyter_server; d=Path(jupyter_server.__file__).parent/'templates'; d.mkdir(parents=True,exist_ok=True); shutil.copyfile('/home/node/app/login.html', d/'login.html')" || true
  else
    echo "Terminal  : install failed — disabling for this boot"
    RUNTIME_JUPYTER_ENABLED=false
  fi
fi
if [ "$RUNTIME_JUPYTER_ENABLED" = "true" ] && ! python3 -c "import jupyterlab" >/dev/null 2>&1; then
  echo "WARNING: jupyter-lab still unavailable; disabling terminal for this boot."
  RUNTIME_JUPYTER_ENABLED=false
fi
export HUGGINGCLAW_JUPYTER_ENABLED="$RUNTIME_JUPYTER_ENABLED"

if [ -n "${SPACE_HOST:-}" ]; then
  if [ "$RUNTIME_JUPYTER_ENABLED" = "true" ]; then
    echo "Routes    : ${APP_BASE}/ (Control UI), ${JUPYTER_BASE}/ (JupyterLab)"
  else
    echo "Routes    : ${APP_BASE}/ (Control UI)"
  fi
fi
echo ""

# ── Trigger Webhook on Restart ──
if [ -n "${WEBHOOK_URL:-}" ]; then
  WEBHOOK_BODY=$(jq -n \
    --arg model "$LLM_MODEL" \
    '{"event":"restart","status":"success","message":"HuggingClaw gateway has started/restarted.","model":$model}')
  curl -s -X POST "$WEBHOOK_URL" \
       -H "Content-Type: application/json" \
       -d "$WEBHOOK_BODY" >/dev/null 2>&1 &
fi

# ── Trap SIGTERM for graceful shutdown ──
stop_background_sync_loop() {
  [ -n "${SYNC_LOOP_PID:-}" ] || return 0

  if ! kill -0 "$SYNC_LOOP_PID" 2>/dev/null; then
    SYNC_LOOP_PID=""
    return 0
  fi

  kill "$SYNC_LOOP_PID" 2>/dev/null || true
  # Wait for the Python process to actually exit so its fcntl lock is released.
  # A fixed short sleep was not enough when the process was inside a HF upload,
  # which made the following one-shot syncs burn their timeout waiting on the
  # lock and left sessions/config changes unsaved.
  for _sync_stop_i in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$SYNC_LOOP_PID" 2>/dev/null; then
      SYNC_LOOP_PID=""
      unset _sync_stop_i
      return 0
    fi
    sleep 0.2
  done

  echo "Warning: workspace sync loop did not stop after SIGTERM; forcing it to release the sync lock."
  kill -9 "$SYNC_LOOP_PID" 2>/dev/null || true
  sleep 0.2
  SYNC_LOOP_PID=""
  unset _sync_stop_i
}

run_openclaw_sync_with_timeout() {
  local timeout_seconds="$1"
  local command_name="$2"
  local lock_timeout_seconds="$3"
  if [ "${timeout_seconds}" = "0" ]; then
    env SYNC_LOCK_TIMEOUT="$lock_timeout_seconds" \
      python3 /home/node/app/openclaw-sync.py "$command_name"
  else
    timeout --kill-after=10s "${timeout_seconds}s" env SYNC_LOCK_TIMEOUT="$lock_timeout_seconds" \
      python3 /home/node/app/openclaw-sync.py "$command_name"
  fi
}

graceful_shutdown() {
  echo "Shutting down..."
  if [ -f "/home/node/app/openclaw-sync.py" ] && [ -n "${HF_TOKEN:-}" ]; then
    echo "Saving state before exit..."
    stop_background_sync_loop
    # Pass 1: wait for config to settle then upload — avoids pushing a
    # half-written JSON config to the dataset.  The per-command lock wait is
    # intentionally shorter than the outer timeout so a stuck lock fails clearly
    # and leaves time for the final catch-up pass.
    run_openclaw_sync_with_timeout "${SYNC_SETTLED_TIMEOUT:-120}" sync-once-settled "${SYNC_ONE_SHOT_LOCK_TIMEOUT:-5}" || \
      echo "Warning: could not complete settled shutdown sync"
    # Pass 2: catch any writes that arrived after the settled sync completed.
    # BUG FIX: added timeout (previously unbounded) so HF container kill
    # can't interrupt a hung upload and lose all data silently.
    run_openclaw_sync_with_timeout "${SYNC_FINAL_TIMEOUT:-120}" sync-once "${SYNC_ONE_SHOT_LOCK_TIMEOUT:-5}" || \
      echo "Warning: could not complete final shutdown sync"
  elif [ -f "/home/node/app/openclaw-sync.py" ]; then
    echo "HF_TOKEN not set; skipping shutdown backup sync."
  fi
  kill $(jobs -p) 2>/dev/null
  exit 0
}
trap graceful_shutdown SIGTERM SIGINT

BROWSER_WARMED_UP=false
warmup_browser() {
  [ "$BROWSER_SHOULD_ENABLE" = "true" ] || return 0
  [ "$BROWSER_PLUGIN_MODE" != "remote" ] || return 0
  # Only warm up once — gateway restarts should not re-spawn new warmup jobs.
  [ "$BROWSER_WARMED_UP" = "false" ] || return 0
  BROWSER_WARMED_UP=true

  (
    # Give the gateway more time to finish its own startup before we poke it.
    sleep 12

    local attempt
    for attempt in 1 2 3 4 5 6 7 8; do
      # FIX: probe the gateway HTTP port first — if the gateway isn't fully up
      # yet, openclaw-browser returns "GatewayClientRequestError: http_unreachable
      # / invalid onRequestStart" because the CDP proxy isn't ready.
      if ! (echo > /dev/tcp/127.0.0.1/${GATEWAY_PORT}) 2>/dev/null; then
        sleep 5
        continue
      fi

      if openclaw browser --browser-profile "$OPENCLAW_BROWSER_PROFILE" start >/dev/null 2>&1; then
        openclaw browser --browser-profile "$OPENCLAW_BROWSER_PROFILE" open about:blank >/dev/null 2>&1 || true
        echo "Managed browser ready."
        return 0
      fi
      sleep 8
    done

    echo "Warning: managed browser warm-up did not complete; first browser action may need a retry."
  ) &
}


# ── Start background services ──
export LLM_MODEL="$LLM_MODEL"

# ── Ensure key-rotator uses the correct HF token for huggingface.co calls ──
# NODE_OPTIONS preloads the provider key rotator into health-server.js.
# The rotator patches https.request and injects HUGGINGFACE_HUB_TOKEN (or
# falls back to LLM_API_KEY) for any call to huggingface.co — including the
# privacy-detection API call in detectSpacePrivacy(). If HUGGINGFACE_HUB_TOKEN
# is not set (user's LLM provider is not HuggingFace), the rotator falls back
# to LLM_API_KEY, which is the AI-provider key, NOT the HF owner token.
# This causes a 401 on /api/spaces/${SPACE_ID} → privacy detection always
# fails → SPACE_IS_PRIVATE stays true → public-space links never open in a
# new tab.
# Fix: seed HUGGINGFACE_HUB_TOKEN from HF_TOKEN when not already set.
# HF Spaces auto-injects HF_TOKEN as the space owner's token, so this is safe.
export HUGGINGFACE_HUB_TOKEN="${HUGGINGFACE_HUB_TOKEN:-${HF_TOKEN:-}}"

# 10. Start Health Server & Dashboard
node /home/node/app/health-server.js &
HEALTH_PID=$!

start_jupyter_once() {
  [ "$RUNTIME_JUPYTER_ENABLED" = "true" ] || return 0
  if [ -n "${JUPYTER_PID:-}" ] && kill -0 "$JUPYTER_PID" 2>/dev/null; then
    return 0
  fi

  # GATEWAY_TOKEN fallback: if JUPYTER_TOKEN is unset or still the insecure default,
  # reuse GATEWAY_TOKEN. Both protect the same Space, so the credential is equivalent.
  if { [ -z "${JUPYTER_TOKEN:-}" ] || [ "${JUPYTER_TOKEN}" = "huggingface" ]; } && [ -n "${GATEWAY_TOKEN:-}" ]; then
    JUPYTER_TOKEN="$GATEWAY_TOKEN"
  fi

  # Security guard: refuse to start JupyterLab with the insecure default token.
  # JupyterLab exposes a full shell — a weak token is equivalent to no auth.
  if [ -z "${JUPYTER_TOKEN:-}" ] || [ "${JUPYTER_TOKEN}" = "huggingface" ]; then
    echo "ERROR: JUPYTER_TOKEN is unset or still set to the insecure default (\"huggingface\")." >&2
    echo "       JupyterLab grants full shell access. Set a strong, unique token in your Space secrets." >&2
    echo "       Hint:  openssl rand -hex 32" >&2
    echo "       DEV_MODE active but JupyterLab will NOT start until JUPYTER_TOKEN is changed." >&2
    return 1
  fi
  JUPYTER_ROOT_DIR="${JUPYTER_ROOT_DIR:-/home/node}"
  if [ "$JUPYTER_ROOT_DIR" = "/home/node/.openclaw/workspace" ] && [ "$DEVDATA_ENABLED" = "true" ]; then
    echo "Jupyter root was set to OpenClaw workspace; moving Jupyter root to /home/node/devdata to keep BACKUP and DEVDATA datasets separate."
    JUPYTER_ROOT_DIR="/home/node/devdata"
  fi
  mkdir -p "$JUPYTER_ROOT_DIR"
  export JUPYTER_ROOT_DIR
  if [ "$JUPYTER_ROOT_DIR" != "/home/node/app" ]; then
    if [ -L "$JUPYTER_ROOT_DIR/HuggingClaw" ] || [ ! -e "$JUPYTER_ROOT_DIR/HuggingClaw" ]; then
      ln -sfn /home/node/app "$JUPYTER_ROOT_DIR/HuggingClaw"
    fi
  fi
  if [ "$JUPYTER_ROOT_DIR" != "/home/node/.openclaw/workspace" ]; then
    if [ -L "$JUPYTER_ROOT_DIR/HuggingClaw-Workspace" ] || [ ! -e "$JUPYTER_ROOT_DIR/HuggingClaw-Workspace" ]; then
      ln -sfn /home/node/.openclaw/workspace "$JUPYTER_ROOT_DIR/HuggingClaw-Workspace"
    fi
  fi
  if [ "$JUPYTER_ROOT_DIR" != "/home/node/.openclaw" ]; then
    if [ -L "$JUPYTER_ROOT_DIR/OpenClaw-Home" ] || [ ! -e "$JUPYTER_ROOT_DIR/OpenClaw-Home" ]; then
      ln -sfn /home/node/.openclaw "$JUPYTER_ROOT_DIR/OpenClaw-Home"
    fi
  fi

  # Pre-create runtime directory
  mkdir -p "$JUPYTER_ROOT_DIR/.jupyter"

  echo "Terminal  : starting (root: $JUPYTER_ROOT_DIR)"
  JUPYTER_LOG_FILE="/tmp/jupyterlab.log"
  
  # Use explicit Python to avoid PATH issues; set memory-friendly limits
  export PYTHONPATH=""
  python3 -m jupyterlab \
      --ip 127.0.0.1 \
      --port "$JUPYTER_PORT" \
      --no-browser \
      --IdentityProvider.token="$JUPYTER_TOKEN" \
      --ServerApp.base_url="${JUPYTER_BASE}/" \
      --ContentsManager.allow_hidden=True \
      --ServerApp.terminals_enabled=True \
      --ServerApp.terminado_settings='{"shell_command":["/bin/bash","-i"]}' \
      --ServerApp.allow_origin='*' \
      --ServerApp.allow_remote_access=True \
      --ServerApp.trust_xheaders=True \
      --ServerApp.tornado_settings="{'headers': {'Content-Security-Policy': 'frame-ancestors *'}}" \
      --IdentityProvider.cookie_options="{'SameSite': 'None', 'Secure': True}" \
      --ServerApp.disable_check_xsrf=True \
      --LabApp.news_url=None \
      --LabApp.check_for_updates_class=jupyterlab.NeverCheckForUpdate \
      --ServerApp.log_level=WARN \
      --ServerApp.root_dir="$JUPYTER_ROOT_DIR" \
      >> "$JUPYTER_LOG_FILE" 2>&1 &
  JUPYTER_PID=$!
  export JUPYTER_PID
  echo "Terminal  : started (PID: $JUPYTER_PID)"
}

# BUG FIX #3: DevData restore must happen BEFORE JupyterLab starts.
# The background jupyter-devdata-sync.py process is only launched AFTER the
# gateway is ready (20-90 s from now). If restore ran there, JupyterLab would
# already be live and the file writes would corrupt its runtime state → crash.
# Running --restore here (synchronous, before JupyterLab) solves that.
if [ "$RUNTIME_JUPYTER_ENABLED" = "true" ] && \
   [ "$DEVDATA_ENABLED" = "true" ] && \
   [ -n "${HF_TOKEN:-}" ] && \
   [ -f "/home/node/app/jupyter-devdata-sync.py" ] && \
   [ "${DEVDATA_DATASET_NAME:-huggingclaw-devdata}" != "${BACKUP_DATASET_NAME:-huggingclaw-backup}" ]; then
  echo "DevData   : restoring workspace..."
  python3 /home/node/app/jupyter-devdata-sync.py --restore 2>/dev/null || \
    echo "DevData   : restore warning (non-fatal); continuing startup."
fi

# Fix: reinstall jsonschema AFTER devdata restore — restore can overwrite a broken
# version from .local/lib/python3.11/site-packages into the workspace, causing
# JupyterLab to crash with a circular import error on every boot.
if [ "$DEV_MODE_ENABLED" = "true" ]; then
  if ! python3 -c "import jsonschema" >/dev/null 2>&1; then
    python3 -m pip install -q --force-reinstall --no-cache-dir --break-system-packages "jsonschema>=4.0" >/dev/null 2>&1 || true
  fi
fi

# 10.5. Start JupyterLab Terminal on internal port 8888 (DEV_MODE only)
# Accessible via /terminal/ path through the health-server proxy
if [ "$RUNTIME_JUPYTER_ENABLED" = "true" ]; then
  start_jupyter_once
fi

if [ -n "${CLOUDFLARE_WORKERS_TOKEN:-}" ]; then
  echo "Setting up Cloudflare KeepAlive monitor..."
  python3 /home/node/app/cloudflare-keepalive-setup.py || true
fi

# ── Write shell capture wrappers to .bashrc ──
# The wrappers persist only install commands, not downloaded package files.
# On the next boot the synced workspace/startup.sh replays those commands.
if [ ! -f "$STARTUP_FILE" ]; then
  touch "$STARTUP_FILE"
  chmod +x "$STARTUP_FILE"
  echo "Created workspace/startup.sh"
fi
cat > /home/node/.bashrc << 'BASHRC'
export PATH="/home/node/.local/bin:$PATH"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/home/node/.local}"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
export PYTHONUSERBASE="${PYTHONUSERBASE:-/home/node/.local}"
export DEBIAN_FRONTEND="${DEBIAN_FRONTEND:-noninteractive}"
export HISTFILE="${HISTFILE:-/home/node/.bash_history}"
export HISTSIZE="${HISTSIZE:-50000}"
export HISTFILESIZE="${HISTFILESIZE:-100000}"
mkdir -p "$(dirname "$HISTFILE")"
touch "$HISTFILE" 2>/dev/null || true
chmod 600 "$HISTFILE" 2>/dev/null || true
shopt -s histappend 2>/dev/null || true
_hc_history_sync_prompt() {
  history -a
  history -n
}
case ";${PROMPT_COMMAND:-};" in
  *";_hc_history_sync_prompt;"*) ;;
  ""|";") PROMPT_COMMAND="_hc_history_sync_prompt" ;;
  *) PROMPT_COMMAND="_hc_history_sync_prompt; ${PROMPT_COMMAND}" ;;
esac
export PROMPT_COMMAND
if [ -z "${PS1:-}" ] || [ "$PS1" = "$ " ]; then
  export PS1="\u@\h:\w\$ "
fi
STARTUP_FILE="/home/node/.openclaw/workspace/startup.sh"
_hc_append() {
  if [ "${HUGGINGCLAW_CAPTURE_DISABLE:-0}" = "1" ]; then
    return 0
  fi
  local line="$*"
  mkdir -p "$(dirname "$STARTUP_FILE")"
  touch "$STARTUP_FILE"
  chmod +x "$STARTUP_FILE" 2>/dev/null || true
  grep -qxF "$line" "$STARTUP_FILE" 2>/dev/null || echo "$line" >> "$STARTUP_FILE"
}
_hc_quote_args() {
  local quoted=()
  local arg
  for arg in "$@"; do
    printf -v arg '%q' "$arg"
    quoted+=("$arg")
  done
  printf '%s' "${quoted[*]}"
}
_hc_append_cmd() {
  local cmd="$1"
  shift
  local args
  args=$(_hc_quote_args "$@")
  if [ -n "$args" ]; then
    _hc_append "$cmd $args"
  else
    _hc_append "$cmd"
  fi
}
_hc_args_without_flags() {
  local out=()
  local arg
  for arg in "$@"; do
    case "$arg" in
      ''|-) ;;
      --*) ;;
      -*) ;;
      *) out+=("$arg") ;;
    esac
  done
  printf '%s\n' "${out[@]}"
}
_hc_has_install_targets() {
  local item
  while IFS= read -r item; do
    [ -n "$item" ] && return 0
  done <<EOF
$(_hc_args_without_flags "$@")
EOF
  return 1
}
write_json_atomic() {
  local dest="$1"
  local payload="$2"
  local tmp
  tmp="${dest}.tmp.$$"
  printf '%s\n' "$payload" > "$tmp" || { rm -f "$tmp"; return 1; }
  if ! jq -e . "$tmp" >/dev/null 2>&1; then
    echo "ERROR: refusing to write invalid JSON to $dest" >&2
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$dest"
}
_hc_allow_openclaw_plugins() {
  local config="/home/node/.openclaw/openclaw.json"
  [ -f "$config" ] || return 0

  local plugins=()
  local plugin
  for plugin in "$@"; do
    [ -n "$plugin" ] || continue
    [[ "$plugin" == -* ]] && continue
    plugins+=("$plugin")
    if [[ "$plugin" == @openclaw/* ]]; then
      plugins+=("${plugin#@openclaw/}")
    fi
  done
  [ "${#plugins[@]}" -gt 0 ] || return 0

  local plugins_json
  plugins_json=$(printf '%s\n' "${plugins[@]}" | jq -R 'select(length > 0)' | jq -s 'unique') || return 0
  local patched
  patched=$(jq --argjson plugins "$plugins_json" \
    '.plugins.allow = (((.plugins.allow // []) + $plugins) | unique)' \
    "$config" 2>/dev/null) || { echo "Warning: could not update plugins.allow for $*" >&2; return 0; }
  write_json_atomic "$config" "$patched" || echo "Warning: could not write plugins.allow update to config." >&2
}
_hc_has_arg() {
  local needle="$1"
  shift
  local arg
  for arg in "$@"; do
    [ "$arg" = "$needle" ] && return 0
  done
  return 1
}
_hc_can_sudo_apt() {
  command -v sudo >/dev/null 2>&1 && sudo -n apt-get --version >/dev/null 2>&1
}
_hc_apt_install() {
  if [ "$(id -u)" -eq 0 ]; then
    command apt-get update && command apt-get install -y "$@"
  elif _hc_can_sudo_apt; then
    sudo apt-get update && sudo apt-get install -y "$@"
  else
    echo "Error: apt install needs root. Rebuild with the latest HuggingClaw image or add packages to Dockerfile." >&2
    return 1
  fi
}
apt-get() {
  case "${1:-}" in
    install)
      shift
      _hc_apt_install "$@"
      local rc=$?
      if [ $rc -eq 0 ]; then
        _hc_has_install_targets "$@" && _hc_append_cmd "sudo apt-get update && sudo apt-get install -y" "$@"
      fi
      return $rc
      ;;
    update)
      if [ "$(id -u)" -eq 0 ]; then
        command apt-get "$@"
      elif _hc_can_sudo_apt; then
        sudo apt-get "$@"
      else
        command apt-get "$@"
      fi
      return $?
      ;;
    *)
      command apt-get "$@"
      return $?
      ;;
  esac
}
apt() {
  case "${1:-}" in
    install)
      shift
      _hc_apt_install "$@"
      local rc=$?
      if [ $rc -eq 0 ]; then
        _hc_has_install_targets "$@" && _hc_append_cmd "sudo apt-get update && sudo apt-get install -y" "$@"
      fi
      return $rc
      ;;
    update)
      if [ "$(id -u)" -eq 0 ]; then
        command apt "$@"
      elif _hc_can_sudo_apt; then
        sudo apt "$@"
      else
        command apt "$@"
      fi
      return $?
      ;;
    *)
      command apt "$@"
      return $?
      ;;
  esac
}

sudo() {
  # Keep privilege boundary strict: only apt/apt-get/dpkg may escalate.
  # For common user-space commands, transparently run without sudo so users
  # who habitually type "sudo <cmd>" do not hit unnecessary failures.
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    apt|apt-get|dpkg)
      if command -v command >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
        command sudo "$cmd" "$@"
      else
        "$cmd" "$@"
      fi
      ;;
    unzip|zip|tar|gzip|gunzip|xz|7z|curl|wget|python|python3|pip|pip3|npm|npx|node|git|ls|cat|cp|mv|rm|mkdir|chmod|touch)
      "$cmd" "$@"
      ;;
    "")
      echo "usage: sudo <command> [args...]" >&2
      return 1
      ;;
    *)
      echo "sudo: $cmd is not permitted in this environment (only apt/apt-get/dpkg escalation is allowed)." >&2
      return 1
      ;;
  esac
}
pip() {
  if [ "${1:-}" = "install" ] && [ -z "${VIRTUAL_ENV:-}" ] && ! _hc_has_arg --user "$@" && ! _hc_has_arg --prefix "$@"; then
    command pip install --user --break-system-packages "${@:2}"
  else
    command pip "$@"
  fi
  local rc=$?
  # Skip capture when -r/--requirement is used: the requirements file won't exist on next boot
  if [ $rc -eq 0 ] && [ "${1:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:2}" && ! _hc_has_arg --requirement "${@:2}" \
      && _hc_has_install_targets "${@:2}"; then
    _hc_append_cmd "python3 -m pip install --user" "${@:2}"
  fi
  return $rc
}
pip3() {
  if [ "${1:-}" = "install" ] && [ -z "${VIRTUAL_ENV:-}" ] && ! _hc_has_arg --user "$@" && ! _hc_has_arg --prefix "$@"; then
    command pip3 install --user --break-system-packages "${@:2}"
  else
    command pip3 "$@"
  fi
  local rc=$?
  if [ $rc -eq 0 ] && [ "${1:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:2}" && ! _hc_has_arg --requirement "${@:2}" \
      && _hc_has_install_targets "${@:2}"; then
    _hc_append_cmd "python3 -m pip install --user" "${@:2}"
  fi
  return $rc
}
python() {
  if [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ] && [ -z "${VIRTUAL_ENV:-}" ] && ! _hc_has_arg --user "${@:3}" && ! _hc_has_arg --prefix "${@:3}"; then
    command python -m pip install --user --break-system-packages "${@:4}"
  else
    command python "$@"
  fi
  local rc=$?
  if [ $rc -eq 0 ] && [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:4}" && ! _hc_has_arg --requirement "${@:4}" \
      && _hc_has_install_targets "${@:4}"; then
    _hc_append_cmd "python3 -m pip install --user" "${@:4}"
  fi
  return $rc
}
python3() {
  if [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ] && [ -z "${VIRTUAL_ENV:-}" ] && ! _hc_has_arg --user "${@:3}" && ! _hc_has_arg --prefix "${@:3}"; then
    command python3 -m pip install --user --break-system-packages "${@:4}"
  else
    command python3 "$@"
  fi
  local rc=$?
  if [ $rc -eq 0 ] && [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:4}" && ! _hc_has_arg --requirement "${@:4}" \
      && _hc_has_install_targets "${@:4}"; then
    _hc_append_cmd "python3 -m pip install --user" "${@:4}"
  fi
  return $rc
}
npm() {
  command npm "$@"
  local rc=$?
  if [ $rc -eq 0 ] && { [ "${1:-}" = "install" ] || [ "${1:-}" = "i" ]; } && { [ "${2:-}" = "-g" ] || [ "${2:-}" = "--global" ]; } && _hc_has_install_targets "${@:3}"; then
    _hc_append_cmd "npm install -g" "${@:3}"
  fi
  return $rc
}
openclaw() {
  command openclaw "$@"
  local rc=$?
  if [ $rc -eq 0 ] && [ "${1:-}" = "plugins" ] && [ "${2:-}" = "install" ] && _hc_has_install_targets "${@:3}"; then
    _hc_allow_openclaw_plugins "${@:3}"
    _hc_append_cmd "openclaw plugins install" "${@:3}"
  fi
  return $rc
}
# uv pip install — increasingly popular fast pip replacement
uv() {
  command uv "$@"
  local rc=$?
  # Only capture: uv pip install ... (not uv pip sync, uv add, etc.)
  # Skip if -r/--requirements flag present (file won't exist on next boot)
  if [ $rc -eq 0 ] && [ "${1:-}" = "pip" ] && [ "${2:-}" = "install" ] \
      && ! _hc_has_arg -r "${@:3}" && ! _hc_has_arg --requirements "${@:3}" \
      && _hc_has_install_targets "${@:3}"; then
    _hc_append_cmd "uv pip install" "${@:3}"
  fi
  return $rc
}
# pipx — isolated tool installs
pipx() {
  command pipx "$@"
  local rc=$?
  if [ $rc -eq 0 ] && [ "${1:-}" = "install" ] && _hc_has_install_targets "${@:2}"; then
    _hc_append_cmd "pipx install" "${@:2}"
  fi
  return $rc
}
BASHRC
cat > /home/node/.profile <<'PROFILE'
[ -n "${BASH_VERSION:-}" ] && [ -f ~/.bashrc ] && . ~/.bashrc
PROFILE
echo "Shell capture wrappers ready."

# ── Re-install previously installed plugins ──
EXISTING_CONFIG="/home/node/.openclaw/openclaw.json"
if [ -f "$EXISTING_CONFIG" ]; then
  INSTALLS=$(jq -r '.plugins.installs // {} | keys[]' "$EXISTING_CONFIG" 2>/dev/null || echo "")
  if [ -n "$INSTALLS" ]; then
    echo "Re-installing plugins from config..."
    while IFS= read -r pkg; do
      [ -z "$pkg" ] && continue
      # Try short name first, then @openclaw/ prefix
      if openclaw plugins install "$pkg" 2>/dev/null; then
        echo "  Installed: $pkg"
      elif openclaw plugins install "@openclaw/$pkg" 2>/dev/null; then
        echo "  Installed: @openclaw/$pkg"
      else
        echo "  Warning: could not install $pkg"
      fi
    done <<< "$INSTALLS"
    echo "Plugins done."
  fi
fi

# ── Startup command runner ──
# Runs user-provided boot commands one by one so failures are visible in logs.
# By default failures are logged and boot continues; set
# HUGGINGCLAW_STARTUP_STRICT=true to fail the Space startup on any error.
# HC_STARTUP_FAILURES initialized earlier (before Chromium ensure check)
HC_STARTUP_STRICT_NORMALIZED=$(printf '%s' "${HUGGINGCLAW_STARTUP_STRICT:-false}" | tr '[:upper:]' '[:lower:]')
hc_run_startup_command() {
  local source_label="$1"
  local command_text="$2"
  [ -n "$command_text" ] || return 0

  echo "[startup:${source_label}] $command_text"
  set +e
  HUGGINGCLAW_CAPTURE_DISABLE=1 bash -lc "$command_text"
  local rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    echo "[startup:${source_label}] ok"
    return 0
  fi

  HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))
  echo "ERROR: startup command failed (${source_label}, exit ${rc}): $command_text" >&2
  return "$rc"
}

hc_run_startup_script() {
  local source_label="$1"
  local script_text="$2"
  [ -n "$script_text" ] || return 0

  local script_file
  script_file=$(mktemp "/tmp/huggingclaw-startup-${source_label//[^A-Za-z0-9_.-]/_}.XXXXXX.sh")
  {
    # Load HuggingClaw's install wrappers for env-provided scripts too, so
    # `apt install`, `pip install`, `npm install -g`, and OpenClaw plugin
    # installs behave the same way as they do in the interactive shell.
    echo 'export HUGGINGCLAW_CAPTURE_DISABLE=1'
    echo '[ -f /home/node/.bashrc ] && . /home/node/.bashrc'
    printf '%s\n' "$script_text"
  } > "$script_file"
  chmod 700 "$script_file"

  echo "[startup:${source_label}] running script (${script_file})"
  set +e
  bash "$script_file"
  local rc=$?
  set -e
  rm -f "$script_file"

  if [ "$rc" -eq 0 ]; then
    echo "[startup:${source_label}] ok"
    return 0
  fi

  HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))
  echo "ERROR: startup script failed (${source_label}, exit ${rc})" >&2
  return "$rc"
}
hc_run_startup_script_b64() {
  local source_label="$1"
  local encoded_script="$2"
  [ -n "$encoded_script" ] || return 0

  local script_text
  if ! script_text=$(printf '%s' "$encoded_script" | base64 -d 2>/dev/null); then
    HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))
    echo "ERROR: startup script base64 decode failed (${source_label})" >&2
    return 1
  fi

  hc_run_startup_script "$source_label" "$script_text"
}


hc_run_startup_auto() {
  local source_label="$1"
  local payload="$2"
  [ -n "$payload" ] || return 0

  if [[ "$payload" == base64:* ]]; then
    hc_run_startup_script_b64 "$source_label" "${payload#base64:}"
  elif [[ "$payload" == b64:* ]]; then
    hc_run_startup_script_b64 "$source_label" "${payload#b64:}"
  else
    hc_run_startup_script "$source_label" "$payload"
  fi
}

hc_run_command_block() {
  local source_label="$1"
  local command_block="$2"
  local line
  local index=0

  while IFS= read -r line || [ -n "$line" ]; do
    # Skip blank lines and comments so multi-line env vars can be documented.
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    index=$((index + 1))
    hc_run_startup_command "${source_label}[${index}]" "$line" || true
  done <<< "$command_block"
}

sync_installed_plugins_into_allow() {
  local config="/home/node/.openclaw/openclaw.json"
  [ -f "$config" ] || return 0

  local patched
  patched=$(jq '
    (.plugins.installs // {}) as $installs
    | . as $root
    | [($installs | keys)[] as $id
        | ($id | if startswith("@openclaw/") then sub("^@openclaw/"; "") else . end) as $short
        | select((($root.plugins.entries[$id].enabled // $root.plugins.entries[$short].enabled // true) != false))
        | $id
      ] as $installed
    | ($installed | map(if startswith("@openclaw/") then sub("^@openclaw/"; "") else . end)) as $short
    | .plugins.allow = (((.plugins.allow // []) + $installed + $short) | unique)
  ' "$config" 2>/dev/null) || {
    echo "Warning: could not sync installed plugins into plugins.allow"
    return 0
  }

  write_json_atomic "$config" "$patched" || echo "Warning: could not write synced plugins.allow to config." >&2
}

hc_finish_startup_commands() {
  if [ "$HC_STARTUP_FAILURES" -gt 0 ]; then
    echo "ERROR: ${HC_STARTUP_FAILURES} startup command(s) failed. Check the log lines above." >&2
    if hc_is_true "$HC_STARTUP_STRICT_NORMALIZED"; then
      echo "ERROR: HUGGINGCLAW_STARTUP_STRICT=true, stopping startup." >&2
      exit 1
    fi
  fi
  return 0
}

# ── Optional package install lists from HF Variables/Secrets ──
# These install package names every boot without persisting package files.
# Use them when you prefer HF Variables over editing workspace/startup.sh.
if [ -n "${HUGGINGCLAW_APT_PACKAGES:-}" ]; then
  echo "Installing apt packages from HUGGINGCLAW_APT_PACKAGES..."
  # Normalize: commas and newlines → spaces so all three input styles work:
  #   space-separated: "curl wget git"
  #   comma-separated: "curl,wget,git"        (common user mistake)
  #   one-per-line (textarea default): "curl\nwget\ngit"
  # read -r -a with <<< only reads the FIRST LINE, so normalization is required.
  _HC_APT_NORM=$(printf '%s' "$HUGGINGCLAW_APT_PACKAGES" | tr ',\n\r' '   ' | tr -s ' ')
  read -r -a HC_APT_PACKAGES <<< "$_HC_APT_NORM"
  if command -v sudo >/dev/null 2>&1; then
    if sudo apt-get update && sudo apt-get install -y "${HC_APT_PACKAGES[@]}"; then
      echo "HUGGINGCLAW_APT_PACKAGES install complete."
    else
      HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))
      echo "ERROR: HUGGINGCLAW_APT_PACKAGES install failed: ${HUGGINGCLAW_APT_PACKAGES}" >&2
    fi
  else
    HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))
    echo "ERROR: sudo is unavailable; HUGGINGCLAW_APT_PACKAGES install skipped" >&2
  fi
fi
if [ -n "${HUGGINGCLAW_PIP_PACKAGES:-}" ]; then
  echo "Installing Python packages from HUGGINGCLAW_PIP_PACKAGES..."
  _HC_PIP_NORM=$(printf '%s' "$HUGGINGCLAW_PIP_PACKAGES" | tr ',\n\r' '   ' | tr -s ' ')
  read -r -a HC_PIP_PACKAGES <<< "$_HC_PIP_NORM"
  if python3 -m pip install --user --break-system-packages "${HC_PIP_PACKAGES[@]}"; then
    echo "HUGGINGCLAW_PIP_PACKAGES install complete."
  else
    HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))
    echo "ERROR: HUGGINGCLAW_PIP_PACKAGES install failed: ${HUGGINGCLAW_PIP_PACKAGES}" >&2
  fi
fi
if [ -n "${HUGGINGCLAW_NPM_PACKAGES:-}" ]; then
  echo "Installing global npm packages from HUGGINGCLAW_NPM_PACKAGES..."
  _HC_NPM_NORM=$(printf '%s' "$HUGGINGCLAW_NPM_PACKAGES" | tr ',\n\r' '   ' | tr -s ' ')
  read -r -a HC_NPM_PACKAGES <<< "$_HC_NPM_NORM"
  if npm install -g "${HC_NPM_PACKAGES[@]}"; then
    echo "HUGGINGCLAW_NPM_PACKAGES install complete."
  else
    HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))
    echo "ERROR: HUGGINGCLAW_NPM_PACKAGES install failed: ${HUGGINGCLAW_NPM_PACKAGES}" >&2
  fi
fi
if [ -n "${HUGGINGCLAW_OPENCLAW_PLUGINS:-}" ]; then
  echo "Installing OpenClaw plugins from HUGGINGCLAW_OPENCLAW_PLUGINS..."
  _HC_PLUGINS_NORM=$(printf '%s' "$HUGGINGCLAW_OPENCLAW_PLUGINS" | tr ',\n\r' '   ' | tr -s ' ')
  read -r -a HC_OPENCLAW_PLUGINS <<< "$_HC_PLUGINS_NORM"
  if openclaw plugins install "${HC_OPENCLAW_PLUGINS[@]}"; then
    echo "HUGGINGCLAW_OPENCLAW_PLUGINS install complete."
  else
    HC_STARTUP_FAILURES=$((HC_STARTUP_FAILURES + 1))
    echo "ERROR: HUGGINGCLAW_OPENCLAW_PLUGINS install failed: ${HUGGINGCLAW_OPENCLAW_PLUGINS}" >&2
  fi
fi

# ── Fix config before running startup commands ──
if [ "${AUTO_DOCTOR:-false}" = "true" ]; then
  openclaw doctor --fix || true
fi

# ── Arbitrary startup commands from HF Variables/Secrets ──
# Recommended: use one variable, HUGGINGCLAW_RUN, as a full bash script. If the
# value starts with base64: or b64:, the rest is decoded and run as the script.
# Legacy granular HUGGINGCLAW_STARTUP_* variables are still supported below.
if [ -n "${HUGGINGCLAW_RUN:-}" ]; then
  hc_run_startup_auto "HUGGINGCLAW_RUN" "$HUGGINGCLAW_RUN" || true
fi
if [ -n "${HUGGINGCLAW_STARTUP_COMMANDS:-}" ]; then
  echo "Running commands from HUGGINGCLAW_STARTUP_COMMANDS..."
  hc_run_command_block "HUGGINGCLAW_STARTUP_COMMANDS" "$HUGGINGCLAW_STARTUP_COMMANDS"
fi
for HC_STARTUP_INDEX in $(seq 1 100); do
  HC_STARTUP_VAR="HUGGINGCLAW_STARTUP_COMMAND_${HC_STARTUP_INDEX}"
  if [ -n "${!HC_STARTUP_VAR:-}" ]; then
    hc_run_startup_command "$HC_STARTUP_VAR" "${!HC_STARTUP_VAR}" || true
  fi
done
if [ -n "${HUGGINGCLAW_STARTUP_SCRIPT:-}" ]; then
  hc_run_startup_script "HUGGINGCLAW_STARTUP_SCRIPT" "$HUGGINGCLAW_STARTUP_SCRIPT" || true
fi
if [ -n "${HUGGINGCLAW_STARTUP_SCRIPT_B64:-}" ]; then
  hc_run_startup_script_b64 "HUGGINGCLAW_STARTUP_SCRIPT_B64" "$HUGGINGCLAW_STARTUP_SCRIPT_B64" || true
fi
for HC_STARTUP_INDEX in $(seq 1 20); do
  HC_STARTUP_VAR="HUGGINGCLAW_STARTUP_SCRIPT_B64_${HC_STARTUP_INDEX}"
  if [ -n "${!HC_STARTUP_VAR:-}" ]; then
    hc_run_startup_script_b64 "$HC_STARTUP_VAR" "${!HC_STARTUP_VAR}" || true
  fi
done

# ── Run workspace startup script ──
STARTUP_FILE="/home/node/.openclaw/workspace/startup.sh"
if [ ! -f "$STARTUP_FILE" ]; then
  touch "$STARTUP_FILE"
  chmod +x "$STARTUP_FILE"
  echo "Created workspace/startup.sh"
fi
if [ -s "$STARTUP_FILE" ]; then
  echo "Running workspace/startup.sh script..."
  hc_run_startup_script "workspace/startup.sh" "$(cat "$STARTUP_FILE")" || true
  echo "Workspace startup script complete."
fi
hc_clean_node_options_for_openclaw_maintenance() {
  # OpenClaw plugin install/inspect/update is a maintenance path, not gateway
  # traffic. Keep it isolated from HuggingClaw's gateway preloads because those
  # hooks patch fetch/undici globally and can redirect package downloads through
  # Cloudflare or emit rotator startup logs into installer output.
  local cleaned=" ${NODE_OPTIONS:-} "
  local preload pattern
  for preload in "/opt/cloudflare-proxy.js" "$IFRAME_FIX_PRELOAD" "$KEY_ROTATOR_PRELOAD"; do
    [ -n "$preload" ] || continue
    pattern="--require ${preload} "; cleaned="${cleaned//$pattern/ }"
    pattern="--require=${preload} "; cleaned="${cleaned//$pattern/ }"
    pattern="-r ${preload} "; cleaned="${cleaned//$pattern/ }"
  done
  # Normalize whitespace after removing known preload pairs.
  printf '%s' "$cleaned" | tr -s ' ' | sed 's/^ //;s/ $//'
}

hc_openclaw_maintenance() {
  local cleaned_node_options
  cleaned_node_options="$(hc_clean_node_options_for_openclaw_maintenance)"
  if [ -n "$cleaned_node_options" ]; then
    if [ -n "${OPENCLAW_CONFIG_PATH:-}" ]; then
      env NODE_OPTIONS="$cleaned_node_options" OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" openclaw "$@"
    else
      env NODE_OPTIONS="$cleaned_node_options" openclaw "$@"
    fi
  else
    if [ -n "${OPENCLAW_CONFIG_PATH:-}" ]; then
      env -u NODE_OPTIONS OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" openclaw "$@"
    else
      env -u NODE_OPTIONS openclaw "$@"
    fi
  fi
}

hc_openclaw_maintenance_with_optional_config() {
  local config_path="${1:-}"
  shift || true
  if [ -n "$config_path" ] && [ -f "$config_path" ]; then
    OPENCLAW_CONFIG_PATH="$config_path" hc_openclaw_maintenance "$@"
  else
    hc_openclaw_maintenance "$@"
  fi
}

whatsapp_plugin_runtime_ok() {
  # Check both the bare and scoped install paths that OpenClaw uses across
  # stable/beta releases.  The scoped path (@openclaw/whatsapp) is used when
  # the plugin is installed via `openclaw plugins install @openclaw/whatsapp`.
  local ext_dir="/home/node/.openclaw/extensions/whatsapp"
  local ext_dir_scoped="/home/node/.openclaw/extensions/@openclaw/whatsapp"

  for dir in "$ext_dir" "$ext_dir_scoped"; do
    if [ -f "$dir/dist/setup-entry.js" ] && [ -f "$dir/dist/index.js" ]; then
      return 0
    fi
  done

  # Use openclaw's own inspector to discover a non-standard install directory,
  # but ALWAYS verify the actual dist files exist afterwards.
  #
  # IMPORTANT: `openclaw plugins inspect whatsapp --runtime --json` exits with
  # code 0 based purely on the plugin registry record — even when the dist
  # files (dist/setup-entry.js, dist/index.js) are absent.  That is exactly
  # the condition the gateway.startup_failed error reports.  Trusting the exit
  # code alone (the previous behaviour) caused `install_whatsapp_plugin_runtime`
  # and `repair_broken_whatsapp_plugin_entry` to both return early thinking the
  # runtime was healthy, letting the gateway start with `enabled=true` and
  # missing dist files → crash loop.
  if command -v openclaw >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    local inspect_json
    inspect_json=$(hc_openclaw_maintenance plugins inspect whatsapp --runtime --json 2>/dev/null) || true
    if [ -n "$inspect_json" ]; then
      local root_dir
      root_dir=$(printf '%s' "$inspect_json" \
        | jq -r '(.rootDir // .root // .dir // .path // empty)' 2>/dev/null || true)
      if [ -n "$root_dir" ] && \
         [ -f "$root_dir/dist/setup-entry.js" ] && \
         [ -f "$root_dir/dist/index.js" ]; then
        return 0
      fi
    fi
  fi

  return 1
}

install_whatsapp_plugin_runtime() {
  [ "$WHATSAPP_ENABLED_NORMALIZED" = "true" ] || return 0
  whatsapp_plugin_runtime_ok && return 0

  echo "WhatsApp is enabled but OpenClaw reports the external @openclaw/whatsapp runtime is missing/broken; checking the official install path before gateway start..."

  # Remove stale/broken extension directories so openclaw gets a clean slate.
  # This is the primary fix for "WhatsApp enabled but won't install on restart":
  # the backed-up extensions dir (now excluded from sync) or any leftover dir
  # from a previous partial install can cause openclaw plugins install to skip
  # or fail silently.  A clean delete ensures the install always runs fresh.
  local _wa_ext_dir="/home/node/.openclaw/extensions/whatsapp"
  local _wa_ext_dir_scoped="/home/node/.openclaw/extensions/@openclaw/whatsapp"
  if [ -d "$_wa_ext_dir" ] || [ -d "$_wa_ext_dir_scoped" ]; then
    echo "Removing stale WhatsApp extension directories before reinstall..."
    rm -rf "$_wa_ext_dir" "$_wa_ext_dir_scoped" 2>/dev/null || true
  fi

  local config="/home/node/.openclaw/openclaw.json"
  local install_config=""
  if [ -f "$config" ]; then
    install_config="$(mktemp)"
    cp "$config" "$install_config" 2>/dev/null || install_config=""
    if [ -n "$install_config" ] && [ -f "$install_config" ]; then
      # Use a temporary installer-only config so the user's real WhatsApp
      # channel settings (dmPolicy/allowFrom/group rules/session choices) are
      # never deleted just to bootstrap the missing plugin runtime.
      #
      # Also wipe plugins.installs entries for whatsapp so openclaw does NOT
      # see an existing install record and skip the download.  This is the fix
      # for "install command runs but nothing is actually downloaded": openclaw
      # treats a non-empty installs entry as "already installed" and returns
      # early even when the dist files are missing.
      jq '
        .plugins.entries.whatsapp.enabled = false
        | del(.channels.whatsapp)
        | .plugins.allow = ((.plugins.allow // []) | map(select(. != "whatsapp" and . != "@openclaw/whatsapp" and . != "clawhub:@openclaw/whatsapp")))
        | if .plugins.installs then
            .plugins.installs = (.plugins.installs | with_entries(select(
              (.key | test("whatsapp|@openclaw/whatsapp"; "i")) | not
            )))
          else . end
      ' "$install_config" > "$install_config.tmp" 2>/dev/null && mv "$install_config.tmp" "$install_config" || rm -f "$install_config.tmp"
    fi
  fi

  # Official WhatsApp docs: stable/beta uses the external @openclaw/whatsapp
  # plugin, preferring ClawHub and using the bare npm package only as fallback.
  # Do not pin versions here; OpenClaw's plugin installer/update logic tracks
  # the correct release/beta tag for the active OpenClaw channel.
  local installed_ok=false
  if hc_openclaw_maintenance_with_optional_config "$install_config" plugins install "clawhub:@openclaw/whatsapp" >> /tmp/openclaw-whatsapp-plugin-install.log 2>&1; then
    installed_ok=true
  elif hc_openclaw_maintenance_with_optional_config "$install_config" plugins install "@openclaw/whatsapp" >> /tmp/openclaw-whatsapp-plugin-install.log 2>&1; then
    installed_ok=true
  else
    # If an install record already exists but its payload is broken/missing,
    # OpenClaw's documented path is update/repair rather than blind reinstall.
    echo "WhatsApp plugin install did not complete; trying OpenClaw plugin update for an existing broken install..." >> /tmp/openclaw-whatsapp-plugin-install.log
    if hc_openclaw_maintenance_with_optional_config "$install_config" plugins update whatsapp >> /tmp/openclaw-whatsapp-plugin-install.log 2>&1; then
      installed_ok=true
    elif hc_openclaw_maintenance_with_optional_config "$install_config" plugins update @openclaw/whatsapp >> /tmp/openclaw-whatsapp-plugin-install.log 2>&1; then
      installed_ok=true
    fi
  fi

  if [ "$installed_ok" != "true" ]; then
    rm -f "$install_config" 2>/dev/null || true
    echo "Warning: failed to install/update @openclaw/whatsapp; see /tmp/openclaw-whatsapp-plugin-install.log. WhatsApp will stay configured but disabled for this boot so the saved channel settings are preserved." >&2
    return 1
  fi

  if whatsapp_plugin_runtime_ok; then
    if [ -f "$config" ]; then
      if [ -n "$install_config" ] && [ -f "$install_config" ]; then
        jq --slurpfile installed "$install_config" '
          .plugins.installs = ((.plugins.installs // {}) + ($installed[0].plugins.installs // {}))
          | .plugins.entries.whatsapp = (($installed[0].plugins.entries.whatsapp // {}) + (.plugins.entries.whatsapp // {}) + {"enabled": true})
          | .channels.whatsapp = (.channels.whatsapp // {"dmPolicy": "pairing"})
          | .plugins.allow = (((.plugins.allow // []) + ["whatsapp"]) | unique)
        ' "$config" > "$config.tmp" 2>/dev/null && mv "$config.tmp" "$config" || rm -f "$config.tmp"
      else
        jq '
          .plugins.entries.whatsapp.enabled = true
          | .channels.whatsapp = (.channels.whatsapp // {"dmPolicy": "pairing"})
          | .plugins.allow = (((.plugins.allow // []) + ["whatsapp"]) | unique)
        ' "$config" > "$config.tmp" 2>/dev/null && mv "$config.tmp" "$config" || rm -f "$config.tmp"
      fi
    fi
    rm -f "$install_config" 2>/dev/null || true
    echo "WhatsApp plugin runtime installed/verified."
    return 0
  fi

  rm -f "$install_config" 2>/dev/null || true
  echo "Warning: @openclaw/whatsapp install/update completed but OpenClaw still reports the runtime as unavailable; WhatsApp will stay configured but disabled for this boot so the saved channel settings are preserved." >&2
  return 1
}
repair_broken_whatsapp_plugin_entry() {
  local config="/home/node/.openclaw/openclaw.json"
  [ -f "$config" ] || return 0
  if ! jq -e '(.plugins.entries.whatsapp.enabled // false) == true' "$config" >/dev/null 2>&1; then
    return 0
  fi
  if whatsapp_plugin_runtime_ok; then
    return 0
  fi

  echo "Warning: WhatsApp plugin is enabled but its runtime files are missing/incompatible; disabling WhatsApp plugin for this boot so gateway can start." >&2
  echo "         Fix by using stable OpenClaw for WhatsApp or reinstalling the official whatsapp plugin, then re-enable WHATSAPP_ENABLED." >&2

  local patched
  patched=$(jq '
    .plugins.entries.whatsapp.enabled = false
    | .plugins.allow = ((.plugins.allow // []) | map(select(. != "whatsapp" and . != "@openclaw/whatsapp" and . != "clawhub:@openclaw/whatsapp")))
  ' "$config" 2>/dev/null) || {
    echo "Warning: could not patch broken WhatsApp plugin entry; gateway may still reject config." >&2
    return 0
  }
  write_json_atomic "$config" "$patched" || echo "Warning: could not write patched WhatsApp plugin config; gateway may still reject config." >&2
}

hc_finish_startup_commands
install_whatsapp_plugin_runtime || true
sync_installed_plugins_into_allow
repair_broken_whatsapp_plugin_entry

# ── Launch gateway ──
GATEWAY_RESTART_DELAY="${GATEWAY_RESTART_DELAY:-2}"
GATEWAY_MAX_RESTARTS="${GATEWAY_MAX_RESTARTS:-0}"
GATEWAY_RESTART_COUNT=0
SYNC_LOOP_PID=""
GUARDIAN_PID=""

sync_before_gateway_restart() {
  [ -n "${HF_TOKEN:-}" ] || return 0
  [ -f "/home/node/app/openclaw-sync.py" ] || return 0

  echo "Gateway stopped; saving latest OpenClaw state before restart..."
  # Kill the background sync loop before syncing — same reason as in
  # graceful_shutdown: the loop holds the fcntl.flock while uploading.  Wait for
  # it to exit (and force-kill as a last resort) before the one-shot syncs so
  # gateway restarts cannot hang behind a stale lock.
  stop_background_sync_loop
  # Pass 1: wait for config to settle then upload — avoids pushing a
  # half-written JSON config to the dataset.  Timeout added (was unbounded)
  # so a slow HF upload cannot stall gateway restarts indefinitely.
  run_openclaw_sync_with_timeout "${SYNC_SETTLED_TIMEOUT:-120}" sync-once-settled "${SYNC_ONE_SHOT_LOCK_TIMEOUT:-5}" || \
    echo "Warning: could not sync settled state before gateway restart"
  # Pass 2: catch any writes that arrived after the settled sync completed
  # (e.g. session state flushed by OpenClaw just before exit).
  # BUG FIX: this second pass was missing from the restart path (it existed
  # only in graceful_shutdown), so last-second writes were lost on watchdog
  # restarts — causing sessions to disappear after OpenClaw auto-restarts.
  run_openclaw_sync_with_timeout "${SYNC_FINAL_TIMEOUT:-120}" sync-once "${SYNC_ONE_SHOT_LOCK_TIMEOUT:-5}" || \
    echo "Warning: could not complete final sync before gateway restart"
}

start_background_devdata_sync() {
  if [ "$DEV_MODE_ENABLED" != "true" ]; then
    return 0
  fi
  if [ "$DEVDATA_ENABLED" != "true" ]; then
    echo "DevData  : disabled by DEVDATA=${DEVDATA_RAW}"
    return 0
  fi
  if [ -z "${HF_TOKEN:-}" ]; then
    echo "DevData  : disabled (HF_TOKEN missing)"
    return 0
  fi
  if [ "${DEVDATA_DATASET_NAME:-huggingclaw-devdata}" = "${BACKUP_DATASET_NAME:-huggingclaw-backup}" ]; then
    echo "DevData  : disabled (DEVDATA_DATASET_NAME must be separate from BACKUP_DATASET_NAME)"
    return 0
  fi
  if [ ! -f "/home/node/app/jupyter-devdata-sync.py" ]; then
    echo "DevData  : script missing; skipped"
    return 0
  fi
  # BUG FIX #1: Guard against spawning a second devdata-sync process on every
  # gateway restart. Without this check, each restart launched a fresh
  # jupyter-devdata-sync.py which called restore_once() while JupyterLab was
  # already running, corrupting its runtime state and killing it.
  if [ -n "${DEVDATA_SYNC_PID:-}" ] && kill -0 "$DEVDATA_SYNC_PID" 2>/dev/null; then
    return 0
  fi
  echo "DevData  : enabled (dataset=${DEVDATA_DATASET_NAME:-huggingclaw-devdata})"
  python3 -u /home/node/app/jupyter-devdata-sync.py >> /tmp/devdata-sync.log 2>&1 &
  DEVDATA_SYNC_PID=$!
}

start_background_sync_once() {
  [ -n "${HF_TOKEN:-}" ] || return 0

  if [ -n "$SYNC_LOOP_PID" ] && kill -0 "$SYNC_LOOP_PID" 2>/dev/null; then
    return 0
  fi

  python3 -u /home/node/app/openclaw-sync.py loop >> /tmp/workspace-sync.log 2>&1 &
  SYNC_LOOP_PID=$!
}

start_guardian_once() {
  [ "$WHATSAPP_ENABLED_NORMALIZED" = "true" ] || return 0

  if [ -n "$GUARDIAN_PID" ] && kill -0 "$GUARDIAN_PID" 2>/dev/null; then
    return 0
  fi

  node /home/node/app/wa-guardian.js &
  GUARDIAN_PID=$!
  echo "WhatsApp Guardian started (PID: $GUARDIAN_PID)"
}

# ── Clean up stale plugin-skills entries that are not generated symlinks ──
# OpenClaw generates plugin-skills entries as symlinks. If a real directory
# exists (e.g. from a previous failed install or manual placement), OpenClaw
# logs "plugin skill entry is not a generated symlink" on every poll cycle.
# Remove any non-symlink entries so they are regenerated cleanly on startup.
PLUGIN_SKILLS_DIR="/home/node/.openclaw/plugin-skills"
if [ -d "$PLUGIN_SKILLS_DIR" ]; then
  for _ps_entry in "$PLUGIN_SKILLS_DIR"/*/; do
    _ps_entry="${_ps_entry%/}"
    [ -e "$_ps_entry" ] || continue
    if [ ! -L "$_ps_entry" ]; then
      _ps_name="$(basename "$_ps_entry")"
      echo "Removing stale plugin-skills entry '$_ps_name' (not a generated symlink; will be regenerated by OpenClaw)..."
      rm -rf "$_ps_entry"
    fi
  done
  unset _ps_entry _ps_name
fi

# ── Start D-Bus session (once, before gateway loop) ──
# Chromium logs "Failed to connect to socket /run/dbus/system_bus_socket" when
# the system D-Bus is absent (HF Spaces containers).  We suppress the noise by:
#   1. Starting a private session bus (dbus-launch) so Chrome has something to
#      connect to for session-scoped calls.
#   2. Pointing DBUS_SYSTEM_BUS_ADDRESS at the same session bus so Chrome's
#      system-bus probes also succeed without a real systemd-dbus daemon.
#   3. Falling back to "disabled:" on minimal images without dbus-launch; the
#      Chrome --disable-dbus / --disable-features=UseDBus flags then silence the
#      remaining warnings that come from Chromium itself.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  if command -v dbus-daemon >/dev/null 2>&1; then
    _DBUS_SOCKET="/tmp/dbus-hc-$$.sock"
    _DBUS_PID_FILE="/tmp/dbus-hc-$$.pid"
    dbus-daemon --session \
        --address="unix:path=${_DBUS_SOCKET}" \
        --print-address=1 \
        --fork \
        --print-pid=3 \
        3>"${_DBUS_PID_FILE}" \
        >"${_DBUS_SOCKET}.addr" 2>/dev/null || true
    if [ -s "${_DBUS_SOCKET}.addr" ]; then
      export DBUS_SESSION_BUS_ADDRESS="$(cat "${_DBUS_SOCKET}.addr")"
    fi
    unset _DBUS_SOCKET _DBUS_PID_FILE
  elif command -v dbus-launch >/dev/null 2>&1; then
    eval "$(dbus-launch --sh-syntax 2>/dev/null)" || true
    export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-disabled:}"
  else
    export DBUS_SESSION_BUS_ADDRESS="disabled:"
  fi
fi
# Route system-bus probes to session bus so Chrome stops printing socket errors.
export DBUS_SYSTEM_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-disabled:}"

while true; do
  # Check health-server process - restart if died unexpectedly
  if [ -n "${HEALTH_PID:-}" ] && ! kill -0 "$HEALTH_PID" 2>/dev/null; then
    echo "Warning: health-server exited (PID $HEALTH_PID dead); restarting..."
    node /home/node/app/health-server.js &
    HEALTH_PID=$!
    echo "Health server restarted (PID: $HEALTH_PID)"
  fi

  # Check JupyterLab process - restart if died unexpectedly
  if [ "$RUNTIME_JUPYTER_ENABLED" = "true" ]; then
    if [ -n "${JUPYTER_PID:-}" ]; then
      if ! kill -0 "$JUPYTER_PID" 2>/dev/null; then
        echo "Warning: JupyterLab exited (PID $JUPYTER_PID dead); checking log..."
        tail -5 /tmp/jupyterlab.log 2>/dev/null || echo "No log file"
        echo "Attempting JupyterLab restart..."
        unset JUPYTER_PID
        start_jupyter_once
      fi
    else
      # First start
      start_jupyter_once
    fi
  fi

  if [ "${AUTO_DOCTOR:-false}" = "true" ]; then
    openclaw doctor --fix || true
  fi
  echo "Launching OpenClaw gateway on port ${GATEWAY_PORT}..."

  GATEWAY_ARGS=(gateway run --port "${GATEWAY_PORT}" --bind lan)
  if [ "${GATEWAY_VERBOSE:-0}" = "1" ]; then
    GATEWAY_ARGS+=(--verbose)
    echo "Gateway verbose logging enabled (GATEWAY_VERBOSE=1)"
  fi

  # Use stdbuf -oL -eL to ensure logs are not buffered and appear immediately
  # in the console. NOTE: $! captures the LAST pipeline element (tee), not
  # openclaw — fine for passing to `wait` (waits for the whole pipeline to
  # finish), but kill -0 on it is uninformative. We probe TCP instead.
  stdbuf -oL -eL openclaw "${GATEWAY_ARGS[@]}" 2>&1 | tee -a /home/node/.openclaw/gateway.log &
  GATEWAY_PID=$!

  # Poll for the gateway to start listening on ${GATEWAY_PORT}. OpenClaw can take 20-30s
  # on cold start (plugin install + auto-restore). On HF Spaces the bootstrap-context
  # stage alone can exceed 300 s on a cold start, so default to 300 s there and
  # 90 s elsewhere. Bail out early if the pipeline died.
  if [ -n "${SPACE_HOST:-}" ]; then
    GATEWAY_READY_TIMEOUT="${GATEWAY_READY_TIMEOUT:-300}"
  else
    GATEWAY_READY_TIMEOUT="${GATEWAY_READY_TIMEOUT:-90}"
  fi
  ready=false
  for ((i=0; i<GATEWAY_READY_TIMEOUT; i++)); do
    if (echo > /dev/tcp/127.0.0.1/${GATEWAY_PORT}) 2>/dev/null; then
      ready=true
      break
    fi
    if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if [ "$ready" != "true" ]; then
    echo ""
    echo "Gateway failed to start. Last 30 lines of log:"
    echo "────────────────────────────────────────────"
    tail -30 /home/node/.openclaw/gateway.log
    if [ "$DEV_MODE_ENABLED" = "true" ]; then
      echo "Gateway failed — DEV_MODE active, retrying in 10s..."
      sleep 10
      continue
    else
      echo "Gateway failed — exiting."
      exit 1
    fi
  fi

  # 11. Start WhatsApp Guardian after the gateway is accepting connections
  start_guardian_once

  # 11.5 Warm up the managed browser so first browser actions have a live tab
  warmup_browser

  # 12. Start Workspace Sync after startup settles. Keep only one loop active;
  # config edits can make OpenClaw exit/reload, and the gateway loop below will
  # relaunch it without rerunning all startup code.
  start_background_sync_once
  start_background_devdata_sync

  set +e
  wait "$GATEWAY_PID"
  GATEWAY_EXIT_CODE=$?
  set -e

  sync_before_gateway_restart

  GATEWAY_RESTART_COUNT=$((GATEWAY_RESTART_COUNT + 1))
  if [ "$GATEWAY_MAX_RESTARTS" != "0" ] && [ "$GATEWAY_RESTART_COUNT" -ge "$GATEWAY_MAX_RESTARTS" ]; then
    echo "Gateway exited with code ${GATEWAY_EXIT_CODE}; restart limit (${GATEWAY_MAX_RESTARTS}) reached."
    echo "Gateway stopped — JupyterLab and env-builder still running."
    break
  fi

  echo "Gateway exited with code ${GATEWAY_EXIT_CODE}; restarting in ${GATEWAY_RESTART_DELAY}s..."
  sleep "$GATEWAY_RESTART_DELAY"
done
