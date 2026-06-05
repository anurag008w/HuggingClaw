'use strict';

const RAW_KEY_ROTATOR_ENABLED = String(
  process.env.KEY_ROTATOR_ENABLED
  ?? process.env.KEY_ROTATOR
  ?? process.env.ROTATOR
  ?? 'off'
).trim();
const KEY_ROTATOR_ENABLED = /^(1|true|yes|on|enabled)$/i.test(RAW_KEY_ROTATOR_ENABLED);

if (!KEY_ROTATOR_ENABLED) {
  if (String(process.env.KEY_ROTATOR_LOG_LEVEL || '').trim().toLowerCase() !== 'silent') {
    console.error('[key-rotator] disabled by env (set ROTATOR=on or KEY_ROTATOR_ENABLED=true to enable HuggingClaw rotation; OpenClaw native key pools remain available).');
  }
  module.exports = { disabled: true, reason: 'env' };
  return;
}

/**
 * Multi-provider API key rotator for OpenClaw/HuggingClaw
 * --------------------------------------------------------
 * - Round-robin rotation per provider for new task windows
 * - Short same-task affinity avoids spending a new key for each sequential chunk
 * - 429/402 → exponential backoff blacklist per key
 * - After MAX_STRIKES consecutive failures → permanent session blacklist
 * - Successful response → strikes reset
 * - 10+ keys handled correctly (idx tracks only active keys, no drift)
 *
 * Env vars:
 *   ROTATOR / KEY_ROTATOR_ENABLED on/off                (default off)
 *   KEY_BLACKLIST_COOLDOWN_MS   base backoff ms        (default 60 000)
 *   KEY_MAX_STRIKES             failures before perm   (default 3)
 *   LLM_API_KEY_FALLBACK_ENABLED true/false            (default true)
 *   KEY_ROTATOR_LOG_LEVEL      info/debug/silent       (default info)
 *   KEY_ROTATOR_VERBOSE_PICKS  true/false              (default false)
 *     Verbose pick diagnostics are written to stdout so HF/Space logs do not
 *     label normal rotation decisions as process errors. Real warnings/errors
 *     still use stderr.
 */

const http  = require('node:http');
const https = require('node:https');
const fs    = require('node:fs');
const path  = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const VERBOSE_PICKS = /^(1|true|yes|on)$/i.test(String(process.env.KEY_ROTATOR_VERBOSE_PICKS || '').trim());
const RAW_LOG_LEVEL = String(process.env.KEY_ROTATOR_LOG_LEVEL || '').trim().toLowerCase();
const LOG_LEVEL = RAW_LOG_LEVEL || (
  VERBOSE_PICKS ||
  /^(1|true|yes|on)$/i.test(String(process.env.GATEWAY_VERBOSE || '').trim()) ||
  String(process.env.OPENCLAW_CONSOLE_LOG_LEVEL || '').trim().toLowerCase() === 'debug'
    ? 'debug'
    : 'info'
);
const log  = (...a) => { if (LOG_LEVEL !== 'silent') console.error(...a); };
const warn = (...a) => { if (LOG_LEVEL !== 'silent') console.warn(...a); };
const debug = (...a) => { if (LOG_LEVEL === 'debug') console.error(...a); };
const verbosePickLog = (...a) => { if (LOG_LEVEL === 'debug' && VERBOSE_PICKS) console.log(...a); };

// Prevent one logical request from being rotated multiple times when transports
// are stacked (global fetch → undici dispatch → node:http, or nested undici
// Agent/Pool/Client dispatches). The outermost patched layer injects the key and
// records the result; inner patched layers must pass through without another
// nextKey()/beginInFlight()/handler wrapper, otherwise one API call can burn 2-3
// keys and inflate the dashboard.
const rotatorRequestContext = new AsyncLocalStorage();
let rotatorSyncRequestDepth = 0;
let rotatorRequestSeq = 0;
const isInRotatorRequest = () => rotatorSyncRequestDepth > 0 || !!rotatorRequestContext.getStore()?.active;
const runInRotatorRequest = (fn) => rotatorRequestContext.run({ active: true }, fn);
const runInRotatorSyncRequest = (fn) => {
  rotatorSyncRequestDepth += 1;
  try { return fn(); }
  finally { rotatorSyncRequestDepth = Math.max(0, rotatorSyncRequestDepth - 1); }
};

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_COOLDOWN_MS = Math.max(
  1000,
  parseInt(process.env.KEY_BLACKLIST_COOLDOWN_MS || '', 10) || 60_000,
);
const MAX_STRIKES = Math.max(
  1,
  parseInt(process.env.KEY_MAX_STRIKES || '', 10) || 3,
);
const MAX_INFLIGHT_PER_KEY = Math.max(
  1,
  parseInt(process.env.KEY_MAX_INFLIGHT_PER_KEY || '', 10) || 3,
);
// Sticky providers (Gemini by default) are intentionally pinned until the
// provider returns a real key outcome (success keeps the pin; quota/auth/
// retryable provider failures clear it). In-flight leases are only local
// bookkeeping and can expire when a stream/caller stops being observed, so they
// must not force Gemini to walk the whole key pool. Keep this production-safe by
// making the behavior explicit and env-tunable for operators who prefer hard
// concurrency spreading.
const STICKY_IGNORE_INFLIGHT_SATURATION = !/^(0|false|no|off)$/i.test(
  String(process.env.KEY_STICKY_IGNORE_INFLIGHT_SATURATION || 'true').trim(),
);
// Task-affinity keys: same reasoning as sticky — in-flight leases are local
// bookkeeping only.  When the affinity key reaches MAX_INFLIGHT_PER_KEY,
// re-using it (with a warning) keeps the whole task on one key.  The
// alternative — dropping affinity and letting round-robin pick a new key —
// causes exactly the mid-task API-key switch the user observes.
// FIX: default changed to true so non-sticky providers (Anthropic, OpenAI, etc.)
// are protected from mid-task rotation just like Gemini sticky keys.
const TASK_AFFINITY_IGNORE_INFLIGHT_SATURATION = !/^(0|false|no|off)$/i.test(
  String(process.env.KEY_AFFINITY_IGNORE_INFLIGHT_SATURATION || 'true').trim(),
);
const COOLDOWN_JITTER_PCT = Math.min(
  50,
  Math.max(0, parseInt(process.env.KEY_BLACKLIST_JITTER_PCT || '', 10) || 15),
);
const FAILURE_DECAY_MS = Math.max(
  30_000,
  parseInt(process.env.KEY_FAILURE_DECAY_MS || '', 10) || 15 * 60_000,
);
const MAX_PERM_SUSPEND_MS = 16 * 60 * 60 * 1000;
const PERM_SUSPEND_MS = Math.min(
  MAX_PERM_SUSPEND_MS,
  Math.max(60_000, parseInt(process.env.KEY_PERM_SUSPEND_MS || '', 10) || MAX_PERM_SUSPEND_MS),
);
const RAW_FETCH_MAX_RETRIES = parseInt(process.env.KEY_FETCH_MAX_RETRIES || '', 10);
// Default to zero extra upstream attempts so the rotator never "eats" more
// provider quota than the caller requested. Users can opt in to same-request
// failover with KEY_FETCH_MAX_RETRIES=1 or 2.
const FETCH_MAX_RETRIES = Math.max(
  0,
  Math.min(2, Number.isFinite(RAW_FETCH_MAX_RETRIES) ? RAW_FETCH_MAX_RETRIES : 0),
);
const FETCH_RETRY_BASE_DELAY_MS = Math.max(
  0,
  Math.min(10_000, parseInt(process.env.KEY_FETCH_RETRY_BASE_DELAY_MS || '', 10) || 250),
);
const EMIT_SYNTHETIC_EVENTS = /^(1|true|yes|on)$/i.test(
  String(process.env.KEY_ROTATOR_EMIT_SYNTHETIC_EVENTS || '').trim(),
);
const ASSERT_NO_EXTRA_CALLS = /^(1|true|yes|on)$/i.test(
  String(process.env.KEY_ROTATOR_ASSERT_NO_EXTRA_CALLS || '').trim(),
);
const DIAGNOSTICS_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.KEY_ROTATOR_DIAGNOSTICS || '').trim(),
);
const DIAGNOSTICS_INTERVAL_MS = Math.max(
  10_000,
  parseInt(process.env.KEY_ROTATOR_DIAGNOSTICS_INTERVAL_MS || '', 10) || 60_000,
);
const EVENT_LOG_FILE = process.env.KEY_ROTATOR_EVENT_LOG_FILE || '/tmp/huggingclaw-key-rotator-events.jsonl';
const EVENT_LOG_MAX_BYTES = Math.max(64 * 1024, parseInt(process.env.KEY_ROTATOR_EVENT_LOG_MAX_BYTES || '', 10) || 1024 * 1024);
const INFLIGHT_TTL_MS = Math.max(
  30_000,
  Math.min(30 * 60_000, parseInt(process.env.KEY_INFLIGHT_TTL_MS || '', 10) || 30_000),
);
const REQUEST_MODEL_SNIFF_MAX_BYTES = Math.max(
  16 * 1024,
  Math.min(1024 * 1024, parseInt(process.env.KEY_MODEL_SNIFF_MAX_BYTES || '', 10) || 256 * 1024),
);
const ERROR_BODY_SNIFF_MAX_BYTES = Math.max(
  4 * 1024,
  Math.min(256 * 1024, parseInt(process.env.KEY_ERROR_BODY_SNIFF_MAX_BYTES || '', 10) || 64 * 1024),
);
const ERROR_BODY_WAIT_MS = Math.max(
  250,
  Math.min(10_000, parseInt(process.env.KEY_ERROR_BODY_WAIT_MS || '', 10) || 1500),
);

const USE_SUSPENDED_KEY_AS_LAST_RESORT = !/^(0|false|no|off)$/i.test(
  String(process.env.KEY_USE_SUSPENDED_AS_LAST_RESORT || 'true').trim(),
);

