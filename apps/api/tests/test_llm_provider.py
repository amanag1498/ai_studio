from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.execution import ExecutionContext, execute_chatbot, typed_payload
from app.services.llm import FakeLlmProvider, OpenRouterLlmProvider, build_llm_provider


class FakeOpenAiResponse:
    def __init__(self, content: str) -> None:
        self.choices = [SimpleNamespace(message=SimpleNamespace(content=content))]

    def model_dump(self, mode: str = "json") -> dict[str, str]:
        return {"mode": mode, "content": self.choices[0].message.content}


class FakeOpenAiClient:
    def __init__(self, content: str) -> None:
        self.content = content
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=self._create_completion),
        )

    def _create_completion(self, **_: object) -> FakeOpenAiResponse:
        return FakeOpenAiResponse(self.content)


def test_build_llm_provider_returns_openrouter_provider():
    provider = build_llm_provider("openrouter")

    assert isinstance(provider, OpenRouterLlmProvider)


def test_openrouter_provider_returns_chat_completion_response():
    provider = OpenRouterLlmProvider(api_key="test-key", base_url="https://example.com")
    provider._client = FakeOpenAiClient("hello from openrouter")

    response = provider.generate(
        model="custom-model",
        messages=[],
        temperature=0.2,
    )

    assert response.provider == "openrouter"
    assert response.model == "custom-model"
    assert response.output_text == "hello from openrouter"


def test_execute_chatbot_accepts_injected_provider():
    context = ExecutionContext(
        session=None,
        workflow=None,
        workflow_run=None,
        runtime_inputs={},
        node_inputs={
            "chatbot-node": {
                "message": [typed_payload("text", "What is RAG?", "What is RAG?")],
                "context": [],
            }
        },
        node_outputs={},
        memory_store={},
        run_logs=[],
        uploaded_files_by_node={},
        session_id="session-1",
        user_id="user-1",
    )
    node = {
        "id": "chatbot-node",
        "data": {
            "label": "Chatbot",
            "blockType": "chatbot",
            "config": {
                "systemPrompt": "Answer clearly.",
                "model": "custom-model",
                "temperature": 0.3,
            },
        },
    }

    result = execute_chatbot(node, context, provider=FakeLlmProvider())

    assert "reply" in result.outputs
    assert result.outputs["reply"].metadata["provider"] == "fake"
    assert "What is RAG?" in result.outputs["reply"].value


def test_build_llm_provider_rejects_unknown_provider():
    with pytest.raises(ValueError):
        build_llm_provider("unknown-provider")
