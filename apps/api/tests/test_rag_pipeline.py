from __future__ import annotations

from collections import defaultdict
from math import sqrt

from app.models.workflow import KnowledgeChunk, KnowledgeDocument, Workflow, WorkflowRun
from app.services.chunking import TextChunker
from app.services.embeddings import FakeEmbeddingProvider, HashingEmbeddingProvider, LocalSentenceTransformerEmbeddingProvider
from app.services.rag import build_rag_config, ingest_documents, retrieve_relevant_chunks


class InMemoryVectorStore:
    def __init__(self) -> None:
        self.collections: dict[str, list[dict]] = defaultdict(list)

    def upsert(self, *, collection_name, ids, embeddings, documents, metadatas) -> None:
        collection = self.collections[collection_name]
        for item_id, embedding, document, metadata in zip(ids, embeddings, documents, metadatas, strict=False):
            collection.append(
                {
                    "id": item_id,
                    "embedding": list(embedding),
                    "document": document,
                    "metadata": metadata,
                }
            )

    def query(self, *, collection_name, query_embedding, top_k, metadata_filter=None):
        collection = self.collections.get(collection_name, [])
        if metadata_filter:
            collection = [
                item
                for item in collection
                if all(item["metadata"].get(key) == value for key, value in metadata_filter.items())
            ]
        ranked = sorted(
            collection,
            key=lambda item: cosine_distance(item["embedding"], list(query_embedding)),
        )
        return [
            {
                "id": item["id"],
                "document": item["document"],
                "metadata": item["metadata"],
                "distance": cosine_distance(item["embedding"], list(query_embedding)),
            }
            for item in ranked[:top_k]
        ]


def cosine_distance(a: list[float], b: list[float]) -> float:
    dot = sum(left * right for left, right in zip(a, b, strict=False))
    norm_a = sqrt(sum(value * value for value in a)) or 1.0
    norm_b = sqrt(sum(value * value for value in b)) or 1.0
    return 1.0 - (dot / (norm_a * norm_b))


