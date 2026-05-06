from fastapi import FastAPI
from backend.api.routes import router
from backend.automation.engine import AutomationEngine

app = FastAPI(title="DivyaOS API", version="0.2.0")
app.include_router(router)
automation = AutomationEngine()

@app.on_event("startup")
def startup() -> None:
    automation.start()

@app.on_event("shutdown")
def shutdown() -> None:
    automation.stop()
