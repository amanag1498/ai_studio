from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Any

from app.core.config import settings


class VectorStore(ABC):
    @abstractmethod
    def upsert(
        self,
        *,
        collection_name: str,
        ids: Sequence[str],
        embeddings: Sequence[Sequence[float]],
        documents: Sequence[str],
        metadatas: Sequence[dict[str, Any]],
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def query(
        self,
        *,
        collection_name: str,
        query_embedding: Sequence[float],
        top_k: int,
        metadata_filter: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    def delete_collection(self, *, collection_name: str) -> None:
        raise NotImplementedError


class ChromaVectorStore(VectorStore):
    def __init__(self, persist_dir: str | None = None) -> None:
        self.persist_dir = persist_dir or settings.chroma_persist_dir
        self._client = None

    def _get_client(self):
        if self._client is None:
            import chromadb
            from chromadb.config import Settings

            self._client = chromadb.PersistentClient(
                path=self.persist_dir,
                settings=Settings(anonymized_telemetry=False),
            )
        return self._client

    def _get_collection(self, collection_name: str):
        client = self._get_client()
        return client.get_or_create_collection(name=collection_name)

    def upsert(
        self,
        *,
        collection_name: str,
        ids: Sequence[str],
        embeddings: Sequence[Sequence[float]],
        documents: Sequence[str],
        metadatas: Sequence[dict[str, Any]],
    ) -> None:
        collection = self._get_collection(collection_name)
        collection.upsert(
            ids=list(ids),
            embeddings=[list(embedding) for embedding in embeddings],
            documents=list(documents),
            metadatas=[sanitize_metadata(metadata) for metadata in metadatas],
        )

    def query(
        self,
        *,
        collection_name: str,
        query_embedding: Sequence[float],
        top_k: int,
        metadata_filter: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        collection = self._get_collection(collection_name)
        result = collection.query(
            query_embeddings=[list(query_embedding)],
            n_results=top_k,
            where=to_chroma_where(metadata_filter),
        )
        ids = result.get("ids", [[]])[0]
        documents = result.get("documents", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]

        return [
          {
              "id": ids[index],
              "document": documents[index],
              "metadata": metadatas[index] or {},
              "distance": distances[index] if index < len(distances) else None,
          }
          for index in range(len(ids))
        ]

    def delete_collection(self, *, collection_name: str) -> None:
        client = self._get_client()
        try:
            client.delete_collection(name=collection_name)
        except Exception:
            # Chroma raises when a collection does not exist. Deleting should be idempotent for the UI.
            return


def sanitize_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, value in metadata.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            sanitized[key] = value
        else:
            sanitized[key] = str(value)
    return sanitized


def to_chroma_where(metadata_filter: dict[str, Any] | None) -> dict[str, Any] | None:
    if not metadata_filter:
        return None
    if len(metadata_filter) == 1:
        return metadata_filter
    return {"$and": [{key: value} for key, value in metadata_filter.items()]}


def get_default_vector_store() -> VectorStore:
    return ChromaVectorStore()
