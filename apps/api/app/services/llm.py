from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    OpenAI,
    OpenAIError,
    RateLimitError,
)

from app.core.config import settings


@dataclass
class LlmMessage:
    role: str
    content: str


@dataclass
class LlmResponse:
    provider: str
    model: str
    output_text: str
    raw_response: dict[str, Any]


class LlmProvider(ABC):
    provider_name: str

    @abstractmethod
    def chat_completion(
        self,
        *,
        model: str,
        messages: list[LlmMessage],
        temperature: float,
    ) -> LlmResponse:
        raise NotImplementedError

    def generate(
        self,
        *,
        model: str,
        messages: list[LlmMessage],
        temperature: float,
    ) -> LlmResponse:
        return self.chat_completion(
            model=model,
            messages=messages,
            temperature=temperature,
        )


class OpenRouterLlmProvider(LlmProvider):
    provider_name = "openrouter"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        max_retries: int | None = None,
    ) -> None:
        self.api_key = api_key or settings.openrouter_api_key
        self.base_url = base_url or settings.openrouter_base_url
        self.timeout_seconds = (
            settings.openrouter_timeout_seconds if timeout_seconds is None else timeout_seconds
        )
        self.max_retries = settings.openrouter_max_retries if max_retries is None else max_retries
        self._client: OpenAI | None = None

    def _get_client(self) -> OpenAI:
        if not self.api_key:
            raise ValueError(
                "OpenRouter API key is missing. Set OPENROUTER_API_KEY in apps/api/.env or the root .env."
            )
        if self._client is None:
            self._client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout_seconds,
                max_retries=self.max_retries,
            )
        return self._client

    def chat_completion(
        self,
        *,
        model: str,
        messages: list[LlmMessage],
        temperature: float,
    ) -> LlmResponse:
        client = self._get_client()
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": message.role, "content": message.content} for message in messages
                ],
                temperature=temperature,
            )
        except AuthenticationError as exc:
            raise ValueError(
                "OpenRouter authentication failed. Check OPENROUTER_API_KEY and OPENROUTER_BASE_URL."
            ) from exc
        except BadRequestError as exc:
            raise ValueError(f"OpenRouter rejected the chat completion request: {exc}") from exc
        except (APITimeoutError, APIConnectionError, RateLimitError, APIStatusError) as exc:
            raise RuntimeError(
                "OpenRouter chat completion failed after retries. "
                "Check network access, provider availability, and model configuration."
            ) from exc
        except OpenAIError as exc:
            raise RuntimeError(f"Unexpected OpenRouter client error: {exc}") from exc
        output_text = response.choices[0].message.content or ""
        return LlmResponse(
            provider=self.provider_name,
            model=model,
            output_text=output_text,
            raw_response=response.model_dump(mode="json"),
        )


class FakeLlmProvider(LlmProvider):
    provider_name = "fake"

    def chat_completion(
        self,
        *,
        model: str,
        messages: list[LlmMessage],
        temperature: float,
    ) -> LlmResponse:
        last_user_message = next(
            (message.content for message in reversed(messages) if message.role == "user"),
            "",
        )
        return LlmResponse(
            provider=self.provider_name,
            model=model,
            output_text=f"[fake:{model}] {last_user_message}",
            raw_response={"temperature": temperature, "message_count": len(messages)},
        )


def build_llm_provider(provider_name: str) -> LlmProvider:
    if provider_name == "openrouter":
        return OpenRouterLlmProvider()
    raise ValueError(f"Unsupported LLM provider '{provider_name}'.")


def get_default_llm_provider() -> LlmProvider:
    return build_llm_provider(settings.llm_provider)
