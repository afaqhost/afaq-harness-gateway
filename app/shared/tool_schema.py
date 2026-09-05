from __future__ import annotations

from pydantic import BaseModel, Field


class FunctionDef(BaseModel):
    name: str
    description: str | None = None
    parameters: dict | None = None


class ToolDef(BaseModel):
    type: str = "function"
    function: FunctionDef
