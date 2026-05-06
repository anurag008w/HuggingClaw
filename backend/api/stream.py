from fastapi import APIRouter, WebSocket
import json
import time
from backend.core.config import settings
from backend.api.routes import orchestrator

router = APIRouter()


@router.websocket('/ws/chat')
async def ws_chat(websocket: WebSocket):
    token = websocket.query_params.get('token', '')
    if token != settings.admin_token:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    try:
        while True:
            text = await websocket.receive_text()
            req = json.loads(text) if text.strip().startswith('{') else {
                "message": text,
                "session_id": "ws",
                "confirm_dangerous": False,
            }

            events: list[dict] = []

            def emit(event: dict):
                event["ts"] = time.time()
                events.append(event)

            orchestrator.stream_run_goal(
                req.get("message", ""),
                req.get("session_id", "ws"),
                bool(req.get("confirm_dangerous", False)),
                emit,
            )
            for event in events:
                await websocket.send_text(json.dumps(event))
    except Exception:
        await websocket.close()
