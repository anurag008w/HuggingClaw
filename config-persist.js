"use strict";

/**
 * Persist runtime gateway config changes by re-applying the latest config
 * payload through RPC whenever the config hash changes.
 */

const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "";
const INTERVAL_MS = Math.max(1000, Number(process.env.CONFIG_PERSIST_INTERVAL || "10") * 1000);
const WS_URL = process.env.CONFIG_PERSIST_WS_URL || "ws://127.0.0.1:7860";
const CONFIG_PATH = process.env.CONFIG_PERSIST_PATH || "/home/node/.openclaw/openclaw.json";

let lastHash = "";
let seq = 0;

function writeConfigAtomically(raw) {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, raw, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function callRpc(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), 10_000);

    const onMessage = (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (payload.id !== id) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      if (payload.ok) resolve(payload);
      else reject(new Error(payload.error || `RPC failed: ${method}`));
    };

    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function loop() {
  while (true) {
    let ws;
    try {
      ws = new WebSocket(WS_URL, {
        headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
      });
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });

      // Keep connection alive until an error; poll hash at interval.
      while (ws.readyState === WebSocket.OPEN) {
        try {
          const getRes = await callRpc(ws, "config.get", {});
          const hash = getRes?.payload?.hash || "";
          const raw = getRes?.payload?.raw || "";
          if (hash && raw && hash !== lastHash) {
            // Persist on disk directly so WebUI toggles are reflected in openclaw.json
            // even if a given OpenClaw CLI/RPC apply path is flaky in some versions.
            writeConfigAtomically(raw);
            // Also keep runtime config in sync with explicit apply.
            await callRpc(ws, "config.apply", {
              raw,
              baseHash: hash,
              note: "huggingclaw-config-persist",
            });
            lastHash = hash;
          }
        } catch {
          // swallow and retry next tick
        }
        await delay(INTERVAL_MS);
      }
    } catch {
      // gateway may still be booting
    } finally {
      try { ws && ws.close(); } catch {}
    }
    await delay(2000);
  }
}

loop().catch(() => process.exit(1));
