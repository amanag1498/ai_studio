from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
import hashlib
import math
import re

from app.core.config import settings


class EmbeddingProvider(ABC):
    model_name: str

    @abstractmethod
    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        raise NotImplementedError


class LocalSentenceTransformerEmbeddingProvider(EmbeddingProvider):
    def __init__(
        self,
        model_name: str | None = None,
        *,
        allow_download: bool | None = None,
        fallback_provider: EmbeddingProvider | None = None,
    ) -> None:
        self.model_name = model_name or settings.embedding_model
        self.allow_download = settings.embedding_allow_download if allow_download is None else allow_download
        self.fallback_provider = fallback_provider or HashingEmbeddingProvider()
        self._model = None
        self._using_fallback = False

    def _get_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(
                self.model_name,
                local_files_only=not self.allow_download,
            )
        return self._model

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        if self._using_fallback:
            return self.fallback_provider.embed_texts(texts)
        try:
            model = self._get_model()
            embeddings = model.encode(list(texts), normalize_embeddings=True)
            return [embedding.tolist() for embedding in embeddings]
        except Exception:  # noqa: BLE001
            # Local-first MVP behavior: if the sentence-transformers model is not
            # already cached, fall back to deterministic local embeddings instead
            # of blocking workflow execution on a network download.
            self._using_fallback = True
            self.model_name = self.fallback_provider.model_name
            return self.fallback_provider.embed_texts(texts)


class HashingEmbeddingProvider(EmbeddingProvider):
    def __init__(self, dimensions: int = 384) -> None:
        self.dimensions = dimensions
        self.model_name = f"local-hashing-{dimensions}"

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._embed_text(text) for text in texts]

    def _embed_text(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        tokens = re.findall(r"[a-z0-9]+", text.lower())
        if not tokens:
            return vector

        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[index] += sign

        norm = math.sqrt(sum(value * value for value in vector))
        if not norm:
            return vector
        return [value / norm for value in vector]


class FakeEmbeddingProvider(EmbeddingProvider):
    def __init__(self, model_name: str = "fake-embedding-provider") -> None:
        self.model_name = model_name

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        embeddings: list[list[float]] = []
        for text in texts:
            lowered = text.lower()
            embeddings.append(
                [
                    float(len(lowered)),
                    float(lowered.count("agent")),
                    float(lowered.count("local")),
                    float(lowered.count("rag")),
                ]
            )
        return embeddings


def get_default_embedding_provider() -> EmbeddingProvider:
    if settings.embedding_provider == "hashing":
        return HashingEmbeddingProvider()
    if settings.embedding_provider == "sentence-transformers":
        return LocalSentenceTransformerEmbeddingProvider()
    raise ValueError(f"Unsupported embedding provider '{settings.embedding_provider}'.")
