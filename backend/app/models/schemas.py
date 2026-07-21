from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WorkflowPayload(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    workflow: WorkflowPayload | None = None
    schedule: dict[str, Any] | None = None
    schedule_enabled: bool = False
    schedule_interval_minutes: int | None = Field(default=None, ge=1)


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    workflow: WorkflowPayload
    schedule: dict[str, Any] | None = None
    schedule_enabled: bool = False
    schedule_interval_minutes: int | None = Field(default=None, ge=1)
