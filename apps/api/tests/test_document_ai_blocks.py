from __future__ import annotations

from collections import defaultdict

from app.services.execution import (
    ExecutionContext,
    execute_classifier,
    execute_extraction_ai,
    execute_summarizer,
    typed_payload,
)
from app.services.llm import FakeLlmProvider


def create_context():
    return ExecutionContext(
        session=None,
        workflow=None,
        workflow_run=None,
        runtime_inputs={},
        node_inputs={},
        node_outputs={},
        memory_store={},
        run_logs=[],
        uploaded_files_by_node=defaultdict(list),
    )


def test_summarizer_accepts_document_payload():
    context = create_context()
    context.node_inputs["summarizer-1"] = {
        "content": [
            typed_payload(
                "document",
                {
                    "documents": [
                        {
                            "text": "Company policy allows work from home two days per week.",
                            "metadata": {"title": "Policy"},
                        }
                    ],
                    "combined_text": "Company policy allows work from home two days per week.",
                },
                {},
            )
        ]
    }
    node = {
        "id": "summarizer-1",
        "data": {
            "label": "Summarizer",
            "config": {"model": "demo-model", "style": "bullets", "maxWords": 50},
        },
    }

    result = execute_summarizer(node, context, provider=FakeLlmProvider())

    assert "summary" in result.outputs
    assert result.outputs["summary"].value["summary"]


def test_classifier_returns_structured_payload():
    context = create_context()
    context.node_inputs["classifier-1"] = {
        "content": [typed_payload("text", "This is an internal policy document.", "policy")]
    }
    node = {
        "id": "classifier-1",
        "data": {
            "label": "Classifier",
            "config": {
                "model": "demo-model",
                "labels": "policy\ninvoice\nother",
                "multiLabel": False,
            },
        },
    }

    result = execute_classifier(node, context, provider=FakeLlmProvider())

    assert result.outputs["classification"].value["allowed_labels"] == ["policy", "invoice", "other"]
    assert "classification" in result.outputs["classification"].value


def test_extraction_ai_returns_json_payload():
    context = create_context()
    context.node_inputs["extraction-ai-1"] = {
        "content": [typed_payload("text", "Invoice total is $42.", "Invoice total is $42.")]
    }
    node = {
        "id": "extraction-ai-1",
        "data": {
            "label": "Extraction AI",
            "config": {
                "model": "demo-model",
                "schemaPrompt": "Return JSON with total.",
                "strictMode": True,
            },
        },
    }

    result = execute_extraction_ai(node, context, provider=FakeLlmProvider())

    assert "json" in result.outputs
    assert "extracted" in result.outputs["json"].value
