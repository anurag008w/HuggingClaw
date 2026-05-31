'use strict';

/**
 * Multi-provider API key rotator for OpenClaw/HuggingClaw
 * --------------------------------------------------------
 * - Round-robin rotation per provider
 * - 429/402 → exponential backoff blacklist per key
 * - After MAX_STRIKES consecutive failures → permanent session blacklist
 * - Successful response → strikes reset
 * - 10+ keys handled correctly (idx tracks only active keys, no drift)
 *
 * Env vars:
 *   KEY_BLACKLIST_COOLDOWN_MS   base backoff ms        (default 60 000)
 *   KEY_MAX_STRIKES             failures before perm   (default 3)
 *   LLM_API_KEY_FALLBACK_ENABLED true/false            (default true)
 *   KEY_ROTATOR_LOG_LEVEL      info/debug/silent       (default info)
 *   KEY_ROTATOR_VERBOSE_PICKS  true/false              (default false)
 */

const http  = require('node:http');
const https = require('node:https');
const fs    = require('node:fs');

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
const FETCH_MAX_RETRIES = Math.max(
  0,
  Math.min(2, parseInt(process.env.KEY_FETCH_MAX_RETRIES || '', 10) || 2),
);
const FETCH_RETRY_BASE_DELAY_MS = Math.max(
  0,
  Math.min(10_000, parseInt(process.env.KEY_FETCH_RETRY_BASE_DELAY_MS || '', 10) || 250),
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

const USE_SUSPENDED_KEY_AS_LAST_RESORT = !/^(0|false|no|off)$/i.test(
  String(process.env.KEY_USE_SUSPENDED_AS_LAST_RESORT || 'true').trim(),
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
// Set to 0 to disable (reverts to old fire-and-miss behaviour).
const MAX_KEY_WAIT_MS = Math.max(
  0,
  parseInt(process.env.KEY_MAX_WAIT_MS || '', 10) || 20_000,
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

// ─── Provider definitions ────────────────────────────────────────────────────

const PROVIDERS = [
  { name:'anthropic',    hostname:/(?:^|\.)api\.anthropic\.com$/i,            envPlural:'ANTHROPIC_API_KEYS',        envSingular:'ANTHROPIC_API_KEY' },
  { name:'openai',       hostname:/(?:^|\.)api\.openai\.com$/i,               envPlural:'OPENAI_API_KEYS',           envSingular:'OPENAI_API_KEY' },
  { name:'gemini',       hostname:/(?:^|\.)(?:generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com)$/i,
                                                                               envPlural:'GEMINI_API_KEYS',           envSingular:'GEMINI_API_KEY',  queryParam:true,
    extraEnvPlural:['GOOGLE_API_KEYS', 'GOOGLE_GENERATIVE_AI_API_KEYS', 'GOOGLE_AI_API_KEYS'],
    extraEnvSingular:['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY'],
    // Google enforces rate limits per-model per-key (RPM / TPD per model).
    // A 429 on gemini-2.5-pro must NOT blacklist the key for gemini-1.5-flash.
    perModelLimits: true },
  { name:'deepseek',     hostname:/(?:^|\.)api\.deepseek\.com$/i,             envPlural:'DEEPSEEK_API_KEYS',         envSingular:'DEEPSEEK_API_KEY' },
  { name:'openrouter',   hostname:/(?:^|\.)openrouter\.ai$/i,                 envPlural:'OPENROUTER_API_KEYS',       envSingular:'OPENROUTER_API_KEY' },
  { name:'kilocode',     hostname:/(?:^|\.)kilocode\.ai$/i,                   envPlural:'KILOCODE_API_KEYS',         envSingular:'KILOCODE_API_KEY' },
  { name:'opencode',     hostname:/(?:^|\.)opencode\.ai$/i,                   envPlural:'OPENCODE_API_KEYS',         envSingular:'OPENCODE_API_KEY' },
  { name:'zai',          hostname:/(?:^|\.)(?:z\.ai|open\.bigmodel\.cn)$/i,   envPlural:'ZAI_API_KEYS',             envSingular:'ZAI_API_KEY' },
  // FIX: kimi-coding aur moonshot ek hi hostname share karte hain (api.moonshot.cn).
  // Purani file mein dono alag entries thi — find() hamesha kimi-coding pick karta tha,
  // MOONSHOT_API_KEYS kabhi use nahi hoti. Ab merged entry: dono pools combine honge.
  { name:'kimi-moonshot',hostname:/(?:^|\.)api\.moonshot\.cn$/i,              envPlural:'KIMI_API_KEYS',            envSingular:'KIMI_API_KEY',
    _extraPlural:'MOONSHOT_API_KEYS', _extraSingular:'MOONSHOT_API_KEY' },
  { name:'minimax',      hostname:/(?:^|\.)api\.minimax\.chat$/i,             envPlural:'MINIMAX_API_KEYS',          envSingular:'MINIMAX_API_KEY' },
  { name:'xiaomi',       hostname:/(?:^|\.)api\.xiaomi\.com$/i,               envPlural:'XIAOMI_API_KEYS',           envSingular:'XIAOMI_API_KEY' },
  { name:'volcengine',   hostname:/(?:^|\.)(?:ark\.cn-beijing\.volces\.com|volcengineapi\.com)$/i,
                                                                               envPlural:'VOLCANO_ENGINE_API_KEYS',  envSingular:'VOLCANO_ENGINE_API_KEY' },
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
                                                                               envPlural:'HUGGINGFACE_HUB_TOKENS',   envSingular:'HUGGINGFACE_HUB_TOKEN' },
  { name:'venice',       hostname:/(?:^|\.)api\.venice\.ai$/i,                envPlural:'VENICE_API_KEYS',           envSingular:'VENICE_API_KEY' },
  { name:'github-copilot',hostname:/(?:^|\.)api\.githubcopilot\.com$/i,       envPlural:'COPILOT_GITHUB_TOKENS',    envSingular:'COPILOT_GITHUB_TOKEN' },
  { name:'qianfan',      hostname:/(?:^|\.)(?:aip|qianfan)\.baidubce\.com$/i, envPlural:'QIANFAN_API_KEYS',         envSingular:'QIANFAN_API_KEY' },
  { name:'modelstudio',  hostname:/(?:^|\.)dashscope\.aliyuncs\.com$/i,       envPlural:'MODELSTUDIO_API_KEYS',      envSingular:'MODELSTUDIO_API_KEY' },
  { name:'synthetic',    hostname:/(?:^|\.)synthetic\.local$/i,               envPlural:'SYNTHETIC_API_KEYS',        envSingular:'SYNTHETIC_API_KEY' },
];

// ─── Key loading ─────────────────────────────────────────────────────────────

function normalizeKeys(...inputs) {
  const seen = new Set(), out = [];
  for (const input of inputs)
    // Accept comma-separated values (documented) plus newline-separated values
    // (common when users paste many HF Space secrets from a spreadsheet/editor).
    // Do not split on generic spaces because some providers may someday use
    // structured token strings that contain spaces.
    for (const k of String(input || '').split(/[\n\r,]+/).map(s => s.trim()).filter(Boolean))
      if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out;
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
      ...(idx >= 0 ? { slot: idx + 1, total: p.keys.length, key: keyMask(key) } : {}),
      ...extra,
    };
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
function extractModelFromUrl(urlLike) {
  try {
    const str =
      typeof urlLike === 'string'   ? urlLike
      : urlLike instanceof URL      ? urlLike.href
      : (urlLike && typeof urlLike.url === 'string') ? urlLike.url
      : null;
    if (!str) return null;
    const m = new URL(str).pathname.match(/\/models\/([^/:?]+)/);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

/**
 * Returns the earliest epoch-ms at which this key will be usable again,
 * considering both the global key state and (for perModelLimits providers)
 * the model-specific state.  Returns 0 if the key is currently active.
 */
function getKeyExpiry(p, key, model) {
  let expiry = p.keyState.get(key)?.blacklistedUntil ?? 0;
  if (p.modelKeyState && model) {
    const mks = p.modelKeyState.get(`${key}:${model}`);
    if (mks && mks.blacklistedUntil > expiry) expiry = mks.blacklistedUntil;
  }
  return expiry;
}

const providerState = PROVIDERS.map(p => {
  const llmFallbackEnabled = !/^(0|false|no|off)$/.test(
    String(process.env.LLM_API_KEY_FALLBACK_ENABLED || '').trim().toLowerCase(),
  );

  const envValues = (...names) => names
    .flat()
    .filter(Boolean)
    .map(name => process.env[name] || '');

  const extraKeys = normalizeKeys(
    ...envValues(
      p._extraPlural,
      p._extraSingular,
      p.extraEnvPlural,
      p.extraEnvSingular,
    ),
  );

  const dedicatedKeys = normalizeKeys(
    process.env[p.envPlural]  || '',
    process.env[p.envSingular] || '',
    ...extraKeys,
  );
  const hasDedicated = dedicatedKeys.length > 0;
  const keys = hasDedicated
    ? dedicatedKeys
    : (llmFallbackEnabled ? normalizeKeys(process.env.LLM_API_KEY || '') : []);

  if (hasDedicated)
    debug(`[key-rotator] ${p.name}: ${keys.length} key${keys.length === 1 ? '' : 's'}`);
  else if (!keys.length)
    debug(`[key-rotator] No keys for provider "${p.name}"`);

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
  return { ...p, keys, keyState, modelKeyState, inFlight: new Map(), idx: 0 };
});

// LLM_API_KEY fallback summary
const fallbackCount = providerState.filter(p => {
  const envValues = (...names) => names
    .flat()
    .filter(Boolean)
    .map(name => process.env[name] || '');
  const ded = normalizeKeys(
    process.env[p.envPlural]   || '',
    process.env[p.envSingular] || '',
    ...envValues(
      p._extraPlural,
      p._extraSingular,
      p.extraEnvPlural,
      p.extraEnvSingular,
    ),
  );
  return ded.length === 0 && p.keys.length > 0;
}).length;
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
  if (p.modelKeyState && model) {
    const mKey = `${key}:${model}`;
    const mks  = p.modelKeyState.get(mKey);
    if (mks && mks.blacklistedUntil !== 0) {
      if (Date.now() < mks.blacklistedUntil) return false;   // blocked for this model
      mks.blacklistedUntil = 0;
      if (mks.strikes > 0) mks.strikes -= 1;
      debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} back in pool for model=${model} (strikes now ${mks.strikes})`);
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

  if (p.modelKeyState && model) {
    const mKey = `${key}:${model}`;
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
      warn(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} model=${model} hit ${MAX_STRIKES} strikes — suspended for ${formatHours(PERM_SUSPEND_MS)}h (quota likely exhausted for this model)`);
    else
      debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} model=${model} strike ${mks.strikes}/${MAX_STRIKES} — backoff ${Math.round(cooldown / 1000)}s${serverHintMs > 0 ? ` (server-hint ${Math.round(serverHintMs/1000)}s)` : ''}`);
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
function recordTransientFailure(p, key) {
  let ks = p.keyState.get(key);
  if (!ks) { ks = makeKeyState(); p.keyState.set(key, ks); }
  ks.lastFailureAt = Date.now();
  const jitter = 1 + ((Math.random() * 2 - 1) * (COOLDOWN_JITTER_PCT / 100));
  const cooldown = Math.max(1000, Math.round(BASE_COOLDOWN_MS * jitter));
  ks.blacklistedUntil = Math.max(ks.blacklistedUntil || 0, Date.now() + cooldown);
  const secs = Math.round(cooldown / 1000);
  debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} transient backoff ${secs}s (strikes unchanged)`);
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

  // Also clear model-specific state on success
  if (p.modelKeyState && model) {
    const mKey = `${key}:${model}`;
    const mks  = p.modelKeyState.get(mKey);
    if (mks && (mks.strikes > 0 || mks.blacklistedUntil > 0)) {
      mks.strikes = 0;
      mks.lastFailureAt = 0;
      mks.blacklistedUntil = 0;
      debug(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} model=${model} recovered — strikes reset`);
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


function shouldRetryMethod(method, hasReplayableBody) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  if (m !== 'POST') return false;
  return hasReplayableBody;
}

function beginInFlight(p, key) {
  if (!p || !key) return;
  p.inFlight.set(key, (p.inFlight.get(key) || 0) + 1);
}

function endInFlight(p, key) {
  if (!p || !key) return;
  const next = Math.max(0, (p.inFlight.get(key) || 0) - 1);
  if (next === 0) p.inFlight.delete(key);
  else p.inFlight.set(key, next);
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

  let bestPick = null;
  for (let offset = 0; offset < total; offset++) {
    const i   = (p.idx + offset) % total;
    const key = p.keys[i];
    if (isActive(p, key, model)) {
      const inflight = p.inFlight.get(key) || 0;
      if (inflight < MAX_INFLIGHT_PER_KEY) {
        p.idx = (i + 1) % total;   // next call starts AFTER the key we just picked
        if (VERBOSE_PICKS) debug(`[key-rotator] ${p.name}: picked ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''} inflight=${inflight + 1}/${MAX_INFLIGHT_PER_KEY}`);
        emitEvent('pick', p, key, { model, inflight: inflight + 1, maxInflight: MAX_INFLIGHT_PER_KEY });
        return { key, waitMs: 0 };
      }
      if (!bestPick) bestPick = { i, key, inflight, score: Number.POSITIVE_INFINITY };
      // Score: prefer keys with fewer recent failures and lower in-flight count.
      // For perModelLimits, also factor in model-specific strike count.
      const ks  = p.keyState.get(key) || makeKeyState();
      const mks = (p.modelKeyState && model) ? (p.modelKeyState.get(`${key}:${model}`) || makeKeyState()) : makeKeyState();
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
    warn(`[key-rotator] ${p.name}: all active keys saturated, reusing ${keySlot(p, bestPick.key)}${keyMask(bestPick.key)}${model ? ` model=${model}` : ''} inflight=${bestPick.inflight + 1}/${MAX_INFLIGHT_PER_KEY}`);
    emitEvent('saturated_reuse', p, bestPick.key, { model, inflight: bestPick.inflight + 1, maxInflight: MAX_INFLIGHT_PER_KEY });
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

  emitEvent('all_suspended_pick', p, chosenKey, { model, waitMs });
  return { key: chosenKey, waitMs };
}

// ─── Auth header injection ────────────────────────────────────────────────────

function resolveHostname(urlLike) {
  try {
    const u =
      typeof urlLike === 'string'                         ? new URL(urlLike)
      : urlLike instanceof URL                            ? urlLike
      : urlLike && typeof urlLike.url === 'string'        ? new URL(urlLike.url)
      : urlLike && typeof urlLike.href === 'string'       ? new URL(urlLike.href)
      : urlLike && typeof urlLike.hostname === 'string'   ? urlLike
      : null;
    return u ? u.hostname : null;
  } catch { return null; }
}

function matchProvider(hostname) {
  if (!hostname) return null;
  return providerState.find(p => p.hostname.test(hostname)) || null;
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

function handleStatus(p, key, status, model, retryAfterMs) {
  if (!p || !key) return;
  if (status === 401 || status === 403) {
    // Invalid/expired key — always a global (not model-scoped) blacklist.
    let ks = p.keyState.get(key);
    if (!ks) { ks = makeKeyState(); p.keyState.set(key, ks); }
    ks.strikes = MAX_STRIKES;
    ks.lastFailureAt = Date.now();
    ks.blacklistedUntil = Date.now() + PERM_SUSPEND_MS;
    warn(`[key-rotator] ${p.name}: ${keySlot(p, key)}${keyMask(key)} auth-failed (${status}) — suspended for ${formatHours(PERM_SUSPEND_MS)} h`);
    emitEvent('auth_failed', p, key, { status, suspendMs: PERM_SUSPEND_MS });
    return;
  }

  if (status === 429 || status === 402) {
    // For perModelLimits providers (gemini): quota is per (key, model).
    // recordFailure will scope the blacklist to the model when model is provided.
    // Pass retryAfterMs so the key blacklist respects the server's stated wait time.
    recordFailure(p, key, model, retryAfterMs);
    warn(`[key-rotator] ${p.name}: quota/rate status=${status} on ${keySlot(p, key)}${keyMask(key)}${model ? ` model=${model}` : ''}${retryAfterMs ? ` retry-after=${Math.round(retryAfterMs/1000)}s` : ''}`);
    emitEvent('rate_limited', p, key, { status, model, retryAfterMs: retryAfterMs || 0 });
    return;
  }

  if (classifyRetryableFailure(status)) {
    // Transient server errors are not model-specific — penalise key globally.
    recordTransientFailure(p, key);
    warn(`[key-rotator] ${p.name}: transient status=${status} on ${keySlot(p, key)}${keyMask(key)}`);
    emitEvent('transient_status', p, key, { status, model });
    return;
  }

  if (status >= 200 && status < 400) {
    recordSuccess(p, key, model);
    emitEvent('success', p, key, { status, model });
  }
}

function handleTransportError(p, key, err) {
  if (!p || !key) return;
  // Node.js 18+ undici fetch throws TypeError: "fetch failed" where the actual
  // network error code lives in err.cause.code (e.g. ECONNRESET, ETIMEDOUT,
  // ENOTFOUND).  Fall back to err.cause.code so retryable network errors are
  // correctly classified and transient blacklists are applied.
  const code = (err?.code || err?.cause?.code)
    ? String(err.code || err.cause?.code).toUpperCase()
    : '';
  const name = String(err?.name || '');
  const retryable = classifyRetryableFailure(undefined, code) || name === 'AbortError';
  if (retryable) {
    recordTransientFailure(p, key);
    warn(`[key-rotator] ${p.name}: retryable network ${name || 'Error'}${code ? ` code=${code}` : ''} on ${keySlot(p, key)}${keyMask(key)}`);
    emitEvent('network_retryable', p, key, { name: name || 'Error', code });
  }
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
        return { provider: p.name, total: keyStats.length, active, suspended, keys: keyStats };
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
      url.searchParams.set('key', usedKey);

      // BUG FIX: Google's OpenAI-compatible endpoint (/v1beta/openai/...) reads the
      // rotated key from the Authorization: Bearer header, NOT from ?key=.
      // If the caller already has an Authorization header (OpenClaw's openai-transport
      // sets Bearer <GEMINI_API_KEY> for every request), replace it with the rotated
      // key so the pool actually gets used instead of the single env-var key.
      const existingAuth = baseHeaders.get
        ? baseHeaders.get('authorization')
        : (baseHeaders['authorization'] || baseHeaders['Authorization'] || '');
      if (existingAuth && String(existingAuth).toLowerCase().startsWith('bearer ')) {
        setAuthHeader(baseHeaders, usedKey);
      }

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
    return [input, { ...initObj, headers: setAuthHeader(baseHeaders, usedKey) }];
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
function wrapUndiciHandler(handler, provider, key, model) {
  if (!handler || typeof handler !== 'object') return handler;
  let statusCode = 0;
  let settled = false;
  const settle = (fn) => {
    if (settled) return;
    settled = true;
    try { endInFlight(provider, key); } catch (_) {}
    try { fn(); } catch (_) {}
  };
  return new Proxy(handler, {
    get(target, prop) {
      if (prop === 'onHeaders') {
        return function (sc, headers, resume, statusMessage) {
          statusCode = sc;
          return target.onHeaders ? target.onHeaders.call(target, sc, headers, resume, statusMessage) : undefined;
        };
      }
      if (prop === 'onComplete') {
        return function (trailers) {
          settle(() => { try { handleStatus(provider, key, statusCode, model); } catch (_) {} });
          return target.onComplete ? target.onComplete.call(target, trailers) : undefined;
        };
      }
      if (prop === 'onError') {
        return function (err) {
          settle(() => { try { handleTransportError(provider, key, err); } catch (_) {} });
          return target.onError ? target.onError.call(target, err) : undefined;
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
    let usedKey = null, usedProvider = null, usedModel = null;
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

      const provider = matchProvider(hostname);
      if (provider) {
        const pathStr = options.path || '/';
        const model = provider.perModelLimits
          ? (pathStr.match(/\/models\/([^/:?]+)/)?.[1]?.toLowerCase() || null)
          : null;

        const { key, waitMs } = nextKey(provider, model);
        if (key && waitMs > 0)
          warn(`[key-rotator] ${provider.name}: undici (${tag}): all keys suspended (${Math.round(waitMs / 1000)}s) — best-effort on ${keySlot(provider, key)}${keyMask(key)}${model ? ` model=${model}` : ''} (sync)`);

        if (key) {
          usedKey = key; usedProvider = provider; usedModel = model;
          beginInFlight(usedProvider, usedKey);

          const newOptions = { ...options };

          if (provider.queryParam) {
            // Gemini REST endpoint: inject key as ?key=<rotated> in path
            try {
              const pu = new URL(pathStr, 'http://d');
              pu.searchParams.set('key', key);
              newOptions.path = pu.pathname + pu.search;
            } catch (_) { /* leave path unchanged on URL parse failure */ }
            // Gemini OpenAI-compat endpoint (/v1beta/openai/…) uses Bearer auth
            // instead of ?key=.  Replace it so the rotated key is actually used.
            const authVal = uGetHeader(options.headers || [], 'authorization');
            if (String(authVal).toLowerCase().startsWith('bearer ')) {
              newOptions.headers = uSetHeader(options.headers, 'authorization', `Bearer ${key}`);
            }
          } else {
            // All other providers: inject / replace Authorization: Bearer
            newOptions.headers = uSetHeader(options.headers || {}, 'authorization', `Bearer ${key}`);
          }

          const wrappedHandler = wrapUndiciHandler(handler, usedProvider, usedKey, usedModel);
          return origDispatch.call(this, newOptions, wrappedHandler);
        }
      }
    } catch (err) {
      warn(`[key-rotator] undici (${tag}) dispatch patch error:`, err?.message || err);
      if (usedProvider && usedKey) { try { endInFlight(usedProvider, usedKey); } catch (_) {} }
    }

    return origDispatch.call(this, options, handler);
  };

  proto.dispatch._kRotatorPatched = true;
  // FIX: Also set cloudflare-proxy's flag on rotatorDispatch so CF proxy doesn't
  // re-wrap us on the next require() hook fire.  Without this, CF proxy sees
  // _patched=undefined on rotatorDispatch → wraps again → rotator sees
  // _kRotatorPatched=undefined on the new cfDispatch → wraps again → infinite
  // mutual re-wrapping that produces hundreds of "dispatch patched" log entries
  // on startup and builds an ever-growing call chain on every undici require.
  proto.dispatch._patched = true;
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
    const urlLike = typeof input === 'string' || input instanceof URL
      ? input
      : (input && typeof input.url === 'string' ? input.url : null);
    const provider = matchProvider(resolveHostname(urlLike));
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
        if (typeof rawBody === 'string') {
          const bodyModel = JSON.parse(rawBody)?.model;
          if (bodyModel && typeof bodyModel === 'string' && bodyModel.length > 0) {
            // Strip provider prefix when present (e.g. "google/gemini-2.5-pro" → "gemini-2.5-pro").
            model = (bodyModel.includes('/') ? bodyModel.split('/').slice(1).join('/') : bodyModel).toLowerCase();
            debug(`[key-rotator] ${provider.name}: model extracted from request body: ${model}`);
          }
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

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let usedKey = null;
        try {
          let { key, waitMs } = nextKey(provider, model);

          // FIX: Prefer a fresh key for each retry without calling nextKey repeatedly
          // (which would advance p.idx for keys we never actually use, causing drift).
          // Instead, scan the pool directly for an untried active key.
          if (key && triedKeys.has(key) && triedKeys.size < provider.keys.length) {
            const total = provider.keys.length;
            for (let offset = 0; offset < total; offset++) {
              const i = (provider.idx + offset) % total;
              const candidate = provider.keys[i];
              if (!triedKeys.has(candidate) && isActive(provider, candidate, model)) {
                const inflight = provider.inFlight.get(candidate) || 0;
                if (inflight < MAX_INFLIGHT_PER_KEY) {
                  provider.idx = (i + 1) % total;
                  key = candidate; waitMs = 0;
                  emitEvent('pick_retry_fresh', provider, key, { model, attempt });
                  break;
                }
              }
            }
          }

          // ── Real-cycle: actually wait for the soonest suspended key ──────────
          // Old behaviour fired immediately into a guaranteed 429 (fake cycle).
          // Now we sleep until the key's cooldown expires so the request has a
          // real chance of succeeding.  Capped by MAX_KEY_WAIT_MS (env-tunable,
          // default 2 min) so we never stall indefinitely.
          if (key && waitMs > 0 && MAX_KEY_WAIT_MS > 0) {
            const actualWait = Math.min(waitMs, MAX_KEY_WAIT_MS);
            await sleep(actualWait);
          }

          if (key) {
            triedKeys.add(key);
            usedKey = key;
            beginInFlight(provider, key);
          }

          const attemptArgs = buildAttemptFetchArgs(input, init, provider, usedKey);
          const response = await orig(...attemptArgs);
          lastResponse = response;

          // Parse Retry-After BEFORE calling handleStatus so the key blacklist
          // is set to the correct duration the server asked for.
          const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
          try { handleStatus(provider, usedKey, response.status, model, retryAfterMs); } catch (_) {}
          try { endInFlight(provider, usedKey); } catch (_) {}

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
          try { handleTransportError(provider, usedKey, err); } catch (_) {}
          try { endInFlight(provider, usedKey); } catch (_) {}
          // Node.js 18+ undici fetch: network errors are TypeError("fetch failed")
          // where the real code (ECONNRESET, ETIMEDOUT, ENOTFOUND …) is in
          // err.cause.code.  Check that first before falling back to err.code.
          const code = (err?.code || err?.cause?.code)
            ? String(err.code || err.cause?.code).toUpperCase()
            : '';
          const isAbort = String(err?.name || '') === 'AbortError';
          const shouldRetry = attempt < maxAttempts && (classifyRetryableFailure(undefined, code) || isAbort);
          if (shouldRetry) {
            const backoffMs = Math.min(10_000, FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
            warn(`[key-rotator] ${provider.name}: fetch retry ${attempt}/${maxAttempts - 1} after network ${isAbort ? 'AbortError' : `code=${code || 'unknown'}`} method=${method}`);
            await sleep(backoffMs);
            continue;
          }
          throw err;
        }
      }

      if (lastResponse) return lastResponse;
      if (lastErr) throw lastErr;
      return await orig(input, init);
    } catch (err) {
      warn(`[key-rotator] ${provider.name}: fetch patch error:`, err?.message || err);
      throw err;
    }
  };
}

// ─── Patch node:http / node:https ────────────────────────────────────────────

function patchHttpModule(mod) {
  const orig = mod.request;

  mod.request = function patchedRequest(...args) {
    let usedKey = null, usedProvider = null, usedModel = null;

    try {
      const options  = args[0];
      const provider = matchProvider(resolveHostname(options));

      if (provider) {
        // Extract model for per-model-limit providers from the request path.
        const pathStr = typeof options === 'object' && options.path
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
          beginInFlight(usedProvider, usedKey);
          if (provider.queryParam) {
            const u = new URL(String(
              typeof options === 'string' || options instanceof URL
                ? options
                : `https://${options.hostname}${options.path || '/'}`
            ));
            u.searchParams.set('key', key);
            // BUG FIX: Also replace Authorization: Bearer header if present
            // (Google OpenAI-compatible endpoint uses Bearer, not ?key=).
            const existingHeaders = (typeof options === 'object' && options.headers) ? options.headers : {};
            const authVal = existingHeaders['authorization'] || existingHeaders['Authorization'] || '';
            const patchedHeaders = String(authVal).toLowerCase().startsWith('bearer ')
              ? setAuthHeader(typeof existingHeaders === 'object' ? { ...existingHeaders } : existingHeaders, key)
              : existingHeaders;
            args[0] = typeof options === 'object' && !(options instanceof URL)
              ? { ...options, path:`${u.pathname}${u.search}`, headers: patchedHeaders }
              : u.toString();
          } else if (typeof options === 'string' || options instanceof URL) {
            const u = new URL(String(options));
            const extra = (args[1] && typeof args[1] === 'object' && typeof args[1].on !== 'function') ? args[1] : {};
            args[0] = { protocol:u.protocol, hostname:u.hostname, port:u.port,
                        path:`${u.pathname}${u.search}`, ...extra,
                        headers:setAuthHeader(extra.headers, key) };
          } else if (options && typeof options === 'object') {
            args[0] = { ...options, headers:setAuthHeader(options.headers, key) };
          }
        }
      }
    } catch (err) { warn('[key-rotator] http patch error:', err?.message || err); }

    const req = orig.apply(mod, args);

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
                  const bodyModel = JSON.parse(fullBody)?.model;
                  if (bodyModel && typeof bodyModel === 'string' && bodyModel.length > 0) {
                    usedModel = (bodyModel.includes('/') ? bodyModel.split('/').slice(1).join('/') : bodyModel).toLowerCase();
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

    // Intercept response to track 429/success — pass model for per-model accounting
    if (usedProvider && usedKey) {
      const _emit = req.emit.bind(req);
      req.emit = function (event, ...rest) {
        if (event === 'response') {
          const res = rest[0];
          try { handleStatus(usedProvider, usedKey, res?.statusCode, usedModel); } catch (_) {}
          try { endInFlight(usedProvider, usedKey); } catch (_) {}
        }
        return _emit(event, ...rest);
      };
      req.on('error', (err) => {
        try { handleTransportError(usedProvider, usedKey, err); } catch (_) {}
        try { endInFlight(usedProvider, usedKey); } catch (_) {}
      });
    }
    return req;
  };
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

