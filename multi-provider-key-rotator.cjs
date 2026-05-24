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
 */

const http  = require('node:http');
const https = require('node:https');

const log  = (...a) => console.error(...a);
const warn = (...a) => console.warn(...a);

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
// Long suspend window for exhausted/invalid keys.
// Capped to 16h to avoid oversuppressing pools for too long.
const formatHours = (ms) => (ms / (60 * 60 * 1000)).toFixed(ms % (60 * 60 * 1000) === 0 ? 0 : 2);

// ─── Provider definitions ────────────────────────────────────────────────────

const PROVIDERS = [
  { name:'anthropic',    hostname:/(?:^|\.)api\.anthropic\.com$/i,            envPlural:'ANTHROPIC_API_KEYS',        envSingular:'ANTHROPIC_API_KEY' },
  { name:'openai',       hostname:/(?:^|\.)api\.openai\.com$/i,               envPlural:'OPENAI_API_KEYS',           envSingular:'OPENAI_API_KEY' },
  { name:'gemini',       hostname:/(?:^|\.)(?:generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com)$/i,
                                                                               envPlural:'GEMINI_API_KEYS',           envSingular:'GEMINI_API_KEY',  queryParam:true },
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
    for (const k of String(input || '').split(',').map(s => s.trim()).filter(Boolean))
      if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out;
}

// Per-key state: { strikes, blacklistedUntil }
// strikes   – consecutive 429/402 count; resets on success
// blacklistedUntil – epoch ms; 0 = active
function makeKeyState() { return { strikes: 0, blacklistedUntil: 0, lastFailureAt: 0 }; }

const providerState = PROVIDERS.map(p => {
  const llmFallbackEnabled = !/^(0|false|no|off)$/.test(
    String(process.env.LLM_API_KEY_FALLBACK_ENABLED || '').trim().toLowerCase(),
  );

  const extraKeys = (p._extraPlural || p._extraSingular)
    ? normalizeKeys(process.env[p._extraPlural || ''] || '', process.env[p._extraSingular || ''] || '')
    : [];

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
    log(`[key-rotator] ${p.name}: ${keys.length} key${keys.length === 1 ? '' : 's'}`);
  else if (!keys.length)
    warn(`[key-rotator] No keys for provider "${p.name}"`);

  // keyState: Map<keyString, {strikes, blacklistedUntil}>
  const keyState = new Map(keys.map(k => [k, makeKeyState()]));

  // FIX: idx tracks position in the ACTIVE (non-permanently-removed) pool.
  // We never remove keys from the array — we just skip blacklisted ones.
  // idx advances only when a key is ACTUALLY picked (no drift for skipped keys).
  return { ...p, keys, keyState, inFlight: new Map(), idx: 0 };
});

// LLM_API_KEY fallback summary
const fallbackCount = providerState.filter(p => {
  const ded = normalizeKeys(process.env[p.envPlural] || '', process.env[p.envSingular] || '');
  return ded.length === 0 && p.keys.length > 0;
}).length;
if (fallbackCount > 0)
  log(`[key-rotator] ${fallbackCount} provider(s) using LLM_API_KEY fallback`);

// ─── Per-key state helpers ────────────────────────────────────────────────────

/**
 * Is this key currently sitting out?
 * Also auto-clears expired blacklists so the key re-enters the pool silently.
 */
function isActive(p, key) {
  const ks = p.keyState.get(key);
  if (!ks) return true;                          // unknown key → treat as active
  if (ks.blacklistedUntil === 0) return true;    // not blacklisted
  if (Date.now() >= ks.blacklistedUntil) {
    ks.blacklistedUntil = 0;                     // expired → back in pool
    log(`[key-rotator] ${p.name}: ...${key.slice(-6)} back in pool`);
    return true;
  }
  return false;
}