// Sticky mode keeps one key assigned to the same provider/model bucket until
// that key is suspended or fails.  Gemini enables it by default because Google
// quotas are model-scoped. New model buckets are initially balanced through
// normal round-robin, then stay pinned until their selected key fails for that
// model, preventing a logical chat turn from burning 2-3 keys.
const STICKY_UNTIL_FAILURE = !/^(0|false|no|off)$/i.test(
  String(process.env.KEY_STICKY_UNTIL_FAILURE || 'true').trim(),
);
const STICKY_PROVIDER_SET = new Set(
  String(process.env.KEY_STICKY_PROVIDERS || 'gemini')
    .split(/[,\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
);
const UNKNOWN_MODEL_SCOPE = '__unknown_model__';

// Task affinity keeps sequential non-sticky provider calls on the same key for
// an entire task window.  OpenClaw/HuggingClaw splits one user task into many
// upstream requests (planning → tool calls → result synthesis → follow-ups);
// pure per-request round-robin would spend a different key on every chunk and
// cause visible mid-task provider switches.
//
// FIX: defaults raised from 30 s / 3 reuses to 300 s / 50 reuses.
//   - 30 s was too short: complex tasks (deep research, multi-tool chains) easily
//     exceed it, causing a key switch at the 31st second.
//   - 3 reuses was too low: a single OpenClaw task can involve 5-20+ upstream
//     calls (think → tool → observe → think → tool → synthesize …).  After the
//     3rd call the rotator picked a fresh key mid-task.
// Round-robin load-balancing still resumes when a *new* task starts (affinity
// expires or key fails), so fairness across keys is preserved over time.
// Sticky providers (Gemini) use their stronger until-failure pin and are unaffected.
const RAW_TASK_AFFINITY_MS = parseInt(process.env.KEY_TASK_AFFINITY_MS || '', 10);
const TASK_AFFINITY_MS = Math.max(
  0,
  Number.isFinite(RAW_TASK_AFFINITY_MS) ? RAW_TASK_AFFINITY_MS : 300_000,  // 5 min — covers full task burst
);
const RAW_TASK_AFFINITY_MAX_REUSES = parseInt(process.env.KEY_TASK_AFFINITY_MAX_REUSES || '', 10);
const TASK_AFFINITY_MAX_REUSES = Math.max(
  0,
  Number.isFinite(RAW_TASK_AFFINITY_MAX_REUSES) ? RAW_TASK_AFFINITY_MAX_REUSES : 50,  // 50 calls — covers any task
);

// Maximum ms to respect from a Retry-After header.
// Old cap was 10s — too low for Gemini/Google which often returns 60s+.
const MAX_RETRY_AFTER_MS = Math.max(
  1_000,
  parseInt(process.env.KEY_MAX_RETRY_AFTER_MS || '', 10) || 5 * 60_000,
);

// Real-cycle: when all keys are suspended, sleep until the soonest key
// recovers rather than firing into a guaranteed 429.
// Default: 20 s — intentionally below HC_PROXY_TIMEOUT_MS (45 s) so the
// sleep never causes a proxy timeout.  With large key pools (50+) this
// path rarely triggers anyway; with 2-3 keys it prevents the rotator from
// sleeping longer than the upstream proxy allows.
// Default is 0 (disabled) — fire-and-miss on all-suspended pools.
// Set to a positive value (e.g. 20000) to sleep up to that many ms for the
// soonest-recovering key instead of immediately forwarding into a guaranteed 429.
const MAX_KEY_WAIT_MS = Math.max(
  0,
  parseInt(process.env.KEY_MAX_WAIT_MS || '', 10) || 0,
);

// Long suspend window for exhausted/invalid keys.
// Capped to 16h to avoid oversuppressing pools for too long.
const formatHours = (ms) => (ms / (60 * 60 * 1000)).toFixed(ms % (60 * 60 * 1000) === 0 ? 0 : 2);

/**
 * Returns a masked key string: first 4 chars + "..." + last 6 chars.
 * e.g. "AIzaSyBaklu...abc123" so logs are readable but keys stay private.
 * Short keys (≤12 chars) are fully masked as "***".
 */
const keyMask = (k) => (k && k.length > 12 ? `${k.slice(0, 4)}...${k.slice(-6)}` : '***');
const keyFingerprint = (k) => {
  try { return k ? crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 12) : null; }
  catch (_) { return null; }
};

// ─── Provider definitions ────────────────────────────────────────────────────

const PROVIDERS = [
  // Anthropic's native REST API (api.anthropic.com) authenticates via the
  // `x-api-key` header, NOT `Authorization: Bearer`. Injecting only a Bearer
  // header leaves the caller's original x-api-key in place, so the rotated pool
  // is never used. authHeader pins the correct header for key injection.
  { name:'anthropic',    hostname:/(?:^|\.)api\.anthropic\.com$/i,            envPlural:'ANTHROPIC_API_KEYS',        envSingular:'ANTHROPIC_API_KEY', authHeader:'x-api-key' },
  { name:'openai',       hostname:/(?:^|\.)api\.openai\.com$/i,               envPlural:'OPENAI_API_KEYS',           envSingular:'OPENAI_API_KEY' },
  { name:'gemini',       hostname:/(?:^|\.)(?:generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com)$/i,
                                                                               envPlural:'GEMINI_API_KEYS',           envSingular:'GEMINI_API_KEY',  queryParam:true,
    extraEnvPlural:['GOOGLE_API_KEYS', 'GOOGLE_GENERATIVE_AI_API_KEYS', 'GOOGLE_AI_API_KEYS', 'GOOGLE_GENAI_API_KEYS'],
    extraEnvSingular:['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_GENAI_API_KEY'],
    // Google enforces rate limits per-model per-key (RPM / TPD per model).
    // A 429 on gemini-2.5-pro must NOT blacklist the key for gemini-1.5-flash.
    perModelLimits: true },
  { name:'deepseek',     hostname:/(?:^|\.)api\.deepseek\.com$/i,             envPlural:'DEEPSEEK_API_KEYS',         envSingular:'DEEPSEEK_API_KEY' },
  { name:'openrouter',   hostname:/(?:^|\.)openrouter\.ai$/i,                 envPlural:'OPENROUTER_API_KEYS',       envSingular:'OPENROUTER_API_KEY' },
  { name:'kilocode',     hostname:/(?:^|\.)kilocode\.ai$/i,                   envPlural:'KILOCODE_API_KEYS',         envSingular:'KILOCODE_API_KEY' },
  { name:'opencode',     hostname:/(?:^|\.)opencode\.ai$/i,                   envPlural:'OPENCODE_API_KEYS',         envSingular:'OPENCODE_API_KEY' },
  { name:'zai',          hostname:/(?:^|\.)(?:z\.ai|open\.bigmodel\.cn)$/i,   envPlural:'ZAI_API_KEYS',             envSingular:'ZAI_API_KEY',
    extraEnvPlural:['ZHIPU_API_KEYS', 'BIGMODEL_API_KEYS'], extraEnvSingular:['ZHIPU_API_KEY', 'BIGMODEL_API_KEY'] },
  // FIX: kimi-coding aur moonshot ek hi hostname share karte hain (api.moonshot.cn).
  // Purani file mein dono alag entries thi — find() hamesha kimi-coding pick karta tha,
  // MOONSHOT_API_KEYS kabhi use nahi hoti. Ab merged entry: dono pools combine honge.
  { name:'kimi-moonshot',hostname:/(?:^|\.)api\.moonshot\.cn$/i,              envPlural:'KIMI_API_KEYS',            envSingular:'KIMI_API_KEY',
    _extraPlural:'MOONSHOT_API_KEYS', _extraSingular:'MOONSHOT_API_KEY' },
  { name:'minimax',      hostname:/(?:^|\.)api\.minimax\.chat$/i,             envPlural:'MINIMAX_API_KEYS',          envSingular:'MINIMAX_API_KEY' },
  { name:'xiaomi',       hostname:/(?:^|\.)api\.xiaomi\.com$/i,               envPlural:'XIAOMI_API_KEYS',           envSingular:'XIAOMI_API_KEY' },
  { name:'volcengine',   hostname:/(?:^|\.)(?:ark\.cn-beijing\.volces\.com|volcengineapi\.com)$/i,
                                                                               envPlural:'VOLCANO_ENGINE_API_KEYS',  envSingular:'VOLCANO_ENGINE_API_KEY',
    extraEnvPlural:['VOLCENGINE_API_KEYS', 'ARK_API_KEYS'], extraEnvSingular:['VOLCENGINE_API_KEY', 'ARK_API_KEY'] },
  { name:'byteplus',     hostname:/(?:^|\.)maas-api\.ml-platform-cn-beijing\.byteplus\.com$/i,
                                                                               envPlural:'BYTEPLUS_API_KEYS',         envSingular:'BYTEPLUS_API_KEY' },
  { name:'mistral',      hostname:/(?:^|\.)api\.mistral\.ai$/i,               envPlural:'MISTRAL_API_KEYS',          envSingular:'MISTRAL_API_KEY' },
  { name:'xai',          hostname:/(?:^|\.)api\.x\.ai$/i,                     envPlural:'XAI_API_KEYS',              envSingular:'XAI_API_KEY' },
  { name:'nvidia',       hostname:/(?:^|\.)(?:integrate\.api\.nvidia\.com|api\.nvidia\.com)$/i,
                                                                               envPlural:'NVIDIA_API_KEYS',           envSingular:'NVIDIA_API_KEY' },
  { name:'groq',         hostname:/(?:^|\.)api\.groq\.com$/i,                 envPlural:'GROQ_API_KEYS',             envSingular:'GROQ_API_KEY' },
  { name:'cohere',       hostname:/(?:^|\.)api\.cohere\.(?:ai|com)$/i,        envPlural:'COHERE_API_KEYS',           envSingular:'COHERE_API_KEY' },
  { name:'together',     hostname:/(?:^|\.)api\.together\.(?:xyz|ai)$/i,      envPlural:'TOGETHER_API_KEYS',         envSingular:'TOGETHER_API_KEY' },
  { name:'cerebras',     hostname:/(?:^|\.)api\.cerebras\.ai$/i,              envPlural:'CEREBRAS_API_KEYS',         envSingular:'CEREBRAS_API_KEY' },
  { name:'huggingface',  hostname:/(?:^|\.)(?:api-inference\.huggingface\.co|router\.huggingface\.co|huggingface\.co)$/i,
                                                                               envPlural:'HUGGINGFACE_HUB_TOKENS',   envSingular:'HUGGINGFACE_HUB_TOKEN',
    extraEnvPlural:['HUGGINGFACE_API_KEYS', 'HUGGINGFACE_HUB_API_KEYS', 'HF_TOKEN_POOL'],
    extraEnvSingular:['HUGGINGFACE_API_KEY', 'HUGGINGFACE_HUB_API_KEY', 'HF_TOKEN'] },
  { name:'venice',       hostname:/(?:^|\.)api\.venice\.ai$/i,                envPlural:'VENICE_API_KEYS',           envSingular:'VENICE_API_KEY' },
  { name:'github-copilot',hostname:/(?:^|\.)api\.githubcopilot\.com$/i,       envPlural:'COPILOT_GITHUB_TOKENS',    envSingular:'COPILOT_GITHUB_TOKEN',
    extraEnvPlural:['GITHUB_COPILOT_TOKENS', 'GITHUB_COPILOT_API_KEYS'],
    extraEnvSingular:['GITHUB_COPILOT_TOKEN', 'GITHUB_COPILOT_API_KEY'] },
  { name:'qianfan',      hostname:/(?:^|\.)(?:aip|qianfan)\.baidubce\.com$/i, envPlural:'QIANFAN_API_KEYS',         envSingular:'QIANFAN_API_KEY' },
  { name:'modelstudio',  hostname:/(?:^|\.)dashscope\.aliyuncs\.com$/i,       envPlural:'MODELSTUDIO_API_KEYS',      envSingular:'MODELSTUDIO_API_KEY',
    extraEnvPlural:['DASHSCOPE_API_KEYS', 'QWEN_API_KEYS', 'ALIBABA_CLOUD_API_KEYS'],
    extraEnvSingular:['DASHSCOPE_API_KEY', 'QWEN_API_KEY', 'ALIBABA_CLOUD_API_KEY'] },
  { name:'vercel-ai-gateway',hostname:/(?:^|\.)ai-gateway\.vercel\.sh$/i,     envPlural:'AI_GATEWAY_API_KEYS',       envSingular:'AI_GATEWAY_API_KEY',
    extraEnvPlural:['VERCEL_AI_GATEWAY_API_KEYS'], extraEnvSingular:['VERCEL_AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'] },
  { name:'synthetic',    hostname:/(?:^|\.)synthetic\.local$/i,               envPlural:'SYNTHETIC_API_KEYS',        envSingular:'SYNTHETIC_API_KEY' },
];

// ─── Key loading ─────────────────────────────────────────────────────────────

function normalizeKeys(...inputs) {
  const seen = new Set(), out = [];
  for (const input of inputs)
    // Accept comma/semicolon-separated values (OpenClaw-compatible) plus newline-separated values
    // (common when users paste many HF Space secrets from a spreadsheet/editor).
    // Do not split on generic spaces because some providers may someday use
    // structured token strings that contain spaces.
    for (const k of String(input || '').split(/[\n\r,;]+/).map(s => s.trim()).filter(Boolean))
      if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out;
}

function numberedEnvValues(baseName) {
  if (!baseName) return [];
  const prefix = `${baseName}_`;
  return Object.keys(process.env)
    .map(name => {
      if (!name.startsWith(prefix)) return null;
      const suffix = name.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) return null;
      return { name, idx: Number(suffix) };
    })
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx || a.name.localeCompare(b.name))
    .map(({ name }) => process.env[name] || '');
}

function providerEnvValues(p, ...names) {
  const flatNames = names.flat().filter(Boolean);
  return flatNames.flatMap(name => [process.env[name] || '', ...numberedEnvValues(name)]);
}

function providerDedicatedKeys(p) {
  // HuggingClaw's rotator keeps the existing pool env contract unchanged:
  // <PROVIDER>_API_KEYS remains the preferred pool, then <PROVIDER>_API_KEY,
  // numbered singular keys, and supported aliases. When ROTATOR=off this
  // preload is not added by start.sh, so OpenClaw reads the same env vars
  // directly using its native key rotation.
  return normalizeKeys(
    process.env[p.envPlural] || '',
    process.env[p.envSingular] || '',
    ...numberedEnvValues(p.envSingular),
    ...providerEnvValues(
      p,
      p._extraPlural,
      p._extraSingular,
      p.extraEnvPlural,
      p.extraEnvSingular,
    ),
  );
}

function keySlot(p, key) {
  const idx = p?.keys?.indexOf?.(key) ?? -1;
  return idx >= 0 ? `#${idx + 1}/${p.keys.length} ` : '';
}

function emitEvent(type, p, key, extra = {}) {
  try {
    const idx = key && p?.keys ? p.keys.indexOf(key) : -1;
    const payload = {
      ts: new Date().toISOString(),
      type,
      provider: p?.name || extra.provider || 'system',
      ...(idx >= 0 ? { slot: idx + 1, total: p.keys.length, key: keyMask(key), kid: keyFingerprint(key) } : {}),
      ...extra,
    };
    const dir = path.dirname(EVENT_LOG_FILE);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(EVENT_LOG_FILE, JSON.stringify(payload) + '\n', { encoding: 'utf8' });
    const stat = fs.statSync(EVENT_LOG_FILE);
    if (stat.size > EVENT_LOG_MAX_BYTES) {
      const keep = fs.readFileSync(EVENT_LOG_FILE, 'utf8').slice(-Math.floor(EVENT_LOG_MAX_BYTES * 0.75));
      fs.writeFileSync(EVENT_LOG_FILE, keep.replace(/^[^\n]*\n?/, ''), 'utf8');
    }
  } catch (_) { /* event logging must never affect requests */ }
}

// Per-key state: { strikes, blacklistedUntil }
// strikes   – consecutive 429/402 count; resets on success
// blacklistedUntil – epoch ms; 0 = active
function makeKeyState() { return { strikes: 0, blacklistedUntil: 0, lastFailureAt: 0, timesUsed: 0 }; }

/**
 * Extracts the model name from a request URL.
 * Gemini:   /v1beta/models/gemini-2.5-pro:generateContent  → "gemini-2.5-pro"
 * OpenAI-compat: cannot be extracted from URL (body only) → null
 */
function normalizeModelName(model) {
  if (typeof model !== 'string') return null;
  const raw = model.trim();
  if (!raw) return null;
  // Strip provider prefix when present (e.g. "google/gemini-2.5-pro" → "gemini-2.5-pro").
  return (raw.includes('/') ? raw.split('/').slice(1).join('/') : raw).toLowerCase();
}

function extractModelFromUrl(urlLike) {
  try {
    const str =
      typeof urlLike === 'string'   ? urlLike
      : urlLike instanceof URL      ? urlLike.href
      : (urlLike && typeof urlLike.url === 'string') ? urlLike.url
      : null;
    if (!str) return null;
    const m = new URL(str).pathname.match(/\/models\/([^/:?]+)/);
    return m ? normalizeModelName(m[1]) : null;
  } catch { return null; }
}

function bodyToUtf8String(body) {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
  if (Array.isArray(body)) {
    const parts = body.map(part => bodyToUtf8String(part));
    return parts.every(part => part !== null) ? parts.join('') : null;
  }
  return null;
}

function extractModelFromBody(body) {
  const text = bodyToUtf8String(body);
  if (!text) return null;
  try {
    const bodyModel = JSON.parse(text)?.model;
    return normalizeModelName(bodyModel);
  } catch { return null; }
}

function normalizeErrorToken(value) {
  return String(value || '').trim().toLowerCase();
}

function retryDelayMsFromText(text) {
  const raw = String(text || '');
  if (!raw) return 0;
  const retryIn = raw.match(/(?:retry|try again|retry-after|retry_after)[^0-9]{0,40}(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|mins?|minutes?)?/i);
  if (!retryIn) return 0;
  const value = Number(retryIn[1]);
  if (!Number.isFinite(value) || value < 0) return 0;
  const unit = String(retryIn[2] || 's').toLowerCase();
  const ms = unit.startsWith('m') && !unit.startsWith('ms') && !unit.startsWith('milli')
    ? value * 60_000
    : unit.startsWith('ms') || unit.startsWith('milli')
      ? value
      : value * 1000;
  return Math.min(MAX_RETRY_AFTER_MS, Math.round(ms));
}

function parseProviderErrorInfo(text) {
  if (!text || typeof text !== 'string') return null;
  const info = { raw: text.slice(0, ERROR_BODY_SNIFF_MAX_BYTES) };
  try {
    const body = JSON.parse(text);
    const err = body?.error || body;
    if (err && typeof err === 'object') {
      info.code = err.code ?? body.code;
      info.type = err.type ?? body.type;
      info.status = err.status ?? body.status;
      info.reason = err.reason ?? body.reason;
      info.message = err.message ?? body.message;
      if (!info.reason && Array.isArray(err.errors) && err.errors[0]) info.reason = err.errors[0].reason;
      if (Array.isArray(err.details)) {
        if (!info.reason) {
          const quota = err.details.find(d => d && (d.reason || d.violations || d.quotaMetric));
          if (quota) info.reason = quota.reason || quota.quotaMetric || 'quota_details';
        }
        const retry = err.details.find(d => d && (d.retryDelay || d.retry_delay));
        if (retry) info.retryAfterMs = retryDelayMsFromText(`retry in ${retry.retryDelay || retry.retry_delay}`);
      }
    }
  } catch (_) {
    info.message = text.slice(0, 512);
  }
  if (!info.retryAfterMs) info.retryAfterMs = retryDelayMsFromText(info.message || text);
  return info;
}

