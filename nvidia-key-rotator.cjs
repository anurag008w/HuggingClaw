'use strict';

/**
 * NVIDIA API key rotator for OpenClaw/HuggingClaw
 * ------------------------------------------------
 * - Supports comma-separated keys in NVIDIA_API_KEYS
 * - Falls back to NVIDIA_API_KEY, then LLM_API_KEY
 * - Rotates keys on every NVIDIA request
 * - Patches fetch + http/https request so most callers are covered
 */

const http = require('node:http');
const https = require('node:https');

const NVIDIA_HOST_RE = /(^|\.)((integrate\.api\.nvidia\.com)|(api\.nvidia\.com))$/i;

function normalizeKeys(input) {
  return String(input || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const keys = Array.from(
  new Set(
    normalizeKeys(process.env.NVIDIA_API_KEYS)
      .concat(normalizeKeys(process.env.NVIDIA_API_KEY))
      .concat(normalizeKeys(process.env.LLM_API_KEY))
  )
);

if (!keys.length) {
  console.warn('[nvidia-key-rotator] No NVIDIA keys found');
}

let idx = 0;

function nextKey() {
  if (!keys.length) return null;
  const key = keys[idx % keys.length];
  idx = (idx + 1) % keys.length;
  return key;
}

function isNvidiaUrl(urlLike) {
  try {
    const u = typeof urlLike === 'string'
      ? new URL(urlLike)
      : urlLike instanceof URL
        ? urlLike
        : urlLike && typeof urlLike.url === 'string'
          ? new URL(urlLike.url)
          : null;

    if (!u) return false;
    return NVIDIA_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

function setAuthHeader(headers, key) {
  if (!key) return headers;

  const authValue = `Bearer ${key}`;

  // Headers instance
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.set('authorization', authValue);
    return headers;
  }

  // Array of tuples
  if (Array.isArray(headers)) {
    const out = headers.filter(([k]) => String(k).toLowerCase() !== 'authorization');
    out.push(['authorization', authValue]);
    return out;
  }

  // Plain object
  if (headers && typeof headers === 'object') {
    return {
      ...headers,
      authorization: authValue,
    };
  }

  return { authorization: authValue };
}

function patchFetch() {
  if (typeof globalThis.fetch !== 'function') return;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function patchedFetch(input, init = {}) {
    try {
      const urlLike =
        typeof input === 'string' || input instanceof URL
          ? input
          : input && typeof input.url === 'string'
            ? input.url
            : null;

      if (urlLike && isNvidiaUrl(urlLike)) {
        const key = nextKey();
        if (key) {
          const headers = init.headers || (input && input.headers) || undefined;
          const patchedHeaders = setAuthHeader(headers, key);

          if (init && typeof init === 'object') {
            init = { ...init, headers: patchedHeaders };
          } else {
            init = { headers: patchedHeaders };
          }

          if (input && typeof input === 'object' && !(input instanceof URL) && input.headers) {
            try {
              input = new Request(input, { headers: patchedHeaders });
            } catch {
              // ignore and let fetch handle original input
            }
          }
        }
      }
    } catch (err) {
      console.warn('[nvidia-key-rotator] fetch patch error:', err?.message || err);
    }

    return originalFetch(input, init);
  };
}

function patchHttpModule(mod) {
  const originalRequest = mod.request;

  mod.request = function patchedRequest(...args) {
    try {
      let options = args[0];

      const urlLike =
        typeof options === 'string' || options instanceof URL
          ? options
          : options && typeof options === 'object' && typeof options.href === 'string'
            ? options.href
            : null;

      if (urlLike && isNvidiaUrl(urlLike)) {
        const key = nextKey();
        if (key) {
          if (typeof options === 'string' || options instanceof URL) {
            const u = new URL(String(options));
            u.username = '';
            u.password = '';
            args[0] = {
              protocol: u.protocol,
              hostname: u.hostname,
              port: u.port,
              path: `${u.pathname}${u.search}`,
              headers: { authorization: `Bearer ${key}` },
            };
          } else if (options && typeof options === 'object') {
            const headers = setAuthHeader(options.headers, key);
            args[0] = {
              ...options,
              headers,
            };
          }
        }
      }
    } catch (err) {
      console.warn('[nvidia-key-rotator] http patch error:', err?.message || err);
    }

    return originalRequest.apply(mod, args);
  };
}

patchFetch();
patchHttpModule(http);
patchHttpModule(https);

console.log(
  `[nvidia-key-rotator] loaded (${keys.length} key${keys.length === 1 ? '' : 's'})`
);