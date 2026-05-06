from backend.schemas.contracts import AIAction

class Planner:
    def plan(self, goal: str) -> list[AIAction]:
        return [
            AIAction(thought=f"I will inspect workspace to solve: {goal}", action="list_dir", args={"path": "."}),
            AIAction(thought="I will search relevant files to reduce steps", action="search_files", args={"query": goal.split()[0]}),
        ]
