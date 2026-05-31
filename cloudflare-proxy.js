/**
 * Cloudflare Proxy: Transparent Fix for Blocked Domains
 *
 * Patches https.request/http.request/fetch and undici to redirect traffic 
 * for blocked hosts through a Cloudflare Worker proxy.
 */
"use strict";

const https = require("https");
const http = require("http");

// Use stderr for logs to avoid breaking child processes that communicate via stdout JSON.
// Default output should stay quiet: debug chatter only appears when
// CLOUDFLARE_PROXY_DEBUG=true, while real problems are emitted as warnings.
const debug = (...args) => { if (DEBUG) console.error(...args); };
const warn = (...args) => console.warn(...args);

let PROXY_URL = process.env.CLOUDFLARE_PROXY_URL;
if (
  PROXY_URL &&
  !PROXY_URL.startsWith("http://") &&
  !PROXY_URL.startsWith("https://")
) {
  PROXY_URL = `https://${PROXY_URL}`;
}

const DEBUG = process.env.CLOUDFLARE_PROXY_DEBUG === "true";
const PROXY_SHARED_SECRET = (process.env.CLOUDFLARE_PROXY_SECRET || "").trim();
const DEFAULT_PROXY_DOMAINS = [
  // Messaging & social platforms — these are the primary use-case for the
  // Cloudflare proxy on HF Spaces (geo-restrictions on Telegram, Discord, WA).
  "api.telegram.org", "discord.com", "discordapp.com",
  "gateway.discord.gg", "status.discord.com",
  "web.whatsapp.com", "whatsapp.com", "whatsapp.net",
  "graph.facebook.com", "graph.instagram.com",
  "api.twitter.com", "api.x.com", "upload.twitter.com",
  "api.linkedin.com", "www.linkedin.com",
  "open.tiktokapis.com", "oauth.reddit.com",
  "youtube.com", "www.youtube.com",
  // Email delivery
  "api.resend.com", "api.sendgrid.com", "api.mailgun.net",
  // Google services
  "googleapis.com", "google.com", "googleusercontent.com", "gstatic.com",
  // NOTE: AI-provider domains (api.openai.com, api.anthropic.com, etc.) are
  // intentionally NOT included here. Proxying AI calls routes your API keys
  // through the Cloudflare Worker without an explicit opt-in. Users who need
  // AI API calls proxied (e.g. geo-restricted regions) can add specific
  // domains via the CLOUDFLARE_PROXY_DOMAINS environment variable.
];
const PROXY_DOMAINS_RAW = (process.env.CLOUDFLARE_PROXY_DOMAINS || "").trim();
const PROXY_ALL = PROXY_DOMAINS_RAW === "*";
let BLOCKED_DOMAINS;
if (PROXY_ALL) {
  BLOCKED_DOMAINS = [];
} else {
  const extra = PROXY_DOMAINS_RAW.split(",").map((d) => d.trim()).filter(Boolean);
  const seen = new Set(DEFAULT_PROXY_DOMAINS);
  BLOCKED_DOMAINS = [...DEFAULT_PROXY_DOMAINS];
  for (const d of extra) {
    if (!seen.has(d)) { BLOCKED_DOMAINS.push(d); seen.add(d); }
  }
}

