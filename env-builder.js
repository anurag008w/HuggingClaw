const MODEL_CATALOGS = {
  "LLM_MODEL": {
    "Anthropic": [
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-0",
      "claude-sonnet-4-0",
      "claude-3-7-sonnet-latest",
      "claude-3-5-haiku-latest"
    ],
    "OpenAI": [
      "gpt-5.5",
      "gpt-5.4-pro",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.1",
      "gpt-5",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-4o",
      "o3",
      "o3-mini",
      "gpt-5.5-2026-04-23",
      "gpt-5.4-2026-03-05",
      "gpt-5.4-chat-latest",
      "gpt-5.5-chat-latest",
      "chatgpt-4o-latest"
    ],
    "Gemini": [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-flash-latest",
      "gemini-pro-latest",
      "gemini-3.5-flash-latest",
      "gemini-2.5-pro-latest",
      "gemini-2.5-flash-latest"
    ],
    "DeepSeek": [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-r1",
      "deepseek-r1-0528",
      "deepseek-chat",
      "deepseek-reasoner"
    ],
    "xAI": [
      "grok-4.20",
      "grok-4.3",
      "grok-4.1",
      "grok-latest",
      "grok-4.3-latest",
      "grok-4.20-latest",
      "grok-build-0.1"
    ],
    "Groq": [
      "groq/compound",
      "groq/compound-mini",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "moonshotai/kimi-k2-instruct-0905",
      "groq/llama-3.3-70b-versatile",
      "qwen/qwen3-32b",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "groq/mixtral-8x7b-32768"
    ],
    "Mistral": [
      "mistral/mistral-large-latest",
      "mistral/mistral-large-2",
      "mistral/mistral-medium-3.5",
      "mistral/mistral-small-latest",
      "mistral/mistral-small-3.2",
      "mistral/devstral-2",
      "mistral/ocr-3-premier",
      "mistral/voxtral-mini-transcribe-realtime",
      "mistral/codestral-latest",
      "mistral/mistral-latest",
      "mistral/open-mistral-nemo",
      "mistral/open-codestral-mamba"
    ],
    "Cohere": [
      "command-a",
      "command-a-03-2025",
      "command-a-translate-08-2025",
      "command-a-reasoning-08-2025",
      "command-a-vision-07-2025",
      "command-r7b-12-2024",
      "command-r-plus-08-2024"
    ],
    "OpenRouter": [
      "openrouter/free",
      "openrouter/auto",
      "anthropic/claude-opus-4-7",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-haiku-4-5",
      "openai/gpt-5.4",
      "openai/gpt-4.1",
      "openai/gpt-4o",
      "openai/gpt-5.1",
      "google/gemini-3.5-flash",
      "google/gemini-3.1-pro-preview",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-r1",
      "moonshotai/kimi-k2.6",
      "qwen/qwen3-32b",
      "meta-llama/llama-3.3-70b-instruct"
    ],
    "Together": [
      "moonshotai/Kimi-K2.6",
      "deepseek-ai/DeepSeek-V4-Pro",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen3-235B-A22B-Instruct-2507-tput",
      "zai-org/GLM-5.1",
      "google/gemma-4-31B-it",
      "MiniMaxAI/MiniMax-M2.7",
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
      "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    ],
    "OpenCode": [
      "opencode/claude-opus-4-7",
      "opencode/gpt-5.4",
      "opencode-go/kimi-k2.6",
      "opencode-go/qwen3-32b"
    ],
    "Cerebras": [
      "cerebras/zai-glm-4.7",
      "cerebras/gpt-oss-120b",
      "cerebras/deepseek-r1",
      "cerebras/qwen3-32b"
    ],
    "NVIDIA": [
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-4-340b-instruct",
      "nvidia/llama-3.1-nemotron-70b-instruct"
    ],
    "KiloCode": [
      "kilocode/anthropic/claude-opus-4.7",
      "kilocode/anthropic/claude-sonnet-4.6",
      "kilocode/openai/gpt-5.4",
      "kilocode/google/gemini-2.5-pro"
    ],
    "Z.AI": [
      "zai-org/GLM-5.1",
      "zai-org/GLM-4.7",
      "zai-org/GLM-4.5"
    ],
    "Moonshot": [
      "moonshot/kimi-k2.6",
      "moonshot/kimi-k2.6-thinking",
      "moonshot/kimi-k2-thinking"
    ],
    "MiniMax": [
      "minimax/minimax-m2.7",
      "minimax/minimax-m1.5",
      "minimax/abab6.5s-chat"
    ],
    "Xiaomi": [
      "xiaomi/mimo-v1",
      "xiaomi/mimo-v2",
      "xiaomi/mi-mo"
    ],
    "Volcano Engine": [
      "volcengine/doubao-seed-1.6",
      "volcengine/doubao-1.5-pro",
      "volcengine/doubao-1.5-lite"
    ],
    "BytePlus": [
      "byteplus/seed-1.6",
      "byteplus/deepseek-v3.2",
      "byteplus/doubao-seed-1.6"
    ],
    "Qianfan": [
      "qianfan/ernie-4.5",
      "qianfan/ernie-4.5-8k",
      "qianfan/deepseek-v3.2",
      "qianfan/ernie-x1"
    ],
    "ModelStudio": [
      "modelstudio/qwen3-max",
      "modelstudio/qwen3-coder",
      "modelstudio/qwen3-32b"
    ],
    "Hugging Face": [
      "meta-llama/Llama-3.3-70B-Instruct",
      "Qwen/Qwen3-32B",
      "google/gemma-4-31B-it",
      "deepseek-ai/DeepSeek-V3.2",
      "moonshotai/Kimi-K2.6"
    ],
    "Venice": [
      "venice/gpt-5",
      "venice/llama-3.3-70b",
      "venice/deepseek-r1"
    ],
    "Synthetic": [
      "synthetic/gpt-5",
      "synthetic/claude-sonnet-4-6"
    ],
    "AI Gateway": [
      "openai/gpt-5.4",
      "anthropic/claude-sonnet-4-6",
      "google/gemini-2.5-pro"
    ],
    "GitHub Copilot": [
      "github-copilot/gpt-5",
      "github-copilot/gpt-4.1",
      "github-copilot/gpt-4.1-mini"
    ],
    "ZAI": [
      "zai/glm-5",
      "zai/glm-5-turbo",
      "zai/glm-4.7",
      "zai/glm-4.7-flash"
    ],
    "Kimi": [
      "moonshot/kimi-k2.6",
      "moonshot/kimi-k2.6-thinking"
    ],
    "HuggingFace": [
      "huggingface/deepseek-ai/DeepSeek-R1",
      "huggingface/meta-llama/Llama-3.3-70B-Instruct",
      "huggingface/Qwen/Qwen3-32B"
    ]
  },
  "OPENAI_MODELS": [
    "gpt-5.5",
    "gpt-5.4-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.1",
    "gpt-5",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "o3",
    "o3-mini",
    "gpt-5.4-chat-latest",
    "gpt-5.5-chat-latest",
    "chatgpt-4o-latest"
  ],
  "ANTHROPIC_MODELS": [
    "anthropic/claude-opus-4-7",
    "anthropic/claude-opus-4-6",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-opus-4-0",
    "anthropic/claude-sonnet-4-0",
    "anthropic/claude-3-7-sonnet-latest",
    "anthropic/claude-3-5-haiku-latest"
  ],
  "GEMINI_MODELS": [
    "google/gemini-3.5-flash",
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.1-flash-lite",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
    "google/gemini-flash-latest",
    "google/gemini-pro-latest",
    "google/gemini-3.5-flash-latest",
    "google/gemini-2.5-pro-latest",
    "google/gemini-2.5-flash-latest"
  ],
  "VERTEX_MODELS": [
    "google-vertex/gemini-3.5-flash",
    "google-vertex/gemini-3.1-pro-preview",
    "google-vertex/gemini-2.5-pro",
    "google-vertex/gemini-2.5-flash",
    "google-vertex/gemini-2.5-flash-lite",
    "google-vertex/gemini-flash-latest",
    "google-vertex/gemini-pro-latest",
    "google-vertex/gemini-2.5-pro-latest",
    "google-vertex/gemini-2.5-flash-latest"
  ],
  "DEEPSEEK_MODELS": [
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-r1",
    "deepseek/deepseek-r1-0528",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-reasoner"
  ],
  "OPENROUTER_MODELS": [
    "openrouter/free",
    "openrouter/auto",
    "openrouter/anthropic/claude-sonnet-4-6",
    "openrouter/anthropic/claude-opus-4-7",
    "openrouter/anthropic/claude-haiku-4-5",
    "openrouter/openai/gpt-5.4",
    "openrouter/openai/gpt-4.1",
    "openrouter/openai/gpt-4o",
    "openrouter/openai/gpt-5.1",
    "openrouter/google/gemini-3.5-flash",
    "openrouter/google/gemini-3.1-pro-preview",
    "openrouter/google/gemini-2.5-pro",
    "openrouter/deepseek/deepseek-v4-pro",
    "openrouter/deepseek/deepseek-r1",
    "openrouter/moonshotai/kimi-k2.6",
    "openrouter/qwen/qwen3-32b"
  ],
  "GROQ_MODELS": [
    "groq/compound",
    "groq/compound-mini",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "moonshotai/kimi-k2-instruct-0905",
    "groq/llama-3.3-70b-versatile",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "qwen/qwen3-32b",
    "groq/mixtral-8x7b-32768"
  ],
  "MISTRAL_MODELS": [
    "mistral/mistral-large-latest",
    "mistral/mistral-large-2",
    "mistral/mistral-medium-3.5",
    "mistral/mistral-small-latest",
    "mistral/mistral-small-3.2",
    "mistral/devstral-2",
    "mistral/ocr-3-premier",
    "mistral/voxtral-mini-transcribe-realtime",
    "mistral/codestral-latest",
    "mistral/mistral-latest",
    "mistral/open-mistral-nemo",
    "mistral/open-codestral-mamba"
  ],
  "XAI_MODELS": [
    "grok-4.20",
    "grok-4.3",
    "grok-4.1",
    "grok-latest",
    "grok-4.3-latest",
    "grok-4.20-latest",
    "grok-build-0.1"
  ],
  "COHERE_MODELS": [
    "command-a",
    "command-a-03-2025",
    "command-a-translate-08-2025",
    "command-a-reasoning-08-2025",
    "command-a-vision-07-2025",
    "command-r7b-12-2024",
    "command-r-plus-08-2024"
  ],
  "TOGETHER_MODELS": [
    "moonshotai/Kimi-K2.6",
    "deepseek-ai/DeepSeek-V4-Pro",
    "deepseek-ai/DeepSeek-R1",
    "Qwen/Qwen3-235B-A22B-Instruct-2507-tput",
    "zai-org/GLM-5.1",
    "google/gemma-4-31B-it",
    "MiniMaxAI/MiniMax-M2.7",
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
  ],
  "CEREBRAS_MODELS": [
    "cerebras/zai-glm-4.7",
    "cerebras/gpt-oss-120b",
    "cerebras/deepseek-r1",
    "cerebras/qwen3-32b"
  ],
  "NVIDIA_MODELS": [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-4-340b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct"
  ],
  "KILOCODE_MODELS": [
    "kilocode/anthropic/claude-opus-4.7",
    "kilocode/anthropic/claude-sonnet-4.6",
    "kilocode/openai/gpt-5.4",
    "kilocode/google/gemini-2.5-pro"
  ],
  "OPENCODE_MODELS": [
    "opencode/claude-opus-4-7",
    "opencode/gpt-5.4",
    "opencode-go/kimi-k2.6",
    "opencode-go/qwen3-32b"
  ],
  "ZAI_MODELS": [
    "zai/glm-5",
    "zai/glm-5-turbo",
    "zai/glm-4.7",
    "zai/glm-4.7-flash"
  ],
  "MOONSHOT_MODELS": [
    "moonshot/kimi-k2.6",
    "moonshot/kimi-k2.6-thinking",
    "moonshot/kimi-k2-thinking"
  ],
  "MINIMAX_MODELS": [
    "minimax/minimax-m2.7",
    "minimax/minimax-m1.5",
    "minimax/abab6.5s-chat"
  ],
  "XIAOMI_MODELS": [
    "xiaomi/mimo-v1",
    "xiaomi/mimo-v2",
    "xiaomi/mi-mo"
  ],
  "VOLCANO_ENGINE_MODELS": [
    "volcengine/doubao-seed-1.6",
    "volcengine/doubao-1.5-pro",
    "volcengine/doubao-1.5-lite"
  ],
  "BYTEPLUS_MODELS": [
    "byteplus/seed-1.6",
    "byteplus/deepseek-v3.2",
    "byteplus/doubao-seed-1.6"
  ],
  "QIANFAN_MODELS": [
    "qianfan/ernie-4.5",
    "qianfan/ernie-4.5-8k",
    "qianfan/deepseek-v3.2",
    "qianfan/ernie-x1"
  ],
  "MODELSTUDIO_MODELS": [
    "modelstudio/qwen3-max",
    "modelstudio/qwen3-coder",
    "modelstudio/qwen3-32b"
  ],
  "KIMI_MODELS": [
    "moonshot/kimi-k2.6",
    "moonshot/kimi-k2.6-thinking",
    "moonshot/kimi-k2-thinking"
  ],
  "HUGGINGFACE_MODELS": [
    "huggingface/deepseek-ai/DeepSeek-R1",
    "huggingface/meta-llama/Llama-3.3-70B-Instruct",
    "huggingface/Qwen/Qwen3-32B",
    "huggingface/mistralai/Mistral-Small-3.2-24B-Instruct-2506"
  ],
  "GITHUB_COPILOT_MODELS": [
    "github-copilot/gpt-5",
    "github-copilot/gpt-4.1",
    "github-copilot/gpt-4.1-mini"
  ],
  "AI_GATEWAY_MODELS": [
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4-6",
    "google/gemini-2.5-pro"
  ],
  "VENICE_MODELS": [
    "venice/gpt-5",
    "venice/llama-3.3-70b",
    "venice/deepseek-r1"
  ],
  "SYNTHETIC_MODELS": [
    "synthetic/gpt-5",
    "synthetic/claude-sonnet-4-6"
  ]
};

const FIELDS = [
{
    "g": "Core",
    "icon": "⚡",
    "k": "LLM_MODEL",
    "lbl": "Default model ID",
    "type": "text",
    "ph": "choose a provider model",
    "common": 1,
    "tag": "critical"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "LLM_API_KEY",
    "lbl": "Primary provider API key",
    "type": "password",
    "ph": "sk-...",
    "common": 1,
    "tag": "credential"
  },
{
    "g": "Core",
    "icon": "🔄",
    "k": "LLM_FALLBACK_MODELS",
    "lbl": "Fallback models (comma-separated, tried in order if primary fails)",
    "type": "text",
    "ph": "anthropic/claude-sonnet-4-6,openai/gpt-5.4,google/gemini-3.5-flash",
    "tag": "advanced",
    "help": "Each fallback provider needs its own API key set (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY). OpenClaw will try these in order on rate-limit, auth failure, or provider outage."
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "GATEWAY_TOKEN",
    "lbl": "Control UI gateway token",
    "type": "password",
    "common": 1,
    "tag": "critical"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "OPENCLAW_PASSWORD",
    "lbl": "Optional password auth",
    "type": "password",
    "tag": "credential"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "OPENCLAW_VERSION",
    "lbl": "Pin OpenClaw version (build-time; rebuild required)",
    "type": "text",
    "ph": "latest",
    "tag": "build"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "LLM_API_KEY_FALLBACK_ENABLED",
    "lbl": "Allow global LLM_API_KEY fallback for key rotation",
    "type": "toggle",
    "ph": "true",
    "tag": "advanced",
    "help": "When enabled, the key rotator can fall back to LLM_API_KEY for providers that don't have their own dedicated key configured."
  },
{
    "g": "Plugins",
    "icon": "🔄",
    "k": "KEY_BLACKLIST_COOLDOWN_MS",
    "lbl": "Key rotation base backoff (ms) — time a key is skipped after first 429/rate-limit (doubles on repeated failures; long suspend after max strikes)",
    "type": "text",
    "ph": "60000",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "🔄",
    "k": "KEY_BLACKLIST_JITTER_PCT",
    "lbl": "Key rotation cooldown jitter (%)",
    "type": "text",
    "ph": "15",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "🔄",
    "k": "KEY_MAX_STRIKES",
    "lbl": "Key rotation max strikes — consecutive 429/quota errors before long suspend",
    "type": "text",
    "ph": "3",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "🔄",
    "k": "KEY_PERM_SUSPEND_MS",
    "lbl": "Long suspend duration (ms) for exhausted/auth-invalid keys (max 16h cap)",
    "type": "text",
    "ph": "57600000",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "🔄",
    "k": "KEY_FAILURE_DECAY_MS",
    "lbl": "Recent-failure decay window (ms) for key deprioritization",
    "type": "text",
    "ph": "900000",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "🔄",
    "k": "KEY_MAX_INFLIGHT_PER_KEY",
    "lbl": "Key rotation per-key soft concurrency cap",
    "type": "text",
    "ph": "3",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "🔄",
    "k": "KEY_FETCH_MAX_RETRIES",
    "lbl": "Auto-retries for retryable failures (GET/HEAD/OPTIONS/POST)",
    "type": "text",
    "ph": "2",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "🔄",
    "k": "KEY_FETCH_RETRY_BASE_DELAY_MS",
    "lbl": "Base delay between auto-retries (ms, capped to 10s)",
    "type": "text",
    "ph": "250",
    "tag": "advanced"
  },

{
    "g": "Plugins",
    "icon": "🧾",
    "k": "KEY_ROTATOR_LOG_LEVEL",
    "lbl": "Key-rotator log level (info/debug/silent)",
    "type": "text",
    "ph": "info",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "🧾",
    "k": "KEY_ROTATOR_VERBOSE_PICKS",
    "lbl": "Verbose per-request key pick logs (use with debug)",
    "type": "toggle",
    "ph": "false",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "📊",
    "k": "KEY_ROTATOR_DIAGNOSTICS",
    "lbl": "Enable key-rotator diagnostics logs",
    "type": "toggle",
    "ph": "false",
    "tag": "advanced"
  },
{
    "g": "Plugins",
    "icon": "📊",
    "k": "KEY_ROTATOR_DIAGNOSTICS_INTERVAL_MS",
    "lbl": "Key-rotator diagnostics interval (ms)",
    "type": "text",
    "ph": "60000",
    "tag": "advanced"
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "DEV_MODE",
    "lbl": "Enable dev mode",
    "type": "toggle",
    "ph": "false",
    "common": 1,
    "tag": "build"
  },
{
    "g": "Startup",
    "icon": "🩺",
    "k": "AUTO_DOCTOR",
    "lbl": "Auto-fix config on boot (openclaw doctor --fix)",
    "type": "toggle",
    "ph": "false",
    "tag": "advanced"
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_JUPYTER_ENABLED",
    "lbl": "Enable Jupyter terminal",
    "type": "toggle",
    "ph": "false",
    "common": 1,
    "tag": "feature"
  },
{
    "g": "DevData",
    "icon": "⚡",
    "k": "DEVDATA",
    "lbl": "DevData switch",
    "type": "toggle",
    "ph": "on",
    "common": 1,
    "tag": "feature"
  },
{
    "g": "DevData",
    "icon": "⚡",
    "k": "DEVDATA_DATASET_NAME",
    "lbl": "DevData dataset name",
    "type": "text",
    "ph": "huggingclaw-devdata",
    "common": 1,
    "tag": "feature"
  },
{
    "g": "DevData",
    "icon": "⚡",
    "k": "DEVDATA_SYNC_INTERVAL",
    "lbl": "DevData sync interval (seconds)",
    "type": "number",
    "ph": "180",
    "tag": "advanced"
  },
{
    "g": "WhatsApp",
    "icon": "⚡",
    "k": "WHATSAPP_ENABLED",
    "lbl": "Enable WhatsApp pairing",
    "type": "toggle",
    "ph": "false",
    "common": 1,
    "tag": "feature"
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_CAPTURE_DISABLE",
    "lbl": "Disable capture wrapper",
    "type": "toggle",
    "ph": "false",
    "tag": "advanced"
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_STARTUP_STRICT",
    "lbl": "Stop on startup failure",
    "type": "toggle",
    "ph": "false",
    "tag": "advanced"
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_RUN",
    "lbl": "Startup script (bash — inline, multi-line, or base64: prefix)",
    "type": "textarea",
    "tag": "optional",
    "help": "Runs on every boot before the gateway starts. Supports a single command, a full multi-line bash script, or a base64-encoded script prefixed with 'base64:'. For complex logic prefer HUGGINGCLAW_STARTUP_SCRIPT."
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_STARTUP_COMMANDS",
    "lbl": "Multiline startup commands",
    "type": "textarea",
    "tag": "optional"
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_STARTUP_SCRIPT",
    "lbl": "Startup shell script",
    "type": "textarea",
    "tag": "optional"
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_STARTUP_SCRIPT_B64",
    "lbl": "Startup script (base64)",
    "type": "textarea",
    "tag": "optional"
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_APT_PACKAGES",
    "lbl": "APT packages to install",
    "type": "textarea",
    "ph": "curl wget git",
    "tag": "optional",
    "help": "Packages to apt-get install on every boot. Accepts space-separated, comma-separated, or one package per line."
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_PIP_PACKAGES",
    "lbl": "Pip packages to install",
    "type": "textarea",
    "ph": "requests pandas numpy",
    "tag": "optional",
    "help": "Python packages to pip install on every boot. Accepts space-separated, comma-separated, or one package per line."
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_NPM_PACKAGES",
    "lbl": "NPM packages to install",
    "type": "textarea",
    "ph": "typescript ts-node",
    "tag": "optional",
    "help": "npm packages to install globally on every boot. Accepts space-separated, comma-separated, or one package per line."
  },
{
    "g": "Startup",
    "icon": "⚡",
    "k": "HUGGINGCLAW_OPENCLAW_PLUGINS",
    "lbl": "OpenClaw plugins to load",
    "type": "textarea",
    "ph": "@openclaw/myplugin another-plugin",
    "tag": "optional",
    "help": "OpenClaw plugins to install on every boot. Accepts space-separated, comma-separated, or one plugin per line."
  },
{
    "g": "Network",
    "icon": "⚡",
    "k": "ALLOWED_ORIGINS",
    "lbl": "Allowed CORS origins",
    "type": "textarea",
    "tag": "advanced"
  },
{
    "g": "Network",
    "icon": "⚡",
    "k": "TRUSTED_PROXIES",
    "lbl": "Trusted proxy CIDRs",
    "type": "textarea",
    "tag": "advanced"
  },
{
    "g": "Network",
    "icon": "⚡",
    "k": "WEBHOOK_URL",
    "lbl": "Webhook URL",
    "type": "text",
    "ph": "https://..."
  },
  {
    "g": "Core",
    "icon": "⚡",
    "k": "GATEWAY_MAX_RESTARTS",
    "lbl": "Gateway max restarts",
    "type": "number",
    "ph": "10",
    "tag": "advanced"
  },
{
    "g": "Gateway",
    "icon": "⚡",
    "k": "GATEWAY_READY_TIMEOUT",
    "lbl": "Gateway ready timeout",
    "type": "number",
    "ph": "90",
    "tag": "advanced"
  },
{
    "g": "Gateway",
    "icon": "⚡",
    "k": "GATEWAY_RESTART_DELAY",
    "lbl": "Gateway restart delay",
    "type": "number",
    "ph": "5",
    "tag": "advanced"
  },
{
    "g": "Gateway",
    "icon": "⚡",
    "k": "GATEWAY_VERBOSE",
    "lbl": "Verbose gateway logs",
    "type": "toggle",
    "ph": "false",
    "tag": "advanced"
  },
{
    "g": "Logging",
    "icon": "⚡",
    "k": "OPENCLAW_CONSOLE_LOG_LEVEL",
    "lbl": "Console log level",
    "type": "select",
    "options": [
      "debug",
      "info",
      "warn",
      "error"
    ],
    "ph": "info",
    "tag": "optional"
  },
{
    "g": "Logging",
    "icon": "⚡",
    "k": "OPENCLAW_FILE_LOG_LEVEL",
    "lbl": "File log level",
    "type": "select",
    "options": [
      "debug",
      "info",
      "warn",
      "error"
    ],
    "ph": "info",
    "tag": "optional"
  },
{
    "g": "Logging",
    "icon": "⚡",
    "k": "OPENCLAW_CONSOLE_LOG_STYLE",
    "lbl": "Console log style",
    "type": "select",
    "options": [
      "pretty",
      "json",
      "compact"
    ],
    "ph": "pretty",
    "tag": "optional"
  },
{
    "g": "Plugins",
    "icon": "⚡",
    "k": "BROWSER_PLUGIN_MODE",
    "lbl": "Browser plugin mode",
    "type": "select",
    "options": [
      "auto",
      "enabled",
      "disabled"
    ],
    "ph": "auto",
    "tag": "feature"
  },
{
    "g": "Plugins",
    "icon": "⚡",
    "k": "ACP_PLUGIN_MODE",
    "lbl": "ACP plugin mode",
    "type": "select",
    "options": [
      "auto",
      "enabled",
      "disabled"
    ],
    "ph": "auto",
    "tag": "feature"
  },
{
    "g": "Cloudflare",
    "icon": "⚡",
    "k": "CLOUDFLARE_PROXY_DEBUG",
    "lbl": "Cloudflare proxy debug",
    "type": "toggle",
    "ph": "false",
    "tag": "advanced"
  },
{
    "g": "Cloudflare",
    "icon": "⚡",
    "k": "CLOUDFLARE_KEEPALIVE_ENABLED",
    "lbl": "Enable keep-awake worker",
    "type": "toggle",
    "ph": "true",
    "tag": "feature"
  },
{
    "g": "Cloudflare",
    "icon": "⚡",
    "k": "CLOUDFLARE_PROXY_URL",
    "lbl": "Proxy worker URL",
    "type": "text",
    "ph": "https://your-proxy.workers.dev",
    "common": 1,
    "tag": "feature"
  },
{
    "g": "Cloudflare",
    "icon": "⚡",
    "k": "CLOUDFLARE_PROXY_SECRET",
    "lbl": "Proxy shared secret",
    "type": "password",
    "tag": "credential"
  },
{
    "g": "Cloudflare",
    "icon": "⚡",
    "k": "CLOUDFLARE_PROXY_DOMAINS",
    "lbl": "Extra domains to proxy",
    "type": "textarea",
    "ph": "api.sendgrid.com,slack.com",
    "tag": "advanced"
  },
{
    "g": "Cloudflare",
    "icon": "⚡",
    "k": "CLOUDFLARE_WORKERS_TOKEN",
    "lbl": "Workers API token",
    "type": "password",
    "common": 1,
    "tag": "credential"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "HF_USERNAME",
    "lbl": "Hugging Face username",
    "type": "text",
    "common": 1,
    "tag": "optional"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "HF_TOKEN",
    "lbl": "HF write token",
    "type": "password",
    "common": 1,
    "tag": "credential"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "BACKUP_DATASET_NAME",
    "lbl": "Backup dataset name",
    "type": "text",
    "ph": "huggingclaw-backup",
    "common": 1,
    "tag": "optional"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "SYNC_INTERVAL",
    "lbl": "Sync interval (seconds)",
    "type": "number",
    "ph": "180",
    "common": 1,
    "tag": "advanced"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "JUPYTER_TOKEN",
    "lbl": "Jupyter access token (Must NOT be 'huggingface'. Run: openssl rand -hex 32)",
    "type": "password",
    "secret": 1,
    "ph": "huggingface",
    "common": 1
  },
  {
    "g": "Core",
    "icon": "⚡",
    "k": "OPENCLAW_DISABLE_BONJOUR",
    "lbl": "Disable Bonjour/mDNS discovery",
    "type": "toggle",
    "ph": "false",
    "tag": "advanced"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "OPENCLAW_RUNTIME_VERSION",
    "lbl": "Pin runtime version",
    "type": "text",
    "ph": "latest",
    "tag": "advanced"
  },
{
    "g": "Core",
    "icon": "⚡",
    "k": "OPENCLAW_DISPLAY_VERSION",
    "lbl": "Display version label",
    "type": "text",
    "ph": "",
    "tag": "optional"
  },
{
    "g": "Integrations",
    "icon": "🔌",
    "k": "CLOUDFLARE_ACCOUNT_ID",
    "lbl": "Cloudflare account ID",
    "type": "text",
    "ph": "account-id",
    "tag": "feature"
  },
{
    "g": "Integrations",
    "icon": "🔌",
    "k": "CLOUDFLARE_WORKER_NAME",
    "lbl": "Outbound proxy worker name",
    "type": "text",
    "ph": "huggingclaw-proxy",
    "tag": "feature"
  },
{
    "g": "Integrations",
    "icon": "🔌",
    "k": "CLOUDFLARE_KEEPALIVE_URL",
    "lbl": "Keepalive worker URL",
    "type": "text",
    "ph": "https://your-worker.workers.dev",
    "tag": "feature"
  },
{
    "g": "Integrations",
    "icon": "🔌",
    "k": "CLOUDFLARE_KEEPALIVE_WORKER_NAME",
    "lbl": "Keepalive worker name",
    "type": "text",
    "ph": "huggingclaw-keepalive",
    "tag": "feature"
  },
{
    "g": "Integrations",
    "icon": "🔌",
    "k": "CLOUDFLARE_KEEPALIVE_CRON",
    "lbl": "Keepalive cron schedule",
    "type": "text",
    "ph": "*/5 * * * *",
    "tag": "advanced"
  },
{
    "g": "Integrations",
    "icon": "🔌",
    "k": "TELEGRAM_API_ROOT",
    "lbl": "Telegram API root override",
    "type": "text",
    "ph": "https://api.telegram.org",
    "tag": "advanced"
  },
{
    "g": "Runtime",
    "icon": "⚙️",
    "k": "OPENCLAW_CONFIG_WATCH_INTERVAL",
    "lbl": "Config watch interval (seconds)",
    "type": "number",
    "ph": "1",
    "tag": "advanced"
  },
{
    "g": "Runtime",
    "icon": "⚙️",
    "k": "OPENCLAW_CONFIG_SETTLE_SECONDS",
    "lbl": "Config settle window (seconds)",
    "type": "number",
    "ph": "3",
    "tag": "advanced"
  },
{
    "g": "Runtime",
    "icon": "⚙️",
    "k": "SESSIONS_MIN_SYNC_GAP",
    "lbl": "Sessions min sync gap (seconds)",
    "type": "number",
    "ph": "30",
    "tag": "advanced"
  },
{
    "g": "Runtime",
    "icon": "⚙️",
    "k": "JUPYTER_ROOT_DIR",
    "lbl": "Jupyter root directory",
    "type": "text",
    "ph": "/home/node",
    "tag": "advanced"
  },
  {
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "ANTHROPIC_API_KEY",
    "lbl": "Anthropic (Claude)",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "OPENAI_API_KEY",
    "lbl": "OpenAI (GPT)",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "GEMINI_API_KEY",
    "lbl": "Google Gemini",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "GOOGLE_CLOUD_PROJECT",
    "lbl": "Google Vertex AI — GCP Project ID",
    "type": "text",
    "ph": "my-gcp-project-id",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "GOOGLE_CLOUD_LOCATION",
    "lbl": "Google Vertex AI — GCP Region",
    "type": "text",
    "ph": "us-central1",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "lbl": "Google Vertex AI — Service Account JSON (base64)",
    "type": "password",
    "ph": "base64-encoded service account JSON",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "DEEPSEEK_API_KEY",
    "lbl": "DeepSeek",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "OPENROUTER_API_KEY",
    "lbl": "OpenRouter",
    "type": "password",
    "common": 1,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "OPENCODE_API_KEY",
    "lbl": "OpenCode",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "KILOCODE_API_KEY",
    "lbl": "KiloCode",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "ZAI_API_KEY",
    "lbl": "Z.ai / GLM",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "MOONSHOT_API_KEY",
    "lbl": "Moonshot / Kimi",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "MINIMAX_API_KEY",
    "lbl": "MiniMax",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "XIAOMI_API_KEY",
    "lbl": "Xiaomi / MiMo",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "VOLCANO_ENGINE_API_KEY",
    "lbl": "Volcengine / Doubao",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "BYTEPLUS_API_KEY",
    "lbl": "BytePlus",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "MISTRAL_API_KEY",
    "lbl": "Mistral",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "XAI_API_KEY",
    "lbl": "xAI (Grok)",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "NVIDIA_API_KEY",
    "lbl": "NVIDIA",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "GROQ_API_KEY",
    "lbl": "Groq",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "COHERE_API_KEY",
    "lbl": "Cohere",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "TOGETHER_API_KEY",
    "lbl": "Together AI",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "CEREBRAS_API_KEY",
    "lbl": "Cerebras",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "QIANFAN_API_KEY",
    "lbl": "Qianfan",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "MODELSTUDIO_API_KEY",
    "lbl": "ModelStudio",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "KIMI_API_KEY",
    "lbl": "Kimi",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "HUGGINGFACE_HUB_TOKEN",
    "lbl": "Hugging Face token",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "COPILOT_GITHUB_TOKEN",
    "lbl": "GitHub Copilot",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "VENICE_API_KEY",
    "lbl": "Venice",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "SYNTHETIC_API_KEY",
    "lbl": "Synthetic",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Provider Keys",
    "icon": "🔑",
    "k": "AI_GATEWAY_API_KEY",
    "lbl": "AI Gateway",
    "type": "password",
    "common": 0,
    "tag": "credential"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "ANTHROPIC_API_KEYS",
    "lbl": "Anthropic pool (comma-sep)",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "OPENAI_API_KEYS",
    "lbl": "OpenAI pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "GEMINI_API_KEYS",
    "lbl": "Gemini pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "DEEPSEEK_API_KEYS",
    "lbl": "DeepSeek pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "OPENROUTER_API_KEYS",
    "lbl": "OpenRouter pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "OPENCODE_API_KEYS",
    "lbl": "OpenCode pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "KILOCODE_API_KEYS",
    "lbl": "KiloCode pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "ZAI_API_KEYS",
    "lbl": "Z.ai / GLM pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "MOONSHOT_API_KEYS",
    "lbl": "Moonshot pool (merged with KIMI_API_KEYS into one rotation pool)",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "MINIMAX_API_KEYS",
    "lbl": "MiniMax pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "XIAOMI_API_KEYS",
    "lbl": "Xiaomi pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "VOLCANO_ENGINE_API_KEYS",
    "lbl": "Volcano Engine pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "BYTEPLUS_API_KEYS",
    "lbl": "BytePlus pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "MISTRAL_API_KEYS",
    "lbl": "Mistral pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "XAI_API_KEYS",
    "lbl": "xAI pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "NVIDIA_API_KEYS",
    "lbl": "NVIDIA pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "GROQ_API_KEYS",
    "lbl": "Groq pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "COHERE_API_KEYS",
    "lbl": "Cohere pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "TOGETHER_API_KEYS",
    "lbl": "Together pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "CEREBRAS_API_KEYS",
    "lbl": "Cerebras pool",
    "type": "text",
    "tag": "advanced"
  },
{
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "HUGGINGFACE_HUB_TOKENS",
    "lbl": "HF token pool",
    "type": "text"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "OPENAI_MODELS",
    "lbl": "Visible OpenAI models",
    "type": "model_list",
    "options_key": "OPENAI_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "ANTHROPIC_MODELS",
    "lbl": "Visible Anthropic models",
    "type": "model_list",
    "options_key": "ANTHROPIC_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "GEMINI_MODELS",
    "lbl": "Visible Gemini models",
    "type": "model_list",
    "options_key": "GEMINI_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "VERTEX_MODELS",
    "lbl": "Visible Vertex AI models (google-vertex/...)",
    "type": "model_list",
    "options_key": "VERTEX_MODELS",
    "ph": "Select Vertex models (needs GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION)",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "DEEPSEEK_MODELS",
    "lbl": "Visible DeepSeek models",
    "type": "model_list",
    "options_key": "DEEPSEEK_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "OPENROUTER_MODELS",
    "lbl": "Visible OpenRouter models",
    "type": "model_list",
    "options_key": "OPENROUTER_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "GROQ_MODELS",
    "lbl": "Visible Groq models",
    "type": "model_list",
    "options_key": "GROQ_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "MISTRAL_MODELS",
    "lbl": "Visible Mistral models",
    "type": "model_list",
    "options_key": "MISTRAL_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "XAI_MODELS",
    "lbl": "Visible xAI models",
    "type": "model_list",
    "options_key": "XAI_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "COHERE_MODELS",
    "lbl": "Visible Cohere models",
    "type": "model_list",
    "options_key": "COHERE_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "TOGETHER_MODELS",
    "lbl": "Visible Together models",
    "type": "model_list",
    "options_key": "TOGETHER_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "CEREBRAS_MODELS",
    "lbl": "Visible Cerebras models",
    "type": "model_list",
    "options_key": "CEREBRAS_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "NVIDIA_MODELS",
    "lbl": "Visible NVIDIA models",
    "type": "model_list",
    "options_key": "NVIDIA_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "KILOCODE_MODELS",
    "lbl": "Visible KiloCode models",
    "type": "model_list",
    "options_key": "KILOCODE_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "OPENCODE_MODELS",
    "lbl": "Visible OpenCode models",
    "type": "model_list",
    "options_key": "OPENCODE_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "ZAI_MODELS",
    "lbl": "Visible Z.ai / GLM models",
    "type": "model_list",
    "options_key": "ZAI_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "MOONSHOT_MODELS",
    "lbl": "Visible Moonshot / Kimi models",
    "type": "model_list",
    "options_key": "MOONSHOT_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "MINIMAX_MODELS",
    "lbl": "Visible MiniMax models",
    "type": "model_list",
    "options_key": "MINIMAX_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "XIAOMI_MODELS",
    "lbl": "Visible Xiaomi models",
    "type": "model_list",
    "options_key": "XIAOMI_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "VOLCANO_ENGINE_MODELS",
    "lbl": "Visible Volcano Engine models",
    "type": "model_list",
    "options_key": "VOLCANO_ENGINE_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "BYTEPLUS_MODELS",
    "lbl": "Visible BytePlus models",
    "type": "model_list",
    "options_key": "BYTEPLUS_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "QIANFAN_MODELS",
    "lbl": "Visible Qianfan models",
    "type": "model_list",
    "options_key": "QIANFAN_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "MODELSTUDIO_MODELS",
    "lbl": "Visible ModelStudio models",
    "type": "model_list",
    "options_key": "MODELSTUDIO_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "KIMI_MODELS",
    "lbl": "Visible Kimi models",
    "type": "model_list",
    "options_key": "KIMI_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "HUGGINGFACE_MODELS",
    "lbl": "Visible Hugging Face models",
    "type": "model_list",
    "options_key": "HUGGINGFACE_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Model Lists",
    "icon": "📋",
    "k": "GITHUB_COPILOT_MODELS",
    "lbl": "Visible GitHub Copilot models",
    "type": "model_list",
    "options_key": "GITHUB_COPILOT_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
{
    "g": "Custom Provider",
    "icon": "🔌",
    "k": "CUSTOM_PROVIDER_NAME",
    "lbl": "Provider display name",
    "type": "text",
    "tag": "feature"
  },
{
    "g": "Custom Provider",
    "icon": "🔌",
    "k": "CUSTOM_BASE_URL",
    "lbl": "OpenAI-compatible base URL",
    "type": "text",
    "tag": "feature"
  },
{
    "g": "Custom Provider",
    "icon": "🔌",
    "k": "CUSTOM_MODEL_ID",
    "lbl": "Model ID",
    "type": "text",
    "ph": "custom model id",
    "tag": "feature"
  },
{
    "g": "Custom Provider",
    "icon": "🔌",
    "k": "CUSTOM_MODEL_NAME",
    "lbl": "Friendly model name",
    "type": "text",
    "tag": "feature"
  },
{
    "g": "Custom Provider",
    "icon": "🔌",
    "k": "CUSTOM_API_KEY",
    "lbl": "Provider API key",
    "type": "password",
    "tag": "credential"
  },
{
    "g": "Custom Provider",
    "icon": "🔌",
    "k": "CUSTOM_API_TYPE",
    "lbl": "API type",
    "type": "select",
    "options": [
      "openai-completions",
      "openai-chat-completions",
      "anthropic",
      "gemini",
      "openrouter"
    ],
    "ph": "openai-completions",
    "tag": "feature"
  },
{
    "g": "Custom Provider",
    "icon": "🔌",
    "k": "CUSTOM_CONTEXT_WINDOW",
    "lbl": "Context window",
    "type": "number",
    "ph": "128000",
    "tag": "advanced"
  },
{
    "g": "Custom Provider",
    "icon": "🔌",
    "k": "CUSTOM_MAX_TOKENS",
    "lbl": "Max output tokens",
    "type": "number",
    "ph": "8192",
    "tag": "advanced"
  },
{
    "g": "Telegram",
    "icon": "✈️",
    "k": "TELEGRAM_BOT_TOKEN",
    "lbl": "Bot token from BotFather",
    "type": "password",
    "common": 1,
    "tag": "credential"
  },
{
    "g": "Telegram",
    "icon": "✈️",
    "k": "TELEGRAM_ALLOWED_USERS",
    "lbl": "Allowed user IDs (comma)",
    "type": "text",
    "ph": "123456789,987654321",
    "common": 1,
    "tag": "critical"
  },
{
    "g": "Deployment",
    "icon": "🧭",
    "k": "APP_BASE",
    "lbl": "Public app base path",
    "type": "text",
    "ph": "/app",
    "tag": "advanced"
  },
{
    "g": "Deployment",
    "icon": "🧭",
    "k": "SPACE_AUTHOR_NAME",
    "lbl": "HF Space author name",
    "type": "text",
    "tag": "optional"
  },
{
    "g": "Deployment",
    "icon": "🧭",
    "k": "SPACE_HOST",
    "lbl": "HF Space host domain",
    "type": "text",
    "tag": "optional"
  },
{
    "g": "Deployment",
    "icon": "🧭",
    "k": "PORT",
    "lbl": "Public dashboard port",
    "type": "number",
    "ph": "7861",
    "tag": "advanced"
  },
{
    "g": "Deployment",
    "icon": "🧭",
    "k": "GATEWAY_PORT",
    "lbl": "OpenClaw internal port",
    "type": "number",
    "ph": "7860",
    "tag": "advanced"
  },
{
    "g": "Deployment",
    "icon": "🧭",
    "k": "JUPYTER_PORT",
    "lbl": "Jupyter internal port",
    "type": "number",
    "ph": "8888",
    "tag": "advanced"
  },
{
    "g": "Deployment",
    "icon": "🧭",
    "k": "JUPYTER_BASE",
    "lbl": "Jupyter public base path",
    "type": "text",
    "ph": "/terminal",
    "tag": "advanced"
  },
  {
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "AI_GATEWAY_API_KEYS",
    "lbl": "AI Gateway pool (comma-sep)",
    "type": "text",
    "tag": "advanced"
  },
  {
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "COPILOT_GITHUB_TOKENS",
    "lbl": "GitHub Copilot token pool",
    "type": "text",
    "tag": "advanced"
  },
  {
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "KIMI_API_KEYS",
    "lbl": "Kimi pool (merged with MOONSHOT_API_KEYS into one rotation pool)",
    "type": "text",
    "tag": "advanced"
  },
  {
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "MODELSTUDIO_API_KEYS",
    "lbl": "ModelStudio pool",
    "type": "text",
    "tag": "advanced"
  },
  {
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "QIANFAN_API_KEYS",
    "lbl": "Qianfan pool",
    "type": "text",
    "tag": "advanced"
  },
  {
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "SYNTHETIC_API_KEYS",
    "lbl": "Synthetic pool",
    "type": "text",
    "tag": "advanced"
  },
  {
    "g": "Rotation Pools",
    "icon": "🔄",
    "k": "VENICE_API_KEYS",
    "lbl": "Venice pool",
    "type": "text",
    "tag": "advanced"
  },
  {
    "g": "Model Lists",
    "icon": "📋",
    "k": "VENICE_MODELS",
    "lbl": "Visible Venice models",
    "type": "model_list",
    "options_key": "VENICE_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  },
  {
    "g": "Model Lists",
    "icon": "📋",
    "k": "SYNTHETIC_MODELS",
    "lbl": "Visible Synthetic models",
    "type": "model_list",
    "options_key": "SYNTHETIC_MODELS",
    "ph": "Select models to build a comma list",
    "tag": "optional"
  }
]

const ICONS = {
  All:'🏠', Core:'⚡', Startup:'🚀', DevData:'🧪', WhatsApp:'💬',
  Cloudflare:'☁️', Gateway:'🔀', Logging:'📝', Network:'🌐', Plugins:'🔌',
  Deployment:'🧭', 'Provider Keys':'🔑', 'Rotation Pools':'🔄',
  'Model Lists':'📋', 'Custom Provider':'🧩', Telegram:'✈️',
  Backup:'💾', Runtime:'⚙️', Integrations:'🔗', 'Custom Env':'🔧'
};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));
const safeKey = k => /^[A-Z_][A-Z0-9_]*$/.test(k) && !['HUGGINGCLAW_ENV_BUNDLE', 'ENV_BUNDLE'].includes(k);

function encodeBundle(obj) {
  const j = JSON.stringify(obj);
  let b = '';
  for (const x of new TextEncoder().encode(j)) b += String.fromCharCode(x);
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBundle(raw) {
  try {
    raw = String(raw || '').trim();
    if (!raw) return {};

    if (raw.includes('HUGGINGCLAW_ENV_BUNDLE=')) {
      raw = raw.split('HUGGINGCLAW_ENV_BUNDLE=').pop().trim();
    }

    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    }

    if (raw.startsWith('{')) return JSON.parse(raw);

    const p = raw + '='.repeat((4 - raw.length % 4) % 4);
    const b = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(b, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function parseEnv(text) {
  text = String(text || '').trim();
  if (!text) return {};

  if (
    text.startsWith('{') ||
    /^[A-Za-z0-9_-]{20,}$/.test(text) ||
    text.includes('HUGGINGCLAW_ENV_BUNDLE=')
  ) {
    return decodeBundle(text);
  }

  const out = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const i = line.indexOf('=');
    if (i < 1) continue;

    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (safeKey(key)) out[key] = val;
  }
  return out;
}

function showToast(msg = 'Copied!') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}

let activeGroup = 'All';
let customCount = 0;
const GROUPS = ['All', ...[...new Set(FIELDS.map(f => f.g))], 'Custom Env'];

function ensureAllSelectedSection() {
  const wrap = $('sections');
  if (!wrap) return null;
  let sec = document.getElementById('allSelectedSec');
  if (sec) return sec;
  sec = document.createElement('div');
  sec.id = 'allSelectedSec';
  sec.className = 'sec';
  sec.innerHTML = `
    <div class="sec-header">
      <span class="sec-icon">✅</span>
      <span class="sec-title">Selected First</span>
      <span class="sec-count" id="allSelectedCount">0</span>
      <div class="sec-line"></div>
    </div>
    <div class="cards" id="allSelectedCards"></div>`;
  wrap.prepend(sec);
  return sec;
}

function rebalanceAllSelectedCards() {
  const sec = ensureAllSelectedSection();
  if (!sec) return;
  const selectedCardsWrap = document.getElementById('allSelectedCards');
  if (!selectedCardsWrap) return;

  // Restore cards when not in All view.
  if (activeGroup !== 'All') {
    [...selectedCardsWrap.querySelectorAll('[data-row]')].forEach(card => {
      const grp = card.dataset.group;
      const target = document.querySelector(`.sec[data-section="${CSS.escape(grp)}"] .cards`);
      if (target) target.appendChild(card);
    });
    sec.classList.add('sec-hidden');
    const countEl = $('allSelectedCount'); if (countEl) countEl.textContent = '0';
    return;
  }

  // Move checked cards from regular sections to top selected bucket.
  document.querySelectorAll('.sec[data-section] .cards [data-row]').forEach(card => {
    const checked = !!card.querySelector('[data-check]')?.checked;
    if (checked) selectedCardsWrap.appendChild(card);
  });

  // Move unchecked cards out of selected bucket back to original section.
  [...selectedCardsWrap.querySelectorAll('[data-row]')].forEach(card => {
    const checked = !!card.querySelector('[data-check]')?.checked;
    if (checked) return;
    const grp = card.dataset.group;
    const target = document.querySelector(`.sec[data-section="${CSS.escape(grp)}"] .cards`);
    if (target) target.appendChild(card);
  });

  const count = selectedCardsWrap.querySelectorAll('[data-row]').length;
  const countEl = $('allSelectedCount'); if (countEl) countEl.textContent = String(count);
  sec.classList.toggle('sec-hidden', count === 0);
}

function renderSidebar() {
  const sb = $('sidebar');
  sb.innerHTML = '<div class="sb-label">Groups</div>';
  GROUPS.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'nav-btn' + (activeGroup === g ? ' active' : '');
    btn.dataset.group = g;
    const id = 'nc_' + g.replace(/\W/g, '_');
    btn.innerHTML = `<span class="nav-icon">${ICONS[g] || '📁'}</span><span class="nav-label">${esc(g)}</span><span class="nav-count" id="${id}">0</span>`;
    btn.onclick = () => {
      activeGroup = g;
      renderSidebar();
      filter();
    };
    sb.appendChild(btn);
  });
}

