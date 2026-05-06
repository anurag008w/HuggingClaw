from pydantic import BaseModel, Field, field_validator
from typing import Any, Literal

class AIAction(BaseModel):
    thought: str
    action: str
    args: dict[str, Any] = Field(default_factory=dict)

class ChatRequest(BaseModel):
    message: str
    session_id: str = 'default'
    confirm_dangerous: bool = False

class ExecuteRequest(BaseModel):
    action: str
    args: dict[str, Any] = Field(default_factory=dict)
    confirm_dangerous: bool = False

class MemorySearchRequest(BaseModel):
    session_id: str = 'default'
    query: str

class ScheduleRequest(BaseModel):
    name: str
    hour: int
    minute: int
    action: str
    args: dict[str, Any] = Field(default_factory=dict)

    @field_validator('hour')
    @classmethod
    def validate_hour(cls, v: int) -> int:
        if v < 0 or v > 23:
            raise ValueError('hour must be 0..23')
        return v

    @field_validator('minute')
    @classmethod
    def validate_minute(cls, v: int) -> int:
        if v < 0 or v > 59:
            raise ValueError('minute must be 0..59')
        return v

class TriggerRequest(BaseModel):
    event: str

class ToolResult(BaseModel):
    success: bool
    output: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None

class ActionLog(BaseModel):
    action: str
    permission: Literal['SAFE', 'MEDIUM', 'DANGEROUS']
    args: dict[str, Any] = Field(default_factory=dict)
