from __future__ import annotations

from pathlib import Path

from app.models.workflow import Workflow
from app.schemas.execution import ExecuteWorkflowRequest, RuntimeNodeInput
from app.services import execution as execution_module
from app.services.execution import execute_workflow
from app.services.llm import FakeLlmProvider


def block_data(block_type: str, label: str, inputs: list[dict], outputs: list[dict], config: dict) -> dict:
    return {
        "blockType": block_type,
        "label": label,
        "kind": "input",
        "category": "Inputs",
        "description": label,
        "accentColor": "#111827",
        "icon": label[:2].upper(),
        "inputs": inputs,
        "outputs": outputs,
        "config": config,
    }


def edge(source: str, source_port: str, target: str, target_port: str) -> dict:
    return {
        "id": f"edge-{source}-{source_port}-{target}-{target_port}",
        "source": source,
        "sourceHandle": f"out:{source_port}",
        "target": target,
        "targetHandle": f"in:{target_port}",
    }


def test_upload_extract_rag_chatbot_output_end_to_end(db_session, tmp_path: Path, monkeypatch):
    monkeypatch.setattr(execution_module, "get_default_llm_provider", lambda: FakeLlmProvider())
    source_path = tmp_path / "policy.txt"
    source_path.write_text("Work from home is allowed two days per week with manager approval.", encoding="utf-8")

    graph = {
        "id": "e2e-rag",
        "name": "E2E RAG",
        "version": 1,
        "nodes": [
            {
                "id": "file_upload-1",
                "type": "builderBlock",
                "position": {"x": 0, "y": 0},
                "data": block_data(
                    "file_upload",
                    "File Upload",
                    [],
                    [{"id": "file", "label": "File", "direction": "output", "dataTypes": ["file"]}],
                    {"accept": ".txt", "multiple": False, "maxSizeMb": 5, "defaultLocalPaths": ""},
                ),
            },
            {
                "id": "text_extraction-1",
                "type": "builderBlock",
                "position": {"x": 300, "y": 0},
                "data": block_data(
                    "text_extraction",
                    "Text Extraction",
                    [{"id": "file", "label": "File", "direction": "input", "dataTypes": ["file"], "required": True}],
                    [{"id": "document", "label": "Document", "direction": "output", "dataTypes": ["document", "text"]}],
                    {"strategy": "auto"},
                ),
            },
            {
                "id": "chat_input-1",
                "type": "builderBlock",
                "position": {"x": 0, "y": 250},
                "data": block_data(
                    "chat_input",
                    "Chat Input",
                    [],
                    [{"id": "message", "label": "Message", "direction": "output", "dataTypes": ["chat", "text"]}],
                    {"placeholder": "work from home", "persistHistory": True},
                ),
            },
            {
                "id": "rag_knowledge-1",
                "type": "builderBlock",
                "position": {"x": 600, "y": 100},
                "data": block_data(
                    "rag_knowledge",
                    "RAG Knowledge",
                    [
                        {"id": "document", "label": "Document", "direction": "input", "dataTypes": ["document", "text"]},
                        {"id": "query", "label": "Query", "direction": "input", "dataTypes": ["chat", "text"]},
                    ],
                    [{"id": "knowledge", "label": "Knowledge", "direction": "output", "dataTypes": ["knowledge"]}],
                    {
                        "ingestMode": "ingest_and_retrieve",
                        "collection": "e2e-rag",
                        "chunkSize": 200,
                        "overlap": 20,
                        "topK": 3,
                        "tags": "",
                        "allowedFileTypes": ".txt",
                    },
                ),
            },
            {
                "id": "chatbot-1",
                "type": "builderBlock",
                "position": {"x": 900, "y": 100},
                "data": block_data(
                    "chatbot",
                    "Chatbot",
                    [
                        {"id": "message", "label": "Message", "direction": "input", "dataTypes": ["chat", "text"], "required": True},
                        {"id": "context", "label": "Context", "direction": "input", "dataTypes": ["knowledge", "text", "json"]},
                    ],
                    [
                        {"id": "reply", "label": "Reply", "direction": "output", "dataTypes": ["chat", "text"]},
                        {"id": "json", "label": "JSON", "direction": "output", "dataTypes": ["json"]},
                    ],
                    {
                        "model": "fake-model",
                        "systemPrompt": "Use context.",
                        "answerStyle": "conversational",
                        "temperature": 0.1,
                    },
                ),
            },
            {
                "id": "chat_output-1",
                "type": "builderBlock",
                "position": {"x": 1200, "y": 100},
                "data": block_data(
                    "chat_output",
                    "Chat Output",
                    [{"id": "message", "label": "Message", "direction": "input", "dataTypes": ["chat", "text"], "required": True}],
                    [],
                    {"stream": True},
                ),
            },
        ],
        "edges": [
            edge("file_upload-1", "file", "text_extraction-1", "file"),
            edge("text_extraction-1", "document", "rag_knowledge-1", "document"),
            edge("chat_input-1", "message", "rag_knowledge-1", "query"),
            edge("chat_input-1", "message", "chatbot-1", "message"),
            edge("rag_knowledge-1", "knowledge", "chatbot-1", "context"),
            edge("chatbot-1", "reply", "chat_output-1", "message"),
        ],
    }
    workflow = Workflow(
        name="E2E RAG",
        description="end to end",
        status="draft",
        current_version=1,
        latest_saved_version=0,
        graph_json=graph,
    )
    db_session.add(workflow)
    db_session.flush()

    run = execute_workflow(
        db_session,
        workflow.id,
        ExecuteWorkflowRequest(
            session_id="e2e-session",
            user_id="e2e-user",
            inputs={
                "file_upload-1": RuntimeNodeInput(files=[str(source_path)]),
                "chat_input-1": RuntimeNodeInput(value="work from home"),
            },
        ),
    )

    assert run.status == "completed"
    assert "chat_output-1" in run.output_payload
    assert run.output_payload["chat_output-1"]["result"]["value"]["source_chunks"]