function renderOptionsHTML(field) {
  const src = field.options || MODEL_CATALOGS[field.options_key] || [];

  if (field.options_key === 'LLM_MODEL') {
    const groups = MODEL_CATALOGS.LLM_MODEL || {};
    return Object.entries(groups).map(([group, items]) => {
      const options = items.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      return `<optgroup label="${esc(group)}">${options}</optgroup>`;
    }).join('');
  }

  if (Array.isArray(src)) {
    return src.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  }

  return '';
}

function defaultValueFor(field) {
  if (field.type === 'toggle') {
    const on = String(field.ph ?? '').toLowerCase();
    return ['1', 'true', 'yes', 'on', 'enabled'].includes(on) ? 'true' : 'false';
  }
  if (field.type === 'select') return String(field.ph ?? '');
  return '';
}

function valueControlHTML(field) {
  if (!field || !field.k) return '<span style="color:red">Invalid field</span>';
  const key = esc(field.k);
  const placeholder = esc(field.ph || field.lbl || '');
  const isSecret = !!field.secret;
  const isTextarea = field.type === 'textarea' || field.type === 'model_list';
  const hasPicker = !!field.options_key || Array.isArray(field.options);
  const inputType = isSecret ? 'password' : (field.type === 'number' ? 'number' : 'text');

  let control = '';
  if (field.type === 'toggle') {
    const initial = defaultValueFor(field);
    control = `
      <div class="toggle-shell" data-toggle-row="1" data-field="${key}">
        <input type="hidden" data-key="${key}" value="${initial}">
        <button type="button" class="tog ${initial === 'true' ? 'on' : ''}" data-toggle="${key}">${initial === 'true' ? 'On' : 'Off'}</button>
      </div>`;
  } else if (isTextarea) {
    control = `<textarea data-key="${key}" placeholder="${placeholder}" spellcheck="false"></textarea>`;
  } else {
    control = `<input type="${inputType}" data-key="${key}" placeholder="${placeholder}" spellcheck="false"/>`;
  }

  if (!hasPicker) return control;

  const pickerMode = field.type === 'model_list' ? 'multi' : 'single';
  const pickerLabel = field.type === 'model_list' ? 'Add model…' : 'Choose preset…';
  return `
    <div class="picker-shell" data-picker-shell="${key}" data-picker-mode="${pickerMode}">
      <div class="picker-row">
        <select class="picker-select" data-pick-for="${key}" aria-label="${esc(field.lbl || field.k)} presets">
          <option value="">${esc(pickerLabel)}</option>
          ${renderOptionsHTML(field)}
          <option value="__custom__">Custom…</option>
        </select>
        <button type="button" class="mini-btn" data-custom-for="${key}">+ Custom</button>
        <button type="button" class="mini-btn" data-clear-for="${key}">Clear</button>
      </div>
      ${control}
    </div>`;

}

