from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Position2D(BaseModel):
    x: float
    y: float


class BuilderNodeData(BaseModel):
    blockType: str
    label: str = Field(min_length=1, max_length=255)
    kind: str
    category: str
    description: str | None = None
    accentColor: str
    icon: str
    inputs: list[dict[str, Any]] = Field(default_factory=list)
    outputs: list[dict[str, Any]] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)


class BuilderNodePayload(BaseModel):
    id: str = Field(min_length=1, max_length=255)
    type: str = "builderBlock"
    position: Position2D
    data: BuilderNodeData


class BuilderEdgePayload(BaseModel):
    id: str = Field(min_length=1, max_length=255)
    source: str = Field(min_length=1, max_length=255)
    target: str = Field(min_length=1, max_length=255)
    sourceHandle: str | None = None
    targetHandle: str | None = None
    label: str | None = Field(default=None, max_length=255)


class BuilderGraphPayload(BaseModel):
    id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    version: int = Field(ge=1)
    nodes: list[BuilderNodePayload] = Field(default_factory=list)
    edges: list[BuilderEdgePayload] = Field(default_factory=list)


class WorkflowBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    graph: BuilderGraphPayload


class WorkflowCreate(WorkflowBase):
    pass


class WorkflowUpdate(WorkflowBase):
    status: str | None = Field(default=None, max_length=50)


class WorkflowVersionCreate(BaseModel):
    version_note: str | None = Field(default=None, max_length=500)
    graph: BuilderGraphPayload


class WorkflowMetadataUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: str | None = Field(default=None, max_length=50)


class WorkflowPermissionCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    role: str = Field(default="viewer", max_length=50)


class WorkflowPermissionRead(BaseModel):
    id: int
    workflow_id: int
    user_id: int
    email: str
    display_name: str
    role: str
    created_at: datetime


class WorkflowSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    status: str
    current_version: int
    latest_saved_version: int
    is_published: bool
    published_slug: str | None
    created_by_user_id: int | None = None
    updated_by_user_id: int | None = None
    archived_at: datetime | None = None
    run_count: int = 0
    failed_run_count: int = 0
    avg_latency_ms: float | None = None
    last_run_id: int | None = None
    last_run_status: str | None = None
    last_run_error: str | None = None
    last_run_at: datetime | None = None
    rag_document_count: int = 0
    rag_chunk_count: int = 0
    rag_last_ingested_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class WorkflowNodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_id: str
    block_type: str
    label: str
    position_x: float
    position_y: float
    config_json: dict[str, Any]


class WorkflowEdgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    edge_id: str
    source_node_id: str
    target_node_id: str
    source_handle: str | None
    target_handle: str | None
    label: str | None


class WorkflowVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version_number: int
    version_note: str | None
    graph_json: dict[str, Any]
    created_at: datetime


class WorkflowRead(WorkflowSummary):
    graph_json: dict[str, Any]
    published_version_id: int | None
    nodes: list[WorkflowNodeRead]
    edges: list[WorkflowEdgeRead]
    versions: list[WorkflowVersionRead]
