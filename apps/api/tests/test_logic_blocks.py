from __future__ import annotations

from collections import defaultdict

from app.models.workflow import ConversationMemoryMessage, Workflow, WorkflowRun
from app.schemas.execution import RuntimeNodeInput
from app.services.execution import (
    ExecutionContext,
    evaluate_condition_rule,
    execute_condition,
    execute_conversation_memory,
    execute_merge,
    merge_structured_payloads,
    typed_payload,
)


def create_workflow_and_run(db_session):
    workflow = Workflow(
        name="Logic Workflow",
        description="test workflow",
        status="draft",
        current_version=1,
        latest_saved_version=0,
        graph_json={"id": "g1", "name": "g1", "version": 1, "nodes": [], "edges": []},
    )
    db_session.add(workflow)
    db_session.flush()

    workflow_run = WorkflowRun(
        workflow_id=workflow.id,
        status="running",
        trigger_mode="manual",
        graph_version=1,
        graph_snapshot=workflow.graph_json,
        input_payload={},
        output_payload={},
        preview_payload={},
        log_messages=[],
    )
    db_session.add(workflow_run)
    db_session.flush()
    return workflow, workflow_run


def make_context(db_session, workflow, workflow_run):
    return ExecutionContext(
        session=db_session,
        workflow=workflow,
        workflow_run=workflow_run,
        runtime_inputs={"input": RuntimeNodeInput(value="hello")},
        node_inputs={},
        node_outputs={},
        memory_store={},
        run_logs=[],
        uploaded_files_by_node=defaultdict(list),
        session_id="session-1",
        user_id="user-1",
    )


def test_conversation_memory_persists_messages(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    context = make_context(db_session, workflow, workflow_run)
    context.node_inputs["memory-1"] = {
        "message": [
            typed_payload("chat", "first message", "first"),
            typed_payload("chat", "second message", "second"),
        ]
    }

    node = {"id": "memory-1", "data": {"label": "Memory", "config": {"namespace": "chat", "windowSize": 5}}}
    result = execute_conversation_memory(node, context)

    assert result.outputs["memory"].value["history"] == ["first message", "second message"]
    assert db_session.query(ConversationMemoryMessage).count() == 2


def test_conversation_memory_reads_recent_history_for_same_session_user(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    context = make_context(db_session, workflow, workflow_run)
    context.node_inputs["memory-1"] = {"message": [typed_payload("chat", "older message", "older")]}
    node = {"id": "memory-1", "data": {"label": "Memory", "config": {"namespace": "chat", "windowSize": 3}}}
    execute_conversation_memory(node, context)

    next_run = WorkflowRun(
        workflow_id=workflow.id,
        status="running",
        trigger_mode="manual",
        graph_version=1,
        graph_snapshot=workflow.graph_json,
        input_payload={},
        output_payload={},
        preview_payload={},
        log_messages=[],
    )
    db_session.add(next_run)
    db_session.flush()

    next_context = make_context(db_session, workflow, next_run)
    next_context.node_inputs["memory-1"] = {"message": [typed_payload("chat", "newer message", "newer")]}
    result = execute_conversation_memory(node, next_context)

    assert result.outputs["memory"].value["history"] == ["older message", "newer message"]


def test_merge_structured_payloads_returns_stable_json():
    result = merge_structured_payloads(
        "json_merge",
        [typed_payload("json", {"left": 1}, {"left": 1})],
        [typed_payload("json", {"right": 2}, {"right": 2})],
    )

    assert result["mode"] == "json_merge"
    assert result["merged_object"] == {"left": 1, "right": 2}
    assert result["input_count"] == 2


def test_execute_merge_outputs_structured_payload(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    context = make_context(db_session, workflow, workflow_run)
    context.node_inputs["merge-1"] = {
        "left": [typed_payload("text", "left text", "left")],
        "right": [typed_payload("json", {"a": 1}, {"a": 1})],
    }
    node = {"id": "merge-1", "data": {"label": "Merge", "config": {"mode": "append"}}}

    result = execute_merge(node, context)

    assert result.outputs["merged"].data_type == "json"
    assert result.outputs["merged"].value["input_count"] == 2
    assert "left text" in result.outputs["merged"].value["combined_text"]


def test_condition_rules_support_exists_equals_contains_and_boolean():
    assert evaluate_condition_rule("exists", "hello")["matched"] is True
    assert evaluate_condition_rule("equals:hello", "hello")["matched"] is True
    assert evaluate_condition_rule("contains:ell", "hello")["matched"] is True
    assert evaluate_condition_rule("boolean", 0)["matched"] is False


def test_execute_condition_branches_with_structured_payload(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    context = make_context(db_session, workflow, workflow_run)
    context.node_inputs["condition-1"] = {"value": [typed_payload("text", "approved", "approved")]}
    node = {"id": "condition-1", "data": {"label": "Condition", "config": {"expression": "contains:app"}}}

    result = execute_condition(node, context)

    assert "true" in result.outputs
    assert result.outputs["true"].value["branch"] == "true"
    assert result.outputs["true"].value["matched"] is True
