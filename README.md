# DivyaOS

DivyaOS is an AI-native operating environment on Linux.

## Completed modules
- User Interface: React + Tauri shell with Chat, File Explorer, Dashboard, Floating Assistant.
- AI Core: ModelManager + Planner + Executor + Orchestrator workflow.
- Tool System: modular tools for files, terminal, apps, browser, clipboard, notifications.
- DivyaFS: `/divya/{files,memory,logs,projects}` + SQLite metadata + FAISS hooks.
- System Layer: Linux process, shell, app control integration.

## API
- `POST /chat`
- `POST /workflow`
- `POST /execute`
- `GET /tools`

## Run backend
```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

## Workflow
1. Parse intent
2. Create plan
3. Execute tools (with permission checks)
4. Update memory
5. Return result

## Safety
- Structured AI action format:
```json
{"thought":"...","action":"tool_name","args":{}}
```
- Dangerous actions require `confirm_dangerous=true`.
- Action logs written to `/divya/logs/actions.jsonl`.