function cardHTML(f, origIdx = 0) {
  const TAG_META = {
    critical:   { cls: 'badge-critical',   lbl: 'critical'   },
    credential: { cls: 'badge-credential', lbl: 'credential' },
    feature:    { cls: 'badge-feature',    lbl: 'feature'    },
    optional:   { cls: 'badge-optional',   lbl: 'optional'   },
    advanced:   { cls: 'badge-advanced',   lbl: 'advanced'   },
    build:      { cls: 'badge-build',      lbl: 'build-time' },
  };
  const tm = TAG_META[f.tag] || TAG_META.optional;
  const badge = `<span class="badge ${tm.cls}">${tm.lbl}</span>`;

  return `<div class="env-card" data-row data-orig-idx="${origIdx}" data-group="${esc(f.g)}" data-search="${esc((f.g + ' ' + f.k + ' ' + (f.lbl || '') + ' ' + (f.tag || '')).toLowerCase())}" data-tag="${esc(f.tag || 'optional')}">
    <div class="card-top">
      <input type="checkbox" class="card-check" data-check="${esc(f.k)}" ${f.common ? 'data-common="1"' : ''}>
      <div class="card-info">
        <div class="card-key">${esc(f.k)}</div>
        <div class="card-lbl">${esc(f.lbl || '')}</div>
      </div>
      ${badge}
    </div>
    <div class="card-input">${valueControlHTML(f)}</div>
  </div>`;
}

