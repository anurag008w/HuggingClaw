from backend.tools.registry import ToolRegistry
from backend.models.permissions import PermissionLevel
from backend.schemas.contracts import AIAction
from backend.tracking.analytics import Tracker

class Executor:
    def __init__(self, registry: ToolRegistry, tracker: Tracker):
        self.registry = registry
        self.tracker = tracker

    def execute_step(self, step: AIAction, confirm_dangerous: bool = False) -> dict:
        tool = self.registry.get(step.action)
        self.tracker.log_action(step.action, tool.permission.value, step.args)
        if tool.permission == PermissionLevel.DANGEROUS and not confirm_dangerous:
            return {"success": False, "error": "Confirmation required", "step": step.model_dump()}
        for attempt in range(3):
            try:
                out = tool.run(**step.args)
                return {"success": True, "output": out, "attempt": attempt + 1, "step": step.model_dump()}
            except Exception as e:
                if attempt == 2:
                    return {"success": False, "error": str(e), "step": step.model_dump()}
        return {"success": False, "error": "Unknown execution error", "step": step.model_dump()}

    def execute_steps(self, steps: list[AIAction], confirm_dangerous: bool = False) -> list[dict]:
        return [self.execute_step(step, confirm_dangerous=confirm_dangerous) for step in steps]