async function parseResponseErrorInfo(response) {
  if (!response || response.status < 400 || typeof response.clone !== 'function') return null;
  const deadline = Date.now() + ERROR_BODY_WAIT_MS;
  const remainingWait = () => Math.max(0, deadline - Date.now());
  const withDeadline = async (promise) => {
    const waitMs = remainingWait();
    if (waitMs <= 0) return { timedOut: true };
    let timer = null;
    try {
      return await Promise.race([
        promise.then(value => ({ value }), error => ({ error })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), waitMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    const clone = response.clone();
    if (clone.body && typeof clone.body.getReader === 'function') {
      const reader = clone.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (total < ERROR_BODY_SNIFF_MAX_BYTES) {
          const result = await withDeadline(reader.read());
          if (result.timedOut || result.error) break;
          const { done, value } = result.value || {};
          if (done) break;
          const buf = Buffer.isBuffer(value)
            ? value
            : value instanceof Uint8Array
              ? Buffer.from(value)
              : Buffer.from(String(value || ''));
          if (!buf.length) continue;
          const remaining = ERROR_BODY_SNIFF_MAX_BYTES - total;
          const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
          chunks.push(slice);
          total += slice.length;
        }
      } finally {
        try { reader.cancel().catch?.(() => {}); } catch (_) {}
      }
      return chunks.length ? parseProviderErrorInfo(Buffer.concat(chunks).toString('utf8')) : null;
    }
    const result = await withDeadline(clone.text());
    if (result.timedOut || result.error || typeof result.value !== 'string') return null;
    return parseProviderErrorInfo(result.value.slice(0, ERROR_BODY_SNIFF_MAX_BYTES));
  } catch (_) {
    return null;
  }
}

function providerErrorFields(errorInfo) {
  if (!errorInfo) return {};
  return {
    ...(errorInfo.code !== undefined ? { errorCode: String(errorInfo.code) } : {}),
    ...(errorInfo.type ? { errorType: String(errorInfo.type) } : {}),
    ...(errorInfo.status ? { errorStatus: String(errorInfo.status) } : {}),
    ...(errorInfo.reason ? { errorReason: String(errorInfo.reason) } : {}),
  };
}

function extractStatusFromError(err) {
  const direct = [
    err?.status,
    err?.statusCode,
    err?.code,
    err?.response?.status,
    err?.response?.statusCode,
    err?.cause?.status,
    err?.cause?.statusCode,
    err?.cause?.response?.status,
    err?.cause?.response?.statusCode,
  ];
  for (const value of direct) {
    if (typeof value === 'number' && value >= 100 && value <= 599) return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) {
      const n = Number(value.trim());
      if (n >= 100 && n <= 599) return n;
    }
  }

  const text = [
    err?.message,
    err?.cause?.message,
    err?.stack,
  ].filter(Boolean).join(' ');
  const match = text.match(/(?:^|\D)([1-5]\d{2})\s*(?:status(?:\s+code)?|http|response|provider)/i)
    || text.match(/(?:status(?:\s+code)?|http|response|provider)\D+([1-5]\d{2})(?:\D|$)/i)
    || text.match(/^\s*(?:[A-Za-z][A-Za-z0-9_]*Error:\s*)?([1-5]\d{2})\b/)
    || text.match(/\b([1-5]\d{2})\s+(?:RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|PERMISSION_DENIED|UNAUTHENTICATED|INVALID_ARGUMENT|FAILED_PRECONDITION|NOT_FOUND|overloaded|too many|unauthori[sz]ed|forbidden|rate)/i);
  return match ? Number(match[1]) : null;
}

function transportErrorInfo(err, status) {
  const message = String(err?.message || err?.cause?.message || '').slice(0, 512);
  const info = parseProviderErrorInfo(message) || { message };
  if (!info.message) info.message = message;
  if (typeof status === 'number') info.status = String(status);
  if (err?.type) info.type = err.type;
  if (err?.reason) info.reason = err.reason;
  return info;
}

function normalizeHttpStatusCode(status) {
  const n = Number(status);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function statusNeedsErrorBodyForScope(status) {
  status = normalizeHttpStatusCode(status);
  // Production classification needs provider error bodies for more than Gemini
  // 403s: many gateways encode quota/auth/transient reasons in JSON even when
  // the HTTP code is generic (400/404/422/5xx). We still cap the wait with
  // ERROR_BODY_WAIT_MS, so missing bodies close quickly instead of aging into
  // lease-only/pending dashboard noise.
  return status >= 400 && status < 600;
}

function classifyProviderFailure(p, status, errorInfo) {
  status = normalizeHttpStatusCode(status);
  const haystack = [
    errorInfo?.code,
    errorInfo?.type,
    errorInfo?.status,
    errorInfo?.reason,
    errorInfo?.message,
  ].map(normalizeErrorToken).join(' ');

  const looksRateOrQuota = /rate.?limit|too.?many|quota|resource.?exhaust|usage.?limit|insufficient.?quota|capacity.?exceeded|tokens?.?per|requests?.?per|rate_limit|rate.?limited|userratelimit|dailylimit|limitexceeded/.test(haystack);
  const looksAuth = /auth|unauthori[sz]ed|invalid.?api.?key|invalid.?key|permission|forbidden|billing|credit|payment|required/.test(haystack);
  const looksTransient = /overload|temporar|unavailable|timeout|backend|internal|server.?error|try.?again|capacity/.test(haystack);

  if (status >= 100 && status < 400) return 'success';
  if (status === 401) return 'auth';
  if (status === 402) return 'rate';
  if (status === 429) return 'rate';
  if (status === 529) return looksRateOrQuota ? 'rate' : 'transient';
  // Google/Vertex and some Google APIs can return 403 for quota/rate conditions
  // (rateLimitExceeded / QUOTA_EXCEEDED), while plain 403 remains auth/permission.
  if (status === 403) return looksRateOrQuota ? 'rate' : 'auth';
  if (looksRateOrQuota && (status === 400 || status === 409 || status === 413 || status === 423 || status === 425 || status === 529)) return 'rate';
  if (looksTransient) return 'transient';
  if (classifyRetryableFailure(status)) return 'transient';
  if (looksAuth && status >= 400 && status < 500) return 'auth';
  return 'other';
}

function isGeminiOpenAICompatPath(pathOrUrl) {
  try {
    const raw = String(pathOrUrl || '');
    if (!raw) return false;
    const pathname = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw).pathname
      : new URL(raw, 'https://generativelanguage.googleapis.com').pathname;
    return /\/v\d+(?:beta|alpha)?\/openai(?:\/|$)/i.test(pathname);
  } catch { return false; }
}

/**
 * Returns the earliest epoch-ms at which this key will be usable again,
 * considering both the global key state and (for perModelLimits providers)
 * the model-specific state.  Returns 0 if the key is currently active.
 */
function getKeyExpiry(p, key, model) {
  let expiry = p.keyState.get(key)?.blacklistedUntil ?? 0;
  if (p.modelKeyState) {
    const mks = p.modelKeyState.get(`${key}:${scopedModelKey(model)}`);
    if (mks && mks.blacklistedUntil > expiry) expiry = mks.blacklistedUntil;
  }
  return expiry;
}

function stickyBucketForProvider(p, model) {
  const rawScope = String(process.env.KEY_STICKY_SCOPE || '').trim().toLowerCase();
  const scope = rawScope === 'provider'
    ? 'provider'
    : rawScope === 'model' || rawScope === 'per-model'
      ? 'model'
      : p?.perModelLimits
        ? 'model'
        : 'provider';
  return scope === 'provider' ? '__provider__' : (model || UNKNOWN_MODEL_SCOPE);
}

function scopedModelKey(model) {
  return model || UNKNOWN_MODEL_SCOPE;
}

function isStickyProvider(p) {
  return !!(STICKY_UNTIL_FAILURE && p && STICKY_PROVIDER_SET.has(String(p.name || '').toLowerCase()));
}

function rememberStickyKey(p, model, key) {
  if (!isStickyProvider(p) || !key) return;
  p.stickyKeys.set(stickyBucketForProvider(p, model), key);
}

function clearStickyKey(p, key, model) {
  if (!p?.stickyKeys || !key) return;
  const hasScopedModelArg = arguments.length >= 3;
  if (hasScopedModelArg) {
    const bucket = stickyBucketForProvider(p, model);
    if (p.stickyKeys.get(bucket) === key) p.stickyKeys.delete(bucket);
    // Also clear the ambiguous fallback bucket if this key was selected before
    // a Gemini OpenAI-compatible request body revealed its model.  Do not clear
    // other model buckets: Gemini quota failures are model-scoped.
    if (model) {
      const fallbackBucket = stickyBucketForProvider(p, null);
      if (p.stickyKeys.get(fallbackBucket) === key) p.stickyKeys.delete(fallbackBucket);
    }
    return;
  }
  for (const [bucket, stickyKey] of p.stickyKeys) {
    if (stickyKey === key) p.stickyKeys.delete(bucket);
  }
}

function rememberTaskAffinityKey(p, model, key) {
  if (!p?.taskAffinity || !key || TASK_AFFINITY_MS <= 0 || TASK_AFFINITY_MAX_REUSES <= 0) return;
  // Sticky providers already have a stronger until-failure pin.  Do not layer a
  // second affinity system on top, otherwise diagnostics and expiry semantics
  // become harder to reason about.
  if (isStickyProvider(p)) return;
  const bucket = stickyBucketForProvider(p, model);
  // FIX: do NOT reset a still-valid affinity slot for the same key.
  // rememberTaskAffinityKey is called from nextKey's round-robin path every time
  // ANY key is picked (including the saturated-reuse fallback).  Overwriting a
  // live entry here would silently refill remainingReuses and extend expiresAt,
  // hiding the mid-task switch that TASK_AFFINITY_IGNORE_INFLIGHT_SATURATION is
  // meant to guard against.  Only create/replace when the bucket is empty,
  // pointing at a different key, or the existing entry has expired/exhausted.
  const existing = p.taskAffinity.get(bucket);
  if (existing && existing.key === key && Date.now() < existing.expiresAt && (existing.remainingReuses || 0) > 0) return;
  p.taskAffinity.set(bucket, {
    key,
    expiresAt: Date.now() + TASK_AFFINITY_MS,
    remainingReuses: TASK_AFFINITY_MAX_REUSES,
  });
}

function clearTaskAffinityKey(p, key, model) {
  if (!p?.taskAffinity || !key) return;
  const hasScopedModelArg = arguments.length >= 3;
  if (hasScopedModelArg) {
    const bucket = stickyBucketForProvider(p, model);
    if (p.taskAffinity.get(bucket)?.key === key) p.taskAffinity.delete(bucket);
    if (model) {
      const fallbackBucket = stickyBucketForProvider(p, null);
      if (p.taskAffinity.get(fallbackBucket)?.key === key) p.taskAffinity.delete(fallbackBucket);
    }
    return;
  }
  for (const [bucket, entry] of p.taskAffinity) {
    if (entry?.key === key) p.taskAffinity.delete(bucket);
  }
}

function pickAffinitizedKey(p, model) {
  if (!p?.taskAffinity || TASK_AFFINITY_MS <= 0 || TASK_AFFINITY_MAX_REUSES <= 0) return null;
  if (isStickyProvider(p)) return null;
  const bucket = stickyBucketForProvider(p, model);
  const entry = p.taskAffinity.get(bucket);
  if (!entry?.key) return null;
  if (Date.now() > entry.expiresAt || (entry.remainingReuses || 0) <= 0) {
    p.taskAffinity.delete(bucket);
    return null;
  }
  const key = entry.key;
  if (!p.keys.includes(key) || !isActive(p, key, model)) {
    p.taskAffinity.delete(bucket);
    return null;
  }
  const inflight = p.inFlight.get(key) || 0;
  const saturated = inflight >= MAX_INFLIGHT_PER_KEY;
  // FIX: when the affinity key is saturated, do NOT return null.
  // Returning null here drops affinity and sends the caller back to round-robin,
  // which picks a DIFFERENT key mid-task — the exact bug reported.
  // In-flight counts are local safety leases (they expire via INFLIGHT_TTL_MS),
  // not real provider verdicts; a saturated key is almost certainly still healthy.
  // Mirror sticky-provider behaviour: stay pinned and warn, rotate only on a
  // real provider failure (auth / rate / transient from handleStatus).
  if (saturated && !TASK_AFFINITY_IGNORE_INFLIGHT_SATURATION) return null;
  entry.remainingReuses -= 1;
  entry.expiresAt = Date.now() + TASK_AFFINITY_MS;
  if (entry.remainingReuses <= 0) p.taskAffinity.delete(bucket);
  if (saturated) {
    warn(`[key-rotator] ${p.name}: task-affinity key saturated but staying pinned on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''} inflight=${inflight + 1}/${MAX_INFLIGHT_PER_KEY} remaining-reuses=${Math.max(0, entry.remainingReuses || 0)} (affinity protects mid-task key switch)`);
    emitEvent('task_affinity_saturated_reuse', p, key, { model, inflight: inflight + 1, maxInflight: MAX_INFLIGHT_PER_KEY, ttlMs: TASK_AFFINITY_MS, remainingReuses: Math.max(0, entry.remainingReuses || 0), sticky: false, reason: 'affinity_until_real_failure' });
  } else {
    verbosePickLog(`[key-rotator] ${p.name}: task-affinity picked ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''} inflight=${inflight + 1}/${MAX_INFLIGHT_PER_KEY} remaining-reuses=${Math.max(0, entry.remainingReuses)}`);
    emitEvent('task_affinity_pick', p, key, { model, inflight: inflight + 1, maxInflight: MAX_INFLIGHT_PER_KEY, ttlMs: TASK_AFFINITY_MS, remainingReuses: Math.max(0, entry.remainingReuses), sticky: false });
  }
  return { key, waitMs: 0 };
}

function promoteStickyKeyModel(p, key, fromModel, toModel) {
  if (!key || !toModel) return;
  const fromBucket = stickyBucketForProvider(p, fromModel);
  const toBucket = stickyBucketForProvider(p, toModel);
  if (isStickyProvider(p)) {
    // Pin the now-known model bucket so future picks that DO know the model reuse it.
    rememberStickyKey(p, toModel, key);
    // Keep the unknown-model fallback bucket pinned to this key instead of
    // vacating it. OpenAI-compatible Gemini (and node:http) requests routinely
    // reach nextKey() before the body reveals the model, so the *next* request
    // also picks under the unknown bucket. Deleting it here sent every such
    // request back to round-robin, defeating stickiness entirely (keys rotated
    // on every call). The fallback pin is still cleared on a real provider
    // failure via clearStickyKey()'s fallback-bucket path.
    if (fromBucket !== toBucket && !p.stickyKeys.has(fromBucket)) {
      rememberStickyKey(p, fromModel, key);
    }
  }
  if (fromBucket !== toBucket && p.taskAffinity?.get(fromBucket)?.key === key) p.taskAffinity.delete(fromBucket);
  rememberTaskAffinityKey(p, toModel, key);
}


function modelProviderToRotatorProviderName(model) {
  const provider = String(model || '').split('/')[0].toLowerCase();
  const aliases = {
    google: 'gemini',
    gemini: 'gemini',
    'google-vertex': 'gemini',
    moonshot: 'kimi-moonshot',
    'kimi-coding': 'kimi-moonshot',
    qwen: 'modelstudio',
    dashscope: 'modelstudio',
    modelstudio: 'modelstudio',
    mistralai: 'mistral',
    'x-ai': 'xai',
    'z-ai': 'zai',
    'z.ai': 'zai',
    zhipu: 'zai',
    bigmodel: 'zai',
    'volcengine-plan': 'volcengine',
    'byteplus-plan': 'byteplus',
    'opencode-go': 'opencode',
    'github-copilot': 'github-copilot',
    'vercel-ai-gateway': 'vercel-ai-gateway',
  };
  return aliases[provider] || provider;
}

function configuredRouteProviderNames() {
  const explicit = String(process.env.KEY_LLM_FALLBACK_PROVIDERS || '').trim();
  if (explicit) {
    const values = explicit.split(/[\n\r,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (values.includes('*') || values.includes('all')) return null;
    return new Set(values.map(modelProviderToRotatorProviderName));
  }

  const models = [process.env.LLM_MODEL || '', ...String(process.env.LLM_FALLBACK_MODELS || '')
    .split(/[\n\r,]+/)
    .map(s => s.trim())]
    .filter(Boolean);
  if (!models.length) return null;
  return new Set(models.map(modelProviderToRotatorProviderName).filter(Boolean));
}

const LLM_FALLBACK_PROVIDER_SET = configuredRouteProviderNames();
function shouldUseLlmFallbackForProvider(p) {
  if (!p || p.name === 'synthetic') return false;
  return !LLM_FALLBACK_PROVIDER_SET || LLM_FALLBACK_PROVIDER_SET.has(String(p.name || '').toLowerCase());
}

const providerState = PROVIDERS.map(p => {
  const llmFallbackEnabled = !/^(0|false|no|off)$/.test(
    String(process.env.LLM_API_KEY_FALLBACK_ENABLED || '').trim().toLowerCase(),
  );

  const dedicatedKeys = providerDedicatedKeys(p);
  const hasDedicated = dedicatedKeys.length > 0;
  const useLlmFallback = !hasDedicated && llmFallbackEnabled && shouldUseLlmFallbackForProvider(p);
  const keys = hasDedicated
    ? dedicatedKeys
    : (useLlmFallback ? normalizeKeys(process.env.LLM_API_KEY || '') : []);

  if (hasDedicated)
    debug(`[key-rotator] ${p.name}: ${keys.length} key${keys.length === 1 ? '' : 's'}`);
  else if (!keys.length)
    verbosePickLog(`[key-rotator] No keys for provider "${p.name}"`);

  // keyState: Map<keyString, {strikes, blacklistedUntil}>
  const keyState = new Map(keys.map(k => [k, makeKeyState()]));

  // modelKeyState: Map<"key:model", {strikes, blacklistedUntil, lastFailureAt}>
  // Only populated for providers with perModelLimits (e.g. gemini).
  // Tracks 429 cooldowns scoped to (key, model) pairs so a rate-limited key
  // for model-A remains fully available for model-B.
  const modelKeyState = p.perModelLimits ? new Map() : null;

  // FIX: idx tracks position in the ACTIVE (non-permanently-removed) pool.
  // We never remove keys from the array — we just skip blacklisted ones.
  // idx advances only when a key is ACTUALLY picked (no drift for skipped keys).
  return { ...p, keys, keyState, modelKeyState, inFlight: new Map(), inFlightTimers: new Map(), idx: 0, stickyKeys: new Map(), taskAffinity: new Map() };
});

// LLM_API_KEY fallback summary
const fallbackCount = providerState.filter(p => (
  providerDedicatedKeys(p).length === 0 && p.keys.length > 0 && shouldUseLlmFallbackForProvider(p)
)).length;
if (fallbackCount > 0)
  debug(`[key-rotator] ${fallbackCount} provider(s) using LLM_API_KEY fallback`);

// ─── Per-key state helpers ────────────────────────────────────────────────────

/**
 * Is this key currently active (not sitting out)?
 *
 * For plain providers: checks the global keyState only.
 * For perModelLimits providers (e.g. gemini): additionally checks the
 * model-scoped state.  A key blocked for "gemini-2.5-pro" is still active
 * for "gemini-1.5-flash".
 *
 * Also auto-clears expired blacklists so keys re-enter the pool silently.
 * Strike decay: each natural expiry reduces strikes by 1 to avoid permanent
 * suspension from rate-limit bursts spread over hours.
 */
function isActive(p, key, model) {
  // ── Global key check ───────────────────────────────────────────────────────
  const ks = p.keyState.get(key);
  if (ks && ks.blacklistedUntil !== 0) {
    if (Date.now() < ks.blacklistedUntil) return false;   // still cooling down
    // Natural expiry: give partial fresh start
    ks.blacklistedUntil = 0;
    if (ks.strikes > 0) ks.strikes -= 1;
    debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} back in pool (strikes now ${ks.strikes})`);
  }

  // ── Per-model check (gemini etc.) ──────────────────────────────────────────
  if (p.modelKeyState) {
    const scopedModel = scopedModelKey(model);
    const mKey = `${key}:${scopedModel}`;
    const mks  = p.modelKeyState.get(mKey);
    if (mks && mks.blacklistedUntil !== 0) {
      if (Date.now() < mks.blacklistedUntil) return false;   // blocked for this model/unknown-model scope
      mks.blacklistedUntil = 0;
      if (mks.strikes > 0) mks.strikes -= 1;
      debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} back in pool for model=${model || 'unknown'} (strikes now ${mks.strikes})`);
    }
  }

  return true;
}

