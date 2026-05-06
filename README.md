# DivyaOS

DivyaOS is an AI-native operating environment on Linux with chat-first control.

## What is now complete
- ✅ FastAPI backend with orchestration and modular tool execution
- ✅ AI action format (`thought`, `action`, `args`) across planner/model/executor
- ✅ Tool system: file, terminal, app control, browser, clipboard, notifications
- ✅ DivyaFS primitives with SQLite metadata and FAISS hooks
- ✅ Memory: short-term (session) + persistent long-term
- ✅ Tracking + action logs
- ✅ Automation engine (time and event triggers)
- ✅ Plugin loading with sample plugin (`echo_plugin`)
- ✅ React + Tauri GUI shell with Chat, File Explorer, Dashboard, Floating Assistant

## API
- `GET /healthz`
- `GET /readyz`
- `GET /launch-check`
- `POST /chat`
- `POST /workflow`
- `POST /execute`
- `GET /tools`

## Launch backend
```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

## Launch GUI
```bash
cd gui
npm install
npm run dev
```

## Production safety
- Dangerous operations require `confirm_dangerous=true`.
- All actions are logged to `/divya/logs/actions.jsonl`.
- Run readiness checks before launch: `/readyz` and `/launch-check`.
