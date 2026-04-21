from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.db.session import SessionLocal
from app.schemas.execution import ExecuteWorkflowRequest
from app.services.execution import create_workflow_run, execute_prepared_workflow_run, get_workflow_or_404, validate_graph_json


executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="ai-studio-workflow")


@dataclass(frozen=True)
class QueuedRun:
    workflow_id: int
    run_id: int
    status: str
    queued_at: str


def enqueue_workflow_execution(
    workflow_id: int,
    payload: ExecuteWorkflowRequest,
    *,
    owner_user_id: int | None = None,
) -> QueuedRun:
    with SessionLocal() as session:
        workflow = get_workflow_or_404(session, workflow_id)
        graph = validate_graph_json(workflow.graph_json)
        workflow_run = create_workflow_run(
            session,
            workflow=workflow,
            graph=graph,
            payload=payload,
            owner_user_id=owner_user_id,
            status_value="queued",
        )
        run_id = workflow_run.id

    executor.submit(run_workflow_job, run_id, payload.model_dump())
    return QueuedRun(
        workflow_id=workflow_id,
        run_id=run_id,
        status="queued",
        queued_at=datetime.now(timezone.utc).isoformat(),
    )


def run_workflow_job(run_id: int, payload_data: dict[str, Any]) -> None:
    payload = ExecuteWorkflowRequest.model_validate(payload_data)
    with SessionLocal() as session:
        execute_prepared_workflow_run(session, run_id, payload)