def create_workflow_and_run(db_session):
    workflow = Workflow(
        name="RAG Workflow",
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


def test_text_chunker_splits_text_with_overlap():
    chunker = TextChunker(chunk_size=30, chunk_overlap=10)
    chunks = chunker.chunk("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda")

    assert len(chunks) >= 2
    assert chunks[0].char_end > chunks[1].char_start
    assert chunks[0].text
    assert chunks[1].text


def test_local_embedding_provider_falls_back_when_model_is_unavailable():
    provider = LocalSentenceTransformerEmbeddingProvider(
        model_name="definitely-not-cached",
        allow_download=False,
        fallback_provider=HashingEmbeddingProvider(dimensions=384),
    )

    embeddings = provider.embed_texts(["Work from home is allowed two days per week."])

    assert len(embeddings) == 1
    assert len(embeddings[0]) == 384
    assert provider.model_name == "local-hashing-384"


def test_ingest_documents_persists_document_and_chunks(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    embedding_provider = FakeEmbeddingProvider()
    vector_store = InMemoryVectorStore()
    rag_config = build_rag_config(
        {
            "ingestMode": "ingest_and_retrieve",
            "collection": "test-collection",
            "chunkSize": 400,
            "overlap": 40,
            "topK": 4,
            "tags": "product,docs",
            "allowedFileTypes": ".txt,.md",
        }
    )

    summary = ingest_documents(
        db_session,
        workflow=workflow,
        workflow_run=workflow_run,
        node_id="rag-node-1",
        rag_config=rag_config,
        documents=[
            {
                "id": None,
                "source_path": "/tmp/doc-1.txt",
                "text": "Local RAG helps an agent retrieve context quickly. Local storage matters.",
                "metadata": {"original_name": "doc-1.txt", "parser": "txt", "extension": ".txt"},
            }
        ],
        chunker=TextChunker(chunk_size=40, chunk_overlap=8),
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )

    assert summary["documents_indexed"] == 1
    assert summary["chunks_indexed"] >= 1
    assert summary["tags"] == ["product", "docs"]
    assert db_session.query(KnowledgeDocument).count() == 1
    assert db_session.query(KnowledgeChunk).count() == summary["chunks_indexed"]
    stored_collection = vector_store.collections["test-collection"]
    assert len(stored_collection) == summary["chunks_indexed"]


def test_retrieve_relevant_chunks_returns_top_matches(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    embedding_provider = FakeEmbeddingProvider()
    vector_store = InMemoryVectorStore()
    rag_config = build_rag_config(
        {
            "ingestMode": "ingest_and_retrieve",
            "collection": "test-collection",
            "chunkSize": 600,
            "overlap": 60,
            "topK": 2,
            "tags": "private",
            "allowedFileTypes": ".txt",
        }
    )

    ingest_documents(
        db_session,
        workflow=workflow,
        workflow_run=workflow_run,
        node_id="rag-node-1",
        rag_config=rag_config,
        documents=[
            {
                "id": None,
                "source_path": "/tmp/doc-1.txt",
                "text": "Agents use local RAG pipelines for private retrieval.",
                "metadata": {"original_name": "doc-1.txt", "parser": "txt", "extension": ".txt"},
            },
            {
                "id": None,
                "source_path": "/tmp/doc-2.txt",
                "text": "Weather reports and travel plans are unrelated documents.",
                "metadata": {"original_name": "doc-2.txt", "parser": "txt", "extension": ".txt"},
            },
        ],
        chunker=TextChunker(chunk_size=60, chunk_overlap=10),
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )

    results = retrieve_relevant_chunks(
        db_session,
        workflow=workflow,
        rag_config=rag_config,
        query="local rag agent retrieval",
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )

    assert results
    assert "local RAG" in results[0].text or "local rag" in results[0].text.lower()
    assert results[0].metadata["collection_name"] == "test-collection"


def test_retrieve_relevant_chunks_filters_vector_matches_by_workflow(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    other_workflow, other_run = create_workflow_and_run(db_session)
    embedding_provider = FakeEmbeddingProvider()
    vector_store = InMemoryVectorStore()
    rag_config = build_rag_config(
        {
            "ingestMode": "ingest_and_retrieve",
            "collection": "shared-collection",
            "chunkSize": 80,
            "overlap": 10,
            "topK": 4,
            "tags": "",
            "allowedFileTypes": ".txt",
        }
    )

    ingest_documents(
        db_session,
        workflow=other_workflow,
        workflow_run=other_run,
        node_id="rag-node-1",
        rag_config=rag_config,
        documents=[
            {
                "id": None,
                "source_path": "/tmp/other.txt",
                "text": "Work from home is not discussed in this unrelated record.",
                "metadata": {"original_name": "other.txt", "extension": ".txt"},
            }
        ],
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )
    ingest_documents(
        db_session,
        workflow=workflow,
        workflow_run=workflow_run,
        node_id="rag-node-1",
        rag_config=rag_config,
        documents=[
            {
                "id": None,
                "source_path": "/tmp/policy.txt",
                "text": "Work from home is allowed two days per week with manager approval.",
                "metadata": {"original_name": "policy.txt", "extension": ".txt"},
            }
        ],
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )

    results = retrieve_relevant_chunks(
        db_session,
        workflow=workflow,
        rag_config=rag_config,
        query="work from home",
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )

    assert results
    assert all(result.metadata["workflow_id"] == workflow.id for result in results)
    assert "two days" in results[0].text


def test_ingest_documents_respects_allowed_file_types(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    rag_config = build_rag_config(
        {
            "ingestMode": "ingest_only",
            "collection": "test-collection",
            "chunkSize": 400,
            "overlap": 40,
            "topK": 4,
            "tags": "",
            "allowedFileTypes": ".txt",
        }
    )

    summary = ingest_documents(
        db_session,
        workflow=workflow,
        workflow_run=workflow_run,
        node_id="rag-node-1",
        rag_config=rag_config,
        documents=[
            {
                "id": None,
                "source_path": "/tmp/doc-1.txt",
                "text": "This text should be ingested.",
                "metadata": {"original_name": "doc-1.txt", "parser": "txt", "extension": ".txt"},
            },
            {
                "id": None,
                "source_path": "/tmp/doc-2.json",
                "text": '{"skip": true}',
                "metadata": {"original_name": "doc-2.json", "parser": "json", "extension": ".json"},
            },
        ],
        embedding_provider=FakeEmbeddingProvider(),
        vector_store=InMemoryVectorStore(),
    )

    assert summary["documents_seen"] == 2
    assert summary["documents_indexed"] == 1
    assert db_session.query(KnowledgeDocument).count() == 1


def test_ingest_documents_reuses_existing_document_chunks(db_session):
    workflow, workflow_run = create_workflow_and_run(db_session)
    embedding_provider = FakeEmbeddingProvider()
    vector_store = InMemoryVectorStore()
    rag_config = build_rag_config(
        {
            "ingestMode": "ingest_and_retrieve",
            "collection": "test-collection",
            "chunkSize": 400,
            "overlap": 40,
            "topK": 4,
            "tags": "policy",
            "allowedFileTypes": ".txt",
        }
    )
    document = {
        "id": None,
        "source_path": "/tmp/policy.txt",
        "text": "Work from home is allowed two days per week with manager approval.",
        "metadata": {"original_name": "policy.txt", "extension": ".txt"},
    }

    first_summary = ingest_documents(
        db_session,
        workflow=workflow,
        workflow_run=workflow_run,
        node_id="rag-node-1",
        rag_config=rag_config,
        documents=[document],
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )
    second_summary = ingest_documents(
        db_session,
        workflow=workflow,
        workflow_run=workflow_run,
        node_id="rag-node-1",
        rag_config=rag_config,
        documents=[document],
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )

    assert first_summary["documents_indexed"] == 1
    assert second_summary["documents_indexed"] == 0
    assert second_summary["documents_reused"] == 1
    assert db_session.query(KnowledgeDocument).count() == 1
