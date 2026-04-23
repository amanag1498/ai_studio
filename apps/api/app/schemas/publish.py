from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PublishWorkflowRequest(BaseModel):
    slug: str | None = Field(default=None, max_length=255)
    visibility: str = Field(default="public", max_length=50)


class PublishWorkflowResponse(BaseModel):
    workflow_id: int
    slug: str
    is_published: bool
    visibility: str = "public"
    access_token: str | None = None
    chat_endpoint: str


class PublishedChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    session_id: str = Field(default="default-session", max_length=255)
    user_id: str = Field(default="anonymous-user", max_length=255)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PublishedChatResponse(BaseModel):
    workflow_id: int
    slug: str
    session_id: str
    user_id: str
    run_id: int
    answer: str
    citations: list[dict[str, Any]]
    source_chunks: list[dict[str, Any]]
    output_payload: dict[str, Any]
