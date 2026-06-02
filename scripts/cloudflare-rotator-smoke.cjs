#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

function runCase(name, source, extraEnv = {}) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(`\n[FAIL] ${name}\n`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
  process.stdout.write(`[PASS] ${name}${result.stdout.trim() ? ` — ${result.stdout.trim()}` : ''}\n`);
}

runCase('default Cloudflare proxy domains still cover Telegram, WhatsApp, and Google web/search hosts', String.raw`
const http = require('node:http');
(async () => {
  const hits = [];
  const proxy = http.createServer((req, res) => {
    hits.push({ url: req.url, target: req.headers['x-target-host'] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  process.env.CLOUDFLARE_PROXY_URL = 'http://127.0.0.1:' + proxy.address().port;
  require('./cloudflare-proxy.js');
  await fetch('https://api.telegram.org/botTEST/getMe');
  await fetch('https://web.whatsapp.com/check');
  await fetch('https://www.google.com/search?q=huggingclaw');
  proxy.close();
  const targets = hits.map((hit) => hit.target);
  if (targets.join(',') !== 'api.telegram.org,web.whatsapp.com,www.google.com') {
    console.error(JSON.stringify(hits));
    process.exit(1);
  }
  console.log(targets.join(','));
})();
`);

runCase('rotator loaded before Cloudflare still proxies Gemini and injects native key query param', String.raw`
const http = require('node:http');
(async () => {
  const hits = [];
  const proxy = http.createServer((req, res) => {
    hits.push({ url: req.url, target: req.headers['x-target-host'] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  process.env.CLOUDFLARE_PROXY_URL = 'http://127.0.0.1:' + proxy.address().port;
  require('./multi-provider-key-rotator.cjs');
  require('./cloudflare-proxy.js');
  await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  proxy.close();
  const hit = hits[0];
  if (!hit || hit.target !== 'generativelanguage.googleapis.com' || !hit.url.includes('key=gemini-key-1')) {
    console.error(JSON.stringify(hits));
    process.exit(1);
  }
  console.log(hit.target + ' ' + hit.url);
})();
`, {
  KEY_ROTATOR_EVENT_LOG_FILE: '/tmp/huggingclaw-smoke-rotator-cf.jsonl',
  KEY_ROTATOR_LOG_LEVEL: 'silent',
  GEMINI_API_KEYS: 'gemini-key-1',
});

runCase('Headers x-target-host requests still receive Gemini OpenAI-compatible bearer rotation', String.raw`
const http = require('node:http');
require('./multi-provider-key-rotator.cjs');
(async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const headers = new Headers({
    'x-target-host': 'generativelanguage.googleapis.com',
    'content-type': 'application/json',
  });
  await fetch('http://127.0.0.1:' + server.address().port + '/v1beta/openai/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'google/gemini-2.5-flash' }),
  });
  server.close();
  const auth = String(seen[0]?.authorization || '');
  if (!auth.includes('gemini-key-1')) {
    console.error(JSON.stringify(seen));
    process.exit(1);
  }
  console.log(auth);
})();
`, {
  KEY_ROTATOR_EVENT_LOG_FILE: '/tmp/huggingclaw-smoke-headers.jsonl',
  KEY_ROTATOR_LOG_LEVEL: 'silent',
  GEMINI_API_KEYS: 'gemini-key-1',
});

runCase('route-scoped LLM_API_KEY fallback still avoids unrelated dummy providers', String.raw`
require('./multi-provider-key-rotator.cjs');
const fs = require('node:fs');
const events = fs.readFileSync(process.env.KEY_ROTATOR_EVENT_LOG_FILE, 'utf8').trim().split('\n').map(JSON.parse);
const loaded = events.find((event) => event.type === 'rotator_loaded');
const providers = loaded.providers.map((provider) => provider.name).sort();
if (providers.join(',') !== 'gemini,openrouter') {
  console.error(JSON.stringify(loaded.providers));
  process.exit(1);
}
console.log(providers.join(','));
`, {
  KEY_ROTATOR_EVENT_LOG_FILE: '/tmp/huggingclaw-smoke-fallback.jsonl',
  KEY_ROTATOR_LOG_LEVEL: 'silent',
  LLM_MODEL: 'google/gemini-2.5-flash',
  LLM_API_KEY: 'sk-route-fallback',
  OPENROUTER_API_KEYS: 'or-dedicated',
});
