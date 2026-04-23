from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    workflow_limit: int = Field(default=100, ge=1, le=100_000)
    monthly_run_limit: int = Field(default=1000, ge=1, le=1_000_000)
    storage_limit_mb: int = Field(default=2048, ge=1, le=10_000_000)


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    workflow_limit: int | None = Field(default=None, ge=1, le=100_000)
    monthly_run_limit: int | None = Field(default=None, ge=1, le=1_000_000)
    storage_limit_mb: int | None = Field(default=None, ge=1, le=10_000_000)


class WorkspaceMemberCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    role: str = Field(default="viewer", max_length=50)


class WorkspaceMemberRead(BaseModel):
    id: int
    user_id: int
    email: str
    display_name: str
    app_role: str
    role: str
    created_at: datetime


class WorkspaceRead(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None
    workflow_limit: int
    monthly_run_limit: int
    storage_limit_mb: int
    created_by_user_id: int | None
    created_at: datetime
    updated_at: datetime
    current_user_role: str | None = None
    usage: dict
    members: list[WorkspaceMemberRead] = []