function addCustomRow(key = '', val = '', enabled = false) {
  const id = customCount++;
  const row = document.createElement('div');
  row.className = 'custom-row';
  row.dataset.customRow = id;
  row.dataset.enabled = enabled ? '1' : '0';

  row.innerHTML = `
    <input data-ck="${id}" placeholder="CUSTOM_ENV_NAME" value="${esc(key)}">
    <input data-cv="${id}" placeholder="value" value="${esc(val)}">
    <button class="tog${enabled ? ' on' : ''}">${enabled ? 'On' : 'Off'}</button>
  `;

  $('customRows').appendChild(row);

  row.querySelectorAll('input').forEach(el => el.addEventListener('input', refresh));
  const keyInput = row.querySelector(`[data-ck="${id}"]`);
  const syncCustomKey = () => {
    const customKey = (keyInput?.value || '').trim();
    if (customKey) row.dataset.customKey = customKey;
    else delete row.dataset.customKey;
  };
  row.querySelector(`[data-ck="${id}"]`)?.addEventListener('input', syncCustomKey);
  syncCustomKey();
  row.querySelector('button').onclick = () => {
    const on = row.dataset.enabled !== '1';
    row.dataset.enabled = on ? '1' : '0';
    row.querySelector('button').textContent = on ? 'On' : 'Off';
    row.querySelector('button').classList.toggle('on', on);
    refresh();
  };
}

