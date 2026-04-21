from __future__ import annotations

from app.models.workflow import Workflow
from app.services.publish import extract_chatbot_response_from_run, publish_workflow, slugify


class FakeRun:
    def __init__(self, output_payload, node_runs=None):
        self.output_payload = output_payload
        self.node_runs = node_runs or []


class FakeNodeRun:
    def __init__(self, *, node_id, block_type, output_payload):
        self.node_id = node_id
        self.block_type = block_type
        self.output_payload = output_payload


def create_workflow(db_session, *, name: str = "Support Bot") -> Workflow:
    workflow = Workflow(
        name=name,
        description="published workflow",
        status="draft",
        current_version=1,
        latest_saved_version=0,
        is_published=False,
        graph_json={"id": "g1", "name": "g1", "version": 1, "nodes": [], "edges": []},
    )
    db_session.add(workflow)
    db_session.flush()
    return workflow


def test_slugify_normalizes_names():
    assert slugify("Customer Support Bot") == "customer-support-bot"
    assert slugify("  Hello__World  ") == "hello-world"


def test_publish_workflow_sets_slug_and_flag(db_session):
    workflow = create_workflow(db_session)

    published = publish_workflow(db_session, workflow.id, None)

    assert published.is_published is True
    assert published.published_slug == "support-bot"


def test_extract_chatbot_response_from_run_returns_chat_output_payload():
    run = FakeRun(
        {
            "chat-output-1": {
                "result": {
                    "value": {
                        "answer": "Hello there",
                        "citations": [{"chunk_id": 1}],
                        "source_chunks": [{"chunk_id": 1, "snippet": "hello"}],
                    }
                }
            }
        }
    )

    response = extract_chatbot_response_from_run(run)

    assert response["answer"] == "Hello there"
    assert response["citations"] == [{"chunk_id": 1}]
    assert response["source_chunks"] == [{"chunk_id": 1, "snippet": "hello"}]


def test_extract_chatbot_response_from_run_falls_back_to_chatbot_reply():
    run = FakeRun(
        {},
        node_runs=[
            FakeNodeRun(
                node_id="chatbot-1",
                block_type="chatbot",
                output_payload={
                    "reply": {
                        "value": "Fallback answer",
                        "metadata": {
                            "citations": [{"chunk_id": 2}],
                            "source_chunks": [{"chunk_id": 2, "snippet": "fallback"}],
                        },
                    }
                },
            )
        ],
    )

    response = extract_chatbot_response_from_run(run)

    assert response["answer"] == "Fallback answer"
    assert response["citations"] == [{"chunk_id": 2}]
    assert response["source_chunks"] == [{"chunk_id": 2, "snippet": "fallback"}]
