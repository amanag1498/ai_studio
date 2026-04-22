from __future__ import annotations

import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.workflow import WorkflowNodeRun, WorkflowRun
from app.schemas.execution import ExecuteWorkflowRequest
from app.services.execution import create_workflow_run, execute_prepared_workflow_run, get_workflow_or_404, validate_graph_json


executor = ThreadPoolExecutor(max_workers=max(settings.execution_queue_max_workers, 1), thread_name_prefix="ai-studio-workflow")
queue_lock = threading.Lock()
active_jobs: dict[int, Future] = {}
cancelled_run_ids: set[int] = set()


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

    with queue_lock:
        future = executor.submit(run_workflow_job, run_id, payload.model_dump())
        active_jobs[run_id] = future
    return QueuedRun(
        workflow_id=workflow_id,
        run_id=run_id,
        status="queued",
        queued_at=datetime.now(timezone.utc).isoformat(),
    )


def run_workflow_job(run_id: int, payload_data: dict[str, Any]) -> None:
    payload = ExecuteWorkflowRequest.model_validate(payload_data)
    try:
        for attempt in range(1, max(settings.execution_queue_max_retries, 0) + 2):
            if is_run_cancelled(run_id):
                mark_run_cancelled(run_id, "Run was cancelled before worker execution.")
                return
            with SessionLocal() as session:
                append_run_log(session, run_id, "info", f"Queue worker attempt {attempt} started.")
                run = execute_prepared_workflow_run(session, run_id, payload)
                if run.status in {"completed", "cancelled"}:
                    return
                should_retry = run.status == "failed" and attempt <= max(settings.execution_queue_max_retries, 0)
            if not should_retry:
                return
            time.sleep(max(settings.execution_queue_retry_backoff_seconds, 0))
            with SessionLocal() as session:
                reset_run_for_retry(session, run_id, attempt + 1)
    finally:
        with queue_lock:
            active_jobs.pop(run_id, None)
            cancelled_run_ids.discard(run_id)


def cancel_workflow_run(run_id: int) -> bool:
    with queue_lock:
        cancelled_run_ids.add(run_id)
        future = active_jobs.get(run_id)
        cancelled_future = future.cancel() if future and not future.running() else False
    mark_run_cancelled(run_id, "Cancellation requested by user.")
    return cancelled_future


def queue_snapshot() -> dict[str, Any]:
    with queue_lock:
        jobs = [
            {
                "run_id": run_id,
                "done": future.done(),
                "running": future.running(),
                "cancelled": future.cancelled() or run_id in cancelled_run_ids,
            }
            for run_id, future in active_jobs.items()
        ]
    return {
        "max_workers": max(settings.execution_queue_max_workers, 1),
        "active_count": len(jobs),
        "jobs": jobs,
        "max_retries": max(settings.execution_queue_max_retries, 0),
        "retry_backoff_seconds": settings.execution_queue_retry_backoff_seconds,
    }


def is_run_cancelled(run_id: int) -> bool:
    with queue_lock:
        return run_id in cancelled_run_ids


def append_run_log(session, run_id: int, level: str, message: str) -> None:  # type: ignore[no-untyped-def]
    run = session.get(WorkflowRun, run_id)
    if run is None:
        return
    logs = list(run.log_messages or [])
    logs.append({"level": level, "message": message, "timestamp": datetime.now(timezone.utc).isoformat()})
    run.log_messages = logs
    session.add(run)
    session.commit()


def mark_run_cancelled(run_id: int, message: str) -> None:
    with SessionLocal() as session:
        run = session.get(WorkflowRun, run_id)
        if run is None or run.status in {"completed", "failed", "cancelled"}:
            return
        run.status = "cancelled"
        run.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        logs = list(run.log_messages or [])
        logs.append({"level": "warning", "message": message, "timestamp": datetime.now(timezone.utc).isoformat()})
        run.log_messages = logs
        session.add(run)
        session.commit()


def reset_run_for_retry(session, run_id: int, next_attempt: int) -> None:  # type: ignore[no-untyped-def]
    run = session.get(WorkflowRun, run_id)
    if run is None:
        return
    session.execute(delete(WorkflowNodeRun).where(WorkflowNodeRun.workflow_run_id == run_id))
    logs = list(run.log_messages or [])
    logs.append({"level": "warning", "message": f"Retrying workflow run; next attempt {next_attempt}.", "timestamp": datetime.now(timezone.utc).isoformat()})
    run.status = "queued"
    run.error_message = None
    run.completed_at = None
    run.latency_ms = None
    run.output_payload = {}
    run.preview_payload = {}
    run.log_messages = logs
    session.add(run)
    session.commit()