/**
 * Called when a key gets a 429/402 response.
 *
 * For perModelLimits providers (gemini): the blacklist is scoped to the
 * (key, model) pair so the key remains available for other models.
 * For all other providers: the global key state is penalised as before.
 *
 * Strike logic (same for both scopes):
 *   strike 1 → BASE_COOLDOWN_MS        (e.g. 60 s)
 *   strike 2 → BASE_COOLDOWN_MS × 4   (240 s)
 *   strike 3 → PERM_SUSPEND_MS (max 16 h)
 *
 * A successful response resets strikes so a temporarily rate-limited key
 * is treated as fresh again after recovery.
 */
function recordFailure(p, key, model, retryAfterMs) {
  if (!p || !key) return;
  // retryAfterMs: value from the server's Retry-After response header (already in ms).
  // When the server explicitly says "wait N seconds", use that if it's longer than
  // our exponential cooldown.  This prevents hammering a key before its quota resets.
  const serverHintMs = (typeof retryAfterMs === 'number' && retryAfterMs > 0) ? retryAfterMs : 0;

  if (p.modelKeyState) {
    const scopedModel = scopedModelKey(model);
    const mKey = `${key}:${scopedModel}`;
    let mks = p.modelKeyState.get(mKey);
    if (!mks) { mks = makeKeyState(); p.modelKeyState.set(mKey, mks); }

    mks.strikes     = Math.min(mks.strikes + 1, MAX_STRIKES);
    mks.lastFailureAt = Date.now();

    let cooldown;
    const isPerm = mks.strikes >= MAX_STRIKES;
    if (isPerm) {
      cooldown = PERM_SUSPEND_MS;
    } else {
      cooldown = BASE_COOLDOWN_MS * Math.pow(4, mks.strikes - 1);
      const jitter = 1 + ((Math.random() * 2 - 1) * (COOLDOWN_JITTER_PCT / 100));
      cooldown = Math.max(1_000, Math.round(cooldown * jitter));
      if (serverHintMs > cooldown) cooldown = serverHintMs;
    }
    // ★ Set blacklistedUntil FIRST so it is always written even if the log below throws.
    mks.blacklistedUntil = Math.max(mks.blacklistedUntil || 0, Date.now() + cooldown);
    if (isPerm)
      warn(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} model=${model || 'unknown'} hit ${MAX_STRIKES} strikes — suspended for ${formatHours(PERM_SUSPEND_MS)}h (quota likely exhausted for this model)`);
    else
      debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} model=${model || 'unknown'} strike ${mks.strikes}/${MAX_STRIKES} — backoff ${Math.round(cooldown / 1000)}s${serverHintMs > 0 ? ` (server-hint ${Math.round(serverHintMs/1000)}s)` : ''}`);
    return;
  }

  // ── Global path (all other providers) ─────────────────────────────────────
  let ks = p.keyState.get(key);
  if (!ks) { ks = makeKeyState(); p.keyState.set(key, ks); }

  ks.strikes = Math.min(ks.strikes + 1, MAX_STRIKES);
  ks.lastFailureAt = Date.now();

  let cooldown;
  const isPerm = ks.strikes >= MAX_STRIKES;
  if (isPerm) {
    cooldown = PERM_SUSPEND_MS;
  } else {
    // Exponential: 1× → 4× (strikes 1 and 2)
    cooldown = BASE_COOLDOWN_MS * Math.pow(4, ks.strikes - 1);
    const jitter = 1 + ((Math.random() * 2 - 1) * (COOLDOWN_JITTER_PCT / 100));
    cooldown = Math.max(1000, Math.round(cooldown * jitter));
    if (serverHintMs > cooldown) cooldown = serverHintMs;
  }
  // ★ Set blacklistedUntil FIRST so it is always written even if the log below throws.
  ks.blacklistedUntil = Math.max(ks.blacklistedUntil || 0, Date.now() + cooldown);
  if (isPerm)
    warn(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} reached ${MAX_STRIKES} strikes — suspended for ${formatHours(PERM_SUSPEND_MS)} h (quota likely exhausted)`);
  else
    debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} strike ${ks.strikes}/${MAX_STRIKES} — backoff ${Math.round(cooldown / 1000)}s${serverHintMs > 0 ? ` (server-hint ${Math.round(serverHintMs/1000)}s)` : ''}`);
}

/**
 * Called on transient retryable failures (non-quota/rate):
 * applies short cooldown without incrementing strikes.
 */
function recordTransientFailure(p, key, model = null) {
  if (!p || !key) return;
  const stateMap = p.modelKeyState ? p.modelKeyState : p.keyState;
  const stateKey = p.modelKeyState ? `${key}:${scopedModelKey(model)}` : key;
  let ks = stateMap.get(stateKey);
  if (!ks) { ks = makeKeyState(); stateMap.set(stateKey, ks); }
  ks.lastFailureAt = Date.now();
  const jitter = 1 + ((Math.random() * 2 - 1) * (COOLDOWN_JITTER_PCT / 100));
  const cooldown = Math.max(1000, Math.round(BASE_COOLDOWN_MS * jitter));
  ks.blacklistedUntil = Math.max(ks.blacklistedUntil || 0, Date.now() + cooldown);
  const secs = Math.round(cooldown / 1000);
  debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} transient backoff ${secs}s${p.modelKeyState ? ` model=${model || 'unknown'}` : ''} (strikes unchanged)`);
}

/**
 * Called on any 2xx/3xx response — resets the key's strike counter.
 * For perModelLimits providers, also clears the model-specific cooldown so
 * a key that recovered for a given model is immediately reusable.
 */
function recordSuccess(p, key, model) {
  // Reset global strikes and increment usage counter
  const ks = p.keyState.get(key);
  if (ks) {
    // ★ Increment timesUsed BEFORE the debug so it's always written even if log throws.
    ks.timesUsed = (ks.timesUsed || 0) + 1;
    if (ks.strikes > 0) {
      ks.strikes = 0;
      ks.lastFailureAt = 0;
      debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} recovered (global) — strikes reset`);
    }
  }

  // Also clear model-specific state on success.  If model is still unknown,
  // clear only the unknown-model scope; never clear other Gemini model buckets.
  if (p.modelKeyState) {
    const scopedModel = scopedModelKey(model);
    const mKey = `${key}:${scopedModel}`;
    const mks  = p.modelKeyState.get(mKey);
    if (mks && (mks.strikes > 0 || mks.blacklistedUntil > 0)) {
      mks.strikes = 0;
      mks.lastFailureAt = 0;
      mks.blacklistedUntil = 0;
      debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} model=${model || 'unknown'} recovered — strikes reset`);
    }
  }
}

function classifyRetryableFailure(status, errCode) {
  const retryableStatus = new Set([402, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
  const retryableErrorCodes = new Set([
    'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
    'ECONNREFUSED', 'EPIPE',
  ]);
  if (typeof status === 'number') return retryableStatus.has(status);
  if (errCode) return retryableErrorCodes.has(String(errCode).toUpperCase());
  return false;
}

function isCallerAbortError(err) {
  // OpenClaw's idle watchdog/caller aborts arrive as AbortError, sometimes with
  // a numeric DOMException code (for example 20). That numeric code is not a
  // provider/network failure code, and the selected API key might still be
  // perfectly healthy. Do not blacklist/rotate the key for this shape; just let
  // OpenClaw's same-model retry policy handle it.
  return String(err?.name || '') === 'AbortError';
}

function shouldRetryTransportError(err, code) {
  if (classifyRetryableFailure(undefined, code)) return true;
  return false;
}

function shouldRetryMethod(method, hasReplayableBody) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  if (m !== 'POST') return false;
  return hasReplayableBody;
}

function decrementInFlight(p, key) {
  const next = Math.max(0, (p.inFlight.get(key) || 0) - 1);
  if (next === 0) p.inFlight.delete(key);
  else p.inFlight.set(key, next);
  return next;
}

function removeInFlightToken(p, key, token) {
  if (!p?.inFlightTimers || !key || !token) return;
  const tokens = p.inFlightTimers.get(key) || [];
  const idx = tokens.indexOf(token);
  if (idx >= 0) tokens.splice(idx, 1);
  if (tokens.length) p.inFlightTimers.set(key, tokens);
  else p.inFlightTimers.delete(key);
}

function beginInFlight(p, key, model = null) {
  if (!p || !key) return null;
  const token = { done: false, timer: null, model: model || null, requestId: `${Date.now().toString(36)}-${(++rotatorRequestSeq).toString(36)}` };
  p.inFlight.set(key, (p.inFlight.get(key) || 0) + 1);
  emitEvent('request_started', p, key, { requestId: token.requestId, model: token.model || null, inflight: p.inFlight.get(key) || 0, ttlMs: INFLIGHT_TTL_MS });
  token.timer = setTimeout(() => {
    if (token.done) return;
    token.done = true;
    removeInFlightToken(p, key, token);
    const before = p.inFlight.get(key) || 0;
    if (before > 0) {
      const next = decrementInFlight(p, key);
      // A timeout here only releases the safety lease.  It must not be treated
      // as a key failure or as a still-pending provider request: one logical
      // OpenClaw task can be abandoned by a higher-level failover path, or keep
      // streaming after another layer has stopped observing it. The manager treats
      // this lease-cleanup event as a closed bookkeeping outcome while still
      // showing it separately from success/rate/auth counters.
      emitEvent('inflight_lease_expired', p, key, { requestId: token.requestId, model: token.model || null, inflightBefore: before, inflightAfter: next, ttlMs: INFLIGHT_TTL_MS, classifiedAs: 'lease_cleanup', closesPending: true });
    }
  }, INFLIGHT_TTL_MS);
  token.timer.unref?.();
  const tokens = p.inFlightTimers?.get(key) || [];
  tokens.push(token);
  p.inFlightTimers?.set(key, tokens);
  return token;
}

function endInFlight(p, key, token = null) {
  if (!p || !key) return;
  let activeToken = token;
  if (!activeToken) {
    const tokens = p.inFlightTimers?.get(key) || [];
    activeToken = tokens[0] || null;
  }
  if (activeToken) {
    if (activeToken.done) return;
    activeToken.done = true;
    if (activeToken.timer) clearTimeout(activeToken.timer);
    removeInFlightToken(p, key, activeToken);
  }
  decrementInFlight(p, key);
}

// ─── Round-robin selection ────────────────────────────────────────────────────

/**
 * Pick the next active key using round-robin.
 *
 * `model` (optional) — for perModelLimits providers (gemini) a key that is
 * rate-limited for modelA can still be active for modelB.  Pass the model so
 * `isActive` checks the scoped state in addition to the global one.
 *
 * Returns: { key, waitMs }
 *   key    – the chosen key string (may be null if pool empty)
 *   waitMs – > 0 means ALL keys are suspended; caller should sleep this long
 *            before using the key (real-cycle instead of fire-and-miss).
 *
 * FIX (idx drift): idx advances by 1 per CALL, not per skip.
 * We scan up to `total` positions from the current idx to find an active key.
 * The found key's position becomes the new baseline for the next call.
 *
 * Example with 10 keys where k3–k7 are blacklisted:
 *   call 1: start=0 → picks k0, next start=1
 *   call 2: start=1 → picks k1, next start=2
 *   call 3: start=2 → scans k2→active, picks k2, next start=3
 *   call 4: start=3 → scans k3(skip)…k7(skip)→k8 active, picks k8, next start=9
 *   call 5: start=9 → picks k9, next start=0
 * Every active key gets equal share; blacklisted keys are cleanly skipped.
 */
function nextKey(p, model) {
  if (!p || !p.keys.length) return { key: null, waitMs: 0 };

  const total = p.keys.length;

  const affinitized = pickAffinitizedKey(p, model);
  if (affinitized) return affinitized;

  if (isStickyProvider(p)) {
    const stickyKey = p.stickyKeys.get(stickyBucketForProvider(p, model));
    if (stickyKey && p.keys.includes(stickyKey) && isActive(p, stickyKey, model)) {
      const inflight = p.inFlight.get(stickyKey) || 0;
      if (inflight < MAX_INFLIGHT_PER_KEY || STICKY_IGNORE_INFLIGHT_SATURATION) {
        rememberTaskAffinityKey(p, model, stickyKey);
        const saturated = inflight >= MAX_INFLIGHT_PER_KEY;
        if (saturated) {
          // In-flight count is a local safety lease, not a provider verdict.
          // For sticky providers, only a real provider failure should move the
          // bucket to a different key; otherwise long streams/abandoned callers
          // make Gemini appear to "fail" every key by lease expiry alone.
          warn(`[key-rotator] ${p.name}: sticky key saturated but staying pinned until real provider outcome on ${keySlot(p, stickyKey)}${keyMask(stickyKey)}${model ? ` model=${model}` : ''} inflight=${inflight + 1}/${MAX_INFLIGHT_PER_KEY}`);
          emitEvent('sticky_saturated_reuse', p, stickyKey, { model, inflight: inflight + 1, maxInflight: MAX_INFLIGHT_PER_KEY, sticky: true, reason: 'sticky_until_real_failure' });
        } else {
          verbosePickLog(`[key-rotator] ${p.name}: sticky picked ${keySlot(p, stickyKey)}${keyMask(stickyKey)}${model ? ` model=${model}` : ''} inflight=${inflight + 1}/${MAX_INFLIGHT_PER_KEY}`);
          emitEvent('sticky_pick', p, stickyKey, { model, inflight: inflight + 1, maxInflight: MAX_INFLIGHT_PER_KEY });
        }
        return { key: stickyKey, waitMs: 0 };
      }

      // Operator opted out of strict sticky pinning. In that mode, saturation can
      // rotate away from the sticky key, but this is no longer the default for
      // Gemini because lease-only saturation is not a real key failure.
      warn(`[key-rotator] ${p.name}: sticky key saturated, rotating away from ${keySlot(p, stickyKey)}${keyMask(stickyKey)}${model ? ` model=${model}` : ''} inflight=${inflight}/${MAX_INFLIGHT_PER_KEY}`);
      emitEvent('sticky_saturated_rotate', p, stickyKey, { model, inflight, maxInflight: MAX_INFLIGHT_PER_KEY, sticky: true, reason: 'operator_opt_out' });
      clearStickyKey(p, stickyKey, model);
    } else if (stickyKey) {
      clearStickyKey(p, stickyKey, model);
    }
  }

  let bestPick = null;
  // Sticky mode should pin an existing provider/model bucket, but the first
  // assignment for a new bucket must still use normal round-robin.  Otherwise
  // every newly-seen model would hot-spot key #1 until it fails.
  const startIdx = p.idx;
  for (let offset = 0; offset < total; offset++) {
    const i   = (startIdx + offset) % total;
    const key = p.keys[i];
    if (isActive(p, key, model)) {
      const inflight = p.inFlight.get(key) || 0;
      if (inflight < MAX_INFLIGHT_PER_KEY) {
        p.idx = (i + 1) % total;   // next call starts AFTER the key we just picked
        rememberStickyKey(p, model, key);
        rememberTaskAffinityKey(p, model, key);
        verbosePickLog(`[key-rotator] ${p.name}: picked ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''}${isStickyProvider(p) ? ' (sticky until failure)' : ''} inflight=${inflight + 1}/${MAX_INFLIGHT_PER_KEY}`);
        emitEvent('pick', p, key, { model, inflight: inflight + 1, maxInflight: MAX_INFLIGHT_PER_KEY, sticky: isStickyProvider(p) });
        return { key, waitMs: 0 };
      }
      if (!bestPick) bestPick = { i, key, inflight, score: Number.POSITIVE_INFINITY };
      // Score: prefer keys with fewer recent failures and lower in-flight count.
      // For perModelLimits, also factor in model-specific strike count.
      const ks  = p.keyState.get(key) || makeKeyState();
      const mks = p.modelKeyState ? (p.modelKeyState.get(`${key}:${scopedModelKey(model)}`) || makeKeyState()) : makeKeyState();
      const recentFailPenalty =
        (ks.lastFailureAt  > 0 && (Date.now() - ks.lastFailureAt)  < FAILURE_DECAY_MS ? 100 : 0) +
        (mks.lastFailureAt > 0 && (Date.now() - mks.lastFailureAt) < FAILURE_DECAY_MS ? 100 : 0);
      const strikePenalty = ((ks.strikes || 0) + (mks.strikes || 0)) * 10;
      const score = recentFailPenalty + strikePenalty + inflight;
      if (score < bestPick.score) bestPick = { i, key, inflight, score };
    }
  }

  if (bestPick) {
    p.idx = (bestPick.i + 1) % total;
    rememberStickyKey(p, model, bestPick.key);
    rememberTaskAffinityKey(p, model, bestPick.key);
    warn(`[key-rotator] ${p.name}: all active keys saturated, reusing ${keySlot(p, bestPick.key)}${keyMask(bestPick.key)}${model ? ` model=${model}` : ''} inflight=${bestPick.inflight + 1}/${MAX_INFLIGHT_PER_KEY}`);
    emitEvent('saturated_reuse', p, bestPick.key, { model, inflight: bestPick.inflight + 1, maxInflight: MAX_INFLIGHT_PER_KEY, sticky: isStickyProvider(p) });
    return { key: bestPick.key, waitMs: 0 };
  }

  // All keys are sitting out — default to best-effort progress by reusing
  // the soonest-recovering key, unless explicitly disabled.
  if (!USE_SUSPENDED_KEY_AS_LAST_RESORT) {
    warn(`[key-rotator] ${p.name}: all ${total} key(s) suspended — withholding key until cooldown expires (last-resort disabled)`);
    emitEvent('all_suspended_withheld', p, null, { model, total });
    return { key: null, waitMs: 0 };
  }

  // FIX: scan from p.idx (same round-robin start as normal path) so ties in
  // expiry are broken by position — every key gets equal turns even when all
  // are suspended with the same blacklistedUntil timestamp.
  // For perModelLimits providers, use the effective (max of global + model) expiry.
  let bestIdx = -1, bestExpiry = Infinity;
  for (let offset = 0; offset < total; offset++) {
    const i   = (p.idx + offset) % total;
    const exp = getKeyExpiry(p, p.keys[i], model);
    if (exp < bestExpiry) { bestIdx = i; bestExpiry = exp; }
  }
  const chosenKey = p.keys[bestIdx];
  p.idx = (bestIdx + 1) % total; // advance for next call

  // Real-cycle: tell the caller how long to wait before using this key.
  // This avoids firing into a guaranteed 429 and wasting a request slot.
  const waitMs = Math.max(0, bestExpiry - Date.now());
  if (waitMs > 0)
    warn(`[key-rotator] ${p.name}: all ${total} key(s) suspended — soonest key ${keySlot(p, chosenKey)}${keyMask(chosenKey)} recovers in ${Math.round(waitMs / 1000)}s${model ? ` (model=${model})` : ''}`);
  else
    warn(`[key-rotator] ${p.name}: all ${total} key(s) suspended — using soonest-recovering key ${keySlot(p, chosenKey)}${keyMask(chosenKey)}`);

  rememberStickyKey(p, model, chosenKey);
  rememberTaskAffinityKey(p, model, chosenKey);
  emitEvent('all_suspended_pick', p, chosenKey, { model, waitMs, sticky: isStickyProvider(p) });
  return { key: chosenKey, waitMs };
}

// ─── Auth header injection ────────────────────────────────────────────────────

function normalizeHostname(hostLike) {
  const raw = String(hostLike || '').trim();
  if (!raw) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    return new URL(withScheme).hostname || null;
  } catch {
    return raw.replace(/^\[|\]$/g, '').split(':')[0] || null;
  }
}

function resolveHostname(urlLike) {
  try {
    const u =
      typeof urlLike === 'string'                         ? new URL(urlLike)
      : urlLike instanceof URL                            ? urlLike
      : urlLike && typeof urlLike.url === 'string'        ? new URL(urlLike.url)
      : urlLike && typeof urlLike.href === 'string'       ? new URL(urlLike.href)
      : urlLike && typeof urlLike.hostname === 'string'   ? urlLike
      : null;
    if (u?.hostname) return normalizeHostname(u.hostname);
    // node:http accepts `host` as an alias for `hostname` (often with a port).
    // Some SDKs and small probes use that form; without this the rotator never
    // picked a key, so /key-rotator looked empty even though keys were configured.
    if (urlLike && typeof urlLike.host === 'string') return normalizeHostname(urlLike.host);
    return null;
  } catch { return null; }
}

function matchProvider(hostname) {
  if (!hostname) return null;
  return providerState.find(p => p.hostname.test(hostname)) || null;
}
function resolveProviderFromHeaders(headers) {
  const targetHost = normalizeHostname(uGetHeader(headers || [], 'x-target-host'));
  return targetHost ? matchProvider(targetHost) : null;
}

function resolveProviderForUrl(urlLike, headers) {
  return matchProvider(resolveHostname(urlLike)) || resolveProviderFromHeaders(headers);
}

function setAuthHeader(headers, key) {
  if (!key) return headers;
  const val = `Bearer ${key}`;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.set('authorization', val); return headers;
  }
  if (Array.isArray(headers)) {
    return [...headers.filter(([k]) => String(k).toLowerCase() !== 'authorization'), ['authorization', val]];
  }
  if (headers && typeof headers === 'object') return { ...headers, authorization: val };
  return { authorization: val };
}

// Provider-aware auth injection. Most providers use `Authorization: Bearer <key>`,
// but some native APIs read the key from a different header (e.g. Anthropic uses
// `x-api-key`). For those, set the raw key on the provider's header instead of a
// Bearer token so the rotated key is actually the one the upstream API reads.
function applyProviderAuthHeaders(headers, provider, key) {
  if (!key) return headers;
  const headerName = provider && provider.authHeader ? String(provider.authHeader) : 'authorization';
  const value = headerName.toLowerCase() === 'authorization' ? `Bearer ${key}` : key;
  // uSetHeader handles every header shape used at the call sites — undici flat
  // arrays, fetch Headers/Map, and plain objects — and replaces case-insensitively.
  return uSetHeader(headers || {}, headerName, value);
}

function handleStatus(p, key, status, model, retryAfterMs, errorInfo, extra = {}) {
  if (!p || !key) return;
  status = normalizeHttpStatusCode(status);
  retryAfterMs = retryAfterMs || errorInfo?.retryAfterMs || 0;
  const failureKind = classifyProviderFailure(p, status, errorInfo);
  const errorFields = { ...providerErrorFields(errorInfo), ...extra };

  // Count every final HTTP success code as success before any key-failure logic.
  // Some transports/providers can surface 1xx/204/206/304-style successful
  // completions; these must reset the selected key and show as success in the
  // manager instead of falling through as an unclassified/no-op outcome.
  if (failureKind === 'success') {
    recordSuccess(p, key, model);
    emitEvent('success', p, key, { status, model, ...errorFields });
    return;
  }

  if (failureKind === 'auth') {
    // Invalid/expired/unauthorized key — always a global (not model-scoped) blacklist.
    let ks = p.keyState.get(key);
    if (!ks) { ks = makeKeyState(); p.keyState.set(key, ks); }
    ks.strikes = MAX_STRIKES;
    ks.lastFailureAt = Date.now();
    ks.blacklistedUntil = Date.now() + PERM_SUSPEND_MS;
    clearStickyKey(p, key);
    clearTaskAffinityKey(p, key);
    const reason = errorFields.errorReason || errorFields.errorStatus || errorFields.errorType || errorFields.errorCode || errorFields.source;
    warn(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} auth-failed (${status})${reason ? ` reason=${reason}` : ''}${model ? ` model=${model}` : ''} — suspended for ${formatHours(PERM_SUSPEND_MS)} h`);
    emitEvent('auth_failed', p, key, { status, model, suspendMs: PERM_SUSPEND_MS, ...errorFields });
    return;
  }

  if (failureKind === 'rate') {
    // For perModelLimits providers (gemini): quota is per (key, model).
    // recordFailure will scope the blacklist to the model when model is provided.
    // Pass retryAfterMs so the key blacklist respects the server's stated wait time.
    recordFailure(p, key, model, retryAfterMs);
    clearStickyKey(p, key, model);
    clearTaskAffinityKey(p, key, model);
    const reason = errorFields.errorReason || errorFields.errorStatus || errorFields.errorType || errorFields.errorCode;
    warn(`[key-rotator] ${p.name}: quota/rate status=${status}${reason ? ` reason=${reason}` : ''} on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''}${retryAfterMs ? ` retry-after=${Math.round(retryAfterMs/1000)}s` : ''}`);
    emitEvent('rate_limited', p, key, { status, model, retryAfterMs: retryAfterMs || 0, ...errorFields });
    return;
  }

  if (failureKind === 'transient') {
    // For per-model providers, keep transient cooldowns scoped to the current
    // model/unknown-model bucket so one Gemini model does not suppress the key
    // for all other Gemini models.
    recordTransientFailure(p, key, model);
    clearStickyKey(p, key, model);
    clearTaskAffinityKey(p, key, model);
    warn(`[key-rotator] ${p.name}: transient status=${status} on ${keySlot(p, key)}${keyMask(key)}`);
    emitEvent('transient_status', p, key, { status, model, ...errorFields });
    return;
  }

  if (status >= 400) {
    // Non-key failures (malformed request, missing model, unsupported feature,
    // content/safety/request-size errors, etc.) still need an explicit outcome
    // so the dashboard does not age a completed request into a fake transient.
    // Do not blacklist or rotate on these: the selected API key may be healthy.
    const eventType = status < 500 ? 'client_error' : 'provider_error';
    const reason = errorFields.errorReason || errorFields.errorStatus || errorFields.errorType || errorFields.errorCode || errorFields.source;
    warn(`[key-rotator] ${p.name}: ${eventType} status=${status}${reason ? ` reason=${reason}` : ''} on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''} (key not penalized)`);
    emitEvent(eventType, p, key, { status, model, ...errorFields });
  }
}

