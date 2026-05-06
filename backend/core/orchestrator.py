from typing import Callable
from backend.core.planner import Planner
from backend.core.model_manager import ModelManager
from backend.core.executor import Executor
from backend.schemas.contracts import AIAction
from backend.memory.store import MemoryStore

class Orchestrator:
    def __init__(self, planner: Planner, model: ModelManager, executor: Executor, memory: MemoryStore):
        self.planner = planner
        self.model = model
        self.executor = executor
        self.memory = memory

    def _build_steps(self, message: str) -> list[AIAction]:
        planned = self.planner.plan(message)
        model_step = self.model.generate_action(message)
        return [*planned, model_step]

    def run_goal(self, message: str, session_id: str, confirm_dangerous: bool = False) -> dict:
        steps = self._build_steps(message)
        results = self.executor.execute_steps(steps, confirm_dangerous=confirm_dangerous)
        self.memory.store_memory(session_id, message)
        return {
            "explanation": "I planned the task, selected a minimal tool action, then executed safely with logging.",
            "plan": [s.model_dump() for s in steps],
            "results": results,
            "memory_hits": self.memory.search_memory(session_id, message),
        }

    def stream_run_goal(self, message: str, session_id: str, confirm_dangerous: bool, emit: Callable[[dict], None]) -> dict:
        emit({"type": "status", "message": "planning"})
        steps = self._build_steps(message)
        results = []
        for i, step in enumerate(steps, start=1):
            emit({"type": "step_started", "index": i, "step": step.model_dump()})
            result = self.executor.execute_step(step, confirm_dangerous=confirm_dangerous)
            results.append(result)
            emit({"type": "step_completed", "index": i, "result": result})
        self.memory.store_memory(session_id, message)
        payload = {
            "type": "final",
            "explanation": "I planned the task, selected a minimal tool action, then executed safely with logging.",
            "plan": [s.model_dump() for s in steps],
            "results": results,
            "memory_hits": self.memory.search_memory(session_id, message),
        }
        emit(payload)
        return payload
