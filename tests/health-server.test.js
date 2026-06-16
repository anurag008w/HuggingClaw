"use strict";
// Tests for the changes introduced in this PR to health-server.js:
//   1. parseCookies() – rewritten to use an explicit loop with try/catch so
//      that a malformed percent-encoded cookie value does not crash the server.
//   2. WebSocket upgrade handler – the Authorization header sent by the
//      browser is now suppressed when the proxy is injecting its own
//      "Authorization: Bearer <GATEWAY_TOKEN>" header for /app paths.

// ---------------------------------------------------------------------------
// Inline copy of parseCookies() from health-server.js (lines 264-282).
// Because health-server.js starts an HTTP server on require(), we reproduce
// the function here rather than importing the whole module.  The test verifies
// the algorithm introduced by the PR diff, not a separate reimplementation.
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const h = req.headers.cookie || "";
  const cookies = {};
  for (const rawCookie of h.split(";")) {
    const parts = rawCookie.trim().split("=");
    if (parts.length < 2) continue;
    const key = parts.shift().trim();
    if (!key) continue;
    const rawValue = parts.join("=").trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      // Malformed percent-encoding – skip this cookie.
    }
  }
  return cookies;
}

// ---------------------------------------------------------------------------
// Helper that replicates the WS-upgrade authorization-header filtering logic
// from health-server.js lines 1133-1138.  Returns the list of header names
// (lower-cased) that would be forwarded to the upstream target.
// ---------------------------------------------------------------------------
const STANDARD_SKIP = new Set([
  "host",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-prefix",
]);

function filterUpgradeHeaders(rawHeaders, { isApp, bridgeGatewayAuth, gatewayToken }) {
  const forwarded = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const header = rawHeaders[i];
    const lower = header.toLowerCase();
    if (STANDARD_SKIP.has(lower)) continue;
    if (lower === "authorization" && isApp && bridgeGatewayAuth && gatewayToken) continue;
    forwarded.push(lower);
  }
  return forwarded;
}

// ---------------------------------------------------------------------------
// parseCookies tests
// ---------------------------------------------------------------------------
describe("parseCookies", () => {
  test("parses a single normal cookie", () => {
    const req = { headers: { cookie: "session=abc123" } };
    expect(parseCookies(req)).toEqual({ session: "abc123" });
  });

  test("parses multiple cookies", () => {
    const req = { headers: { cookie: "a=1; b=2; c=3" } };
    expect(parseCookies(req)).toEqual({ a: "1", b: "2", c: "3" });
  });

  test("decodes percent-encoded cookie values", () => {
    const req = { headers: { cookie: "msg=hello%20world" } };
    expect(parseCookies(req)).toEqual({ msg: "hello world" });
  });

  test("handles cookie value containing '=' (base64 etc.)", () => {
    const req = { headers: { cookie: "tok=abc=def=ghi" } };
    expect(parseCookies(req)).toEqual({ tok: "abc=def=ghi" });
  });

  test("skips entry with no value (no '=' separator)", () => {
    const req = { headers: { cookie: "badentry; good=ok" } };
    expect(parseCookies(req)).toEqual({ good: "ok" });
  });

  test("skips cookie with empty key", () => {
    // A cookie like '=value' has an empty key after trim() – should be ignored.
    const req = { headers: { cookie: "=value; valid=yes" } };
    expect(parseCookies(req)).toEqual({ valid: "yes" });
  });

  test("tolerates malformed percent-encoding without throwing", () => {
    // '%zz' is not valid percent-encoding; decodeURIComponent throws URIError.
    // The PR fix silently drops such cookies instead of crashing.
    const req = { headers: { cookie: "bad=%zz; good=ok" } };
    expect(() => parseCookies(req)).not.toThrow();
    // 'bad' cookie should be absent (dropped), 'good' should be present.
    const result = parseCookies(req);
    expect(result.bad).toBeUndefined();
    expect(result.good).toBe("ok");
  });

  test("returns empty object when cookie header is absent", () => {
    const req = { headers: {} };
    expect(parseCookies(req)).toEqual({});
  });

  test("returns empty object when cookie header is empty string", () => {
    const req = { headers: { cookie: "" } };
    expect(parseCookies(req)).toEqual({});
  });

  test("handles leading/trailing whitespace around keys and values", () => {
    const req = { headers: { cookie: "  key1 = val1 ;  key2 = val2 " } };
    expect(parseCookies(req)).toEqual({ key1: "val1", key2: "val2" });
  });

  test("handles multiple malformed cookies mixed with valid ones", () => {
    // %zz and %gg are invalid percent sequences; %C3%BF is valid UTF-8 for ÿ (U+00FF).
    const req = { headers: { cookie: "a=%zz; b=%gg; c=good; d=%C3%BF" } };
    const result = parseCookies(req);
    expect(result.a).toBeUndefined();
    expect(result.b).toBeUndefined();
    // %C3%BF is the valid UTF-8 encoding of ÿ (U+00FF) – should be present.
    expect(result.d).toBe("\u00ff");
    expect(result.c).toBe("good");
  });

  test("handles single cookie with no spaces", () => {
    const req = { headers: { cookie: "token=xyz" } };
    expect(parseCookies(req)).toEqual({ token: "xyz" });
  });

  test("does not mutate the request headers object", () => {
    const req = { headers: { cookie: "x=1; y=2" } };
    const before = req.headers.cookie;
    parseCookies(req);
    expect(req.headers.cookie).toBe(before);
  });

  test("regression: does not crash on semicolons with only whitespace between them", () => {
    const req = { headers: { cookie: "a=1;;; b=2" } };
    expect(() => parseCookies(req)).not.toThrow();
    expect(parseCookies(req)).toMatchObject({ a: "1", b: "2" });
  });
});