function handleTransportError(p, key, err, model = null, extra = {}) {
  if (!p || !key) return;
  // Node.js 18+ undici fetch throws TypeError: "fetch failed" where the actual
  // network error code lives in err.cause.code (e.g. ECONNRESET, ETIMEDOUT,
  // ENOTFOUND).  Fall back to err.cause.code so retryable network errors are
  // correctly classified and transient blacklists are applied.  OpenClaw
  // failover can also throw FailoverError("401 status code (no body)") instead
  // of returning a Response; parse that embedded HTTP status so the selected
  // key is marked auth/rate/transient correctly instead of becoming a stale
  // pending pick on the dashboard.
  const code = (err?.code || err?.cause?.code)
    ? String(err.code || err.cause?.code).toUpperCase()
    : '';
  const name = String(err?.name || '');
  const message = String(err?.message || err?.cause?.message || '');
  const haystack = `${name} ${message}`.toLowerCase();
  if (isCallerAbortError(err)) {
    debug(`[key-rotator] ${p.name}: caller abort ${name || 'AbortError'} on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''} — leaving key sticky/healthy`);
    emitEvent('transport_aborted', p, key, { model, ...extra, name: name || 'AbortError', code, message: message.slice(0, 240), classifiedAs: 'caller_abort' });
    return;
  }

  const embeddedStatus = extractStatusFromError(err);
  if (embeddedStatus) {
    const errorInfo = transportErrorInfo(err, embeddedStatus);
    warn(`[key-rotator] ${p.name}: transport status=${embeddedStatus} ${name || 'Error'} on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''}${message ? ` message=${JSON.stringify(message.slice(0, 160))}` : ''}`);
    handleStatus(p, key, embeddedStatus, model, 0, errorInfo, {
      source: 'transport_error',
      ...(name ? { name } : {}),
      ...(code ? { code } : {}),
      ...(message ? { message: message.slice(0, 240) } : {}),
      ...extra,
    });
    return;
  }

  const looksRateOrQuota = /rate.?limit|too.?many|quota|resource.?exhaust|usage.?limit|insufficient.?quota|capacity.?exceeded|tokens?.?per|requests?.?per|rate_limit|rate.?limited|userratelimit|dailylimit|limitexceeded/.test(haystack);
  if (looksRateOrQuota) {
    recordFailure(p, key, model, 0);
    clearStickyKey(p, key, model);
    clearTaskAffinityKey(p, key, model);
    warn(`[key-rotator] ${p.name}: transport/failover quota signal ${name || 'Error'}${code ? ` code=${code}` : ''} on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''}`);
    emitEvent('rate_limited', p, key, { model, ...extra, name: name || 'Error', code, source: 'transport_error', message: message.slice(0, 240) });
    return;
  }
  const retryable = shouldRetryTransportError(err, code);
  if (retryable) {
    recordTransientFailure(p, key, model);
    clearStickyKey(p, key, model);
    clearTaskAffinityKey(p, key, model);
    warn(`[key-rotator] ${p.name}: retryable network ${name || 'Error'}${code ? ` code=${code}` : ''} on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''}`);
    emitEvent('network_retryable', p, key, { model, ...extra, name: name || 'Error', code });
    return;
  }

  // Always close the dashboard/request lifecycle with a real observed outcome.
  // Unknown transport errors are not enough evidence to punish or rotate a key,
  // but emitting nothing leaves the manager showing phantom pending/lease-only
  // activity and makes sticky providers look broken.
  warn(`[key-rotator] ${p.name}: transport unknown ${name || 'Error'}${code ? ` code=${code}` : ''} on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''} (key not penalized)`);
  emitEvent('transport_unknown', p, key, { model, ...extra, name: name || 'Error', code, message: message.slice(0, 240), classifiedAs: 'non_key_transport_error' });
}

/**
 * Formats a remaining-suspend duration into a human-readable string.
 */
function formatRemaining(ms) {
  if (ms <= 0) return '0s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / (60 * 60_000)).toFixed(2)}h`;
}

function startDiagnostics() {
  if (!DIAGNOSTICS_ENABLED) return;
  setInterval(() => {
    const now = Date.now();
    const SEP = '─'.repeat(62);
    const lines = [`[key-rotator] ${SEP}`];

    for (const p of providerState) {
      if (!p.keys.length) continue;

      // ── Per-key detail ─────────────────────────────────────────────────────
      const keyRows = p.keys.map(k => {
        const ks        = p.keyState.get(k) || makeKeyState();
        const inflight  = p.inFlight.get(k) || 0;
        const globalSuspended = ks.blacklistedUntil > now;
        const remainMs  = globalSuspended ? ks.blacklistedUntil - now : 0;

        // For perModelLimits providers (gemini), collect per-model suspensions.
        const modelSuspensions = [];
        if (p.modelKeyState) {
          for (const [mKey, mks] of p.modelKeyState) {
            if (!mKey.startsWith(k + ':')) continue;
            if (mks.blacklistedUntil > now) {
              const model = mKey.slice(k.length + 1);
              modelSuspensions.push({ model, remainMs: mks.blacklistedUntil - now });
            }
          }
          modelSuspensions.sort((a, b) => b.remainMs - a.remainMs);
        }

        const neverUsed    = !ks.timesUsed;
        const anyModelSusp = modelSuspensions.length > 0;

        // Status icon:  ✅ active  🔴 globally suspended  ⚠️ active globally but some models blocked
        const icon = globalSuspended ? '🔴' : anyModelSusp ? '⚠️ ' : '✅';

        let row = `[key-rotator]   ${icon} #${p.keys.indexOf(k) + 1}/${p.keys.length} ${keyMask(k)}`;
        row += `  strikes:${ks.strikes}/${MAX_STRIKES}`;
        row += `  used:${ks.timesUsed || 0}`;
        row += `  inflight:${inflight}`;

        if (inflight > 0)         row += '  ← IN USE';
        else if (neverUsed)       row += '  (never used)';

        if (globalSuspended) {
          row += `  SUSPENDED ${formatRemaining(remainMs)}`;
        }

        if (modelSuspensions.length > 0) {
          const parts = modelSuspensions.map(m => `${m.model}:${formatRemaining(m.remainMs)}`);
          row += `  [models blocked: ${parts.join(', ')}]`;
        }

        return { row, globalSuspended, anyModelSusp, neverUsed, inflight };
      });

      const total     = keyRows.length;
      const active    = keyRows.filter(r => !r.globalSuspended).length;
      const suspended = total - active;
      const neverUsed = keyRows.filter(r => r.neverUsed).length;
      const inUse     = keyRows.filter(r => r.inflight > 0).length;

      // ── Provider header ────────────────────────────────────────────────────
      let header = `[key-rotator] 📦 ${p.name.toUpperCase()}`;
      header += `  total:${total}  ✅ active:${active}  🔴 suspended:${suspended}`;
      if (neverUsed) header += `  ⬜ unused:${neverUsed}`;
      if (inUse)     header += `  🔵 in-use:${inUse}`;
      lines.push(header);

      for (const { row } of keyRows) lines.push(row);
    }

    lines.push(`[key-rotator] ${SEP}`);
    lines.forEach(l => log(l));

    // Also emit machine-readable JSON on debug level for log consumers.
    if (LOG_LEVEL === 'debug') {
      const snapshot = providerState.filter(p => p.keys.length).map(p => {
        const keyStats = p.keys.map(k => {
          const ks           = p.keyState.get(k) || makeKeyState();
          const globalActive = ks.blacklistedUntil === 0 || now >= ks.blacklistedUntil;
          const modelSusp = {};
          if (p.modelKeyState) {
            for (const [mKey, mks] of p.modelKeyState) {
              if (!mKey.startsWith(k + ':')) continue;
              if (mks.blacklistedUntil > now) {
                const model = mKey.slice(k.length + 1);
                modelSusp[model] = Math.round((mks.blacklistedUntil - now) / 1000);
              }
            }
          }
          return {
            key: keyMask(k),
            active: globalActive,
            strikes: ks.strikes,
            inFlight: p.inFlight.get(k) || 0,
            timesUsed: ks.timesUsed || 0,
            ...(ks.blacklistedUntil > now ? { suspendedForSec: Math.round((ks.blacklistedUntil - now) / 1000) } : {}),
            ...(Object.keys(modelSusp).length ? { modelSusp } : {}),
          };
        });
        const active    = keyStats.filter(s => s.active).length;
        const suspended = keyStats.length - active;
        const stickyBuckets = {};
        if (p.stickyKeys?.size) {
          for (const [bucket, stickyKey] of p.stickyKeys) stickyBuckets[bucket] = keyMask(stickyKey);
        }
        return {
          provider: p.name,
          total: keyStats.length,
          active,
          suspended,
          ...(Object.keys(stickyBuckets).length ? { stickyBuckets } : {}),
          keys: keyStats,
        };
      });
      debug('[key-rotator] diagnostics-json', JSON.stringify({ ts: new Date().toISOString(), providers: snapshot }));
    }
  }, DIAGNOSTICS_INTERVAL_MS).unref?.();
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  // Numeric seconds (most common — Gemini, OpenAI, Anthropic all use this form)
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(MAX_RETRY_AFTER_MS, Math.round(sec * 1000));
  // HTTP-date form
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ts - Date.now()));
  return 0;
}

