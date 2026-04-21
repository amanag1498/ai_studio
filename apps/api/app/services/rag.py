from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.workflow import KnowledgeChunk, KnowledgeDocument, Workflow, WorkflowRun
from app.services.chunking import TextChunker
from app.services.embeddings import EmbeddingProvider, get_default_embedding_provider
from app.services.vector_store import VectorStore, get_default_vector_store


@dataclass
class RetrievedChunk:
    chunk_id: int
    vector_id: str
    text: str
    score: float | None
    metadata: dict[str, Any]


@dataclass
class RagKnowledgeConfig:
    ingest_mode: str
    collection_name: str
    chunk_size: int
    overlap: int
    top_k: int
    tags: list[str]
    allowed_file_types: set[str]


def build_rag_config(config: dict[str, Any]) -> RagKnowledgeConfig:
    tags = [
        item.strip()
        for item in str(config.get("tags", "")).split(",")
        if item.strip()
    ]
    allowed_file_types = {
        item.strip().lower()
        for item in str(config.get("allowedFileTypes", ".pdf,.docx,.txt,.csv,.json")).split(",")
        if item.strip()
    }
    if not allowed_file_types:
        allowed_file_types = {".pdf", ".docx", ".txt", ".csv", ".json"}

    return RagKnowledgeConfig(
        ingest_mode=str(config.get("ingestMode", "ingest_and_retrieve")),
        collection_name=str(config.get("collection", "default-knowledge")),
        chunk_size=max(100, int(config.get("chunkSize", 800))),
        overlap=max(0, int(config.get("overlap", 120))),
        top_k=max(1, int(config.get("topK", 4))),
        tags=tags,
        allowed_file_types=allowed_file_types,
    )


def should_ingest_documents(rag_config: RagKnowledgeConfig) -> bool:
    return rag_config.ingest_mode in {"ingest_only", "ingest_and_retrieve"}


def should_retrieve_chunks(rag_config: RagKnowledgeConfig) -> bool:
    return rag_config.ingest_mode in {"retrieve_only", "ingest_and_retrieve"}


def ingest_documents(
    session: Session,
    *,
    workflow: Workflow,
    workflow_run: WorkflowRun,
    node_id: str,
    rag_config: RagKnowledgeConfig,
    documents: list[dict[str, Any]],
    chunker: TextChunker | None = None,
    embedding_provider: EmbeddingProvider | None = None,
    vector_store: VectorStore | None = None,
) -> dict[str, Any]:
    chunker = chunker or TextChunker(
        chunk_size=rag_config.chunk_size,
        chunk_overlap=rag_config.overlap,
    )
    embedding_provider = embedding_provider or get_default_embedding_provider()
    vector_store = vector_store or get_default_vector_store()

    documents_to_ingest = filter_documents_for_ingestion(documents, rag_config)
    ingested_documents = 0
    ingested_chunks = 0
    reused_documents = 0

    for document in documents_to_ingest:
        text = str(document.get("text", "")).strip()
        if not text:
            continue

        metadata = dict(document.get("metadata", {}))
        metadata["tags"] = rag_config.tags
        checksum = hashlib.sha256(text.encode("utf-8")).hexdigest()
        uploaded_file_id = document.get("id")
        title = metadata.get("original_name") or document.get("source_path") or "document"
        existing_document = session.scalar(
            select(KnowledgeDocument).where(
                KnowledgeDocument.workflow_id == workflow.id,
                KnowledgeDocument.node_id == node_id,
                KnowledgeDocument.collection_name == rag_config.collection_name,
                KnowledgeDocument.checksum == checksum,
            )
        )

        if existing_document is not None:
            existing_chunks = list(
                session.scalars(
                    select(KnowledgeChunk)
                    .where(
                        KnowledgeChunk.workflow_id == workflow.id,
                        KnowledgeChunk.document_id == existing_document.id,
                        KnowledgeChunk.collection_name == rag_config.collection_name,
                    )
                    .order_by(KnowledgeChunk.chunk_index)
                )
            )
            if existing_chunks:
                vector_store.upsert(
                    collection_name=rag_config.collection_name,
                    ids=[chunk.vector_id for chunk in existing_chunks],
                    embeddings=embedding_provider.embed_texts(
                        [chunk.chunk_text for chunk in existing_chunks]
                    ),
                    documents=[chunk.chunk_text for chunk in existing_chunks],
                    metadatas=[
                        {
                            "knowledge_chunk_id": chunk.id,
                            "knowledge_document_id": existing_document.id,
                            "workflow_id": workflow.id,
                            "collection_name": rag_config.collection_name,
                            "chunk_index": chunk.chunk_index,
                            "title": existing_document.title,
                            "tags": ",".join(normalize_tags(chunk.metadata_json.get("tags", []))),
                        }
                        for chunk in existing_chunks
                    ],
                )
                reused_documents += 1
                continue

        knowledge_document = KnowledgeDocument(
            workflow_id=workflow.id,
            workflow_run_id=workflow_run.id,
            uploaded_file_id=uploaded_file_id,
            node_id=node_id,
            collection_name=rag_config.collection_name,
            title=str(title),
            source_path=document.get("source_path"),
            checksum=checksum,
            metadata_json=metadata,
            text_length=len(text),
        )
        session.add(knowledge_document)
        session.flush()

        chunks = chunker.chunk(text)
        if not chunks:
            continue

        embeddings = embedding_provider.embed_texts([chunk.text for chunk in chunks])
        chunk_records: list[KnowledgeChunk] = []

        for chunk, _embedding in zip(chunks, embeddings, strict=False):
            vector_id = f"workflow-{workflow.id}-doc-{knowledge_document.id}-chunk-{chunk.index}"
            chunk_record = KnowledgeChunk(
                workflow_id=workflow.id,
                document_id=knowledge_document.id,
                node_id=node_id,
                collection_name=rag_config.collection_name,
                chunk_index=chunk.index,
                chunk_text=chunk.text,
                token_estimate=chunk.token_estimate,
                char_start=chunk.char_start,
                char_end=chunk.char_end,
                embedding_model=embedding_provider.model_name,
                vector_id=vector_id,
                metadata_json={
                    **metadata,
                    "document_id": knowledge_document.id,
                    "chunk_index": chunk.index,
                    "title": str(title),
                    "tags": rag_config.tags,
                },
            )
            session.add(chunk_record)
            chunk_records.append(chunk_record)
            ingested_chunks += 1

        session.flush()
        vector_ids: list[str] = []
        vector_metadatas: list[dict[str, Any]] = []
        chunk_documents: list[str] = []
        for chunk_record in chunk_records:
            vector_ids.append(chunk_record.vector_id)
            chunk_documents.append(chunk_record.chunk_text)
            vector_metadatas.append(
                {
                    "knowledge_chunk_id": chunk_record.id,
                    "knowledge_document_id": knowledge_document.id,
                    "workflow_id": workflow.id,
                    "collection_name": rag_config.collection_name,
                    "chunk_index": chunk_record.chunk_index,
                    "title": str(title),
                    "tags": ",".join(rag_config.tags),
                }
            )
        vector_store.upsert(
            collection_name=rag_config.collection_name,
            ids=vector_ids,
            embeddings=embeddings,
            documents=chunk_documents,
            metadatas=vector_metadatas,
        )
        ingested_documents += 1

    session.flush()
    return {
        "documents_seen": len(documents),
        "documents_indexed": ingested_documents,
        "documents_reused": reused_documents,
        "chunks_indexed": ingested_chunks,
        "collection_name": rag_config.collection_name,
        "embedding_model": embedding_provider.model_name,
        "tags": rag_config.tags,
        "allowed_file_types": sorted(rag_config.allowed_file_types),
    }