function getFieldValueInput(key) {
  return document.querySelector(`[data-key="${CSS.escape(key)}"]`);
}

function setFieldValue(key, value) {
  const el = getFieldValueInput(key);
  if (!el) return;
  el.value = value ?? '';
}

function appendCsvValue(existing, next) {
  const parts = String(existing || '').split(',').map(s => s.trim()).filter(Boolean);
  const val = String(next || '').trim();
  if (!val) return parts.join(', ');
  if (!parts.includes(val)) parts.push(val);
  return parts.join(', ');
}

function collect() {
  const obj = {};
  document.querySelectorAll('[data-key]').forEach(el => {
    const key = el.dataset.key;
    if (!key || !safeKey(key)) return;
    // Only include if the card's checkbox is ticked
    const chk = document.querySelector(`[data-check="${CSS.escape(key)}"]`);
    if (!chk || !chk.checked) return;
    const val = String(el.value ?? '').trim();
    if (val) obj[key] = val;
  });

  document.querySelectorAll('[data-custom-row]').forEach(row => {
    const id = row.dataset.customRow;
    const key = (row.querySelector(`[data-ck="${id}"]`)?.value || '').trim();
    const val = (row.querySelector(`[data-cv="${id}"]`)?.value || '').trim();
    if (row.dataset.enabled === '1' && safeKey(key) && val) obj[key] = val;
  });

  return obj;
}