if (PROXY_URL) {
  try {
    const proxy = new URL(PROXY_URL);
    const originalHttpsRequest = https.request;
    const originalHttpRequest = http.request;
    const originalFetch =
      typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

    const shouldProxyHost = (hostname) => {
      const normalized = String(hostname || "").trim().toLowerCase();
      if (!normalized) return false;

      const isInternal =
        normalized === "localhost" ||
        normalized === "127.0.0.1" ||
        normalized === "::1" ||
        normalized === "0.0.0.0" ||
        normalized === proxy.hostname ||
        normalized.endsWith(".hf.space") ||
        normalized.endsWith(".huggingface.co") ||
        normalized === "huggingface.co";

      const should = PROXY_ALL ? !isInternal : BLOCKED_DOMAINS.some(
        (domain) =>
          normalized === domain || normalized.endsWith(`.${domain}`),
      );

      return should;
    };

    const patch = (original, originalModuleName) => {
      return function patchedRequest(arg1, arg2, arg3) {
        let options = {};
        let callback;

        if (typeof arg1 === "string" || arg1 instanceof URL) {
          const url = typeof arg1 === "string" ? new URL(arg1) : arg1;
          options = {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
          };
          if (typeof arg2 === "object" && arg2 !== null) {
            options = { ...options, ...arg2 };
            callback = arg3;
          } else {
            callback = arg2;
          }
        } else {
          options = { ...arg1 };
          callback = arg2;
        }

        const hostname =
          options.hostname ||
          (options.host ? String(options.host).split(":")[0] : "");
        const path = options.path || "/";
        const headers = options.headers || {};

        const shouldProxy = shouldProxyHost(hostname);
        const alreadyProxied = options._proxied;
        const hasTargetHeader =
          headers["x-target-host"] || headers["X-Target-Host"];

        if (shouldProxy && !alreadyProxied && !hasTargetHeader) {
          if (DEBUG) {
            debug(
              `[cloudflare-proxy] Redirecting ${originalModuleName}://${hostname}${path} -> ${proxy.hostname}`,
            );
          }

          const newOptions = { ...options };
          newOptions._proxied = true;
          newOptions.protocol = "https:";
          newOptions.hostname = proxy.hostname;
          newOptions.port = proxy.port || 443;
          newOptions.servername = proxy.hostname;
          delete newOptions.host;
          delete newOptions.agent;

          newOptions.headers = {
            ...(options.headers || {}),
            host: proxy.host,
            "x-target-host": hostname,
          };

          if (PROXY_SHARED_SECRET) {
            newOptions.headers["x-proxy-key"] = PROXY_SHARED_SECRET;
          }

          return originalHttpsRequest.call(https, newOptions, callback);
        }

        return original.call(this, arg1, arg2, arg3);
      };
    };

    https.request = patch(originalHttpsRequest, "https");
    http.request = patch(originalHttpRequest, "http");

    if (originalFetch) {
      globalThis.fetch = async function patchedFetch(input, init) {
        const request = input instanceof Request ? input : null;
        const urlStr = request ? request.url : String(input);
        
        let url;
        try {
          url = new URL(urlStr);
        } catch (e) {
          return originalFetch(input, init);
        }

        const hostname = url.hostname;
        const shouldProxy = shouldProxyHost(hostname);
        
        let mergedHeaders;
        if (request) {
            mergedHeaders = new Headers(request.headers);
            if (init?.headers) {
              const initHeaders = new Headers(init.headers);
              initHeaders.forEach((v, k) => mergedHeaders.set(k, v));
            }
        } else {
            mergedHeaders = new Headers(init?.headers || {});
        }

        const alreadyProxied =
          mergedHeaders.has("x-target-host") || mergedHeaders.has("X-Target-Host");

        if (!shouldProxy || alreadyProxied) {
          return originalFetch(input, init);
        }

        if (DEBUG) {
          debug(
            `[cloudflare-proxy] Redirecting fetch://${hostname}${url.pathname}${url.search} -> ${proxy.hostname}`,
          );
        }

        mergedHeaders.set("x-target-host", hostname);
        if (PROXY_SHARED_SECRET) {
          mergedHeaders.set("x-proxy-key", PROXY_SHARED_SECRET);
        }

        const proxiedUrl = new URL(url.pathname + url.search, proxy);

        // proxyWithFallback: try via Cloudflare Worker first; if the proxy
        // itself hard-fails (ETIMEDOUT / ECONNRESET / network error), fall
        // back to a direct connection so callers still get a response.
        // HTTP-level errors from the Worker (4xx/5xx) are NOT retried —
        // only hard network failures (rejected promise) trigger the fallback.
        const proxyWithFallback = (proxyFetchFn, directFallbackFn, debugInfo) => {
          const formatCause = (err) => {
            const cause = err?.cause;
            return cause ? ` | cause: ${cause?.code || cause?.message || String(cause)}` : "";
          };
          const runProxyAttempt = (label) => {
            return Promise.resolve()
              .then(() => proxyFetchFn())
              .then((r) => {
                if (DEBUG && !r.ok) {
                  debug(`[cloudflare-proxy] Proxy HTTP ${r.status} for ${hostname}: ${r.statusText}`);
                }
                return r;
              })
              .catch((err) => {
                if (DEBUG && debugInfo) debug(`[cloudflare-proxy] Debug (${label}): ${debugInfo}`);
                throw err;
              });
          };

          // Requested failover chain:
          // proxy x3 -> direct x1 -> proxy x1
          return runProxyAttempt("proxy-1")
            .catch((e1) => {
              debug(`[cloudflare-proxy] Proxy FAILED ${hostname} [1/3]: ${e1?.message}${formatCause(e1)}`);
              return runProxyAttempt("proxy-2");
            })
            .catch((e2) => {
              debug(`[cloudflare-proxy] Proxy FAILED ${hostname} [2/3]: ${e2?.message}${formatCause(e2)}`);
              return runProxyAttempt("proxy-3");
            })
            .catch((e3) => {
              warn(`[cloudflare-proxy] Proxy failed for ${hostname} after 3 attempts: ${e3?.message}${formatCause(e3)} — trying direct`);
              return Promise.resolve()
                .then(() => directFallbackFn())
                .catch((directErr) => {
                  warn(`[cloudflare-proxy] Direct fallback failed for ${hostname}: ${directErr?.message}${formatCause(directErr)} — trying proxy final`);
                  return runProxyAttempt("proxy-final");
                });
            });
        };

        if (request) {
          const fetchOpts = {
            method: request.method,
            headers: mergedHeaders,
            redirect: request.redirect,
          };
          if (request.body && !request.bodyUsed) {
            fetchOpts.body = request.body;
            fetchOpts.duplex = request.duplex || "half";
          }
          return proxyWithFallback(
            () => originalFetch(String(proxiedUrl), fetchOpts),
            () => originalFetch(input, init),
            `request-mode method=${request.method} hasBody=${!!request.body}`,
          );
        }

        // Build a fresh init: do NOT spread `init` because it may carry a
        // `dispatcher`/`client` pinned to the original target's connection
        // pool, which causes undici to throw UND_ERR_INVALID_ARG when we
        // change the origin. Forward only well-known fetch options.
        const newInit = {
          method: init?.method || "GET",
          headers: mergedHeaders,
        };
        if (init?.body != null) {
          newInit.body = init.body;
          if (init.body instanceof ReadableStream) {
            newInit.duplex = init.duplex || "half";
          }
        }
        if (init?.signal) newInit.signal = init.signal;
        if (init?.redirect) newInit.redirect = init.redirect;
        if (init?.credentials) newInit.credentials = init.credentials;
        if (init?.cache) newInit.cache = init.cache;
        if (init?.mode) newInit.mode = init.mode;
        if (init?.referrer) newInit.referrer = init.referrer;
        if (init?.referrerPolicy) newInit.referrerPolicy = init.referrerPolicy;
        if (init?.integrity) newInit.integrity = init.integrity;
        if (init?.keepalive != null) newInit.keepalive = init.keepalive;

        const bodyType = init?.body == null
          ? "none"
          : init.body instanceof ReadableStream
            ? "ReadableStream"
            : (init.body?.constructor?.name || typeof init.body);

        return proxyWithFallback(
          () => originalFetch(String(proxiedUrl), newInit),
          () => originalFetch(input, init),
          `init-mode method=${newInit.method} body=${bodyType} initKeys=${Object.keys(init || {}).join(",")}`,
        );
      };
    }

    // undici patching
    const patchUndiciInstance = (exports) => {
      if (!exports) return;

      const patchDispatch = (proto, name) => {
        if (proto && proto.dispatch && !proto.dispatch._patched) {
          const origDispatch = proto.dispatch;
          proto.dispatch = function(options, handler) {
            let origin = options.origin || this.origin;
            if (origin && typeof origin !== 'string') {
              try { origin = origin.origin || origin.toString(); } catch (e) { origin = ""; }
            }
            
            let hostname = "";
            try {
              hostname = new URL(String(origin)).hostname;
            } catch(e) {
              hostname = String(origin || "").split(':')[0];
            }

            if (hostname && shouldProxyHost(hostname)) {
              if (DEBUG) debug(`[cloudflare-proxy] Redirecting undici ${name}.dispatch: ${hostname}${options.path || ""} -> ${proxy.hostname}`);
              
              const targetHeader = "x-target-host";
              const secretHeader = "x-proxy-key";

              if (Array.isArray(options.headers)) {
                let foundTarget = false;
                for (let i = 0; i < options.headers.length; i += 2) {
                  if (String(options.headers[i]).toLowerCase() === targetHeader) {
                    foundTarget = true;
                    break;
                  }
                }
                if (!foundTarget) {
                  options.headers.push(targetHeader, hostname);
                  if (PROXY_SHARED_SECRET) options.headers.push(secretHeader, PROXY_SHARED_SECRET);
                }
              } else {
                options.headers = options.headers || {};
                if (options.headers instanceof Map || (typeof options.headers.set === 'function')) {
                  options.headers.set(targetHeader, hostname);
                  if (PROXY_SHARED_SECRET) options.headers.set(secretHeader, PROXY_SHARED_SECRET);
                } else {
                  options.headers[targetHeader] = hostname;
                  if (PROXY_SHARED_SECRET) options.headers[secretHeader] = PROXY_SHARED_SECRET;
                }
              }
              options.origin = `https://${proxy.hostname}`;
            }
            return origDispatch.call(this, options, handler);
          };
          proto.dispatch._patched = true;
        }
      };

      for (const key in exports) {
        if (exports[key] && exports[key].prototype && typeof exports[key].prototype.dispatch === 'function') {
           patchDispatch(exports[key].prototype, key);
        }
      }

      if (exports.getGlobalDispatcher) {
        try {
          const globalDispatcher = exports.getGlobalDispatcher();
          if (globalDispatcher && globalDispatcher.dispatch && !globalDispatcher.dispatch._patched) {
            patchDispatch(globalDispatcher, "GlobalDispatcherInstance");
          }
        } catch (e) {}
      }

      // Also patch Agent and other potentially unexported classes if they have dispatch
      if (exports.Agent && exports.Agent.prototype) patchDispatch(exports.Agent.prototype, "Agent");
      if (exports.Pool && exports.Pool.prototype) patchDispatch(exports.Pool.prototype, "Pool");
      if (exports.Client && exports.Client.prototype) patchDispatch(exports.Client.prototype, "Client");

      if (exports.fetch && !exports.fetch._patched) {
        const origFetch = exports.fetch;
        exports.fetch = async function patchedUndiciFetch(input, init) {
          let url;
          try {
            const urlStr = input && typeof input === "object" && "url" in input
              ? input.url
              : String(input);
            url = new URL(urlStr);
          } catch (_) {
            return origFetch(input, init);
          }

          const hostname = url.hostname;
          if (!shouldProxyHost(hostname)) {
            // Important: keep OpenClaw's bundled undici fetch on its own undici
            // runtime. Forwarding undici.fetch to globalThis.fetch mixes Node's
            // built-in undici with OpenClaw's bundled dispatchers and can break
            // local CDP probes with "invalid onRequestStart method".
            return origFetch(input, init);
          }

          const requestLike = input && typeof input === "object" ? input : null;
          const headers = new Headers(init?.headers || requestLike?.headers || undefined);
          if (headers.has("x-target-host") || headers.has("X-Target-Host")) {
            return origFetch(input, init);
          }

          if (DEBUG) {
            debug(
              `[cloudflare-proxy] Redirecting undici.fetch://${hostname}${url.pathname}${url.search} -> ${proxy.hostname}`,
            );
          }

          headers.set("x-target-host", hostname);
          if (PROXY_SHARED_SECRET) {
            headers.set("x-proxy-key", PROXY_SHARED_SECRET);
          }

          const proxiedUrl = new URL(url.pathname + url.search, proxy);
          const newInit = {
            method: init?.method || requestLike?.method || "GET",
            headers,
          };

          // Preserve the normal fetch surface for proxied undici.fetch calls. In
          // particular, callers may pass a Request object with its body on the
          // input instead of init; dropping that body would silently break POST
          // uploads to proxied domains. Avoid spreading init because dispatcher/
          // client objects are bound to the original origin.
          const body = init?.body ?? (!requestLike?.bodyUsed ? requestLike?.body : undefined);
          if (body != null) {
            newInit.body = body;
            if (body instanceof ReadableStream) {
              newInit.duplex = init?.duplex || requestLike?.duplex || "half";
            }
          }
          const signal = init?.signal || requestLike?.signal;
          if (signal) newInit.signal = signal;
          const redirect = init?.redirect || requestLike?.redirect;
          if (redirect) newInit.redirect = redirect;
          const integrity = init?.integrity || requestLike?.integrity;
          if (integrity) newInit.integrity = integrity;

          return origFetch(String(proxiedUrl), newInit);
        };
        exports.fetch._patched = true;
      }
    };

    // FIX: WeakSet guard — each unique exports object is patched at most once.
    // Without this, the require hook fires on every cached require("undici") call
    // and re-calls patchUndiciInstance. The _patched flag stops re-wrapping within
    // one call, but the overhead was O(n_requires) per process boot. More critically,
    // this was the other half of the mutual re-wrapping cycle with
    // multi-provider-key-rotator (which uses _kRotatorPatched instead of _patched).
    const _cfProxySeen = new WeakSet();
    function patchUndiciOnce(exp) {
      if (!exp || typeof exp !== "object") return;
      if (_cfProxySeen.has(exp)) return;
      _cfProxySeen.add(exp);
      patchUndiciInstance(exp);
    }

    // Try to require undici immediately
    try {
      const undici = require("undici");
      patchUndiciOnce(undici);
    } catch (e) {}

    // Hook require() to patch any undici instance the moment it loads.
    // Match either the bare "undici" id or paths whose final package
    // segment IS undici (e.g. "/foo/node_modules/undici/index.js"). The
    // earlier substring check `id.includes("/undici/")` would also match
    // unrelated packages like "super-undici-x".
    const Module = require("module");
    const originalRequire = Module.prototype.require;
    const UNDICI_PATH_RE = /(?:^|\/)node_modules\/undici(?:\/|$)/;
    Module.prototype.require = function (id) {
      const exports = originalRequire.apply(this, arguments);
      if (id === "undici" || UNDICI_PATH_RE.test(id)) {
        try { patchUndiciOnce(exports); } catch (e) {}
      }
      return exports;
    };

    // Startup banner: print once across all Node spawns. Use a file marker
    // because every Node process (health-server, gateway, sync subprocess)
    // is spawned fresh from bash with NODE_OPTIONS=--require, so an env-var
    // marker won't propagate. /tmp is per-container so it resets on rebuild.
    if (DEBUG) {
      try {
        require("fs").writeFileSync("/tmp/.cf-proxy-banner-shown", "1", {
          flag: "wx",
        });
        debug(
          `[cloudflare-proxy] active (${PROXY_ALL ? "wildcard" : "list"}) -> ${proxy.hostname}`,
        );
      } catch (_) {
        // marker exists — banner already shown by another process
      }
    }
  } catch (error) {
    warn(`[cloudflare-proxy] Failed to initialize: ${error.message}`);
  }
}