function chunkToBuffer(chunk) {
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  return null;
}

function createBodyModelSniffer(provider, key, getModel, setModel) {
  if (!provider?.perModelLimits || !key || typeof setModel !== 'function') return null;
  let total = 0;
  const chunks = [];
  let done = false;
  const tryDetect = (final = false) => {
    if (done || getModel?.()) return;
    if (!chunks.length) return;
    const text = Buffer.concat(chunks).toString('utf8');
    const model = extractModelFromBody(text);
    if (model) {
      done = true;
      setModel(model);
      promoteStickyKeyModel(provider, key, null, model);
      emitEvent('model_detected', provider, key, { model, source: 'request_body_sniff' });
    } else if (final || total >= REQUEST_MODEL_SNIFF_MAX_BYTES) {
      done = true;
    }
  };
  return {
    push(chunk) {
      if (done || getModel?.()) return;
      const buf = chunkToBuffer(chunk);
      if (!buf) { done = true; return; }
      if (total < REQUEST_MODEL_SNIFF_MAX_BYTES) {
        const remain = REQUEST_MODEL_SNIFF_MAX_BYTES - total;
        chunks.push(buf.length > remain ? buf.subarray(0, remain) : buf);
        total += Math.min(buf.length, remain);
        tryDetect(false);
      } else {
        done = true;
      }
    },
    final() { tryDetect(true); },
  };
}

function wrapBodyForModelSniffing(body, provider, key, getModel, setModel) {
  if (!body || getModel?.() || !provider?.perModelLimits) return body;
  const sniffer = createBodyModelSniffer(provider, key, getModel, setModel);
  if (!sniffer) return body;

  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array || body instanceof ArrayBuffer || Array.isArray(body)) {
    const text = bodyToUtf8String(body);
    if (text) {
      const model = extractModelFromBody(text);
      if (model) {
        setModel(model);
        promoteStickyKeyModel(provider, key, null, model);
        emitEvent('model_detected', provider, key, { model, source: 'request_body' });
      }
    }
    return body;
  }

  if (typeof body[Symbol.asyncIterator] === 'function') {
    return (async function* sniffAsyncBody() {
      try {
        for await (const chunk of body) {
          sniffer.push(chunk);
          yield chunk;
        }
      } finally {
        sniffer.final();
      }
    })();
  }

  if (typeof body[Symbol.iterator] === 'function') {
    return (function* sniffSyncBody() {
      try {
        for (const chunk of body) {
          sniffer.push(chunk);
          yield chunk;
        }
      } finally {
        sniffer.final();
      }
    })();
  }

  return body;
}

function buildAttemptFetchArgs(input, init, provider, usedKey) {
  const initObj = init && typeof init === 'object' ? { ...init } : {};
  const inputIsRequest = typeof Request !== 'undefined' && input instanceof Request;

  // Merge input headers (Request input) with init headers so key injection never drops caller headers.
  const baseHeaders = inputIsRequest
    ? new Headers(input.headers || undefined)
    : new Headers();
  if (initObj.headers) {
    const override = new Headers(initObj.headers);
    override.forEach((v, k) => baseHeaders.set(k, v));
  }

  // Preserve caller-provided duplex/body semantics (important for Node stream bodies).
  if (provider?.queryParam && usedKey) {
    const rawUrl = typeof input === 'string' || input instanceof URL
      ? String(input)
      : (input && typeof input.url === 'string' ? input.url : null);
    if (rawUrl) {
      const url = new URL(rawUrl);
      const openAICompatGemini = isGeminiOpenAICompatPath(rawUrl);
      if (!openAICompatGemini) url.searchParams.set('key', usedKey);

      // ★ FIX: Always set Bearer auth for Gemini requests with a key.
      // The ?key= approach only works for older Google APIs. Newer endpoints
      // like /v1beta/embeddings require Bearer auth. Setting both is safe —
      // Google APIs accept either format, and this fixes the 401 auth error
      // on memory/embedding calls that were failing before the key rotator.
      setAuthHeader(baseHeaders, usedKey);

      // With Request input and no explicit init overrides, keep request semantics by cloning shape.
      if (inputIsRequest && (!init || Object.keys(initObj).length === 0)) {
        const reqInit = {
          method: input.method,
          headers: baseHeaders,
        };
        if (input.signal) reqInit.signal = input.signal;
        if (!/^(GET|HEAD)$/i.test(String(input.method || 'GET')) && input.body != null) {
          reqInit.body = input.body;
          if (input.duplex) reqInit.duplex = input.duplex;
        }
        return [url.toString(), reqInit];
      }

      return [url.toString(), { ...initObj, headers: baseHeaders }];
    }

    // If URL cannot be safely rewritten, fall back to auth header injection.
    return [input, { ...initObj, headers: setAuthHeader(baseHeaders, usedKey) }];
  }

  if (usedKey) {
    return [input, { ...initObj, headers: applyProviderAuthHeaders(baseHeaders, provider, usedKey) }];
  }

  return [input, initObj];
}

// ─── Gemini thought-signature sanitiser ──────────────────────────────────────
//
// BUG: When a thinking-enabled Gemini model (e.g. gemini-2.5-pro / gemini-2.5-flash)
// is used in a multi-turn conversation, the model response contains "thought" parts
// with a `thought_signature` field (raw bytes, base64-encoded by the SDK).
// OpenClaw stores these in its internal conversation history.  On the next turn,
// a provider-conversion hop can accidentally turn an opaque signature into the
// Anthropic placeholder string "reasoning_content".  Gemini rejects that malformed
// payload with:
//   400 Invalid value at 'contents[N].parts[M].thought_signature' (TYPE_BYTES),
//   Base64 decoding failed for "reasoning_content"
//
// FIX: Keep valid `thought_signature` bytes intact, remove only standalone
// `thought: true` reasoning-only parts, and drop the known malformed
// string placeholder when it appears in `thought_signature`.
//
function stripGeminiThoughtParts(bodyStr) {
  if (typeof bodyStr !== 'string' || bodyStr.length === 0) return bodyStr;
  // Quick pre-check: skip JSON parse if neither key is present.
  if (!bodyStr.includes('thought_signature') && !bodyStr.includes('"thought":true') &&
      !bodyStr.includes('"thought": true')) {
    return bodyStr;
  }
  try {
    const body = JSON.parse(bodyStr);
    if (!body || !Array.isArray(body.contents)) return bodyStr;
    let modified = false;
    body.contents = body.contents.map(content => {
      if (!content || !Array.isArray(content.parts)) return content;
      let partsModified = false;
      const filtered = content.parts.map(part => {
        if (!part || typeof part !== 'object') return part;
        if (part.thought === true) { modified = true; partsModified = true; return null; }
        if (Object.prototype.hasOwnProperty.call(part, 'thought_signature') &&
            part.thought_signature === 'reasoning_content') {
          const { thought_signature, ...rest } = part;
          modified = true; partsModified = true;
          return rest;
        }
        return part;
      }).filter(Boolean);
      if (partsModified) {
        // Preserve the content entry even if all parts were stripped (empty
        // parts array is valid for role-only content markers).
        return { ...content, parts: filtered };
      }
      return content;
    });
    if (modified) {
      debug('[key-rotator] gemini: normalized malformed thought_signature history');
      return JSON.stringify(body);
    }
  } catch (_) { /* malformed JSON — leave untouched */ }
  return bodyStr;
}

// ─── Patch undici (covers OpenClaw gateway's bundled undici AI calls) ───────────
//
// ROOT CAUSE: OpenClaw gateway uses a bundled undici for all AI provider HTTP
// calls (Gemini, OpenRouter, NVIDIA, etc.).  patchFetch() and patchHttpModule()
// only cover globalThis.fetch and node:http/https.request — bundled undici
// bypasses both, so zero key-rotation or logging happens for gateway AI calls.
//
// FIX: wrap undici's dispatch() on Agent/Pool/Client prototypes, same approach
// cloudflare-proxy.js uses for URL rewriting.  Since cloudflare-proxy loads
// BEFORE this file (Dockerfile ENV sets it first in NODE_OPTIONS), its undici
// dispatch wrapper is already in place when patchUndici() runs.  We wrap that
// wrapper, so our code runs with the ORIGINAL origin before the proxy rewrites
// it to the CF worker URL.  Call chain after both patches:
//
//   app undici call
//     → rotator dispatch  (sees real hostname → picks key → injects key)
//     → cf-proxy dispatch (sees real hostname → rewrites origin to worker)
//     → original dispatch (sends to CF worker → forwards to real API)

/**
 * Get a header value from undici's flat [name, val, name, val] array
 * or from a plain object (case-insensitive).
 */
function uGetHeader(headers, name) {
  const lower = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2)
      if (String(headers[i]).toLowerCase() === lower) return String(headers[i + 1] || '');
    return '';
  }
  if (headers && typeof headers.get === 'function') {
    try {
      const value = headers.get(name) ?? headers.get(lower);
      if (value != null) return String(value);
    } catch (_) {}
  }
  if (headers && typeof headers === 'object') {
    for (const k of Object.keys(headers))
      if (k.toLowerCase() === lower) return String(headers[k] || '');
  }
  return '';
}

/**
 * Set / replace one header in undici flat-array or plain-object form.
 * Always returns a NEW array/object — does not mutate the original.
 */
function uSetHeader(headers, name, value) {
  const lower = name.toLowerCase();
  if (Array.isArray(headers)) {
    const out = [];
    let found = false;
    for (let i = 0; i < headers.length; i += 2) {
      if (String(headers[i]).toLowerCase() === lower) {
        if (!found) { out.push(headers[i], value); found = true; }
        // drop duplicate entries silently
      } else {
        out.push(headers[i], headers[i + 1]);
      }
    }
    if (!found) out.push(name, value);
    return out;
  }
  if (headers && typeof headers.set === 'function') {
    try {
      const out = typeof Headers !== 'undefined' && headers instanceof Headers
        ? new Headers(headers)
        : headers instanceof Map
          ? new Map(headers)
          : headers;
      out.set(name, value);
      return out;
    } catch (_) {}
  }
  // Plain object: case-insensitive replace
  const out = {};
  for (const k of Object.keys(headers || {})) {
    if (k.toLowerCase() !== lower) out[k] = headers[k];
  }
  out[name] = value;
  return out;
}

/**
 * Wraps an undici dispatch() handler so we can observe the response status
 * and call handleStatus / endInFlight after the request completes or errors.
 * Uses a Proxy so all undici handler methods forward correctly, including any
 * added in future undici versions (onBodySent, onRequestSent, onUpgrade …).
 */
