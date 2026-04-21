from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models.workflow import (
    AppUser,
    AuthEvent,
    ConversationMemoryMessage,
    KnowledgeChunk,
    KnowledgeDocument,
    UploadedFile,
    Workflow,
    WorkflowNodeRun,
    WorkflowRun,
)


def get_usage_dashboard(session: Session) -> dict:
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)

    total_workflows = scalar_count(session, select(func.count(Workflow.id)))
    total_runs = scalar_count(session, select(func.count(WorkflowRun.id)))
    failed_runs = scalar_count(session, select(func.count(WorkflowRun.id)).where(WorkflowRun.status == "failed"))
    published_workflows = scalar_count(session, select(func.count(Workflow.id)).where(Workflow.is_published.is_(True)))
    total_users = scalar_count(session, select(func.count(AppUser.id)))
    login_events = scalar_count(session, select(func.count(AuthEvent.id)).where(AuthEvent.event_type == "login"))
    signup_events = scalar_count(session, select(func.count(AuthEvent.id)).where(AuthEvent.event_type == "signup"))
    runs_last_7d = scalar_count(session, select(func.count(WorkflowRun.id)).where(WorkflowRun.started_at >= since))
    files_uploaded = scalar_count(session, select(func.count(UploadedFile.id)))
    knowledge_documents = scalar_count(session, select(func.count(KnowledgeDocument.id)))
    knowledge_chunks = scalar_count(session, select(func.count(KnowledgeChunk.id)))
    active_memory_users = scalar_count(session, select(func.count(distinct(ConversationMemoryMessage.user_id))))
    avg_run_latency = session.scalar(select(func.avg(WorkflowRun.latency_ms)).where(WorkflowRun.latency_ms.is_not(None)))
    avg_node_latency = session.scalar(select(func.avg(WorkflowNodeRun.latency_ms)).where(WorkflowNodeRun.latency_ms.is_not(None)))

    workflow_rows = session.execute(
        select(
            Workflow.id,
            Workflow.name,
            Workflow.is_published,
            func.count(WorkflowRun.id).label("run_count"),
            func.sum(func.coalesce(WorkflowRun.latency_ms, 0)).label("latency_sum"),
            func.max(WorkflowRun.started_at).label("last_run_at"),
        )
        .join(WorkflowRun, WorkflowRun.workflow_id == Workflow.id, isouter=True)
        .group_by(Workflow.id)
        .order_by(func.count(WorkflowRun.id).desc(), Workflow.updated_at.desc())
        .limit(8)
    ).all()

    user_rows = session.execute(
        select(
            AppUser.id,
            AppUser.email,
            AppUser.display_name,
            AppUser.role,
            AppUser.created_at,
            AppUser.last_login_at,
            func.count(AuthEvent.id).label("event_count"),
        )
        .join(AuthEvent, AuthEvent.user_id == AppUser.id, isouter=True)
        .group_by(AppUser.id)
        .order_by(AppUser.last_login_at.desc(), AppUser.created_at.desc())
        .limit(8)
    ).all()

    recent_events = session.execute(
        select(AuthEvent)
        .order_by(AuthEvent.created_at.desc())
        .limit(12)
    ).scalars()

    return {
        "totals": {
            "workflows": total_workflows,
            "published_workflows": published_workflows,
            "runs": total_runs,
            "failed_runs": failed_runs,
            "runs_last_7d": runs_last_7d,
            "users": total_users,
            "active_memory_users": active_memory_users,
            "login_events": login_events,
            "signup_events": signup_events,
            "files_uploaded": files_uploaded,
            "knowledge_documents": knowledge_documents,
            "knowledge_chunks": knowledge_chunks,
            "avg_run_latency_ms": round(float(avg_run_latency or 0), 1),
            "avg_node_latency_ms": round(float(avg_node_latency or 0), 1),
        },
        "top_workflows": [
            {
                "id": row.id,
                "name": row.name,
                "is_published": row.is_published,
                "run_count": row.run_count,
                "latency_sum_ms": row.latency_sum or 0,
                "last_run_at": row.last_run_at,
            }
            for row in workflow_rows
        ],
        "recent_users": [
            {
                "id": row.id,
                "email": row.email,
                "display_name": row.display_name,
                "role": row.role,
                "created_at": row.created_at,
                "last_login_at": row.last_login_at,
                "event_count": row.event_count,
            }
            for row in user_rows
        ],
        "recent_auth_events": [
            {
                "id": event.id,
                "user_id": event.user_id,
                "email": event.email,
                "event_type": event.event_type,
                "created_at": event.created_at,
                "metadata": event.metadata_json,
            }
            for event in recent_events
        ],
    }


def scalar_count(session: Session, statement) -> int:
    return int(session.scalar(statement) or 0)
