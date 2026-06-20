---
title: HuggingClaw
emoji: 🦞
colorFrom: red
colorTo: blue
sdk: docker
app_port: 7861
pinned: false
license: mit
tags:
  - openclaw
  - jupyterlab
  - terminal
  - llm-gateway
secrets:
  - name: LLM_API_KEY
    description: "Your LLM provider API key (e.g. Anthropic, OpenAI, Google, OpenRouter)."
  - name: LLM_MODEL
    description: "Model ID to use, e.g. google/gemini-2.5-flash or openai/gpt-5.4."
  - name: GATEWAY_TOKEN
    description: "Strong token to secure your OpenClaw Control UI (generate: openssl rand -hex 32)."
  - name: JUPYTER_TOKEN
    description: "Optional token for the JupyterLab terminal at /terminal/. Defaults to GATEWAY_TOKEN when set — no extra secret needed."
  - name: CLOUDFLARE_WORKERS_TOKEN
    description: "Cloudflare API token — auto-creates a Worker proxy and KeepAlive monitor."
  - name: TELEGRAM_ALLOWED_USERS
    description: "Comma-separated Telegram user IDs for access"
  - name: TELEGRAM_BOT_TOKEN
    description: "Telegram bot token from BotFather"
  - name: HF_TOKEN
    description: "HuggingFace token with Write access — enables automatic workspace backup."
  - name: WHATSAPP_ENABLED
    description: "Set to 'true' to enable WhatsApp pairing support."
---