function wrapUndiciHandler(handler, provider, key, inFlightToken, getModel) {
  if (!handler || typeof handler !== 'object') return handler;
  let statusCode = 0;
  let retryAfterMs = 0;
  let settled = false;
  let statusHandled = false;
  let errorBytes = 0;
  let bodyWaitTimer = null;
  const errorChunks = [];
  const currentModel = () => (typeof getModel === 'function' ? getModel() : null);
  const collectErrorBody = (chunk) => {
    if (!statusNeedsErrorBodyForScope(statusCode) || errorBytes >= ERROR_BODY_SNIFF_MAX_BYTES) return;
    try {
      const buf = chunkToBuffer(chunk);
      if (!buf?.length) return;
      const remaining = ERROR_BODY_SNIFF_MAX_BYTES - errorBytes;
      const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
      errorChunks.push(slice);
      errorBytes += slice.length;
    } catch (_) {}
  };
  const currentErrorInfo = () => {
    if (!errorChunks.length) return null;
    try { return parseProviderErrorInfo(Buffer.concat(errorChunks).toString('utf8')); } catch (_) { return null; }
  };
  const clearBodyWaitTimer = () => {
    if (bodyWaitTimer) {
      clearTimeout(bodyWaitTimer);
      bodyWaitTimer = null;
    }
  };
  const handleHeadersStatus = (force = false) => {
    if (statusHandled || !statusCode) return false;
    // Success and unambiguous failures are emitted as soon as headers arrive.
    // Long/streaming LLM responses may keep the body open longer than the
    // in-flight TTL, so waiting for onComplete can produce false
    // inflight_timeout events even though the provider already accepted the
    // request. Ambiguous 4xx provider errors (notably Gemini/Google 403 quota)
    // still wait until onComplete so their JSON body can decide model-scoped
    // quota vs global auth suspension.
    if (!force && statusNeedsErrorBodyForScope(statusCode)) return false;
    statusHandled = true;
    clearBodyWaitTimer();
    try { handleStatus(provider, key, statusCode, currentModel(), retryAfterMs, currentErrorInfo(), { requestId: inFlightToken?.requestId }); } catch (_) {}
    return true;
  };
  const settle = (fn) => {
    if (settled) return;
    settled = true;
    clearBodyWaitTimer();
    try { endInFlight(provider, key, inFlightToken); } catch (_) {}
    try { fn(); } catch (_) {}
  };
  return new Proxy(handler, {
    get(target, prop) {
      if (prop === 'onHeaders') {
        return function (sc, headers, resume, statusMessage) {
          statusCode = sc;
          retryAfterMs = parseRetryAfterMs(uGetHeader(headers, 'retry-after'));
          if (handleHeadersStatus()) {
            // Header-level status accounting is complete; close the in-flight
            // token now so successful streams do not later report lease expiry.
            settle(() => {});
          } else if (statusNeedsErrorBodyForScope(statusCode) && !bodyWaitTimer) {
            // Some OpenClaw failover paths stop reading an error response once a
            // higher layer has enough information to throw.  Do not let an
            // ambiguous 4xx wait for the 30s in-flight lease: give the provider
            // body a short chance to arrive, then classify with whatever we saw.
            bodyWaitTimer = setTimeout(() => {
              settle(() => { handleHeadersStatus(true); });
            }, ERROR_BODY_WAIT_MS);
            bodyWaitTimer.unref?.();
          }
          return target.onHeaders ? target.onHeaders.call(target, sc, headers, resume, statusMessage) : undefined;
        };
      }
      if (prop === 'onData') {
        return function (chunk) {
          collectErrorBody(chunk);
          return target.onData ? target.onData.call(target, chunk) : undefined;
        };
      }
      if (prop === 'onComplete') {
        return function (trailers) {
          try {
            return target.onComplete ? target.onComplete.call(target, trailers) : undefined;
          } finally {
            // Always close out rotator accounting even if the caller's undici
            // handler throws while consuming completion. Otherwise a successful
            // upstream response can leak in-flight state and never emit success.
            settle(() => { handleHeadersStatus(true); });
          }
        };
      }
      if (prop === 'onError') {
        return function (err) {
          try {
            return target.onError ? target.onError.call(target, err) : undefined;
          } finally {
            // User handlers may throw/rethrow; the rotator still owns the
            // in-flight token and transport error classification for this key.
            settle(() => { if (!statusHandled) { try { handleTransportError(provider, key, err, currentModel(), { requestId: inFlightToken?.requestId }); } catch (_) {} } });
          }
        };
      }
      // ── undici v6+/v7/v8 dispatch handler interface ──
      // Newer undici (OpenClaw bundles undici 8) no longer calls the classic
      // onHeaders/onData/onComplete/onError methods; it calls onResponseStart/
      // onResponseData/onResponseEnd/onResponseError instead (note the leading
      // `controller` argument and statusCode at index 1). Without instrumenting
      // these, status accounting (success + rate/auth classification) and the
      // in-flight lease release never run, so successful calls show success=0
      // and leak the lease until it TTL-expires (inflight_lease_expired).
      // The shared `settled`/`statusHandled` guards make this safe even if a
      // future undici were to emit both interfaces for one request.
      if (prop === 'onResponseStart') {
        return function (controller, sc, headers, statusMessage) {
          statusCode = sc;
          retryAfterMs = parseRetryAfterMs(uGetHeader(headers, 'retry-after'));
          if (handleHeadersStatus()) {
            settle(() => {});
          } else if (statusNeedsErrorBodyForScope(statusCode) && !bodyWaitTimer) {
            bodyWaitTimer = setTimeout(() => {
              settle(() => { handleHeadersStatus(true); });
            }, ERROR_BODY_WAIT_MS);
            bodyWaitTimer.unref?.();
          }
          return target.onResponseStart ? target.onResponseStart.call(target, controller, sc, headers, statusMessage) : undefined;
        };
      }
      if (prop === 'onResponseData') {
        return function (controller, chunk) {
          collectErrorBody(chunk);
          return target.onResponseData ? target.onResponseData.call(target, controller, chunk) : undefined;
        };
      }
      if (prop === 'onResponseEnd') {
        return function (controller, trailers) {
          try {
            return target.onResponseEnd ? target.onResponseEnd.call(target, controller, trailers) : undefined;
          } finally {
            settle(() => { handleHeadersStatus(true); });
          }
        };
      }
      if (prop === 'onResponseError') {
        return function (controller, err) {
          try {
            return target.onResponseError ? target.onResponseError.call(target, controller, err) : undefined;
          } finally {
            settle(() => { if (!statusHandled) { try { handleTransportError(provider, key, err, currentModel(), { requestId: inFlightToken?.requestId }); } catch (_) {} } });
          }
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/**
 * Patch one undici class prototype's dispatch() method to inject rotated keys.
 * Guards against double-patching with _kRotatorPatched flag (separate from
 * cloudflare-proxy's _patched flag so both can coexist on the same prototype).
 */
function patchUndiciDispatch(proto, tag) {
  if (!proto || typeof proto.dispatch !== 'function') return;
  if (proto.dispatch._kRotatorPatched) return;

  const origDispatch = proto.dispatch;

  proto.dispatch = function rotatorDispatch(options, handler) {
    if (isInRotatorRequest()) return origDispatch.call(this, options, handler);

    let usedKey = null, usedProvider = null, usedModel = null, usedInFlight = null;
    try {
      // Read origin BEFORE cloudflare-proxy's dispatch wrapper rewrites it.
      // We wrap CF proxy's wrapper, so at this point options.origin is still
      // the real target (e.g. generativelanguage.googleapis.com).
      let origin = options.origin;
      if (origin == null && this && this.origin != null) origin = this.origin;
      if (origin && typeof origin !== 'string') {
        try { origin = origin.origin || origin.href || origin.toString(); } catch (_) { origin = ''; }
      }
      let hostname = '';
      try {
        if (origin) hostname = new URL(String(origin)).hostname;
      } catch (_) {
        hostname = String(origin || '').replace(/^https?:\/\//, '').split(/[/:?]/)[0];
      }

      let provider = matchProvider(hostname) || resolveProviderFromHeaders(options.headers || []);
      if (provider) {
        const pathStr = options.path || '/';
        let model = provider.perModelLimits
          ? normalizeModelName(pathStr.match(/\/models\/([^/:?]+)/)?.[1])
          : null;

        // OpenAI-compatible Gemini requests sent through undici use a generic
        // /v1beta/openai/chat/completions path; the model only exists in the
        // JSON body.  Extract it before nextKey() so pick/rate/success events
        // carry the same per-model scope that the limiter uses.
        if (provider.perModelLimits && model === null) {
          const bodyModel = extractModelFromBody(options.body);
          if (bodyModel) {
            model = bodyModel;
            debug(`[key-rotator] ${provider.name}: undici (${tag}) model extracted from request body: ${model}`);
          }
        }

        const { key, waitMs } = nextKey(provider, model);
        if (key && waitMs > 0)
          warn(`[key-rotator] ${provider.name}: undici (${tag}): all keys suspended (${Math.round(waitMs / 1000)}s) — best-effort on ${keySlot(provider, key)}${keyMask(key)}${model ? ` model=${model}` : ''} (sync)`);

        if (key) {
          usedKey = key; usedProvider = provider; usedModel = model;
          usedInFlight = beginInFlight(usedProvider, usedKey, usedModel);

          const newOptions = { ...options };

          if (provider.queryParam) {
            // Gemini native REST endpoint: inject key as ?key=<rotated> in path.
            // Gemini OpenAI-compatible endpoints use Bearer auth instead, per
            // Google's compatibility docs, so do not put the key in the URL there.
            try {
              const pu = new URL(pathStr, 'http://d');
              if (!isGeminiOpenAICompatPath(pathStr)) pu.searchParams.set('key', key);
              newOptions.path = pu.pathname + pu.search;
            } catch (_) { /* leave path unchanged on URL parse failure */ }
            // ★ FIX: Always set Bearer auth for Gemini requests with a key.
            // The ?key= approach only works for older Google APIs. Newer endpoints
            // like /v1beta/embeddings require Bearer auth. Setting both is safe —
            // Google APIs accept either format, and this fixes the 401 auth error
            // on memory/embedding calls that were failing before the key rotator.
            newOptions.headers = uSetHeader(options.headers || {}, 'authorization', `Bearer ${key}`);
          } else {
            // All other providers: inject / replace the provider's auth header
            // (Authorization: Bearer for most; x-api-key for Anthropic, etc.)
            newOptions.headers = applyProviderAuthHeaders(options.headers || {}, provider, key);
          }

          newOptions.body = wrapBodyForModelSniffing(
            newOptions.body,
            usedProvider,
            usedKey,
            () => usedModel,
            (model) => { usedModel = model; if (usedInFlight) usedInFlight.model = model; },
          );
          const wrappedHandler = wrapUndiciHandler(handler, usedProvider, usedKey, usedInFlight, () => usedModel);
          return runInRotatorRequest(() => origDispatch.call(this, newOptions, wrappedHandler));
        }
      }
    } catch (err) {
      warn(`[key-rotator] undici (${tag}) dispatch patch error:`, err?.message || err);
      if (usedProvider && usedKey) { try { endInFlight(usedProvider, usedKey, usedInFlight); } catch (_) {} }
    }

    return origDispatch.call(this, options, handler);
  };

  proto.dispatch._kRotatorPatched = true;
  // Do not set cloudflare-proxy's own _cfProxyPatched marker here: the proxy
  // must still be able to wrap this dispatch if it loads after the rotator.
  // Cloudflare uses a WeakSet plus _cfProxyPatched to avoid re-wrapping.
  debug(`[key-rotator] undici (${tag}) dispatch patched`);
}

function patchUndiciInstance(exports) {
  if (!exports) return;
  if (exports.Agent?.prototype)      patchUndiciDispatch(exports.Agent.prototype,      'Agent');
  if (exports.Pool?.prototype)       patchUndiciDispatch(exports.Pool.prototype,       'Pool');
  if (exports.Client?.prototype)     patchUndiciDispatch(exports.Client.prototype,     'Client');
  if (exports.Dispatcher?.prototype) patchUndiciDispatch(exports.Dispatcher.prototype, 'Dispatcher');
  // Also patch the live global dispatcher instance prototype
  if (exports.getGlobalDispatcher) {
    try {
      const gd = exports.getGlobalDispatcher();
      if (gd) {
        const gdProto = Object.getPrototypeOf(gd);
        if (gdProto && gdProto !== Object.prototype)
          patchUndiciDispatch(gdProto, 'GlobalDispatcher');
      }
    } catch (_) {}
  }
}

function patchUndici() {
  // FIX: WeakSet guard — track which exports objects we've already processed so
  // that cached require() calls (Node returns the *same* object from cache) never
  // trigger a second patch round.  This is the root-cause fix for the log spam:
  // both cloudflare-proxy (_patched) and the rotator (_kRotatorPatched) use
  // *different* flags on the dispatch function, so each hook sees the other's
  // flag as missing and wraps again.  Without _seen, every call to
  // patchUndiciInstance on a cached exports object produces a new wrapper layer
  // and another "dispatch patched" log line — hundreds of them on startup.
  const _seen = new WeakSet();
  function patchOnce(exp) {
    if (!exp || typeof exp !== 'object') return;
    if (_seen.has(exp)) return;
    _seen.add(exp);
    patchUndiciInstance(exp);
  }

  // 1. Patch any undici already in the module cache (e.g. Node's built-in)
  try { patchOnce(require('undici')); } catch (_) {}

  // 2. Hook require() to patch undici instances that load later, including
  //    OpenClaw's bundled copy deep inside node_modules.
  //    Chain-safe: captures current Module.prototype.require (which may already
  //    be cloudflare-proxy's hook) so both hooks compose correctly.
  const Module = require('module');
  const _prevRequire = Module.prototype.require;
  const UNDICI_PATH_RE = /(?:^|\/)node_modules\/undici(?:\/|$)/;
  Module.prototype.require = function kRotatorUndiciHook(id) {
    const exp = _prevRequire.apply(this, arguments);
    if (id === 'undici' || UNDICI_PATH_RE.test(id)) {
      try { patchOnce(exp); } catch (_) {}
    }
    return exp;
  };
}

// ─── Patch globalThis.fetch ───────────────────────────────────────────────────

function patchFetch() {
  if (typeof globalThis.fetch !== 'function') return;
  const orig = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function patchedFetch(input, init = {}) {
    if (isInRotatorRequest()) return await orig(input, init);
    const urlLike = typeof input === 'string' || input instanceof URL
      ? input
      : (input && typeof input.url === 'string' ? input.url : null);
    const inputHeaders = typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined;
    const initHeaders = init && typeof init === 'object' ? init.headers : undefined;
    const provider = resolveProviderForUrl(urlLike, initHeaders || inputHeaders);
    if (!provider) return await orig(input, init);

    // Extract model for per-model-limit providers (gemini etc.)
    let model = provider.perModelLimits ? extractModelFromUrl(urlLike) : null;

    // ── Gemini: normalise thought parts / thought_signature before sending ───
    if (provider.name === 'gemini') {
      try {
        const rawBody = init?.body ?? (typeof input === 'object' && !(input instanceof URL) ? input?.body : null);
        if (typeof rawBody === 'string') {
          const cleaned = stripGeminiThoughtParts(rawBody);
          if (cleaned !== rawBody) {
            // Rebuild init with sanitised body; keep all other fields intact.
            init = { ...init, body: cleaned };
          }
        }
      } catch (_) { /* never break the request on sanitiser error */ }
    }

    // ★ FIX: OpenAI-compatible Gemini endpoint (/v1beta/openai/chat/completions)
    // does NOT include the model name in the URL path — it's in the JSON body as
    // {"model": "gemini-2.5-pro", ...}.  extractModelFromUrl() returns null for
    // these URLs, causing per-model cooldowns to silently fall through to the
    // GLOBAL key blacklist (wrong — a 429 on gemini-2.5-pro blocks all models).
    //
    // Read the model from the (already-sanitised) body when URL extraction fails,
    // so per-model cooldown scoping works correctly for the openai-completions path.
    if (provider.perModelLimits && model === null) {
      try {
        const rawBody = init?.body ?? (typeof input === 'object' && !(input instanceof URL) ? input?.body : null);
        const bodyModel = extractModelFromBody(rawBody);
        if (bodyModel) {
          model = bodyModel;
          debug(`[key-rotator] ${provider.name}: model extracted from request body: ${model}`);
        }
      } catch (_) { /* malformed or non-JSON body — leave model as null */ }
    }

    try {

      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const hasBodyFromInput = !!(input && typeof input === 'object' && 'body' in input && input.body != null);
      const hasBodyFromInit = !!(init && typeof init === 'object' && init.body != null);
      const hasBody = hasBodyFromInput || hasBodyFromInit;
      const hasReplayableBody = !hasBody || (typeof input === 'string' || input instanceof URL);
      const retryEligible = shouldRetryMethod(method, hasReplayableBody);
      const maxAttempts = retryEligible ? 1 + FETCH_MAX_RETRIES : 1;
      const triedKeys = new Set();
      let lastErr = null;
      let lastResponse = null;
      let upstreamAttempts = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let usedKey = null;
        let usedInFlight = null;
        try {
          let { key, waitMs } = nextKey(provider, model);

          // FIX: Prefer a fresh key for each retry without calling nextKey repeatedly
          // (which would advance p.idx for keys we never actually use, causing drift).
          // Instead, scan the pool directly for an untried active key.
          if (key && triedKeys.has(key) && triedKeys.size < provider.keys.length) {
            const total = provider.keys.length;
            const startIdx = isStickyProvider(provider) ? 0 : provider.idx;
            for (let offset = 0; offset < total; offset++) {
              const i = (startIdx + offset) % total;
              const candidate = provider.keys[i];
              if (!triedKeys.has(candidate) && isActive(provider, candidate, model)) {
                const inflight = provider.inFlight.get(candidate) || 0;
                if (inflight < MAX_INFLIGHT_PER_KEY) {
                  provider.idx = (i + 1) % total;
                  key = candidate; waitMs = 0;
                  rememberStickyKey(provider, model, key);
                  rememberTaskAffinityKey(provider, model, key);
                  emitEvent('pick_retry_fresh', provider, key, { model, attempt, sticky: isStickyProvider(provider) });
                  break;
                }
              }
            }
          }

          // ── Real-cycle: actually wait for the soonest suspended key ──────────
          // Old behaviour fired immediately into a guaranteed 429 (fake cycle).
          // Now we sleep until the key's cooldown expires so the request has a
          // real chance of succeeding.  Capped by MAX_KEY_WAIT_MS (env-tunable,
          // default 0 / disabled) so we never stall indefinitely.
          if (key && waitMs > 0 && MAX_KEY_WAIT_MS > 0) {
            const actualWait = Math.min(waitMs, MAX_KEY_WAIT_MS);
            await sleep(actualWait);
          }

          if (key) {
            triedKeys.add(key);
            usedKey = key;
            usedInFlight = beginInFlight(provider, key, model);
          }

          const attemptArgs = buildAttemptFetchArgs(input, init, provider, usedKey);
          upstreamAttempts += 1;
          const response = await runInRotatorRequest(() => orig(...attemptArgs));
          lastResponse = response;

          // Parse Retry-After BEFORE calling handleStatus so the key blacklist
          // is set to the correct duration the server asked for.
          const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
          const errorInfo = await parseResponseErrorInfo(response);
          try { endInFlight(provider, usedKey, usedInFlight); } catch (_) {}
          try { handleStatus(provider, usedKey, response.status, model, retryAfterMs, errorInfo, { requestId: usedInFlight?.requestId }); } catch (_) {}

          const shouldRetry = attempt < maxAttempts && classifyRetryableFailure(response.status);
          if (shouldRetry) {
            // FIX: Inter-attempt backoff should be SMALL (just a jitter) when we
            // have a fresh key to try.  The retry-after duration has already been
            // applied to the KEY blacklist via handleStatus — sleeping for the full
            // retry-after here would block the next attempt with a fresh key for
            // no reason (e.g. 60s wait when key2 is immediately available).
            const backoffMs = Math.min(2_000, FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
            warn(`[key-rotator] ${provider.name}: fetch retry ${attempt}/${maxAttempts - 1} after status=${response.status} method=${method}${retryAfterMs ? ` (retry-after ${Math.round(retryAfterMs/1000)}s applied to key blacklist)` : ''}`);
            await sleep(backoffMs);
            continue;
          }
          return response;
        } catch (err) {
          lastErr = err;
          try { endInFlight(provider, usedKey, usedInFlight); } catch (_) {}
          try { handleTransportError(provider, usedKey, err, model, { requestId: usedInFlight?.requestId }); } catch (_) {}
          // Node.js 18+ undici fetch: network errors are TypeError("fetch failed")
          // where the real code (ECONNRESET, ETIMEDOUT, ENOTFOUND …) is in
          // err.cause.code.  Check that first before falling back to err.code.
          const code = (err?.code || err?.cause?.code)
            ? String(err.code || err.cause?.code).toUpperCase()
            : '';
          const isAbort = String(err?.name || '') === 'AbortError';
          const shouldRetry = attempt < maxAttempts && shouldRetryTransportError(err, code);
          if (shouldRetry) {
            const backoffMs = Math.min(10_000, FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
            warn(`[key-rotator] ${provider.name}: fetch retry ${attempt}/${maxAttempts - 1} after network ${isAbort ? 'AbortError' : `code=${code || 'unknown'}`} method=${method}`);
            await sleep(backoffMs);
            continue;
          }
          throw err;
        }
      }

      if (ASSERT_NO_EXTRA_CALLS && upstreamAttempts > 1) {
        warn(`[key-rotator] ${provider.name}: ASSERT_NO_EXTRA_CALLS observed ${upstreamAttempts} upstream attempts for one ${method} request`);
      }
      if (lastResponse) return lastResponse;
      if (lastErr) throw lastErr;
      return await runInRotatorRequest(() => orig(input, init));
    } catch (err) {
      warn(`[key-rotator] ${provider.name}: fetch patch error:`, err?.message || err);
      throw err;
    }
  };
}

// ─── Patch node:http / node:https ────────────────────────────────────────────

function patchHttpModule(mod) {
  const orig = mod.request;
  const origGet = mod.get;

  mod.request = function patchedRequest(...args) {
    if (isInRotatorRequest()) return orig.apply(mod, args);

    let usedKey = null, usedProvider = null, usedModel = null, usedInFlight = null;

    try {
      const options  = args[0];
      const hasOptionsArg = args[1] && typeof args[1] === 'object' && typeof args[1].on !== 'function';
      const optionHeaders = (() => {
        const first = options && typeof options === 'object' ? options.headers : undefined;
        const second = hasOptionsArg ? args[1].headers : undefined;
        if (!first) return second;
        if (!second) return first;
        return { ...first, ...second };
      })();
      const provider = resolveProviderForUrl(options, optionHeaders);

      if (provider) {
        // Extract model for per-model-limit providers from the effective request path.
        const pathStr = hasOptionsArg && args[1].path
          ? args[1].path
          : typeof options === 'object' && options.path
            ? options.path
            : (typeof options === 'string' || options instanceof URL) ? String(options) : '';
        const model = provider.perModelLimits
          ? (pathStr.match(/\/models\/([^/:?]+)/)?.[1]?.toLowerCase() || null)
          : null;

        const { key, waitMs } = nextKey(provider, model);
        // Note: patchHttpModule is synchronous — we cannot await a sleep here.
        // Real-cycle sleep is only available through patchFetch (async path).
        // Log a warning if we would have benefited from it.
        if (key && waitMs > 0)
          warn(`[key-rotator] ${provider.name}: http: all keys suspended (waitMs=${Math.round(waitMs/1000)}s) — firing best-effort on ${keySlot(provider, key)}${keyMask(key)}${model ? ` model=${model}` : ''} (sync path; use fetch for real-cycle)`);

        if (key) {
          usedKey = key; usedProvider = provider; usedModel = model;
          usedInFlight = beginInFlight(usedProvider, usedKey, usedModel);
          if (provider.queryParam) {
            const u = new URL(String(
              typeof options === 'string' || options instanceof URL
                ? options
                : `${options.protocol || 'https:'}//${options.hostname || options.host || 'localhost'}${options.path || '/'}`
            ));
            // node:http merges request(url, options) with options taking
            // precedence, including `path`. If callers pass an override path in
            // the second arg, inject into that effective path too; otherwise the
            // key added to the URL arg can be silently discarded by Node.
            if (hasOptionsArg && args[1].path) {
              const override = new URL(String(args[1].path), u);
              u.pathname = override.pathname;
              u.search = override.search;
            }
            if (!isGeminiOpenAICompatPath(u.pathname)) u.searchParams.set('key', key);
            // ★ FIX: Always set Bearer auth for Gemini requests with a key.
            // The ?key= approach only works for older Google APIs. Newer endpoints
            // like /v1beta/embeddings require Bearer auth. Setting both is safe —
            // Google APIs accept either format, and this fixes the 401 auth error
            // on memory/embedding calls that were failing before the key rotator.
            const existingHeaders = (typeof options === 'object' && !(options instanceof URL) && options.headers)
              ? options.headers
              : (hasOptionsArg ? args[1].headers : undefined);
            const patchedHeaders = setAuthHeader(existingHeaders, key);
            if (typeof options === 'object' && !(options instanceof URL)) {
              args[0] = { ...options, path:`${u.pathname}${u.search}`, headers: patchedHeaders };
            } else {
              args[0] = u.toString();
              if (hasOptionsArg) {
                args[1] = { ...args[1], path:`${u.pathname}${u.search}`, headers: patchedHeaders };
              } else {
                args[1] = { headers: patchedHeaders };
              }
            }
          } else if (typeof options === 'string' || options instanceof URL) {
            const u = new URL(String(options));
            const extra = hasOptionsArg ? args[1] : {};
            args[0] = { protocol:u.protocol, hostname:u.hostname, port:u.port,
                        path:`${u.pathname}${u.search}`, ...extra,
                        headers:applyProviderAuthHeaders(extra.headers, provider, key) };
            // We have folded the second options argument into args[0]. Leaving it
            // in place would call http.request(options, options, cb), where Node
            // expects the second argument to be the callback and can throw or drop
            // the real callback for non-query providers such as OpenAI/Anthropic.
            if (hasOptionsArg) {
              if (typeof args[2] === 'function') { args[1] = args[2]; args.length = 2; }
              else { args.length = 1; }
            }
          } else if (options && typeof options === 'object') {
            args[0] = { ...options, headers:applyProviderAuthHeaders(options.headers, provider, key) };
          }
        }
      }
    } catch (err) { warn('[key-rotator] http patch error:', err?.message || err); }

    const req = runInRotatorSyncRequest(() => orig.apply(mod, args));

    // ── Gemini: normalise thought parts / thought_signature before sending ───
    // patchFetch handles globalThis.fetch callers.  SDKs that use node:http
    // directly (e.g. older Google AI SDK versions) bypass patchFetch, so the
    // same sanitisation must happen here.  We intercept req.write / req.end,
    // accumulate the body chunks, and rewrite the body before the first flush
    // if any thought parts need normalising.  This avoids the 400 error:
    //   "Invalid value at 'contents[N].parts[M].thought_signature' (TYPE_BYTES)"
    if (usedProvider && usedProvider.name === 'gemini') {
      try {
        const _write = req.write.bind(req);
        const _end   = req.end.bind(req);
        const chunks = [];
        let bodyIntercepted = false;

        // Accumulate chunks written before end() is called.
        req.write = function interceptWrite(chunk, encoding, callback) {
          try {
            if (!bodyIntercepted) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
              if (typeof encoding === 'function') { encoding(); }
              else if (typeof callback === 'function') { callback(); }
              return true;
            }
          } catch (_) { /* fall through to original */ }
          return _write(chunk, encoding, callback);
        };

        req.end = function interceptEnd(chunk, encoding, callback) {
          try {
            if (!bodyIntercepted) {
              bodyIntercepted = true;
              if (chunk != null) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
              }
              const fullBody = Buffer.concat(chunks).toString('utf8');

              // ★ FIX: extract model from body for OpenAI-compat Gemini endpoint.
              // Native endpoint: /v1beta/models/gemini-X:generateContent → model in URL (already set).
              // OpenAI-compat:   /v1beta/openai/chat/completions       → model in body (usedModel=null).
              // Without this, a 429 on gemini-2.5-pro via the compat path blacklists the KEY globally
              // so gemini-flash etc. also stop working — defeating per-model rate-limit scoping.
              if (usedModel === null && usedProvider && usedProvider.perModelLimits) {
                try {
                  const bodyModel = extractModelFromBody(fullBody);
                  if (bodyModel) {
                    usedModel = bodyModel;
                    if (usedInFlight) usedInFlight.model = usedModel;
                    promoteStickyKeyModel(usedProvider, usedKey, null, usedModel);
                    emitEvent('model_detected', usedProvider, usedKey, { model: usedModel, source: 'http_request_body' });
                    debug(`[key-rotator] ${usedProvider.name}: (http) model extracted from request body: ${usedModel}`);
                  }
                } catch (_) { /* non-JSON body — leave model null */ }
              }

              const cleaned = stripGeminiThoughtParts(fullBody);
              if (cleaned !== fullBody) {
                debug('[key-rotator] gemini (http): normalized malformed thought_signature history');
                return _end(cleaned, 'utf8', typeof encoding === 'function' ? encoding : callback);
              }
              // No change — replay chunks as-is.
              for (const c of chunks) _write(c);
              return _end(undefined, typeof encoding === 'function' ? encoding : callback);
            }
          } catch (_) { /* fall through to original on any error */ }
          return _end(chunk, encoding, callback);
        };
      } catch (_) { /* never break the request */ }
    }

    // Intercept response to track provider status.  For ambiguous provider
    // errors (for example Gemini 403 RESOURCE_EXHAUSTED), sniff the response
    // body before classification so quota failures stay model-scoped instead
    // of becoming global auth suspensions.
    if (usedProvider && usedKey) {
      const _emit = req.emit.bind(req);
      let statusHandled = false;
      let bodyWaitTimer = null;
      const clearBodyWaitTimer = () => {
        if (bodyWaitTimer) { clearTimeout(bodyWaitTimer); bodyWaitTimer = null; }
      };
      const finishStatus = (res, errorInfo) => {
        if (statusHandled) return;
        statusHandled = true;
        clearBodyWaitTimer();
        const retryAfterMs = parseRetryAfterMs(res?.headers?.['retry-after']);
        try { endInFlight(usedProvider, usedKey, usedInFlight); } catch (_) {}
        try { handleStatus(usedProvider, usedKey, res?.statusCode, usedModel, retryAfterMs, errorInfo, { requestId: usedInFlight?.requestId }); } catch (_) {}
      };
      req.emit = function (event, ...rest) {
        if (event === 'response') {
          const res = rest[0];
          if (statusNeedsErrorBodyForScope(res?.statusCode)) {
            const chunks = [];
            let total = 0;
            res.on('data', (chunk) => {
              if (total >= ERROR_BODY_SNIFF_MAX_BYTES) return;
              const buf = chunkToBuffer(chunk);
              if (!buf?.length) return;
              const remaining = ERROR_BODY_SNIFF_MAX_BYTES - total;
              const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
              chunks.push(slice);
              total += slice.length;
            });
            const finishWithSniffedBody = () => {
              const errorInfo = chunks.length
                ? parseProviderErrorInfo(Buffer.concat(chunks).toString('utf8'))
                : null;
              finishStatus(res, errorInfo);
            };
            bodyWaitTimer = setTimeout(finishWithSniffedBody, ERROR_BODY_WAIT_MS);
            bodyWaitTimer.unref?.();
            res.on('end', finishWithSniffedBody);
            res.on('close', finishWithSniffedBody);
          } else {
            finishStatus(res, null);
          }
        }
        return _emit(event, ...rest);
      };
      req.on('error', (err) => {
        try { endInFlight(usedProvider, usedKey, usedInFlight); } catch (_) {}
        if (!statusHandled) {
          try { handleTransportError(usedProvider, usedKey, err, usedModel, { requestId: usedInFlight?.requestId }); } catch (_) {}
        }
      });
    }
    return req;
  };

  // node:http.get/node:https.get are separate exports. They do not reliably
  // dispatch through a replaced module.request in all Node versions, so patch
  // them explicitly and preserve the native get() contract: create request,
  // immediately end it, and return the ClientRequest.
  if (typeof origGet === 'function') {
    mod.get = function patchedGet(...args) {
      const req = mod.request.apply(mod, args);
      req.end();
      return req;
    };
    Object.defineProperty(mod.get, '_kRotatorPatched', { value: true });
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

const hasProviderKeys = providerState.some(p => p.keys.length > 0);

if (hasProviderKeys) {
  patchFetch();
  patchHttpModule(http);
  patchHttpModule(https);
  patchUndici();         // covers OpenClaw gateway's bundled undici AI calls
  startDiagnostics();

  debug(`[key-rotator] loaded — cooldown base:${BASE_COOLDOWN_MS/1000}s max-strikes:${MAX_STRIKES} perm-suspend:${formatHours(PERM_SUSPEND_MS)}h (cap 16h) max-inflight-per-key:${MAX_INFLIGHT_PER_KEY} max-retry-after:${MAX_RETRY_AFTER_MS/1000}s max-key-wait:${MAX_KEY_WAIT_MS/1000}s diagnostics:${DIAGNOSTICS_ENABLED ? 'on' : 'off'} log-level:${LOG_LEVEL} verbose-picks:${VERBOSE_PICKS ? 'on' : 'off'} suspended-last-resort:${USE_SUSPENDED_KEY_AS_LAST_RESORT ? 'on' : 'off'} per-model-providers:${providerState.filter(p => p.perModelLimits).map(p => p.name).join(',') || 'none'} model-from-body:on model-sniff-max:${REQUEST_MODEL_SNIFF_MAX_BYTES} error-sniff-max:${ERROR_BODY_SNIFF_MAX_BYTES} error-body-wait:${ERROR_BODY_WAIT_MS}ms inflight-ttl:${INFLIGHT_TTL_MS}ms task-affinity:${TASK_AFFINITY_MS}ms/${TASK_AFFINITY_MAX_REUSES}reuses task-affinity-ignore-inflight:${TASK_AFFINITY_IGNORE_INFLIGHT_SATURATION ? 'on' : 'off'} sticky-until-failure:${STICKY_UNTIL_FAILURE ? 'on' : 'off'} sticky-ignore-inflight-saturation:${STICKY_IGNORE_INFLIGHT_SATURATION ? 'on' : 'off'} sticky-scope:${String(process.env.KEY_STICKY_SCOPE || 'auto').trim().toLowerCase() || 'auto'} sticky-providers:${[...STICKY_PROVIDER_SET].join(',') || 'none'} llm-fallback-providers:${LLM_FALLBACK_PROVIDER_SET ? [...LLM_FALLBACK_PROVIDER_SET].join(',') : 'all'}`);
  emitEvent('rotator_loaded', null, null, {
    providers: providerState.filter(p => p.keys.length).map(p => ({ name: p.name, total: p.keys.length })),
    logLevel: LOG_LEVEL,
    verbosePicks: VERBOSE_PICKS,
    inflightTtlMs: INFLIGHT_TTL_MS,
    modelSniffMaxBytes: REQUEST_MODEL_SNIFF_MAX_BYTES,
    errorBodySniffMaxBytes: ERROR_BODY_SNIFF_MAX_BYTES,
    taskAffinityMs: TASK_AFFINITY_MS,
    taskAffinityMaxReuses: TASK_AFFINITY_MAX_REUSES,
    taskAffinityIgnoreInflightSaturation: TASK_AFFINITY_IGNORE_INFLIGHT_SATURATION,
    stickyUntilFailure: STICKY_UNTIL_FAILURE,
    stickyIgnoreInflightSaturation: STICKY_IGNORE_INFLIGHT_SATURATION,
    stickyScope: String(process.env.KEY_STICKY_SCOPE || 'auto').trim().toLowerCase() || 'auto',
    stickyProviders: [...STICKY_PROVIDER_SET],
    llmFallbackProviders: LLM_FALLBACK_PROVIDER_SET ? [...LLM_FALLBACK_PROVIDER_SET] : ['*'],
  });
} else {
  debug('[key-rotator] skipped — no provider keys configured');
  emitEvent('rotator_skipped', null, null, { reason: 'no_provider_keys' });
}

if (EMIT_SYNTHETIC_EVENTS) {
  const syntheticProvider = providerState.find(p => p.name === 'synthetic');
  if (syntheticProvider?.keys?.length) {
    const { key } = nextKey(syntheticProvider, 'health-check');
    if (key) {
      handleStatus(syntheticProvider, key, 204, 'health-check');
      emitEvent('synthetic_probe', syntheticProvider, key, {
        model: 'health-check',
        note: 'Synthetic rotator event only; no upstream provider request was sent.',
      });
    }
  } else {
    emitEvent('synthetic_probe_skipped', null, null, {
      provider: 'synthetic',
      reason: 'SYNTHETIC_API_KEYS not configured',
    });
  }
}
