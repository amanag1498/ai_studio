from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.workflow import Workflow
from app.schemas.execution import ExecuteWorkflowRequest, RuntimeNodeInput
from app.schemas.publish import PublishedChatRequest
from app.services.execution import execute_workflow
from app.services.workflows import get_workflow_or_404


def publish_workflow(session: Session, workflow_id: int, slug: str | None) -> Workflow:
    workflow = get_workflow_or_404(session, workflow_id)
    resolved_slug = slugify(slug or workflow.name or f"workflow-{workflow.id}")

    existing = session.scalar(
        select(Workflow).where(Workflow.published_slug == resolved_slug, Workflow.id != workflow.id)
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Publish slug '{resolved_slug}' is already in use.",
        )

    workflow.is_published = True
    workflow.published_slug = resolved_slug
    session.add(workflow)
    session.commit()
    session.refresh(workflow)
    return workflow


def get_published_workflow_or_404(session: Session, slug: str) -> Workflow:
    workflow = session.scalar(
        select(Workflow).where(Workflow.published_slug == slug, Workflow.is_published.is_(True))
    )
    if workflow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published chatbot not found.")
    return workflow


def execute_published_chat_message(
    session: Session,
    *,
    slug: str,
    payload: PublishedChatRequest,
    owner_user_id: int | None = None,
) -> tuple[Workflow, Any]:
    workflow = get_published_workflow_or_404(session, slug)
    graph = workflow.graph_json
    chat_input_node_ids = [
        node["id"]
        for node in graph.get("nodes", [])
        if node.get("data", {}).get("blockType") == "chat_input"
    ]

    if not chat_input_node_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Published workflow does not contain a Chat Input block.",
        )

    execute_payload = ExecuteWorkflowRequest(
        trigger_mode="published_chat",
        session_id=payload.session_id,
        user_id=payload.user_id,
        inputs={
            node_id: RuntimeNodeInput(value=payload.message, metadata=payload.metadata)
            for node_id in chat_input_node_ids
        },
    )
    workflow_run = execute_workflow(session, workflow.id, execute_payload, owner_user_id=owner_user_id)
    if workflow_run.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=workflow_run.error_message or "Published workflow execution failed.",
        )
    return workflow, workflow_run


def extract_chatbot_response_from_run(workflow_run: Any) -> dict[str, Any]:
    chatbot_fallback: dict[str, Any] | None = None

    for node_id, node_payload in workflow_run.output_payload.items():
        result_payload = node_payload.get("result")
        if not isinstance(result_payload, dict):
            continue
        value = result_payload.get("value")
        if isinstance(value, dict) and "answer" in value:
            return {
                "node_id": node_id,
                "answer": value.get("answer", ""),
                "citations": value.get("citations", []),
                "source_chunks": value.get("source_chunks", []),
                "output_payload": value,
            }

    for node_run in getattr(workflow_run, "node_runs", []) or []:
        if getattr(node_run, "block_type", None) != "chatbot":
            continue
        reply_payload = node_run.output_payload.get("reply")
        if not isinstance(reply_payload, dict):
            continue
        metadata = reply_payload.get("metadata") if isinstance(reply_payload.get("metadata"), dict) else {}
        chatbot_fallback = {
            "node_id": node_run.node_id,
            "answer": reply_payload.get("value", ""),
            "citations": metadata.get("citations", []),
            "source_chunks": metadata.get("source_chunks", []),
            "output_payload": reply_payload,
        }
        break

    if chatbot_fallback is not None:
        return chatbot_fallback

    return {
        "node_id": None,
        "answer": "",
        "citations": [],
        "source_chunks": [],
        "output_payload": {},
    }


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug or "published-workflow"
