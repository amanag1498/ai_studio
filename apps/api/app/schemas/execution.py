from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RuntimeNodeInput(BaseModel):
    value: Any = None
    files: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExecuteWorkflowRequest(BaseModel):
    trigger_mode: str = Field(default="manual", max_length=50)
    session_id: str = Field(default="default-session", max_length=255)
    user_id: str = Field(default="local-user", max_length=255)
    inputs: dict[str, RuntimeNodeInput] = Field(default_factory=dict)


class WorkflowNodeRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_id: str
    block_type: str
    status: str
    execution_index: int
    started_at: datetime
    completed_at: datetime | None
    latency_ms: int | None
    input_payload: dict[str, Any]
    output_payload: dict[str, Any]
    preview_payload: dict[str, Any]
    log_messages: list[Any]
    error_message: str | None


class WorkflowRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workflow_id: int
    status: str
    trigger_mode: str
    owner_user_id: int | None
    session_id: str | None
    runtime_user_id: str | None
    started_at: datetime
    completed_at: datetime | None
    latency_ms: int | None
    graph_version: int
    graph_snapshot: dict[str, Any]
    input_payload: dict[str, Any]
    output_payload: dict[str, Any]
    preview_payload: dict[str, Any]
    log_messages: list[Any]
    error_message: str | None
    node_runs: list[WorkflowNodeRunRead]