/**
 * Called when a key gets a 429/402 response.
 *
 * Strike logic:
 *   strike 1 → BASE_COOLDOWN_MS  (e.g. 60 s  — probably rate-limit)
 *   strike 2 → BASE_COOLDOWN_MS × 4            (240 s)
 *   strike 3 → PERM_SUSPEND_MS (max 16 h — treat as quota exhausted, skip long)
 *
 * A successful response resets strikes so a key that was temporarily
 * rate-limited and recovered is treated as fresh again.
 */
function recordFailure(p, key) {
  let ks = p.keyState.get(key);
  if (!ks) { ks = makeKeyState(); p.keyState.set(key, ks); }

  ks.strikes = Math.min(ks.strikes + 1, MAX_STRIKES);
  ks.lastFailureAt = Date.now();

  let cooldown;
  if (ks.strikes >= MAX_STRIKES) {
    cooldown = PERM_SUSPEND_MS;
    warn(`[key-rotator] ${p.name}: ...${key.slice(-6)} reached ${MAX_STRIKES} strikes — suspended for ${formatHours(PERM_SUSPEND_MS)} h (quota likely exhausted)`);
  } else {
    // Exponential: 1× → 4× (strikes 1 and 2)
    cooldown = BASE_COOLDOWN_MS * Math.pow(4, ks.strikes - 1);
    const jitter = 1 + ((Math.random() * 2 - 1) * (COOLDOWN_JITTER_PCT / 100));
    cooldown = Math.max(1000, Math.round(cooldown * jitter));
    const secs = Math.round(cooldown / 1000);
    log(`[key-rotator] ${p.name}: ...${key.slice(-6)} strike ${ks.strikes}/${MAX_STRIKES} — backoff ${secs}s`);
  }

  ks.blacklistedUntil = Date.now() + cooldown;
}

/**
 * Called on any 2xx/3xx response — resets the key's strike counter.
 */

function recordTransientFailure(p, key) {
  let ks = p.keyState.get(key);
  if (!ks) { ks = makeKeyState(); p.keyState.set(key, ks); }
  ks.lastFailureAt = Date.now();
  const jitter = 1 + ((Math.random() * 2 - 1) * (COOLDOWN_JITTER_PCT / 100));
  const cooldown = Math.max(1000, Math.round(BASE_COOLDOWN_MS * jitter));
  ks.blacklistedUntil = Math.max(ks.blacklistedUntil || 0, Date.now() + cooldown);
  const secs = Math.round(cooldown / 1000);
  log(`[key-rotator] ${p.name}: ...${key.slice(-6)} transient backoff ${secs}s (strikes unchanged)`);
}