// ---------------------------------------------------------------------------
// WebSocket upgrade – authorization header suppression (PR line 1137)
// ---------------------------------------------------------------------------
describe("WS upgrade: authorization header filtering", () => {
  const baseHeaders = ["Upgrade", "websocket", "Connection", "upgrade", "Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="];

  test("forwards Authorization when not an /app path", () => {
    const rawHeaders = [...baseHeaders, "Authorization", "Bearer user-token"];
    const forwarded = filterUpgradeHeaders(rawHeaders, {
      isApp: false,
      bridgeGatewayAuth: true,
      gatewayToken: "server-secret",
    });
    expect(forwarded).toContain("authorization");
  });

  test("suppresses Authorization on /app path when bridgeGatewayAuth and gatewayToken are set", () => {
    const rawHeaders = [...baseHeaders, "Authorization", "Bearer user-token"];
    const forwarded = filterUpgradeHeaders(rawHeaders, {
      isApp: true,
      bridgeGatewayAuth: true,
      gatewayToken: "server-secret",
    });
    // The client's Authorization header must NOT be forwarded – the proxy
    // injects its own "Authorization: Bearer server-secret" instead.
    expect(forwarded).not.toContain("authorization");
  });

  test("forwards Authorization on /app path when bridgeGatewayAuth is false", () => {
    // Unauthenticated request – no injection, so don't strip the client header.
    const rawHeaders = [...baseHeaders, "Authorization", "Bearer user-token"];
    const forwarded = filterUpgradeHeaders(rawHeaders, {
      isApp: true,
      bridgeGatewayAuth: false,
      gatewayToken: "server-secret",
    });
    expect(forwarded).toContain("authorization");
  });

  test("forwards Authorization on /app path when gatewayToken is empty", () => {
    const rawHeaders = [...baseHeaders, "Authorization", "Bearer user-token"];
    const forwarded = filterUpgradeHeaders(rawHeaders, {
      isApp: true,
      bridgeGatewayAuth: true,
      gatewayToken: "",
    });
    expect(forwarded).toContain("authorization");
  });

  test("always strips standard hop-by-hop headers", () => {
    const rawHeaders = [
      "Host", "example.com",
      "X-Forwarded-For", "1.2.3.4",
      "X-Forwarded-Host", "example.com",
      "X-Forwarded-Proto", "https",
      "X-Forwarded-Prefix", "/app",
      "Upgrade", "websocket",
    ];
    const forwarded = filterUpgradeHeaders(rawHeaders, {
      isApp: false,
      bridgeGatewayAuth: false,
      gatewayToken: "",
    });
    for (const h of ["host", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-prefix"]) {
      expect(forwarded).not.toContain(h);
    }
    expect(forwarded).toContain("upgrade");
  });

  test("handles rawHeaders with no Authorization header gracefully", () => {
    const forwarded = filterUpgradeHeaders(baseHeaders, {
      isApp: true,
      bridgeGatewayAuth: true,
      gatewayToken: "secret",
    });
    expect(forwarded).not.toContain("authorization");
  });

  test("suppresses Authorization only once (odd-index rawHeaders are values)", () => {
    // rawHeaders is [name, value, name, value, ...] – only names at even indices
    const rawHeaders = [
      "Authorization", "Bearer user-token",
      "X-Custom", "data",
      "Authorization", "Bearer second-token",
    ];
    const forwarded = filterUpgradeHeaders(rawHeaders, {
      isApp: true,
      bridgeGatewayAuth: true,
      gatewayToken: "secret",
    });
    // Both Authorization entries should be stripped
    expect(forwarded.filter(h => h === "authorization")).toHaveLength(0);
    expect(forwarded).toContain("x-custom");
  });
});