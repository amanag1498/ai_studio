from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.workflow import AppUser, UploadedFile, Workflow, WorkflowRun, Workspace, WorkspaceMembership


def slugify_workspace_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "workspace"


def unique_workspace_slug(session: Session, base: str) -> str:
    root = slugify_workspace_name(base)
    slug = root
    suffix = 2
    while session.scalar(select(Workspace.id).where(Workspace.slug == slug)) is not None:
        slug = f"{root}-{suffix}"
        suffix += 1
    return slug


def ensure_user_workspace(session: Session, user: AppUser) -> Workspace:
    if user.default_workspace_id:
        workspace = session.get(Workspace, user.default_workspace_id)
        if workspace is not None:
            return workspace

    workspace = Workspace(
        name=f"{user.display_name}'s Workspace",
        slug=unique_workspace_slug(session, user.display_name),
        description="Personal local workspace created automatically for this user.",
        created_by_user_id=user.id,
    )
    session.add(workspace)
    session.flush()
    membership = WorkspaceMembership(workspace_id=workspace.id, user_id=user.id, role="owner")
    session.add(membership)
    user.default_workspace_id = workspace.id
    session.add(user)
    session.flush()
    return workspace


def get_user_workspace_ids(session: Session, user_id: int) -> set[int]:
    return {
        row[0]
        for row in session.execute(
            select(WorkspaceMembership.workspace_id).where(WorkspaceMembership.user_id == user_id)
        )
    }


def get_workspace_usage(session: Session, workspace_id: int) -> dict:
    month_start = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    workflow_count = session.scalar(select(func.count(Workflow.id)).where(Workflow.workspace_id == workspace_id)) or 0
    run_count = (
        session.scalar(
            select(func.count(WorkflowRun.id))
            .join(Workflow, Workflow.id == WorkflowRun.workflow_id)
            .where(Workflow.workspace_id == workspace_id)
        )
        or 0
    )
    runs_last_30d = (
        session.scalar(
            select(func.count(WorkflowRun.id))
            .join(Workflow, Workflow.id == WorkflowRun.workflow_id)
            .where(Workflow.workspace_id == workspace_id, WorkflowRun.started_at >= month_start)
        )
        or 0
    )
    storage_bytes = (
        session.scalar(
            select(func.coalesce(func.sum(UploadedFile.size_bytes), 0))
            .join(Workflow, Workflow.id == UploadedFile.workflow_id)
            .where(Workflow.workspace_id == workspace_id)
        )
        or 0
    )
    member_count = session.scalar(select(func.count(WorkspaceMembership.id)).where(WorkspaceMembership.workspace_id == workspace_id)) or 0
    return {
        "workflow_count": workflow_count,
        "run_count": run_count,
        "runs_last_30d": runs_last_30d,
        "storage_bytes": int(storage_bytes),
        "member_count": member_count,
    }


def ensure_workspace_can_create_workflow(session: Session, workspace: Workspace) -> None:
    usage = get_workspace_usage(session, workspace.id)
    if usage["workflow_count"] >= workspace.workflow_limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Workspace workflow quota reached ({workspace.workflow_limit}). Increase the limit or archive/delete workflows.",
        )


def ensure_workspace_can_run(session: Session, workspace: Workspace) -> None:
    usage = get_workspace_usage(session, workspace.id)
    if usage["runs_last_30d"] >= workspace.monthly_run_limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Workspace monthly run quota reached ({workspace.monthly_run_limit}). Increase the limit or wait for usage to roll off.",
        )


def set_default_workspace(session: Session, user: AppUser, workspace: Workspace) -> AppUser:
    user.default_workspace_id = workspace.id
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