function recordSuccess(p, key) {
  const ks = p.keyState.get(key);
  if (ks && ks.strikes > 0) {
    ks.strikes = 0;
    ks.lastFailureAt = 0;
    log(`[key-rotator] ${p.name}: ...${key.slice(-6)} recovered — strikes reset`);
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
function nextKey(p) {
  if (!p || !p.keys.length) return null;

  const total = p.keys.length;

  let bestPick = null;
  for (let offset = 0; offset < total; offset++) {
    const i   = (p.idx + offset) % total;
    const key = p.keys[i];
    if (isActive(p, key)) {
      const inflight = p.inFlight.get(key) || 0;
      if (inflight < MAX_INFLIGHT_PER_KEY) {
        p.idx = (i + 1) % total;   // next call starts AFTER the key we just picked
        log(`[key-rotator] ${p.name}: picked ...${key.slice(-6)} inflight=${inflight + 1}/${MAX_INFLIGHT_PER_KEY}`);
        return key;
      }
      if (!bestPick) bestPick = { i, key, inflight, score: Number.POSITIVE_INFINITY };
      const ks = p.keyState.get(key) || makeKeyState();
      const recentFailPenalty = ks.lastFailureAt > 0 && (Date.now() - ks.lastFailureAt) < FAILURE_DECAY_MS ? 100 : 0;
      const strikePenalty = (ks.strikes || 0) * 10;
      const score = recentFailPenalty + strikePenalty + inflight;
      if (score < bestPick.score) bestPick = { i, key, inflight, score };
    }
  }

  if (bestPick) {
    p.idx = (bestPick.i + 1) % total;
    warn(`[key-rotator] ${p.name}: all active keys saturated, reusing ...${bestPick.key.slice(-6)} inflight=${bestPick.inflight + 1}/${MAX_INFLIGHT_PER_KEY}`);
    return bestPick.key;
  }

  // All keys are sitting out — pick the one closest to recovering
  warn(`[key-rotator] ${p.name}: all ${total} key(s) suspended — using soonest-recovering key`);
  let best = p.keys[0], bestExpiry = Infinity;
  for (const k of p.keys) {
    const exp = p.keyState.get(k)?.blacklistedUntil ?? 0;
    if (exp < bestExpiry) { best = k; bestExpiry = exp; }
  }
  return best;
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

function handleStatus(p, key, status) {
  if (!p || !key) return;
  if (status === 401 || status === 403) {
    // Usually invalid/expired key. Suspend long to avoid repeatedly poisoning requests.
    let ks = p.keyState.get(key);
    if (!ks) { ks = makeKeyState(); p.keyState.set(key, ks); }
    ks.strikes = MAX_STRIKES;
    ks.lastFailureAt = Date.now();
    ks.blacklistedUntil = Date.now() + PERM_SUSPEND_MS;
    warn(`[key-rotator] ${p.name}: ...${key.slice(-6)} auth-failed (${status}) — suspended for ${formatHours(PERM_SUSPEND_MS)} h`);
    return;
  }

  if (status === 429 || status === 402) {
    recordFailure(p, key);
    warn(`[key-rotator] ${p.name}: quota/rate status=${status} on ...${key.slice(-6)}`);
    return;
  }

  if (classifyRetryableFailure(status)) {
    recordTransientFailure(p, key);
    warn(`[key-rotator] ${p.name}: transient status=${status} on ...${key.slice(-6)}`);
    return;
  }

  if (status >= 200 && status < 400) {
    recordSuccess(p, key);
  }
}

function handleTransportError(p, key, err) {
  if (!p || !key) return;
  const code = err?.code ? String(err.code).toUpperCase() : '';
  const name = String(err?.name || '');
  const retryable = classifyRetryableFailure(undefined, code) || name === 'AbortError';
  if (retryable) {
    recordFailure(p, key);
    warn(`[key-rotator] ${p.name}: retryable network ${name || 'Error'}${code ? ` code=${code}` : ''} on ...${key.slice(-6)}`);
  }
}

function startDiagnostics() {
  if (!DIAGNOSTICS_ENABLED) return;
  setInterval(() => {
    const now = Date.now();
    const snapshot = providerState.map(p => {
      const keyStats = p.keys.map(k => {
        const ks = p.keyState.get(k) || makeKeyState();
        return {
          keySuffix: k.slice(-6),
          active: ks.blacklistedUntil === 0 || now >= ks.blacklistedUntil,
          strikes: ks.strikes,
          inFlight: p.inFlight.get(k) || 0,
        };
      });
      const active = keyStats.filter(s => s.active).length;
      const suspended = keyStats.length - active;
      const avgStrikes = keyStats.length
        ? Number((keyStats.reduce((sum, s) => sum + s.strikes, 0) / keyStats.length).toFixed(2))
        : 0;
      return { provider: p.name, total: keyStats.length, active, suspended, avgStrikes, keys: keyStats };
    });
    log('[key-rotator] diagnostics', JSON.stringify({ ts: new Date().toISOString(), providers: snapshot }));
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
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(10_000, Math.round(sec * 1000));
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) return Math.min(10_000, Math.max(0, ts - Date.now()));
  return 0;
}

// ─── Patch globalThis.fetch ───────────────────────────────────────────────────

function patchFetch() {
  if (typeof globalThis.fetch !== 'function') return;
  const orig = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function patchedFetch(input, init = {}) {
    try {
      const urlLike = typeof input === 'string' || input instanceof URL
        ? input
        : (input && typeof input.url === 'string' ? input.url : null);
      const provider = matchProvider(resolveHostname(urlLike));
      if (!provider) return await orig(input, init);

      const baseRequest = new Request(input, init);
      const method = String(baseRequest.method || 'GET').toUpperCase();
      const replaySafe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
      const retryEligible = replaySafe || method === 'POST';
      const maxAttempts = retryEligible ? 1 + FETCH_MAX_RETRIES : 1;
      const triedKeys = new Set();
      let lastErr = null;
      let lastResponse = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let usedKey = null;
        try {
          let key = nextKey(provider);
          // Prefer a fresh key for each retry when possible, but never spin forever.
          if (key && triedKeys.has(key) && triedKeys.size < provider.keys.length) {
            const maxProbe = Math.min(provider.keys.length, 8);
            for (let probe = 0; probe < maxProbe; probe++) {
              const alt = nextKey(provider);
              if (!alt || !triedKeys.has(alt)) {
                key = alt;
                break;
              }
            }
          }
          if (key) {
            triedKeys.add(key);
            usedKey = key;
            beginInFlight(provider, key);
          }

          const req = new Request(baseRequest);
          let attemptRequest = req;
          if (usedKey) {
            if (provider.queryParam) {
              const url = new URL(req.url);
              url.searchParams.set('key', usedKey);
              attemptRequest = new Request(url.toString(), req);
            } else {
              req.headers.set('authorization', `Bearer ${usedKey}`);
            }
          }

          const response = await orig(attemptRequest);
          lastResponse = response;
          try { handleStatus(provider, usedKey, response.status); } catch (_) {}
          try { endInFlight(provider, usedKey); } catch (_) {}

          const shouldRetry = attempt < maxAttempts && classifyRetryableFailure(response.status);
          if (shouldRetry) {
            const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
            const backoffMs = Math.min(
              10_000,
              Math.max(retryAfterMs, FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)),
            );
            warn(`[key-rotator] ${provider.name}: fetch retry ${attempt}/${maxAttempts - 1} after status=${response.status} method=${method}`);
            await sleep(backoffMs);
            continue;
          }
          return response;
        } catch (err) {
          lastErr = err;
          try { handleTransportError(provider, usedKey, err); } catch (_) {}
          try { endInFlight(provider, usedKey); } catch (_) {}
          const code = err?.code ? String(err.code).toUpperCase() : '';
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
      return await orig(baseRequest);
    } catch (err) {
      warn('[key-rotator] fetch patch error:', err?.message || err);
      throw err;
    }
  };
}

// ─── Patch node:http / node:https ────────────────────────────────────────────

function patchHttpModule(mod) {
  const orig = mod.request;

  mod.request = function patchedRequest(...args) {
    let usedKey = null, usedProvider = null;

    try {
      const options  = args[0];
      const provider = matchProvider(resolveHostname(options));

      if (provider) {
        const key = nextKey(provider);
        if (key) {
          usedKey = key; usedProvider = provider;
          beginInFlight(usedProvider, usedKey);
          if (provider.queryParam) {
            const u = new URL(String(
              typeof options === 'string' || options instanceof URL
                ? options
                : `https://${options.hostname}${options.path || '/'}`
            ));
            u.searchParams.set('key', key);
            args[0] = typeof options === 'object' && !(options instanceof URL)
              ? { ...options, path:`${u.pathname}${u.search}` }
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

    // Intercept response to track 429/success
    if (usedProvider && usedKey) {
      const _emit = req.emit.bind(req);
      req.emit = function (event, ...rest) {
        if (event === 'response') {
          const res = rest[0];
          try { handleStatus(usedProvider, usedKey, res?.statusCode); } catch (_) {}
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

patchFetch();
patchHttpModule(http);
patchHttpModule(https);
startDiagnostics();

log(`[key-rotator] loaded — cooldown base:${BASE_COOLDOWN_MS/1000}s max-strikes:${MAX_STRIKES} perm-suspend:${formatHours(PERM_SUSPEND_MS)}h (cap 16h) max-inflight-per-key:${MAX_INFLIGHT_PER_KEY} diagnostics:${DIAGNOSTICS_ENABLED ? 'on' : 'off'}`);