<!-- Badges -->
[![GitHub Stars](https://img.shields.io/github/stars/somratpro/huggingclaw?style=flat-square)](https://github.com/somratpro/huggingclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![HF Space](https://img.shields.io/badge/🤗%20HuggingFace-Space-blue?style=flat-square)](https://huggingface.co/spaces)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Gateway-red?style=flat-square)](https://github.com/openclaw/openclaw)

**Your always-on AI assistant — free, no server needed.** This merged Space runs [OpenClaw](https://openclaw.ai) plus a Hugging Face-style JupyterLab terminal on one HF Spaces port, giving you a 24/7 AI chat assistant on Telegram and WhatsApp. It works with *any* large language model (LLM) – Claude, ChatGPT, Gemini, etc. – and even supports custom models via [OpenRouter](https://openrouter.ai). Deploy in minutes on the free HF Spaces tier (2 vCPU, 16GB RAM, 50GB) with automatic workspace backup to a HuggingFace Dataset so your chat history and settings persist across restarts.

## Table of Contents

- [✨ Features](#-features)
- [🎥 Video Tutorial](#-video-tutorial)
- [🚀 Quick Start](#-quick-start)
- [📱 Telegram Setup *(Optional)*](#-telegram-setup-optional)
- [🌐 Cloudflare Proxy *(Optional)*](#-cloudflare-proxy-optional)
- [💬 WhatsApp Setup *(Optional)*](#-whatsapp-setup-optional)
- [💾 Workspace Backup *(Optional)*](#-workspace-backup-optional)
- [🔔 Webhooks *(Optional)*](#-webhooks-optional)
- [🔐 Security & Advanced *(Optional)*](#-security--advanced-optional)
- [🔑 API Key Rotation *(Optional)*](#-api-key-rotation-optional)
- [🤖 LLM Providers](#-llm-providers)
- [💻 Local Development](#-local-development)
- [🔗 CLI Access](#-cli-access)
- [💻 JupyterLab Terminal](#-jupyterlab-terminal)
- [🏗️ Architecture](#-architecture)
- [💓 Staying Alive](#-staying-alive)
- [🐛 Troubleshooting](#-troubleshooting)
- [📚 Links](#-links)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## ✨ Features

- 🔌 **Any LLM:** Use Claude, OpenAI GPT, Google Gemini, Grok, DeepSeek, Qwen, and 40+ providers (set `LLM_API_KEY` and `LLM_MODEL` accordingly).
- 🔑 **Multi-Key Rotation:** Supply comma-separated key pools per provider (e.g. `ANTHROPIC_API_KEYS=key1,key2,key3`) for automatic round-robin rotation across rate limits.
- ⚡ **Zero Config:** Duplicate this Space and set **just three** secrets (LLM_API_KEY, LLM_MODEL, GATEWAY_TOKEN) – no other setup needed.
- 🐳 **Fast Builds:** Uses a pre-built OpenClaw Docker image to deploy in minutes.
- 🌐 **Cloudflare Outbound Proxy:** HuggingClaw can automatically provision a Cloudflare Worker proxy for blocked outbound traffic such as Telegram API requests.
- 💾 **Workspace Backup:** Chats, settings, and WhatsApp session state sync to a private HF Dataset via the `huggingface_hub`, preserving data automatically without storing your HF token in a git remote.
- ⏰ **Easy Keep-Alive:** Uses `CLOUDFLARE_WORKERS_TOKEN` to automatically set up a cron-triggered keep-awake worker at boot.
- 👥 **Multi-User Messaging:** Support for Telegram (multi-user) and WhatsApp (pairing).
- 📊 **Visual Dashboard:** Beautiful Web UI to monitor uptime, sync status, and active models.
- 🔔 **Webhooks:** Get notified on restarts or backup failures via standard webhooks.
- 🔐 **Flexible Auth:** Secure the Control UI with either a gateway token or password.
- 💻 **Terminal Out of the Box:** JupyterLab is available at `/terminal/` automatically when `GATEWAY_TOKEN` is set — no extra config needed. `GATEWAY_TOKEN` is reused as the terminal auth token. Set `DEV_MODE=false` explicitly to opt out.
- 🏠 **100% HF-Native:** Runs entirely on HuggingFace’s free infrastructure (2 vCPU, 16GB RAM).

## 🎥 Video Tutorial

Watch a quick walkthrough on YouTube: [Deploying HuggingClaw on HF Spaces](https://www.youtube.com/watch?v=S6pl7NmjX7g&t=73s).

## 🚀 Quick Start

### Step 1: Duplicate this Space

[![Duplicate this Space](https://huggingface.co/datasets/huggingface/badges/resolve/main/duplicate-this-space-xl.svg)](https://huggingface.co/spaces/somratpro/HuggingClaw?duplicate=true)

Click the button above to duplicate the template.

### Step 2: Add Your Secrets

Navigate to your new Space's **Settings**, scroll down to the **Variables and secrets** section, and add the following three under **Secrets**:

- `LLM_API_KEY` – Your provider API key (e.g., Anthropic, OpenAI, OpenRouter).
- `LLM_MODEL` – The model ID string you wish to use (e.g., `openai/gpt-5.4` or `google/gemini-2.5-flash`).
- `GATEWAY_TOKEN` – A custom password or token to secure your Control UI. *(You can use any strong password, or generate one with `openssl rand -hex 32` if you prefer).*

> [!TIP]
> HuggingClaw is completely flexible! You only need these three secrets to get started. You can set other secrets later.

#### 🔄 Optional: Fallback Models

Set `LLM_FALLBACK_MODELS` as a comma-separated list of backup model IDs. If your primary model fails (rate limit, outage, auth error), OpenClaw automatically tries each fallback in order:

```
LLM_FALLBACK_MODELS=anthropic/claude-sonnet-4-6,openai/gpt-5.4,google/gemini-3.5-flash
```

Each fallback provider needs its own API key set as a separate secret (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`). See [API Key Rotation](#-api-key-rotation-optional) for provider key naming.

**Terminal auto-enables when `GATEWAY_TOKEN` is set** — no extra secrets needed. `GATEWAY_TOKEN` is reused as `JUPYTER_TOKEN`, so the terminal is protected by the same credential as the Control UI. To set a different token, add `JUPYTER_TOKEN` as a Secret. To disable the terminal entirely, set `DEV_MODE=false` as a Variable.

If you want to pin a specific OpenClaw release instead of `latest`, add `OPENCLAW_VERSION` under **Variables** in your Space settings. For Docker Spaces, HF passes Variables as build args during image build, so these should be Variables, not Secrets (except tokens).

### Step 3: Deploy & Run

That's it! The Space will build the container and start up automatically. You can monitor the build process in the **Logs** tab.

### Step 4: Monitor & Manage

HuggingClaw features a built-in dashboard to track:

- **Uptime:** Real-time uptime monitoring.
- **Sync Status:** Visual indicators for workspace backup operations.
- **Chat Status:** Real-time connection status for WhatsApp and Telegram.
- **Model Info:** See which LLM and provider are currently powering your assistant.

## 📱 Telegram Setup *(Optional)*

To chat via Telegram:

1. Create a bot via [@BotFather](https://t.me/BotFather): send `/newbot`, follow prompts, and copy the bot token.
2. Find your Telegram user ID with [@userinfobot](https://t.me/userinfobot).
3. Add `CLOUDFLARE_WORKERS_TOKEN` in Space secrets to let HuggingClaw auto-provision the outbound proxy, or set `CLOUDFLARE_PROXY_URL` manually if you already have a Worker.
4. Add these secrets in Settings → Secrets. After restarting, the bot should appear online on Telegram.

| Variable | Default | Description |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token from BotFather |
| `TELEGRAM_ALLOWED_USERS` | — | Comma-separated Telegram user IDs for access |
| `TELEGRAM_WEBHOOK_URL` | *(auto-provisioned)* | Override webhook URL; set `TELEGRAM_MODE=polling` to use long-polling instead |

## 🌐 Cloudflare Proxy Setup

Hugging Face Free Tier often restricts outbound connections to services like Telegram, Discord, and WhatsApp. HuggingClaw solves this with a **Transparent Outbound Proxy** via Cloudflare Workers.

### ⚡ Automatic Setup (Recommended)

This is the easiest way. HuggingClaw will handle the deployment for you.

1. Create a **Cloudflare API Token**:
   - Go to [API Tokens](https://dash.cloudflare.com/profile/api-tokens).
   - Create Token -> **Edit Cloudflare Workers** template.
   - Ensure it has `Account: Workers Scripts: Edit` permissions.
2. Add the token as a secret named `CLOUDFLARE_WORKERS_TOKEN` in your Space Settings.

**What happens next?**

- HuggingClaw automatically creates a Worker named after your Space host.
- It generates a secure, private `CLOUDFLARE_PROXY_SECRET`.
- All restricted outbound traffic is automatically routed through this Worker.

## 💬 WhatsApp Setup *(Optional)*

To use WhatsApp, enable the channel and scan the QR code from the Control UI (**Channels** → **WhatsApp** → **Login**):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `WHATSAPP_ENABLED` | `false` | Enable WhatsApp pairing support |

When `WHATSAPP_ENABLED=true`, startup verifies the official OpenClaw WhatsApp runtime before launching the gateway. It uses OpenClaw's documented install path (`openclaw plugins install clawhub:@openclaw/whatsapp`, with npm/alias fallbacks) and preserves the saved WhatsApp channel/plugin settings instead of removing them when a download needs to be retried.

## 💾 Workspace Backup *(Optional)*

HuggingClaw automatically syncs your workspace (chats, settings, sessions) to a private HF Dataset named `huggingclaw-backup`.

- **Persistence:** Survived restarts and restores your state on boot.
- **WhatsApp:** Stores session credentials so you don't have to scan the QR code every time.
- **Interval:** Syncs every 3 minutes by default.

| Variable | Default | Description |
| :--- | :--- | :--- |
| `HF_TOKEN` | — | HF token with **Write** access |
| `SYNC_INTERVAL` | `180` | Full backup frequency in seconds |
| `OPENCLAW_CONFIG_WATCH_INTERVAL` | `1` | How often to check `openclaw.json` for immediate settings sync |
| `OPENCLAW_CONFIG_SETTLE_SECONDS` | `3` | How long `openclaw.json` must stay valid and unchanged before syncing |
| `SESSIONS_MIN_SYNC_GAP` | `30` | Minimum seconds between session-triggered immediate syncs |
| `SYNC_LOCK_TIMEOUT` | `20` | Max seconds one-off syncs wait for another sync lock before failing clearly |
| `SYNC_UPLOAD_TIMEOUT` | `180` | Max seconds one HF upload call can stay active before failing and retrying next pass; set `0` to disable |
| `SYNC_UPLOAD_STRATEGY` | `folder` | Upload method: `folder` for normal commit uploads, `large_folder` for HF resumable large-folder uploader |
| `SYNC_SETTLED_TIMEOUT` | `120` | Shutdown/restart settled-sync upload budget; set `0` to disable the outer timeout |
| `SYNC_FINAL_TIMEOUT` | `120` | Shutdown/restart final catch-up sync upload budget; set `0` to disable the outer timeout |
| `SYNC_ONE_SHOT_LOCK_TIMEOUT` | `5` | Short lock wait for shutdown/restart one-shot syncs after the background loop is stopped |

## 📦 Ephemeral Package Re-install *(Optional)*

Yes — you can use extra packages after a Space restart without storing package files. The easiest option is to remember **one variable**:

| Variable | What to put in it |
| :--- | :--- |
| `HUGGINGCLAW_RUN` | Any bash commands you want to run on every startup |

Example:

```bash
HUGGINGCLAW_RUN="""
set -e
# In HUGGINGCLAW_RUN use normal startup commands. For apt packages,
# HUGGINGCLAW_APT_PACKAGES=ffmpeg is preferred; sudo also works here.
sudo apt-get update
sudo apt-get install -y ffmpeg
python3 -m pip install --user pandas requests
npm install -g typescript
"""
```

For very quote-heavy or strange scripts, put a base64 script in the same variable:

```bash
# locally
base64 -w0 setup.sh

# HF Variable
HUGGINGCLAW_RUN=base64:<paste-output-here>
```

How it works:

1. `HUGGINGCLAW_RUN` is run as a full bash script on every boot before the OpenClaw gateway launches, so multi-line commands, `if`, loops, functions, and heredocs work. Long installs will delay gateway startup.
2. Startup scripts run in a clean non-login shell and do **not** load the interactive HuggingClaw shell wrappers, so commands in `HUGGINGCLAW_RUN`/`workspace/startup.sh` execute exactly as written.
3. For repeatable package installs, prefer the dedicated `HUGGINGCLAW_APT_PACKAGES`, `HUGGINGCLAW_PIP_PACKAGES`, `HUGGINGCLAW_NPM_PACKAGES`, and `HUGGINGCLAW_OPENCLAW_PLUGINS` variables; OpenClaw plugins installed this way are synced into `plugins.allow` before the gateway launches.
4. If you install from the OpenClaw shell manually, HuggingClaw records only successful install commands in `/home/node/.openclaw/workspace/startup.sh` for replay. Failed or dummy commands are not saved by the wrapper.
5. Package files are not persisted; commands are replayed to reconstruct them after restart.

Errors are always printed as `ERROR:` lines in Space logs. By default HuggingClaw logs the error and continues booting; set `HUGGINGCLAW_STARTUP_STRICT=true` if the Space should fail fast when any startup install command fails.

Advanced/backward-compatible variables still work if you prefer package-specific fields: `HUGGINGCLAW_APT_PACKAGES`, `HUGGINGCLAW_PIP_PACKAGES`, `HUGGINGCLAW_NPM_PACKAGES`, `HUGGINGCLAW_OPENCLAW_PLUGINS`, `HUGGINGCLAW_STARTUP_COMMANDS`, `HUGGINGCLAW_STARTUP_COMMAND_1`...`100`, `HUGGINGCLAW_STARTUP_SCRIPT`, and `HUGGINGCLAW_STARTUP_SCRIPT_B64`.


> [!IMPORTANT]
> Terminal shells are admin-convenient but not unrestricted root shells. You normally do **not** need to type `sudo` for package installs in the Jupyter/OpenClaw terminal: `apt install ...` and `apt-get install ...` are wrapped to use the image's passwordless package-manager sudo internally, while `pip`, `python -m pip`, `npm`, and related user-space tools install into HuggingClaw's writable runtime prefix. Direct `sudo` remains limited to `apt`, `apt-get`, and `dpkg`; common user-space commands such as `sudo unzip`, `sudo tar`, `sudo curl`, and `sudo pip` are passed through without escalation for convenience. Apt-installed packages still disappear on Space restart, so put them in `HUGGINGCLAW_APT_PACKAGES`/`HUGGINGCLAW_RUN` or let the shell wrapper record the command in `startup.sh`.

If you really need an unrestricted root-capable Jupyter terminal for a private Space, you have two options:

- **Build arg (always-on):** rebuild the image with `--build-arg HUGGINGCLAW_FULL_SUDO=true`. Every container boot from that image has full root sudo.
- **Runtime env var (per-Space toggle, requires one rebuild first):** set `HUGGINGCLAW_FULL_SUDO=true` as a Space Variable / in the env builder. The image includes a locked-down root-owned helper (`/usr/local/bin/hc-apply-full-sudo`) that the default sudoers rule lets the `node` user invoke without a password; at boot, `start.sh` runs that helper to flip the sudoers file to `node ALL=(root) NOPASSWD: ALL` for this container only. You need to rebuild the image **once** after upgrading so the helper exists; after that, the env var works on any Space without rebuilding again. (Old images without the helper keep working and print a warning telling you to rebuild.)

Both options change the Docker sudoers file so anyone who can access the Jupyter token can become root inside the container. Keep this disabled on public/shared Spaces.

## 💓 Staying Alive *(Recommended on Free HF Spaces)*

Your Space will automatically be kept awake by a background Cloudflare Worker when you configure the `CLOUDFLARE_WORKERS_TOKEN` secret. The worker uses a cron trigger to regularly ping your Space's `/health` endpoint. The dashboard displays the current keep-alive worker status.

## 🔔 Webhooks *(Optional)*

Get notified when your Space restarts or if a backup fails:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `WEBHOOK_URL` | — | Endpoint URL for POST JSON notifications |

## 🔐 Security & Advanced *(Optional)*

Configure password access and network restrictions:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OPENCLAW_PASSWORD` | — | Enable simple password auth instead of token (applies only when `GATEWAY_TOKEN` is empty) |
| `TRUSTED_PROXIES` | — | Comma-separated IPs of HF proxies |
| `ALLOWED_ORIGINS` | — | Comma-separated allowed origins for Control UI |
| `CLOUDFLARE_KEEPALIVE_ENABLED` | `true` | Set to `false` to disable the automatic Cloudflare KeepAlive worker |

## 🔑 API Key Rotation *(Optional)*

Spread requests across multiple API keys to avoid rate limits. Supply a comma-separated pool for any provider. Gemini uses sticky-per-model key selection by default, so each model starts on the first healthy key and reuses it until it fails or hits quota; other providers keep the normal round-robin behavior.

```bash
# Single provider, multiple keys
ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2,sk-ant-key3

# Multiple providers simultaneously
OPENAI_API_KEYS=sk-openai-key1,sk-openai-key2
GEMINI_API_KEYS=AIza-key1,AIza-key2
```

**Fallback chain** (per provider):
1. `{PROVIDER}_API_KEYS` — comma-separated pool *(preferred)*
2. `{PROVIDER}_API_KEY` — single dedicated key
3. `LLM_API_KEY` — universal fallback *(enabled by default; disable with `LLM_API_KEY_FALLBACK_ENABLED=false`)*

> [!TIP]
> By default, `LLM_API_KEY` fallback is enabled for compatibility. Set `LLM_API_KEY_FALLBACK_ENABLED=false` if you want strict provider-only activation.

Failure handling behavior:
- Retryable failures (rate-limit/quota + common transient upstream/network errors) penalize the current key with cooldown/strikes, so the **next request** avoids that key when possible.
- The rotator **does not auto-replay the same failed request**; retries for the same request should be handled by caller/application logic.

Optional tuning:
- `KEY_BLACKLIST_COOLDOWN_MS` (default `60000`) — base cooldown after a retryable failure.
- `KEY_BLACKLIST_JITTER_PCT` (default `15`) — adds ±jitter to cooldown to prevent herd re-entry.
- `KEY_MAX_STRIKES` (default `3`) — after this many consecutive failures, key enters long suspend.
- `KEY_PERM_SUSPEND_MS` (default `57600000`) — long suspend duration for exhausted/auth-invalid keys (**capped at 16h max**).
- `KEY_FAILURE_DECAY_MS` (default `900000`) — recent-failure decay window used to deprioritize keys.
- `KEY_MAX_INFLIGHT_PER_KEY` (default `3`) — soft concurrent request cap per key.
- `OPENCLAW_PROVIDER_TIMEOUT_SECONDS` (default `300`, set `0` to disable) — injects provider-level `timeoutSeconds` into generated OpenClaw model providers so slow preview/thinking models are not aborted at the default ~120s idle window before the first reply chunk.
- `KEY_INFLIGHT_TTL_MS` (default `30000`) — safety lease for picked keys with no provider headers/completion/error; stale leases are cleaned up without marking the key failed, so long streams/tasks do not rotate away just because bookkeeping timed out.
- `KEY_TASK_AFFINITY_MS` (default `30000`) — short same-task affinity window for sequential non-sticky provider calls; sticky providers keep their stronger until-failure pin.
- `KEY_TASK_AFFINITY_MAX_REUSES` (default `3`) — max extra same-key reuses per non-sticky affinity burst before normal round-robin resumes.
- `KEY_MODEL_SNIFF_MAX_BYTES` (default `262144`) — max request-body bytes to inspect for model names on streaming OpenAI-compatible Gemini calls.
- `KEY_ERROR_BODY_SNIFF_MAX_BYTES` (default `65536`) — max error-response bytes to inspect so provider quota/rate bodies such as 403 quota errors are scoped correctly instead of being treated as permanent auth failures.
- `KEY_STICKY_UNTIL_FAILURE` (default `true`) — keep sticky providers on one key until that key fails/exhausts.
- `KEY_STICKY_PROVIDERS` (default `gemini`) — comma-separated provider names that should use sticky key selection instead of per-request round-robin.
- `KEY_STICKY_SCOPE` (default `auto`) — `auto` uses per-model sticky buckets for Gemini/per-model providers and provider-level buckets for others; set `provider` or `model` to override.
- `KEY_FETCH_MAX_RETRIES` (default `0`) — optional auto-retry count for retryable failures on **GET/HEAD/OPTIONS/POST** with a different key. Default `0` means the rotator does **not** spend extra upstream attempts for a single caller request.
- `KEY_FETCH_RETRY_BASE_DELAY_MS` (default `250`) — base delay for retry backoff (respects `Retry-After`, capped to 10s).
- `KEY_ROTATOR_ASSERT_NO_EXTRA_CALLS=true` — optional diagnostic warning if a single caller fetch creates more than one upstream provider attempt.
- `KEY_ROTATOR_EMIT_SYNTHETIC_EVENTS=true` — optional local-only dashboard probe; with `SYNTHETIC_API_KEYS` configured, emits synthetic rotator events without sending an upstream provider request.
- `KEY_ROTATOR_DIAGNOSTICS=true` — emit periodic provider/key health snapshots.
- `KEY_ROTATOR_DIAGNOSTICS_INTERVAL_MS` (default `60000`) — diagnostics interval.
- `KEY_ROTATOR_LOG_LEVEL` (`info`/`debug`/`silent`, default `info`) — controls rotator log verbosity.
- `KEY_ROTATOR_VERBOSE_PICKS` (`true`/`false`, default `false`) — enable per-request key-pick logs (best with `KEY_ROTATOR_LOG_LEVEL=debug`).

Supported per-provider variables include `ANTHROPIC_API_KEYS`, `OPENAI_API_KEYS`, `GEMINI_API_KEYS`, `DEEPSEEK_API_KEYS`, `GROQ_API_KEYS`, `MISTRAL_API_KEYS`, `OPENROUTER_API_KEYS`, `XAI_API_KEYS`, `NVIDIA_API_KEYS`, `COHERE_API_KEYS`, `TOGETHER_API_KEYS`, `CEREBRAS_API_KEYS`, `HUGGINGFACE_HUB_TOKENS`, `COPILOT_GITHUB_TOKENS`, `AI_GATEWAY_API_KEYS`, and more. Common aliases such as `GOOGLE_API_KEYS`, `DASHSCOPE_API_KEYS`, `ZHIPU_API_KEYS`, `VOLCENGINE_API_KEYS`, and `GITHUB_COPILOT_TOKENS` are normalized automatically; see `.env.example` for the full list.

## 🤖 LLM Providers

HuggingClaw supports **all providers** from OpenClaw. Set `LLM_MODEL=<provider/model>` and the provider is auto-detected.

<details>
<summary><b>Click to see supported providers and examples</b></summary>

| Provider | Prefix | Example Model |
| :--- | :--- | :--- |
| **Anthropic** | `anthropic/` | `anthropic/claude-3-5-sonnet-latest` |
| **OpenAI** | `openai/` | `openai/gpt-5.4` |
| **Google** | `google/` | `google/gemini-2.0-flash` |
| **DeepSeek** | `deepseek/` | `deepseek/deepseek-chat` |
| **xAI (Grok)** | `xai/` | `xai/grok-2-latest` |
| **Mistral** | `mistral/` | `mistral/mistral-large-latest` |
| **HuggingFace** | `huggingface/` | `huggingface/deepseek-ai/DeepSeek-R1` |
| **OpenRouter** | `openrouter/` | `openrouter/anthropic/claude-3.5-sonnet` |

*And many more: Cohere, Groq, NVIDIA, Mistral, Moonshot, etc.*
</details>

### 🔄 Model Fallbacks

Set `LLM_FALLBACK_MODELS` to a comma-separated list of backup models. OpenClaw tries them in order if the primary fails (rate-limit, auth error, or provider outage):

```bash
LLM_MODEL=google/gemini-2.5-flash
LLM_FALLBACK_MODELS=anthropic/claude-sonnet-4-6,openai/gpt-5.4

# Each fallback provider needs its own key:
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

This maps to OpenClaw's `agents.defaults.model` object format at runtime:
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "google/gemini-2.5-flash",
        "fallbacks": ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4"]
      }
    }
  }
}
```

> [!TIP]
> A great starter setup: fast model as primary (e.g. `google/gemini-2.5-flash`), strong model as first fallback (e.g. `anthropic/claude-sonnet-4-6`), and a free-tier model last (e.g. `openrouter/auto`) for maximum resilience.

### Any Other Provider

You can also use any custom provider:

```bash
LLM_API_KEY=your_api_key
LLM_MODEL=provider/model-name
```

The provider prefix in `LLM_MODEL` tells HuggingClaw how to call it. See [OpenClaw Model Providers](https://docs.openclaw.ai/concepts/model-providers) for the full list.

### Custom OpenAI-Compatible Provider

Register a custom endpoint at startup without modifying the CLI.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CUSTOM_PROVIDER_NAME` | Unique provider prefix (e.g., `modal`) | **Required** |
| `CUSTOM_BASE_URL` | API base URL (e.g., `https://.../v1`) | **Required** |
| `CUSTOM_MODEL_ID` | Model ID on the server | **Required** |
| `LLM_MODEL` | Must match `{CUSTOM_PROVIDER_NAME}/{CUSTOM_MODEL_ID}` | **Required** |
| `CUSTOM_API_KEY` | Provider-specific key | `LLM_API_KEY` |
| `CUSTOM_CONTEXT_WINDOW` | Context limit | `128000` |

> [!TIP]
> `CUSTOM_PROVIDER_NAME` cannot override built-in providers (openai, anthropic, etc.).

**Example (Modal):**

```bash
CUSTOM_PROVIDER_NAME=modal
CUSTOM_BASE_URL=https://api.us-west-2.modal.direct/v1
CUSTOM_MODEL_ID=zai-org/GLM-5.1-FP8
LLM_MODEL=modal/zai-org/GLM-5.1-FP8
```

## 💻 Local Development

```bash
git clone https://github.com/somratpro/huggingclaw.git
cd huggingclaw
cp .env.example .env
# Edit .env with your secret values
```

**With Docker:**

```bash
docker build --build-arg OPENCLAW_VERSION=latest -t huggingclaw .
docker run -p 7861:7861 --env-file .env huggingclaw
```

**Without Docker:**

```bash
npm install -g openclaw@latest
export $(cat .env | xargs)
bash start.sh
```

## 🔗 CLI Access

After deploying, you can connect via the OpenClaw CLI (e.g., to onboard channels or run agents):

```bash
npm install -g openclaw@latest
openclaw channels login --gateway https://YOUR_SPACE_NAME.hf.space
# When prompted, enter your GATEWAY_TOKEN
```

## 💻 JupyterLab Terminal

The merged Space includes the Hugging Face JupyterLab template behavior inside the same container:

| Path | Service | Internal Port | Notes |
| :--- | :--- | :--- | :--- |
| `/` | HuggingClaw dashboard | `7861` | Public HF Spaces entrypoint |
| `/app/` | OpenClaw Control UI | `7860` | Mounted behind the local reverse proxy |
| `/terminal/` | JupyterLab terminal | `8888` | Auto-enabled when `GATEWAY_TOKEN` is set; uses `GATEWAY_TOKEN` as auth token unless `JUPYTER_TOKEN` is set separately. Set `DEV_MODE=false` to disable. |

When enabled, the terminal notebook root defaults to `/home/node` (stable + writable by default). To browse a broader tree, set `JUPYTER_ROOT_DIR=/home`. Handy shortcuts are also created: `HuggingClaw`, `HuggingClaw-Workspace`, and `OpenClaw-Home`.

> [!IMPORTANT]
> No extra secret needed — `GATEWAY_TOKEN` is automatically reused as `JUPYTER_TOKEN`. Set a separate `JUPYTER_TOKEN` secret only if you want a different terminal credential.

## 🏗️ Architecture

HuggingClaw uses a multi-layered approach to ensure stability and persistence on Hugging Face's ephemeral infrastructure.

<details>
<summary><b>Click to view technical details</b></summary>

- **Dashboard (`/`)**: Management, monitoring, and keep-alive tools. Terminal button appears when DEV mode is enabled (default when `GATEWAY_TOKEN` is set).
- **Control UI (`/app/`)**: Secure interface for managing agents and channels, proxied to the OpenClaw gateway on internal port `7860`.
- **JupyterLab Terminal (`/terminal/`)**: Browser terminal/notebook server on internal port `8888` (auto-enabled when `GATEWAY_TOKEN` is set; set `DEV_MODE=false` to disable).
- **Health Check (`/health`)**: Endpoint for uptime monitoring and readiness probes.
- **Sync Engine**: Python background process managing HF Dataset persistence.
- **Transparent Proxy**: Interceptor for requests to blocked domains (Telegram, etc.).

**Startup sequence:**

1. Validate required secrets and check HF token.
2. Resolve backup namespace and restore workspace from HF Dataset.
3. Generate `openclaw.json` configuration.
4. Launch background tasks (auto-sync, channel helpers).
5. Start the local dashboard/reverse proxy and OpenClaw gateway (JupyterLab starts automatically when `GATEWAY_TOKEN` is set; set `DEV_MODE=false` to opt out).

</details>

## 🐛 Troubleshooting

- **Private Space 404:** If your Space is private, raw `https://<space>.hf.space/app/` or `/terminal/` links can show Hugging Face's own 404 page when opened outside the embedded App session. Open the Space's **App** tab first, then use the in-page dashboard buttons for `/app/` and `/terminal/`.
- **Terminal 404 or redirect loop:** Open `/terminal/` with the trailing slash from the dashboard/App tab, rebuild after Dockerfile changes, and confirm `JUPYTER_TOKEN` is set correctly if you changed the default.
- **Control UI 404:** Open `/app/` with the trailing slash from the dashboard/App tab; the reverse proxy rewrites backend redirects into this mount path.
- **Missing secrets:** Ensure `LLM_API_KEY`, `LLM_MODEL`, and `GATEWAY_TOKEN` are set in your Space **Settings → Secrets**.
- **Telegram bot issues:** Verify your `TELEGRAM_BOT_TOKEN`. Check Space logs for lines like `📱 Enabling Telegram`.
- **Backup restore failing:** Make sure `HF_TOKEN` is valid and has write access to your HF account dataset. Set `HF_USERNAME` only if auto-detection is not available in your environment.
- **Space keeps sleeping:** Add `CLOUDFLARE_WORKERS_TOKEN` as a Space secret to enable automatic keep-awake monitoring via Cloudflare Workers.
- **Auth errors / proxy:** If you see reverse-proxy auth errors, add the logged IPs under `TRUSTED_PROXIES` (from logs `remote=x.x.x.x`).
- **Control UI says too many failed authentication attempts:** Wait for the retry window to expire, then open the Space in an incognito window or clear site storage for your Space before logging in again with `GATEWAY_TOKEN`.
- **WhatsApp lost its session after restart:** Make sure `HF_TOKEN` is configured so the hidden session backup can be restored on boot.
- **UI blocked (CORS):** Set `ALLOWED_ORIGINS=https://your-space-name.hf.space`.
- **Version mismatches:** Pin a specific OpenClaw build with the `OPENCLAW_VERSION` Variable in HF Spaces, or `--build-arg OPENCLAW_VERSION=...` locally.

## 🌟 More Projects

Similar projects by [@somratpro](https://github.com/somratpro) — all free, one-click deploy on HF Spaces:

| Project | What it runs | HF Space | GitHub |
| :--- | :--- | :--- | :--- |
| **HuggingFlow** | DeerFlow — deep research agent | [Space](https://huggingface.co/spaces/somratpro/HuggingFlow) | [Repo](https://github.com/somratpro/HuggingFlow) |
| **HuggingMes** | Hermes — Self-hosted agent gateway | [Space](https://huggingface.co/spaces/somratpro/HuggingMes) | [Repo](https://github.com/somratpro/huggingmes) |
| **Hugging8n** | n8n — workflow & automation platform | [Space](https://huggingface.co/spaces/somratpro/Hugging8n) | [Repo](https://github.com/somratpro/hugging8n) |
| **HuggingClip** | Paperclip — AI agent orchestration platform | [Space](https://huggingface.co/spaces/somratpro/HuggingClip) | [Repo](https://github.com/somratpro/huggingclip) |
| **HuggingPost** | Postiz — social media scheduler | [Space](https://huggingface.co/spaces/somratpro/HuggingPost) | [Repo](https://github.com/somratpro/HuggingPost) |

## 📚 Links

- [OpenClaw Docs](https://docs.openclaw.ai)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [HuggingFace Spaces Docs](https://huggingface.co/docs/hub/spaces)

## ❤️ Support

If HuggingClaw saves you time, consider buying me a coffee to keep the projects alive!

**USDT (TRC-20 / TRON network only)**

```
TELx8TJz1W1h7n6SgpgGNNGZXpJCEUZrdB
```

> [!WARNING]
> Send **USDT on TRC-20 network only**. Sending other tokens or using a different network will result in permanent loss.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

*Made with ❤️ by [@somratpro](https://github.com/somratpro) for the OpenClaw community.*