def retrieve_relevant_chunks(
    session: Session,
    *,
    workflow: Workflow,
    rag_config: RagKnowledgeConfig,
    query: str,
    embedding_provider: EmbeddingProvider | None = None,
    vector_store: VectorStore | None = None,
) -> list[RetrievedChunk]:
    embedding_provider = embedding_provider or get_default_embedding_provider()
    vector_store = vector_store or get_default_vector_store()

    query_embedding = embedding_provider.embed_texts([query])[0]
    matches = query_vector_store(
        vector_store=vector_store,
        workflow=workflow,
        rag_config=rag_config,
        query_embedding=query_embedding,
    )
    retrieved = hydrate_vector_matches(session, workflow=workflow, rag_config=rag_config, matches=matches)
    if retrieved:
        return retrieved

    heal_summary = heal_vector_collection(
        session,
        workflow=workflow,
        rag_config=rag_config,
        embedding_provider=embedding_provider,
        vector_store=vector_store,
    )
    if heal_summary["chunks_repaired"]:
        matches = query_vector_store(
            vector_store=vector_store,
            workflow=workflow,
            rag_config=rag_config,
            query_embedding=query_embedding,
        )
        retrieved = hydrate_vector_matches(session, workflow=workflow, rag_config=rag_config, matches=matches)
        if retrieved:
            return retrieved

    return lexical_fallback_search(session, workflow=workflow, rag_config=rag_config, query=query)


def query_vector_store(
    *,
    vector_store: VectorStore,
    workflow: Workflow,
    rag_config: RagKnowledgeConfig,
    query_embedding: list[float],
) -> list[dict[str, Any]]:
    return vector_store.query(
        collection_name=rag_config.collection_name,
        query_embedding=query_embedding,
        top_k=rag_config.top_k,
        metadata_filter={
            "workflow_id": workflow.id,
            "collection_name": rag_config.collection_name,
        },
    )


