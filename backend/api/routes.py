from fastapi import APIRouter
from backend.schemas.contracts import ChatRequest, ExecuteRequest, AIAction
from backend.core.planner import Planner
from backend.core.executor import Executor
from backend.core.model_manager import ModelManager
from backend.core.orchestrator import Orchestrator
from backend.tools.registry import ToolRegistry
from backend.memory.store import MemoryStore
from backend.tracking.analytics import Tracker

router = APIRouter()
registry = ToolRegistry(); registry.load_plugins()
tracker = Tracker()
planner = Planner()
executor = Executor(registry, tracker)
memory = MemoryStore()
model = ModelManager(base_url="http://localhost:11434/v1", api_key="", model_id="llama3")
orchestrator = Orchestrator(planner, model, executor, memory)

@router.post("/chat")
def chat(req: ChatRequest):
    return orchestrator.run_goal(req.message, req.session_id, req.confirm_dangerous)

@router.post("/workflow")
def workflow(req: ChatRequest):
    return orchestrator.run_goal(req.message, req.session_id, req.confirm_dangerous)

@router.post("/execute")
def execute(req: ExecuteRequest):
    step = AIAction(thought="Direct execute request", action=req.action, args=req.args)
    return {"result": executor.execute_steps([step], confirm_dangerous=req.confirm_dangerous)}

@router.get("/tools")
def tools():
    return {"tools": sorted(list(registry.tools.keys())), "analytics": tracker.analytics()}