const hasProviderKeys = providerState.some(p => p.keys.length > 0);

if (hasProviderKeys) {
  patchFetch();
  patchHttpModule(http);
  patchHttpModule(https);
  patchUndici();         // covers OpenClaw gateway's bundled undici AI calls
  startDiagnostics();

  debug(`[key-rotator] loaded — cooldown base:${BASE_COOLDOWN_MS/1000}s max-strikes:${MAX_STRIKES} perm-suspend:${formatHours(PERM_SUSPEND_MS)}h (cap 16h) max-inflight-per-key:${MAX_INFLIGHT_PER_KEY} max-retry-after:${MAX_RETRY_AFTER_MS/1000}s max-key-wait:${MAX_KEY_WAIT_MS/1000}s diagnostics:${DIAGNOSTICS_ENABLED ? 'on' : 'off'} log-level:${LOG_LEVEL} verbose-picks:${VERBOSE_PICKS ? 'on' : 'off'} suspended-last-resort:${USE_SUSPENDED_KEY_AS_LAST_RESORT ? 'on' : 'off'} per-model-providers:${providerState.filter(p => p.perModelLimits).map(p => p.name).join(',') || 'none'} model-from-body:on`);
  emitEvent('rotator_loaded', null, null, {
    providers: providerState.filter(p => p.keys.length).map(p => ({ name: p.name, total: p.keys.length })),
    logLevel: LOG_LEVEL,
    verbosePicks: VERBOSE_PICKS,
  });
} else {
  debug('[key-rotator] skipped — no provider keys configured');
  emitEvent('rotator_skipped', null, null, { reason: 'no_provider_keys' });
}