function generateBundle() {
  const obj = collect();
  const keys = Object.keys(obj).sort();
  const bundle = keys.length ? encodeBundle(Object.fromEntries(keys.map(k => [k, obj[k]]))) : '';
  $('bundleOut').value = bundle;
  $('envLineOut').value = bundle ? `HUGGINGCLAW_ENV_BUNDLE=${bundle}` : '';
}

function refresh() {
  const obj = collect();
  const keys = Object.keys(obj).sort();
  const s = $('summary');
  if (keys.length) {
    s.innerHTML = `<strong>${keys.length}</strong> variable${keys.length > 1 ? 's' : ''} selected<div class="sum-keys">${keys.map(k => `<button type="button" class="sum-key" data-jump-key="${esc(k)}">${esc(k)}</button>`).join('')}</div>`;
  } else {
    s.innerHTML = 'No variables selected yet.';
  }
  updateCounts();
}

function jumpToEnvKey(key) {
  if (!key) return;
  const card = document.querySelector(`[data-check="${CSS.escape(key)}"]`)?.closest('[data-row]');
  if (!card) {
    const customRow = document.querySelector(`[data-custom-row][data-custom-key="${CSS.escape(key)}"]`);
    if (!customRow) return;
    activeGroup = 'Custom Env';
    renderSidebar();
    filter();
    customRow.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    customRow.querySelector('input')?.focus({ preventScroll: true });
    return;
  }
  const group = card.dataset.group;
  if (group && activeGroup !== 'All' && activeGroup !== group) {
    activeGroup = group;
    renderSidebar();
    filter();
  }
  card.classList.remove('hidden');
  card.closest('.sec')?.classList.remove('sec-hidden');
  card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  const input = card.querySelector('[data-key]');
  if (input) input.focus({ preventScroll: true });
}