def hydrate_vector_matches(
    session: Session,
    *,
    workflow: Workflow,
    rag_config: RagKnowledgeConfig,
    matches: list[dict[str, Any]],
) -> list[RetrievedChunk]:
    vector_ids = [match["id"] for match in matches]
    if not vector_ids:
        return []

    statement = select(KnowledgeChunk).where(
        KnowledgeChunk.workflow_id == workflow.id,
        KnowledgeChunk.collection_name == rag_config.collection_name,
        KnowledgeChunk.vector_id.in_(vector_ids),
    )
    chunk_records = list(session.scalars(statement))
    chunk_by_vector_id = {chunk.vector_id: chunk for chunk in chunk_records}

    retrieved: list[RetrievedChunk] = []
    for match in matches:
        chunk = chunk_by_vector_id.get(match["id"])
        if chunk is None:
            continue
        if rag_config.tags:
            chunk_tags = normalize_tags(chunk.metadata_json.get("tags", []))
            if not set(rag_config.tags).issubset(set(chunk_tags)):
                continue
        retrieved.append(
            RetrievedChunk(
                chunk_id=chunk.id,
                vector_id=chunk.vector_id,
                text=chunk.chunk_text,
                score=match.get("distance"),
                metadata={
                    **chunk.metadata_json,
                    "workflow_id": chunk.workflow_id,
                    "document_id": chunk.document_id,
                    "collection_name": chunk.collection_name,
                },
            )
        )
    return retrieved[: rag_config.top_k]


def heal_vector_collection(
    session: Session,
    *,
    workflow: Workflow,
    rag_config: RagKnowledgeConfig,
    embedding_provider: EmbeddingProvider,
    vector_store: VectorStore,
) -> dict[str, Any]:
    chunks = list(
        session.scalars(
            select(KnowledgeChunk)
            .where(
                KnowledgeChunk.workflow_id == workflow.id,
                KnowledgeChunk.collection_name == rag_config.collection_name,
            )
            .order_by(KnowledgeChunk.id)
        )
    )
    if not chunks:
        return {"chunks_seen": 0, "chunks_repaired": 0, "reason": "no_sqlite_chunks"}

    embeddings = embedding_provider.embed_texts([chunk.chunk_text for chunk in chunks])
    vector_store.upsert(
        collection_name=rag_config.collection_name,
        ids=[chunk.vector_id for chunk in chunks],
        embeddings=embeddings,
        documents=[chunk.chunk_text for chunk in chunks],
        metadatas=[
            {
                "knowledge_chunk_id": chunk.id,
                "knowledge_document_id": chunk.document_id,
                "workflow_id": workflow.id,
                "collection_name": rag_config.collection_name,
                "chunk_index": chunk.chunk_index,
                "title": chunk.metadata_json.get("title"),
                "tags": ",".join(normalize_tags(chunk.metadata_json.get("tags", []))),
                "self_healed": True,
            }
            for chunk in chunks
        ],
    )
    return {"chunks_seen": len(chunks), "chunks_repaired": len(chunks), "reason": "reindexed_from_sqlite"}


def lexical_fallback_search(
    session: Session,
    *,
    workflow: Workflow,
    rag_config: RagKnowledgeConfig,
    query: str,
) -> list[RetrievedChunk]:
    query_terms = {term.lower() for term in query.split() if len(term) > 2}
    if not query_terms:
        return []
    chunks = list(
        session.scalars(
            select(KnowledgeChunk)
            .where(
                KnowledgeChunk.workflow_id == workflow.id,
                KnowledgeChunk.collection_name == rag_config.collection_name,
            )
            .order_by(KnowledgeChunk.id.desc())
            .limit(500)
        )
    )
    scored: list[tuple[int, KnowledgeChunk]] = []
    for chunk in chunks:
        chunk_tags = normalize_tags(chunk.metadata_json.get("tags", []))
        if rag_config.tags and not set(rag_config.tags).issubset(set(chunk_tags)):
            continue
        text = chunk.chunk_text.lower()
        score = sum(1 for term in query_terms if term in text)
        if score:
            scored.append((score, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [
        RetrievedChunk(
            chunk_id=chunk.id,
            vector_id=chunk.vector_id,
            text=chunk.chunk_text,
            score=max(0.0, 1.0 - (score / max(len(query_terms), 1))),
            metadata={
                **chunk.metadata_json,
                "workflow_id": chunk.workflow_id,
                "document_id": chunk.document_id,
                "collection_name": chunk.collection_name,
                "retrieval_mode": "lexical_self_healing_fallback",
            },
        )
        for score, chunk in scored[: rag_config.top_k]
    ]


def filter_documents_for_ingestion(
    documents: list[dict[str, Any]],
    rag_config: RagKnowledgeConfig,
) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for document in documents:
        metadata = dict(document.get("metadata", {}))
        extension = str(metadata.get("extension", "")).lower()
        if extension and extension not in rag_config.allowed_file_types:
            continue
        filtered.append(document)
    return filtered


def normalize_tags(raw_tags: Any) -> list[str]:
    if isinstance(raw_tags, list):
        return [str(tag).strip() for tag in raw_tags if str(tag).strip()]
    if isinstance(raw_tags, str):
        return [tag.strip() for tag in raw_tags.split(",") if tag.strip()]
    return []
