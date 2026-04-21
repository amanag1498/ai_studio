from __future__ import annotations

from app.services.execution import (
    append_citations,
    build_chatbot_messages,
    extract_citations,
    render_chatbot_context,
    render_memory_context,
    typed_payload,
)
from app.services.llm import FakeLlmProvider, LlmMessage


def test_build_chatbot_messages_includes_system_context_and_memory():
    messages = build_chatbot_messages(
        system_prompt="You are helpful.",
        user_message="Answer the user.",
        context_text="Relevant context chunk",
        memory_text="Earlier conversation",
    )

    assert messages[0].role == "system"
    assert "You are helpful." in messages[0].content
    assert "Relevant context chunk" in messages[0].content
    assert "Earlier conversation" in messages[0].content
    assert messages[1] == LlmMessage(role="user", content="Answer the user.")


def test_extract_citations_from_knowledge_payloads():
    payloads = [
        typed_payload(
            "knowledge",
            {
                "matches": [
                    {
                        "chunk_id": 12,
                        "score": 0.12,
                        "metadata": {
                            "document_id": 3,
                            "title": "Architecture Notes",
                            "source_path": "/tmp/arch.txt",
                        },
                    }
                ]
            },
            {},
        )
    ]

    citations = extract_citations(payloads)

    assert citations == [
        {
            "chunk_id": 12,
            "document_id": 3,
            "title": "Architecture Notes",
            "source_path": "/tmp/arch.txt",
            "score": 0.12,
        }
    ]


def test_render_memory_context_uses_memory_payload_history():
    payloads = [
        typed_payload(
            "memory",
            {"namespace": "default", "history": ["User asked about RAG", "Assistant replied"]},
            {},
        )
    ]

    rendered = render_memory_context(payloads)

    assert "User asked about RAG" in rendered
    assert "Assistant replied" in rendered


def test_append_citations_adds_source_section():
    answer = append_citations(
        "Here is the answer.",
        [
            {
                "chunk_id": 1,
                "document_id": 2,
                "title": "Spec",
                "source_path": "/tmp/spec.txt",
                "score": 0.4,
            }
        ],
    )

    assert "Sources:" in answer
    assert "Spec" in answer
    assert "/tmp/spec.txt" in answer


def test_fake_llm_provider_returns_last_user_message():
    provider = FakeLlmProvider()
    response = provider.generate(
        model="demo-model",
        messages=[
            LlmMessage(role="system", content="system"),
            LlmMessage(role="user", content="hello world"),
        ],
        temperature=0.1,
    )

    assert response.provider == "fake"
    assert response.model == "demo-model"
    assert "hello world" in response.output_text


def test_render_chatbot_context_formats_matches():
    rendered = render_chatbot_context(
        {
            "matches": [
                {
                    "snippet": "A relevant chunk",
                    "metadata": {"title": "Doc 1", "source_path": "/tmp/doc1.txt"},
                }
            ]
        }
    )

    assert "A relevant chunk" in rendered
    assert "Doc 1" in rendered
