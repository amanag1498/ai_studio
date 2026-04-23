from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.routes import ensure_workflow_access, workflow_effective_role
from app.api.routes import import_workflow_bundle_route
from app.models.workflow import Workflow, WorkflowRun, WorkspaceMembership
from app.schemas.execution import ExecuteWorkflowRequest
from app.services.auth import create_local_user
from app.services.execution import create_workflow_run, execute_prepared_workflow_run
from app.services.workspaces import ensure_user_workspace, ensure_workspace_can_create_workflow, ensure_workspace_can_run


def test_create_local_user_gets_default_workspace(db_session):
    user = create_local_user(
        db_session,
        email="owner@example.com",
        display_name="Owner",
        password="secret123",
        role="admin",
    )

    workspace = ensure_user_workspace(db_session, user)

    assert user.default_workspace_id == workspace.id
    assert workspace.name == "Owner's Workspace"
    assert workspace.memberships[0].user_id == user.id
    assert workspace.memberships[0].role == "owner"


def test_workspace_workflow_quota_blocks_creation(db_session):
    user = create_local_user(
        db_session,
        email="quota@example.com",
        display_name="Quota User",
        password="secret123",
        role="user",
    )
    workspace = ensure_user_workspace(db_session, user)
    workspace.workflow_limit = 1
    db_session.add(workspace)
    db_session.add(
        Workflow(
            name="Existing",
            description="quota test",
            status="draft",
            current_version=1,
            latest_saved_version=0,
            graph_json={"id": "g", "name": "g", "version": 1, "nodes": [], "edges": []},
            workspace_id=workspace.id,
            created_by_user_id=user.id,
        )
    )
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        ensure_workspace_can_create_workflow(db_session, workspace)

    assert exc.value.status_code == 403
    assert "workflow quota" in exc.value.detail.lower()


def test_workspace_monthly_run_quota_blocks_execution(db_session):
    user = create_local_user(
        db_session,
        email="runner@example.com",
        display_name="Runner",
        password="secret123",
        role="user",
    )
    workspace = ensure_user_workspace(db_session, user)
    workspace.monthly_run_limit = 1
    workflow = Workflow(
        name="Runnable",
        description="quota test",
        status="draft",
        current_version=1,
        latest_saved_version=0,
        graph_json={"id": "g", "name": "g", "version": 1, "nodes": [], "edges": []},
        workspace_id=workspace.id,
        created_by_user_id=user.id,
    )
    db_session.add(workspace)
    db_session.add(workflow)
    db_session.flush()
    db_session.add(WorkflowRun(workflow_id=workflow.id, status="completed", owner_user_id=user.id))
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        ensure_workspace_can_run(db_session, workspace)

    assert exc.value.status_code == 403
    assert "monthly run quota" in exc.value.detail.lower()


def test_workspace_runner_can_run_but_cannot_edit(db_session):
    owner = create_local_user(db_session, email="owner-runner@example.com", display_name="Owner Runner", password="secret123")
    runner = create_local_user(db_session, email="role-runner@example.com", display_name="Role Runner", password="secret123")
    workspace = ensure_user_workspace(db_session, owner)
    db_session.add(WorkspaceMembership(workspace_id=workspace.id, user_id=runner.id, role="runner"))
    workflow = Workflow(
        name="Role Test",
        description="permission test",
        status="draft",
        current_version=1,
        latest_saved_version=0,
        graph_json={"id": "g", "name": "g", "version": 1, "nodes": [], "edges": []},
        workspace_id=workspace.id,
        created_by_user_id=owner.id,
    )
    db_session.add(workflow)
    db_session.commit()

    ensure_workflow_access(db_session, workflow, runner.id, required_role="runner")
    label, source = workflow_effective_role(db_session, workflow, runner.id)

    assert label == "Workspace Runner"
    assert source == "workspace"
    with pytest.raises(HTTPException) as exc:
        ensure_workflow_access(db_session, workflow, runner.id, required_role="editor")

    assert exc.value.status_code == 403