function markSelected() {
  document.querySelectorAll('[data-row]').forEach(r => r.classList.toggle('selected', !!r.querySelector('[data-check]')?.checked));
}

function updateCounts() {
  document.querySelectorAll('[id^="nc_"]').forEach(el => el.textContent = '0');
  const byGrp = {};
  document.querySelectorAll('[data-check]:checked').forEach(ch => {
    const g = ch.closest('[data-row]')?.dataset.group;
    if (g) byGrp[g] = (byGrp[g] || 0) + 1;
  });
  const custOn = document.querySelectorAll('[data-custom-row][data-enabled="1"]').length;
  const total = Object.values(byGrp).reduce((a, b) => a + b, 0) + custOn;
  const allEl = document.getElementById('nc_All'); if (allEl) allEl.textContent = total;
  Object.entries(byGrp).forEach(([g, c]) => {
    const el = document.getElementById('nc_' + g.replace(/\W/g, '_'));
    if (el) el.textContent = c;
  });
  const custEl = document.getElementById('nc_Custom_Env'); if (custEl) custEl.textContent = custOn;
}

function filter() {
  rebalanceAllSelectedCards();
  const q = $('search').value.trim().toLowerCase();
  document.querySelectorAll('.sec[data-section]').forEach(sec => {
    const grp = sec.dataset.section;
    const gMatch = activeGroup === 'All' || activeGroup === grp;
    if (!gMatch) { sec.classList.add('sec-hidden'); return; }
    let any = false;
    sec.querySelectorAll('[data-row]').forEach(card => {
      const m = !q || card.dataset.search.includes(q);
      card.classList.toggle('hidden', !m);
      if (m) any = true;
    });
    sec.classList.toggle('sec-hidden', !any);
  });
  const cs = $('customSec');
  if (cs) cs.style.display = (activeGroup === 'All' || activeGroup === 'Custom Env') ? '' : 'none';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.group === activeGroup));
  sortSectionsBySelection();
}

function clearForm() {
  document.querySelectorAll('[data-check]').forEach(c => c.checked = false);
  document.querySelectorAll('[data-key]').forEach(el => {
    if (el.closest('[data-toggle-row]')) {
      el.value = 'false';
      const btn = el.closest('.toggle-shell')?.querySelector('[data-toggle]');
      if (btn) {
        btn.textContent = 'Off';
        btn.classList.remove('on');
      }
      return;
    }
    el.value = '';
  });
  $('customRows').innerHTML = '';
  customCount = 0;
  addCustomRow();
}

function applyObj(obj, replace = false) {
  if (replace) clearForm();
  for (const [key, val] of Object.entries(obj || {})) {
    if (!safeKey(key)) continue;
    const inp = getFieldValueInput(key);
    const chk = document.querySelector(`[data-check="${CSS.escape(key)}"]`);
    if (inp && chk) {
      inp.value = val;
      chk.checked = true;
      const btn = inp.closest('[data-toggle-row]')?.querySelector('[data-toggle]');
      if (btn) {
        const on = String(val).trim().toLowerCase() === 'true';
        btn.textContent = on ? 'On' : 'Off';
        btn.classList.toggle('on', on);
        inp.value = on ? 'true' : 'false';
      }
    } else {
      addCustomRow(key, val, true);
    }
  }
  sortAllSections(); markSelected(); filter(); refresh();
}

function autoCheck(key) {
  const chk = document.querySelector(`[data-check="${CSS.escape(key)}"]`);
  if (chk && !chk.checked) {
    chk.checked = true;
    markSelected();
  }
}

function handlePickerChange(sel) {
  const key = sel.dataset.pickFor;
  const mode = sel.closest('[data-picker-shell]')?.dataset.pickerMode || 'single';
  const value = sel.value;
  if (!key || !value) return;
  if (value === '__custom__') {
    sel.value = '';
    return;
  }
  const inp = getFieldValueInput(key);
  if (!inp) return;

  if (mode === 'multi') {
    inp.value = appendCsvValue(inp.value, value);
  } else {
    inp.value = value;
  }
  sel.value = '';
  autoCheck(key);
  refresh();
}

