from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.workflow import AuditLog, KnowledgeChunk, KnowledgeDocument, RagEvaluation, WorkflowRun


logger = logging.getLogger("ai_studio")


def audit_event(
    session: Session,
    *,
    action: str,
    event_type: str = "workflow",
    workflow_id: int | None = None,
    workflow_run_id: int | None = None,
    user_id: int | None = None,
    resource_type: str = "workflow",
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditLog:
    record = AuditLog(
        workflow_id=workflow_id,
        workflow_run_id=workflow_run_id,
        user_id=user_id,
        event_type=event_type,
        resource_type=resource_type,
        resource_id=resource_id,
        action=action,
        metadata_json=metadata or {},
    )
    session.add(record)
    logger.info(
        "audit_event",
        extra={
            "action": action,
            "event_type": event_type,
            "workflow_id": workflow_id,
            "workflow_run_id": workflow_run_id,
            "user_id": user_id,
        },
    )
    return record


def get_observability_dashboard(session: Session) -> dict[str, Any]:
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    total_runs = session.scalar(select(func.count(WorkflowRun.id))) or 0
    running_runs = session.scalar(select(func.count(WorkflowRun.id)).where(WorkflowRun.status.in_(["queued", "running"]))) or 0
    failed_runs = session.scalar(select(func.count(WorkflowRun.id)).where(WorkflowRun.status == "failed")) or 0
    recent_failures = list(
        session.scalars(
            select(WorkflowRun)
            .where(WorkflowRun.status == "failed")
            .order_by(WorkflowRun.started_at.desc())
            .limit(10)
        )
    )
    audit_count_24h = session.scalar(select(func.count(AuditLog.id)).where(AuditLog.created_at >= since)) or 0
    avg_latency = session.scalar(select(func.avg(WorkflowRun.latency_ms)).where(WorkflowRun.latency_ms.is_not(None))) or 0
    rag_documents = session.scalar(select(func.count(KnowledgeDocument.id))) or 0
    rag_chunks = session.scalar(select(func.count(KnowledgeChunk.id))) or 0
    return {
        "status": "ok",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "workflow_runs_total": total_runs,
            "workflow_runs_active": running_runs,
            "workflow_runs_failed": failed_runs,
            "workflow_failure_rate": round((failed_runs / total_runs) if total_runs else 0, 4),
            "workflow_avg_latency_ms": round(float(avg_latency), 1),
            "audit_events_24h": audit_count_24h,
            "rag_documents": rag_documents,
            "rag_chunks": rag_chunks,
        },
        "recent_failures": [
            {
                "run_id": run.id,
                "workflow_id": run.workflow_id,
                "error": run.error_message,
                "started_at": run.started_at,
                "latency_ms": run.latency_ms,
            }
            for run in recent_failures
        ],
    }


def evaluate_rag_result(
    session: Session,
    *,
    workflow_id: int,
    collection_name: str,
    query: str,
    expected_answer: str | None,
    matches: list[dict[str, Any]],
) -> RagEvaluation:
    retrieved_text = "\n".join(str(match.get("text", "")) for match in matches)
    expected_terms = {term.lower().strip(".,:;!?") for term in (expected_answer or query).split() if len(term) > 3}
    matched_terms = {term for term in expected_terms if term in retrieved_text.lower()}
    retrieval_score = round(len(matched_terms) / len(expected_terms), 3) if expected_terms else 0.0
    hallucination_risk = "low" if retrieval_score >= 0.55 and matches else "medium" if matches else "high"
    evaluation = RagEvaluation(
        workflow_id=workflow_id,
        collection_name=collection_name,
        query=query,
        expected_answer=expected_answer,
        retrieved_chunk_ids=[match.get("chunk_id") for match in matches],
        retrieval_score=retrieval_score,
        hallucination_risk=hallucination_risk,
        result_json={
            "matched_terms": sorted(matched_terms),
            "expected_term_count": len(expected_terms),
            "match_count": len(matches),
        },
    )
    session.add(evaluation)
    return evaluation