def test_admin_override_allows_workspace_access(db_session):
    owner = create_local_user(db_session, email="owner-admin-override@example.com", display_name="Owner Admin Override", password="secret123")
    admin = create_local_user(db_session, email="global-admin@example.com", display_name="Global Admin", password="secret123", role="admin")
    workspace = ensure_user_workspace(db_session, owner)
    workflow = Workflow(
        name="Admin Override",
        description="permission test",
        status="draft",
        current_version=1,
        latest_saved_version=0,
        graph_json={"id": "g", "name": "g", "version": 1, "nodes": [], "edges": []},
        workspace_id=workspace.id,
        created_by_user_id=owner.id,
    )
    db_session.add(workflow)
    db_session.commit()

    ensure_workflow_access(db_session, workflow, admin.id, required_role="owner")
    label, source = workflow_effective_role(db_session, workflow, admin.id)

    assert label == "Admin"
    assert source == "admin"


def test_cyclic_prepared_run_fails_instead_of_staying_queued(db_session):
    user = create_local_user(db_session, email="cycle@example.com", display_name="Cycle User", password="secret123")
    workflow = Workflow(
        name="Cycle Workflow",
        description="execution preflight test",
        status="draft",
        current_version=1,
        latest_saved_version=0,
        graph_json={
            "id": "cycle",
            "name": "cycle",
            "version": 1,
            "nodes": [
                {
                    "id": "chat_input-1",
                    "type": "builderBlock",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "blockType": "chat_input",
                        "label": "Chat Input",
                        "kind": "input",
                        "category": "Inputs",
                        "accentColor": "#fff",
                        "icon": "CI",
                        "inputs": [],
                        "outputs": [{"id": "message", "label": "Message", "direction": "output", "dataTypes": ["chat", "text"]}],
                        "config": {"placeholder": "Ask", "persistHistory": True},
                    },
                },
                {
                    "id": "chatbot-1",
                    "type": "builderBlock",
                    "position": {"x": 200, "y": 0},
                    "data": {
                        "blockType": "chatbot",
                        "label": "Chatbot",
                        "kind": "agent",
                        "category": "AI",
                        "accentColor": "#fff",
                        "icon": "CB",
                        "inputs": [
                            {"id": "message", "label": "Message", "direction": "input", "dataTypes": ["chat", "text"], "required": True},
                            {"id": "context", "label": "Context", "direction": "input", "dataTypes": ["knowledge", "text", "json"]},
                        ],
                        "outputs": [{"id": "reply", "label": "Reply", "direction": "output", "dataTypes": ["chat", "text"]}],
                        "config": {"model": "test-model", "systemPrompt": "You are helpful.", "temperature": 0.2},
                    },
                },
            ],
            "edges": [
                {"id": "ab", "source": "chat_input-1", "target": "chatbot-1", "sourceHandle": "out:message", "targetHandle": "in:message"},
                {"id": "ba", "source": "chatbot-1", "target": "chatbot-1", "sourceHandle": "out:reply", "targetHandle": "in:context"},
            ],
        },
        created_by_user_id=user.id,
    )
    db_session.add(workflow)
    db_session.commit()
    payload = ExecuteWorkflowRequest(trigger_mode="manual", session_id="s", user_id="u", inputs={})
    run = create_workflow_run(db_session, workflow=workflow, graph=workflow.graph_json, payload=payload, owner_user_id=user.id)

    failed_run = execute_prepared_workflow_run(db_session, run.id, payload)

    assert failed_run.status == "failed"
    assert "dag" in (failed_run.error_message or "").lower()


def test_import_workflow_bundle_uses_validated_graph_name(db_session):
    user = create_local_user(db_session, email="importer@example.com", display_name="Importer", password="secret123")
    workspace = ensure_user_workspace(db_session, user)
    payload = {
        "workspace_id": workspace.id,
        "graph_json": {
            "id": "imported-graph",
            "name": "Imported Test Workflow",
            "version": 1,
            "nodes": [
                {
                    "id": "chat_input-1",
                    "type": "builderBlock",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "blockType": "chat_input",
                        "label": "Chat Input",
                        "kind": "input",
                        "category": "Inputs",
                        "accentColor": "#fff",
                        "icon": "CI",
                        "inputs": [],
                        "outputs": [{"id": "message", "label": "Message", "direction": "output", "dataTypes": ["chat", "text"]}],
                        "config": {"placeholder": "Ask", "persistHistory": True},
                    },
                }
            ],
            "edges": [],
        },
    }

    workflow = import_workflow_bundle_route(payload, db=db_session, current_user_id=user.id)

    assert workflow.name == "Imported Test Workflow Imported"
    assert workflow.workspace_id == workspace.id