function promptCustomModel(btn) {
  const key = btn.dataset.customFor;
  const mode = btn.closest('[data-picker-shell]')?.dataset.pickerMode || 'single';
  const inp = getFieldValueInput(key);
  if (!inp) return;
  const message = mode === 'multi'
    ? 'Enter one or more custom model IDs separated by commas'
    : 'Enter a custom model ID';
  const initial = '';
  const text = prompt(message, initial);
  if (text === null) return;
  const val = String(text).trim();
  if (!val) return;
  if (mode === 'multi') {
    const vals = val.split(',').map(s => s.trim()).filter(Boolean);
    let out = inp.value || '';
    for (const v of vals) out = appendCsvValue(out, v);
    inp.value = out;
  } else {
    inp.value = val;
  }
  autoCheck(key);
  refresh();
}

function resetPickerField(btn) {
  const key = btn.dataset.clearFor;
  const inp = getFieldValueInput(key);
  if (!inp) return;
  if (inp.closest('[data-toggle-row]')) {
    inp.value = 'false';
    const toggleBtn = inp.closest('.toggle-shell')?.querySelector('[data-toggle]');
    if (toggleBtn) {
      toggleBtn.textContent = 'Off';
      toggleBtn.classList.remove('on');
    }
  } else {
    inp.value = '';
  }
  refresh();
}

function toggleField(key) {
  const inp = getFieldValueInput(key);
  if (!inp) return;
  const on = String(inp.value || '').trim().toLowerCase() !== 'true';
  inp.value = on ? 'true' : 'false';
  const btn = inp.closest('.toggle-shell')?.querySelector('[data-toggle]');
  if (btn) {
    btn.textContent = on ? 'On' : 'Off';
    btn.classList.toggle('on', on);
  }
  // Auto-check when turned on; uncheck when turned off
  const chk = document.querySelector(`[data-check="${CSS.escape(key)}"]`);
  if (chk) {
    chk.checked = on;
    markSelected();
  }
  refresh();
}

function sortSection(cardEl) {
  const cards = cardEl && cardEl.closest('.cards');
  if (!cards) return;
  const all     = [...cards.querySelectorAll('[data-row]')];
  const checked = all.filter(c =>  c.querySelector('[data-check]')?.checked);
  const rest    = all.filter(c => !c.querySelector('[data-check]')?.checked);
  rest.sort((a, b) => Number(a.dataset.origIdx) - Number(b.dataset.origIdx));
  [...checked, ...rest].forEach(c => cards.appendChild(c));
}

function sortAllSections() {
  document.querySelectorAll('.cards').forEach(cards => {
    const all     = [...cards.querySelectorAll('[data-row]')];
    const checked = all.filter(c =>  c.querySelector('[data-check]')?.checked);
    const rest    = all.filter(c => !c.querySelector('[data-check]')?.checked);
    rest.sort((a, b) => Number(a.dataset.origIdx) - Number(b.dataset.origIdx));
    [...checked, ...rest].forEach(c => cards.appendChild(c));
  });
  rebalanceAllSelectedCards();
}

function sortSectionsBySelection() {
  const wrap = $('sections');
  if (!wrap) return;
  const sections = [...wrap.querySelectorAll('.sec[data-section]')];
  if (!sections.length) return;
  const query = $('search')?.value?.trim() || '';
  const totalSelected = document.querySelectorAll('[data-check]:checked').length;

  // Preserve stable/original ordering unless user is in All view with active selections
  // and no search query. This avoids unexpected jumps for existing users while typing.
  if (activeGroup !== 'All' || totalSelected === 0 || query) {
    sections
      .sort((a, b) => Number(a.dataset.origSectionIdx) - Number(b.dataset.origSectionIdx))
      .forEach(sec => wrap.appendChild(sec));
    return;
  }

  sections
    .sort((a, b) => {
      const aChecked = a.querySelectorAll('[data-check]:checked').length;
      const bChecked = b.querySelectorAll('[data-check]:checked').length;
      if (bChecked !== aChecked) return bChecked - aChecked;
      return Number(a.dataset.origSectionIdx) - Number(b.dataset.origSectionIdx);
    })
    .forEach(sec => wrap.appendChild(sec));
}

function bindFieldEvents() {
  document.querySelectorAll('[data-check]').forEach(el => el.addEventListener('change', () => { markSelected(); refresh(); }));
  document.querySelectorAll('[data-key]').forEach(el => el.addEventListener('input', refresh));
  document.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', () => toggleField(btn.dataset.toggle)));
  document.querySelectorAll('[data-pick-for]').forEach(sel => sel.addEventListener('change', () => handlePickerChange(sel)));
  document.querySelectorAll('[data-custom-for]').forEach(btn => btn.addEventListener('click', () => promptCustomModel(btn)));
  document.querySelectorAll('[data-clear-for]').forEach(btn => btn.addEventListener('click', () => resetPickerField(btn)));
}

function renderSections() {
  const grouped = {};
  FIELDS.forEach(f => {
    if (!f || !f.g || !f.k) return;
    (grouped[f.g] ||= []).push(f);
  });

  const wrap = $('sections');
  if (!wrap) return;
  wrap.innerHTML = '';
  Object.entries(grouped).forEach(([grp, items], secIdx) => {
    try {
      const sec = document.createElement('div');
      sec.className = 'sec';
      sec.dataset.section = grp;
      sec.dataset.origSectionIdx = String(secIdx);
      sec.innerHTML = `
        <div class="sec-header">
          <span class="sec-icon">${ICONS[grp] || '📁'}</span>
          <span class="sec-title">${esc(grp)}</span>
          <span class="sec-count">${items.length}</span>
          <div class="sec-line"></div>
        </div>
        <div class="cards">${items.map((f, i) => { try { return cardHTML(f, i); } catch(e) { console.error('cardHTML error for field', f.k, e); return ''; } }).join('')}</div>`;
      wrap.appendChild(sec);
    } catch(e) {
      console.error('renderSections error for group', grp, e);
    }
  });
  bindFieldEvents();
  sortSectionsBySelection();
}

function copyText(text) {
  const clipboardApi = navigator?.clipboard?.writeText;
  if (typeof clipboardApi !== 'function') {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copied ✓');
    return Promise.resolve();
  }
  return clipboardApi.call(navigator.clipboard, text).then(
    () => showToast('Copied ✓'),
    () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('Copied ✓');
    }
  );
}

// ── Init ──
try {
  renderSidebar();
  renderSections();
  addCustomRow();
  filter();
  refresh();
} catch(e) {
  console.error('HuggingClaw ENV Builder init error:', e);
  const wrap = document.getElementById('sections');
  if (wrap) wrap.innerHTML = '<div style="color:red;padding:20px">ENV Builder failed to load. Open browser console for details. Error: ' + e.message + '</div>';
}

// ── Events ──
$('search').oninput = filter;
$('selectRequired').onclick = () => {
  document.querySelectorAll('[data-row][data-tag="critical"] [data-check]').forEach(c => c.checked = true);
  sortAllSections();
  markSelected();
  refresh();
};
$('selectCommon').onclick = () => {
  document.querySelectorAll('[data-common="1"]').forEach(c => c.checked = true);
  sortAllSections();
  markSelected();
  refresh();
};
$('selectVisible').onclick = () => {
  document.querySelectorAll('.sec:not(.sec-hidden) [data-row]:not(.hidden) [data-check]').forEach(c => c.checked = true);
  sortAllSections();
  markSelected();
  refresh();
};
$('clearAll').onclick = () => {
  clearForm();
  sortAllSections();
  markSelected();
  filter();
  refresh();
};
$('applyImport').onclick = () => {
  try {
    const parsed = parseEnv($('importText').value);
    const count = Object.keys(parsed).length;
    if (!count) {
      showToast('No valid env keys found');
      return;
    }
    applyObj(parsed, true);
    showToast(`Imported ${count} key${count > 1 ? 's' : ''} ✓`);
  } catch (e) {
    showToast('Import failed');
    alert(e.message);
  }
};

// Import is explicit via the Import & Apply button to avoid surprising UI resets.
$('addCustom').onclick = () => addCustomRow();
$('applyBundle').onclick = () => {
  try {
    applyObj(decodeBundle($('bundleOut').value), true);
    showToast('Bundle applied ✓');
  } catch (e) {
    showToast('Invalid bundle');
  }
};
$('generateBundle').onclick = () => generateBundle();
$('copyBundle').onclick = () => copyText($('bundleOut').value);
$('copyEnvLine').onclick = () => copyText($('envLineOut').value);
$('copyJson').onclick = () => copyText(JSON.stringify(collect(), null, 2));
document.querySelectorAll('[data-tag-filter]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault();
    const tag = btn.dataset.tagFilter;
    if (!tag) return;
    $('search').value = tag;
    filter();
    const legend = $('tagLegend');
    if (legend) legend.open = false;
  });
});
$('summary').addEventListener('click', e => {
  const btn = e.target.closest('[data-jump-key]');
  if (!btn) return;
  jumpToEnvKey(btn.dataset.jumpKey);
});
$('summary').addEventListener('keydown', e => {
  const btn = e.target.closest('[data-jump-key]');
  if (!btn) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  jumpToEnvKey(btn.dataset.jumpKey);
});
