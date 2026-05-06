# DivyaOS

DivyaOS is an AI-native operating environment on Linux with chat-first control.

## Audit: what was missing and fixed now
1. **Scheduler lifecycle risk**: fixed (startup/shutdown controlled in `backend/main.py`).
2. **WebSocket auth gap**: fixed (token required on `ws://.../ws/chat?token=...`).
3. **Frontend/backend token mismatch**: fixed (GUI sends same token for HTTP + WS).
4. **Schedule input validation missing**: fixed (`hour` and `minute` bounds validated).
5. **Runtime security footgun**: fixed (non-dev mode rejects default admin token).

## Current features
- FastAPI backend with endpoints: chat/workflow/execute/tools/analytics/memory search/system snapshot/health/ready/automation.
- WebSocket action trace endpoint: `ws://localhost:8000/ws/chat?token=...`.
- Planner → ModelManager → Executor orchestrated flow.
- Mandatory tool system (file/terminal/app/browser/clipboard/notification).
- DivyaFS + memory + tracking + automation + plugin loading.
- React + Tauri UI shell with Chat, Dashboard, File Explorer, Floating Assistant, OS toggles.
- CI workflow for backend dependency install + tests and Docker build.
- Docker + Docker Compose launch support.

## Security
- Header token auth for non-health HTTP requests: `x-divya-token`.
- WebSocket token validation via query param.
- Request rate limiting per IP.
- CORS origin control via env.
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`).
- In `DIVYA_ENV!=dev`, default token is blocked at startup.

## Launch local
```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

## Launch with Docker
```bash
cp .env.example .env
docker compose up --build
```

## GitHub Actions GUI preview (open from link)
- Workflow: `.github/workflows/gui-preview.yml`
- Every push/PR builds GUI and uploads `gui-dist` artifact.
- On push to `main`, workflow deploys GUI to **GitHub Pages** and gives a `page_url` in Actions logs.

### To use
1. Repo Settings -> Pages -> Source: GitHub Actions.
2. Push to `main`.
3. Open Actions -> `gui-preview` -> `deploy-pages` job -> open deployed URL.
