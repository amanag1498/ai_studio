from __future__ import annotations

from collections import defaultdict

from app.models.workflow import Workflow, WorkflowRun
from app.schemas.execution import RuntimeNodeInput
from app.services.execution import (
    ExecutionContext,
    collect_payload_citations,
    collect_source_chunks,
    execute_chat_output,
    execute_dashboard_preview,
    execute_json_output,
    execute_logger,
    summarize_preview_content,
    typed_payload,
)


def create_workflow_and_run(db_session):
    workflow = Workflow(
        name="Output Workflow",
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


def test_chat_output_includes_answer_citations_and_source_chunks(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    context = make_context(db_session, workflow, workflow_run)
    context.node_inputs["chat-output-1"] = {
        "message": [
            typed_payload(
                "chat",
                "Final answer",
                "Final answer",
                {
                    "citations": [
                        {
                            "chunk_id": 1,
                            "document_id": 2,
                            "title": "Spec",
                            "source_path": "/tmp/spec.txt",
                        }
                    ],
                    "source_chunks": [
                        {"chunk_id": 1, "snippet": "Relevant snippet", "metadata": {"title": "Spec"}}
                    ],
                },
            )
        ]
    }
    node = {"id": "chat-output-1", "data": {"label": "Chat Output", "config": {"stream": True}}}

    result = execute_chat_output(node, context)

    assert result.outputs["result"].value["answer"] == "Final answer"
    assert len(result.outputs["result"].value["citations"]) == 1
    assert len(result.outputs["result"].value["source_chunks"]) == 1


def test_json_output_returns_pretty_json_payload(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    context = make_context(db_session, workflow, workflow_run)
    context.node_inputs["json-output-1"] = {
        "payload": [typed_payload("json", {"a": 1, "b": "two"}, {"a": 1})]
    }
    node = {"id": "json-output-1", "data": {"label": "JSON Output", "config": {"prettyPrint": True}}}

    result = execute_json_output(node, context)

    assert "pretty_json" in result.outputs["result"].value
    assert '"a": 1' in result.outputs["result"].value["pretty_json"]


def test_dashboard_preview_summarizes_intermediate_content(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    context = make_context(db_session, workflow, workflow_run)
    context.node_inputs["preview-1"] = {
        "content": [typed_payload("json", {"status": "ok", "count": 3}, {"status": "ok"})]
    }
    node = {"id": "preview-1", "data": {"label": "Preview", "config": {"view": "auto"}}}

    result = execute_dashboard_preview(node, context)

    assert result.outputs["result"].value["summary"]["type"] == "object"
    assert "status" in result.outputs["result"].value["summary"]["keys"]


def test_logger_block_generates_summary_for_non_technical_debugging(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    context = make_context(db_session, workflow, workflow_run)
    context.node_inputs["logger-1"] = {
        "payload": [typed_payload("json", {"status": "error", "reason": "missing file"}, {"status": "error"})]
    }
    node = {"id": "logger-1", "data": {"label": "Logger", "config": {"level": "warn"}}}

    result = execute_logger(node, context)

    assert result.outputs["log"].value["summary"]["type"] == "object"
    assert result.outputs["log"].value["summary"]["preview"]
    assert result.logs[0]["level"] == "warn"


def test_citation_and_chunk_collectors_dedupe_entries():
    payloads = [
        typed_payload(
            "chat",
            "answer",
            "answer",
            {
                "citations": [
                    {"chunk_id": 1, "document_id": 2, "title": "Doc", "source_path": "/tmp/doc.txt"},
                    {"chunk_id": 1, "document_id": 2, "title": "Doc", "source_path": "/tmp/doc.txt"},
                ],
                "source_chunks": [
                    {"chunk_id": 1, "snippet": "Snippet", "metadata": {"title": "Doc"}},
                ],
            },
        )
    ]

    citations = collect_payload_citations(payloads)
    source_chunks = collect_source_chunks(payloads)

    assert len(citations) == 1
    assert len(source_chunks) == 1


def test_summarize_preview_content_handles_lists():
    summary = summarize_preview_content([{"a": 1}, {"b": 2}])

    assert summary["type"] == "list"
    assert summary["length"] == 2
