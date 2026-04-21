import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, distinct, func, select
from sqlalchemy.orm import Session

from app.core.block_registry import BLOCK_DEFINITIONS
from app.core.config import settings
from app.db.deps import get_db
from app.db.session import SessionLocal
from app.models.workflow import (
    AppUser,
    KnowledgeChunk,
    KnowledgeDocument,
    UploadedFile,
    Workflow,
    WorkflowPermission,
    WorkflowRun,
    WorkflowVersion,
)
from app.schemas.auth import AppUserRead, AuthResponse, UserLoginRequest, UserSignupRequest
from app.schemas.execution import ExecuteWorkflowRequest, WorkflowRunRead
from app.schemas.publish import (
    PublishWorkflowRequest,
    PublishWorkflowResponse,
    PublishedChatRequest,
    PublishedChatResponse,
)
from app.schemas.workflows import (
    BuilderGraphPayload,
    WorkflowCreate,
    WorkflowMetadataUpdate,
    WorkflowPermissionCreate,
    WorkflowPermissionRead,
    WorkflowRead,
    WorkflowSummary,
    WorkflowUpdate,
    WorkflowVersionCreate,
    WorkflowVersionRead,
)
from app.services.admin import get_usage_dashboard
from app.services.auth import create_local_session_token, create_local_user, login_local_user
from app.services.execution import execute_workflow, get_run_or_404
from app.services.execution_queue import enqueue_workflow_execution
from app.services.files import persist_runtime_upload
from app.services.parsers import parse_uploaded_file
from app.services.rag import build_rag_config, retrieve_relevant_chunks
from app.services.vector_store import get_default_vector_store
from app.services.publish import (
    execute_published_chat_message,
    extract_chatbot_response_from_run,
    get_published_workflow_or_404,
    publish_workflow,
)
from app.services.workflows import (
    archive_workflow,
    create_workflow,
    duplicate_workflow,
    get_workflow_or_404,
    list_workflows,
    restore_workflow,
    save_workflow_version,
    update_workflow,
    validate_graph,
)

router = APIRouter()


def get_current_user_id(x_local_user_id: int | None = Header(default=None), db: Session = Depends(get_db)) -> int | None:
    if x_local_user_id is None:
        return None
    user = db.get(AppUser, x_local_user_id)
    return user.id if user and user.is_active else None


ROLE_RANK = {"viewer": 1, "runner": 2, "editor": 3, "owner": 4}


def ensure_workflow_access(
    db: Session,
    workflow: Workflow,
    current_user_id: int | None,
    *,
    required_role: str = "viewer",
) -> None:
    if current_user_id is None:
        return
    if workflow.created_by_user_id in {None, current_user_id} or workflow.updated_by_user_id == current_user_id:
        return
    permission = db.scalar(
        select(WorkflowPermission).where(
            WorkflowPermission.workflow_id == workflow.id,
            WorkflowPermission.user_id == current_user_id,
        )
    )
    if permission and ROLE_RANK.get(permission.role, 0) >= ROLE_RANK.get(required_role, 1):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this workflow.")


def get_authorized_workflow(
    db: Session,
    workflow_id: int,
    current_user_id: int | None,
    *,
    required_role: str = "viewer",
) -> Workflow:
    workflow = get_workflow_or_404(db, workflow_id)
    ensure_workflow_access(db, workflow, current_user_id, required_role=required_role)
    return workflow


def workflow_summary_payload(db: Session, workflow: Workflow) -> dict:
    runs = list(
        db.scalars(
            select(WorkflowRun)
            .where(WorkflowRun.workflow_id == workflow.id)
            .order_by(WorkflowRun.started_at.desc(), WorkflowRun.id.desc())
        )
    )
    last_run = runs[0] if runs else None
    avg_latency = db.scalar(
        select(func.avg(WorkflowRun.latency_ms)).where(
            WorkflowRun.workflow_id == workflow.id,
            WorkflowRun.latency_ms.is_not(None),
        )
    )
    rag_document_count = db.scalar(select(func.count(KnowledgeDocument.id)).where(KnowledgeDocument.workflow_id == workflow.id)) or 0
    rag_chunk_count = db.scalar(select(func.count(KnowledgeChunk.id)).where(KnowledgeChunk.workflow_id == workflow.id)) or 0
    rag_last_ingested_at = db.scalar(select(func.max(KnowledgeDocument.created_at)).where(KnowledgeDocument.workflow_id == workflow.id))
    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "status": workflow.status,
        "current_version": workflow.current_version,
        "latest_saved_version": workflow.latest_saved_version,
        "is_published": workflow.is_published,
        "published_slug": workflow.published_slug,
        "created_by_user_id": workflow.created_by_user_id,
        "updated_by_user_id": workflow.updated_by_user_id,
        "archived_at": workflow.archived_at,
        "run_count": len(runs),
        "failed_run_count": sum(1 for run in runs if run.status == "failed"),
        "avg_latency_ms": round(float(avg_latency), 1) if avg_latency is not None else None,
        "last_run_id": last_run.id if last_run else None,
        "last_run_status": last_run.status if last_run else None,
        "last_run_error": last_run.error_message if last_run else None,
        "last_run_at": last_run.started_at if last_run else None,
        "rag_document_count": rag_document_count,
        "rag_chunk_count": rag_chunk_count,
        "rag_last_ingested_at": rag_last_ingested_at,
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at,
    }


def score_to_relevance(score: float | None) -> float:
    if score is None:
        return 0.0
    return max(0.0, min(1.0, 1.0 - float(score)))


def calculate_retrieval_confidence(chunks: list) -> float:
    if not chunks:
        return 0.0
    relevances = [score_to_relevance(chunk.score) for chunk in chunks]
    return round(sum(relevances) / len(relevances), 3)


def humanize_block_type(block_type: str) -> str:
    return block_type.replace("_", " ").title()


def compare_graphs(current_graph: dict, version_graph: dict) -> dict:
    current_nodes = {node.get("id"): node for node in current_graph.get("nodes", [])}
    version_nodes = {node.get("id"): node for node in version_graph.get("nodes", [])}
    current_edges = {edge.get("id"): edge for edge in current_graph.get("edges", [])}
    version_edges = {edge.get("id"): edge for edge in version_graph.get("edges", [])}

    added_nodes = sorted(set(current_nodes) - set(version_nodes))
    removed_nodes = sorted(set(version_nodes) - set(current_nodes))
    changed_nodes = []
    for node_id in sorted(set(current_nodes) & set(version_nodes)):
        current_node = current_nodes[node_id]
        version_node = version_nodes[node_id]
        changes = []
        if current_node.get("data", {}).get("label") != version_node.get("data", {}).get("label"):
            changes.append("label")
        if current_node.get("data", {}).get("config") != version_node.get("data", {}).get("config"):
            changes.append("config")
        if current_node.get("position") != version_node.get("position"):
            changes.append("position")
        if changes:
            changed_nodes.append({"node_id": node_id, "changes": changes})

    added_edges = sorted(set(current_edges) - set(version_edges))
    removed_edges = sorted(set(version_edges) - set(current_edges))
    changed_edges = [
        edge_id
        for edge_id in sorted(set(current_edges) & set(version_edges))
        if current_edges[edge_id] != version_edges[edge_id]
    ]

    return {
        "summary": {
            "added_nodes": len(added_nodes),
            "removed_nodes": len(removed_nodes),
            "changed_nodes": len(changed_nodes),
            "added_edges": len(added_edges),
            "removed_edges": len(removed_edges),
            "changed_edges": len(changed_edges),
        },
        "added_nodes": added_nodes,
        "removed_nodes": removed_nodes,
        "changed_nodes": changed_nodes,
        "added_edges": added_edges,
        "removed_edges": removed_edges,
        "changed_edges": changed_edges,
    }


@router.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "app": settings.app_name,
        "database": settings.sqlalchemy_database_url,
        "vector_store": settings.chroma_persist_dir,
    }


@router.get("/system/health/details", tags=["system"])
def system_health_details() -> dict:
    storage_dir = Path(settings.app_storage_dir)
    uploads_dir = Path(settings.uploads_dir)
    chroma_dir = Path(settings.chroma_persist_dir)
    sqlite_path = settings.sqlalchemy_database_url.replace("sqlite:///", "", 1)
    return {
        "status": "ok",
        "app": settings.app_name,
        "generated_at": datetime.now(timezone.utc),
        "checks": [
            {
                "key": "database",
                "label": "SQLite database",
                "status": "ready" if settings.sqlalchemy_database_url.startswith("sqlite:///") else "custom",
                "detail": settings.sqlalchemy_database_url,
            },
            {
                "key": "storage",
                "label": "Local storage",
                "status": "ready" if storage_dir.exists() else "missing",
                "detail": str(storage_dir),
            },
            {
                "key": "uploads",
                "label": "Upload folder",
                "status": "ready" if uploads_dir.exists() else "missing",
                "detail": str(uploads_dir),
            },
            {
                "key": "chroma",
                "label": "Chroma vector store",
                "status": "ready" if chroma_dir.exists() else "will-create",
                "detail": str(chroma_dir),
            },
            {
                "key": "openrouter",
                "label": "OpenRouter API key",
                "status": "ready" if bool(settings.openrouter_api_key) else "missing",
                "detail": "OPENROUTER_API_KEY configured" if settings.openrouter_api_key else "Set OPENROUTER_API_KEY in .env",
            },
            {
                "key": "llm_model",
                "label": "Default LLM model",
                "status": "ready" if bool(settings.openrouter_model) else "missing",
                "detail": settings.openrouter_model or "Set OPENROUTER_MODEL in .env",
            },
            {
                "key": "embedding",
                "label": "Embedding provider",
                "status": "ready",
                "detail": f"{settings.embedding_provider}: {settings.embedding_model}",
            },
        ],
        "paths": {
            "sqlite_file": sqlite_path,
            "storage_dir": str(storage_dir),
            "uploads_dir": str(uploads_dir),
            "chroma_dir": str(chroma_dir),
        },
        "providers": {
            "llm_provider": settings.llm_provider,
            "openrouter_base_url": settings.openrouter_base_url,
            "openrouter_model": settings.openrouter_model,
            "embedding_provider": settings.embedding_provider,
            "embedding_model": settings.embedding_model,
            "vector_backend": settings.vector_backend,
        },
    }


@router.get("/blocks/marketplace", tags=["system"])
def block_marketplace_route() -> list[dict]:
    phase_two = {"summarizer", "classifier", "extraction_ai"}
    return [
        {
            "type": block_type,
            "title": humanize_block_type(block_type),
            "status": "implemented",
            "phase": "phase-2" if block_type in phase_two else "mvp",
            "inputs": [{"id": port.id, "data_types": port.data_types, "required": port.required} for port in definition.inputs],
            "outputs": [{"id": port.id, "data_types": port.data_types, "required": port.required} for port in definition.outputs],
            "fields": [
                {"key": field.key, "required": field.required, "allow_blank": field.allow_blank}
                for field in definition.fields
            ],
        }
        for block_type, definition in sorted(BLOCK_DEFINITIONS.items())
    ]


@router.get("/knowledge/collections", tags=["knowledge"])
def list_all_knowledge_collections_route(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(
        select(
            KnowledgeDocument.workflow_id,
            Workflow.name,
            KnowledgeDocument.collection_name,
            func.count(distinct(KnowledgeDocument.id)),
            func.count(KnowledgeChunk.id),
            func.max(KnowledgeDocument.created_at),
        )
        .join(Workflow, Workflow.id == KnowledgeDocument.workflow_id)
        .join(KnowledgeChunk, KnowledgeChunk.document_id == KnowledgeDocument.id, isouter=True)
        .group_by(KnowledgeDocument.workflow_id, Workflow.name, KnowledgeDocument.collection_name)
        .order_by(Workflow.name, KnowledgeDocument.collection_name)
    ).all()
    return [
        {
            "workflow_id": row[0],
            "workflow_name": row[1],
            "collection_name": row[2],
            "document_count": row[3],
            "chunk_count": row[4],
            "last_ingested_at": row[5],
        }
        for row in rows
    ]


@router.post("/auth/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED, tags=["auth"])
def signup_route(payload: UserSignupRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = create_local_user(
        db,
        email=payload.email,
        display_name=payload.display_name,
        password=payload.password,
    )
    return AuthResponse(
        user=AppUserRead.model_validate(user),
        local_session_token=create_local_session_token(user),
        message="Local account created. This MVP token is stored client-side only.",
    )


@router.post("/auth/login", response_model=AuthResponse, tags=["auth"])
def login_route(payload: UserLoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = login_local_user(db, email=payload.email, password=payload.password)
    return AuthResponse(
        user=AppUserRead.model_validate(user),
        local_session_token=create_local_session_token(user),
        message="Logged in locally. Use this identity for testing multi-user sessions.",
    )


@router.get("/admin/usage", tags=["admin"])
def usage_dashboard_route(db: Session = Depends(get_db)) -> dict:
    return get_usage_dashboard(db)


@router.post("/files/runtime-upload", tags=["files"])
async def runtime_upload_route(file: UploadFile = File(...)) -> dict:
    return await persist_runtime_upload(file)


@router.get("/files", tags=["files"])
def list_files_route(db: Session = Depends(get_db)) -> list[dict]:
    files = list(db.scalars(select(UploadedFile).order_by(UploadedFile.created_at.desc()).limit(200)))
    return [
        {
            "id": file.id,
            "workflow_id": file.workflow_id,
            "workflow_run_id": file.workflow_run_id,
            "node_id": file.node_id,
            "original_name": file.original_name,
            "extension": file.extension,
            "mime_type": file.mime_type,
            "size_bytes": file.size_bytes,
            "storage_path": file.storage_path,
            "metadata": file.metadata_json,
            "created_at": file.created_at,
            "knowledge_document_count": len(file.knowledge_documents),
        }
        for file in files
    ]


@router.get("/files/{file_id}", tags=["files"])
def get_file_route(file_id: int, db: Session = Depends(get_db)) -> dict:
    file = db.get(UploadedFile, file_id)
    if file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")
    preview = ""
    try:
        with open(file.storage_path, "r", encoding="utf-8", errors="ignore") as handle:
            preview = handle.read(4000)
    except OSError:
        preview = "Preview unavailable for this file type."
    return {
        "id": file.id,
        "workflow_id": file.workflow_id,
        "workflow_run_id": file.workflow_run_id,
        "node_id": file.node_id,
        "original_name": file.original_name,
        "extension": file.extension,
        "mime_type": file.mime_type,
        "size_bytes": file.size_bytes,
        "storage_path": file.storage_path,
        "metadata": file.metadata_json,
        "created_at": file.created_at,
        "preview": preview,
        "knowledge_documents": [
            {
                "id": document.id,
                "collection_name": document.collection_name,
                "title": document.title,
                "text_length": document.text_length,
                "created_at": document.created_at,
            }
            for document in file.knowledge_documents
        ],
    }


@router.delete("/files/{file_id}", tags=["files"])
def delete_file_route(file_id: int, db: Session = Depends(get_db)) -> dict:
    file = db.get(UploadedFile, file_id)
    if file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")
    storage_path = Path(file.storage_path)
    db.delete(file)
    db.commit()
    storage_path.unlink(missing_ok=True)
    return {"deleted": True, "file_id": file_id}


@router.post("/files/{file_id}/reprocess", tags=["files"])
def reprocess_file_route(file_id: int, db: Session = Depends(get_db)) -> dict:
    file = db.get(UploadedFile, file_id)
    if file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")
    parsed = parse_uploaded_file(file)
    return {
        "file_id": file_id,
        "document": {
            "text_preview": parsed.text[:4000],
            "metadata": parsed.metadata,
            "text_length": len(parsed.text),
        },
    }


@router.post("/workflows", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED, tags=["workflows"])
def create_workflow_route(
    payload: WorkflowCreate,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    validated_graph = validate_graph(payload.graph)
    workflow = create_workflow(
        db,
        name=payload.name,
        description=payload.description,
        validated_graph=validated_graph,
        user_id=current_user_id,
    )
    return WorkflowRead.model_validate(workflow)


@router.get("/workflows", response_model=list[WorkflowSummary], tags=["workflows"])
def list_workflows_route(
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> list[dict]:
    workflows = list_workflows(db, include_archived=include_archived)
    if current_user_id is not None:
        permitted_workflow_ids = {
            row[0]
            for row in db.execute(
                select(WorkflowPermission.workflow_id).where(WorkflowPermission.user_id == current_user_id)
            )
        }
        workflows = [
            workflow
            for workflow in workflows
            if workflow.created_by_user_id in {None, current_user_id}
            or workflow.updated_by_user_id == current_user_id
            or workflow.id in permitted_workflow_ids
        ]
    return [workflow_summary_payload(db, workflow) for workflow in workflows]


@router.post("/workflows/import-bundle", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED, tags=["workflows"])
def import_workflow_bundle_route(
    payload: dict,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    graph = payload.get("graph_json") or payload.get("workflow", {}).get("graph_json")
    if not isinstance(graph, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bundle is missing graph_json.")
    graph = {**graph, "name": f"{graph.get('name', 'Imported Workflow')} Imported"}
    validated_graph = validate_graph(BuilderGraphPayload.model_validate(graph))
    workflow = create_workflow(
        db,
        name=validated_graph.name,
        description="Imported from AI Studio project bundle.",
        validated_graph=validated_graph,
        user_id=current_user_id,
    )
    return WorkflowRead.model_validate(workflow)


@router.get("/workflows/{workflow_id}", response_model=WorkflowRead, tags=["workflows"])
def get_workflow_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id)
    return WorkflowRead.model_validate(workflow)


@router.put("/workflows/{workflow_id}", response_model=WorkflowRead, tags=["workflows"])
def update_workflow_route(
    workflow_id: int,
    payload: WorkflowUpdate,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id, required_role="editor")
    validated_graph = validate_graph(payload.graph)
    updated_workflow = update_workflow(
        db,
        workflow,
        name=payload.name,
        description=payload.description,
        status_value=payload.status,
        validated_graph=validated_graph,
        user_id=current_user_id,
    )
    return WorkflowRead.model_validate(updated_workflow)


@router.patch("/workflows/{workflow_id}/metadata", response_model=WorkflowRead, tags=["workflows"])
def update_workflow_metadata_route(
    workflow_id: int,
    payload: WorkflowMetadataUpdate,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id, required_role="editor")
    if payload.name is not None:
        workflow.name = payload.name
        workflow.graph_json = {**workflow.graph_json, "name": payload.name}
    if payload.description is not None:
        workflow.description = payload.description
    if payload.status is not None:
        workflow.status = payload.status
    workflow.updated_by_user_id = current_user_id
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return WorkflowRead.model_validate(get_workflow_or_404(db, workflow_id))


@router.post("/workflows/{workflow_id}/archive", response_model=WorkflowRead, tags=["workflows"])
def archive_workflow_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = archive_workflow(db, get_authorized_workflow(db, workflow_id, current_user_id, required_role="editor"), user_id=current_user_id)
    return WorkflowRead.model_validate(workflow)


@router.post("/workflows/{workflow_id}/restore", response_model=WorkflowRead, tags=["workflows"])
def restore_workflow_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = restore_workflow(db, get_authorized_workflow(db, workflow_id, current_user_id, required_role="editor"), user_id=current_user_id)
    return WorkflowRead.model_validate(workflow)


@router.post("/workflows/{workflow_id}/duplicate", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED, tags=["workflows"])
def duplicate_workflow_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = duplicate_workflow(db, get_authorized_workflow(db, workflow_id, current_user_id), user_id=current_user_id)
    if workflow.description == "Advanced seeded workflow for local testing.":
        workflow.description = "Duplicated workflow workspace."
        db.add(workflow)
        db.commit()
        workflow = get_workflow_or_404(db, workflow.id)
    return WorkflowRead.model_validate(workflow)


@router.delete("/workflows/{workflow_id}", tags=["workflows"])
def delete_workflow_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> dict:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id, required_role="owner")
    workflow.published_version_id = None
    workflow.published_slug = None
    workflow.is_published = False
    db.add(workflow)
    db.flush()
    db.delete(workflow)
    db.commit()
    return {"deleted": True, "workflow_id": workflow_id}


@router.get("/workflow-templates", response_model=list[WorkflowSummary], tags=["workflows"])
def list_workflow_templates_route(db: Session = Depends(get_db)) -> list[dict]:
    workflows = list(
        db.scalars(
            select(Workflow)
            .where(Workflow.description == "Advanced seeded workflow for local testing.")
            .order_by(Workflow.name)
        )
    )
    return [workflow_summary_payload(db, workflow) for workflow in workflows]


@router.post("/workflow-templates/{workflow_id}/create", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED, tags=["workflows"])
def create_from_template_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = duplicate_workflow(db, get_workflow_or_404(db, workflow_id), user_id=current_user_id)
    workflow.name = workflow.name.replace(" Copy", " Workspace")
    workflow.description = "Workspace created from an advanced template."
    workflow.graph_json = {**workflow.graph_json, "name": workflow.name}
    db.add(workflow)
    db.commit()
    return WorkflowRead.model_validate(get_workflow_or_404(db, workflow.id))


@router.post(
    "/workflows/{workflow_id}/versions",
    response_model=WorkflowVersionRead,
    status_code=status.HTTP_201_CREATED,
    tags=["workflows"],
)
def save_workflow_version_route(
    workflow_id: int,
    payload: WorkflowVersionCreate,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowVersionRead:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id, required_role="editor")
    validated_graph = validate_graph(payload.graph)
    version = save_workflow_version(
        db,
        workflow,
        version_note=payload.version_note,
        validated_graph=validated_graph,
    )
    return WorkflowVersionRead.model_validate(version)


@router.post("/workflows/{workflow_id}/versions/{version_id}/restore", response_model=WorkflowRead, tags=["workflows"])
def restore_workflow_version_route(
    workflow_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id, required_role="editor")
    version = next((item for item in workflow.versions if item.id == version_id), None)
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow version not found.")
    validated_graph = validate_graph(BuilderGraphPayload.model_validate(version.graph_json))
    restored = update_workflow(
        db,
        workflow,
        name=version.graph_json.get("name", workflow.name),
        description=workflow.description,
        status_value="draft",
        validated_graph=validated_graph,
        user_id=current_user_id,
    )
    return WorkflowRead.model_validate(restored)


@router.get("/workflows/{workflow_id}/versions/{version_id}/compare", tags=["workflows"])
def compare_workflow_version_route(
    workflow_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> dict:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id)
    version = db.get(WorkflowVersion, version_id)
    if version is None or version.workflow_id != workflow_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow version not found.")
    return {
        "workflow_id": workflow.id,
        "version_id": version.id,
        "version_number": version.version_number,
        "current_version": workflow.current_version,
        "diff": compare_graphs(workflow.graph_json, version.graph_json),
    }


@router.get("/workflows/{workflow_id}/permissions", response_model=list[WorkflowPermissionRead], tags=["workflows"])
def list_workflow_permissions_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> list[WorkflowPermissionRead]:
    get_authorized_workflow(db, workflow_id, current_user_id, required_role="owner")
    permissions = list(
        db.scalars(
            select(WorkflowPermission)
            .where(WorkflowPermission.workflow_id == workflow_id)
            .order_by(WorkflowPermission.created_at.desc())
        )
    )
    return [
        WorkflowPermissionRead(
            id=permission.id,
            workflow_id=permission.workflow_id,
            user_id=permission.user_id,
            email=permission.user.email,
            display_name=permission.user.display_name,
            role=permission.role,
            created_at=permission.created_at,
        )
        for permission in permissions
    ]


@router.post("/workflows/{workflow_id}/permissions", response_model=WorkflowPermissionRead, status_code=status.HTTP_201_CREATED, tags=["workflows"])
def add_workflow_permission_route(
    workflow_id: int,
    payload: WorkflowPermissionCreate,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowPermissionRead:
    get_authorized_workflow(db, workflow_id, current_user_id, required_role="owner")
    user = db.scalar(select(AppUser).where(AppUser.email == payload.email.strip().lower()))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local user with this email was not found.")
    role = payload.role if payload.role in {"viewer", "editor", "runner", "owner"} else "viewer"
    permission = db.scalar(
        select(WorkflowPermission).where(
            WorkflowPermission.workflow_id == workflow_id,
            WorkflowPermission.user_id == user.id,
        )
    )
    if permission is None:
        permission = WorkflowPermission(workflow_id=workflow_id, user_id=user.id, role=role)
    else:
        permission.role = role
    db.add(permission)
    db.commit()
    db.refresh(permission)
    return WorkflowPermissionRead(
        id=permission.id,
        workflow_id=permission.workflow_id,
        user_id=permission.user_id,
        email=user.email,
        display_name=user.display_name,
        role=permission.role,
        created_at=permission.created_at,
    )


@router.delete("/workflows/{workflow_id}/permissions/{permission_id}", tags=["workflows"])
def delete_workflow_permission_route(
    workflow_id: int,
    permission_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> dict:
    get_authorized_workflow(db, workflow_id, current_user_id, required_role="owner")
    permission = db.get(WorkflowPermission, permission_id)
    if permission is None or permission.workflow_id != workflow_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow permission not found.")
    db.delete(permission)
    db.commit()
    return {"deleted": True, "permission_id": permission_id}


@router.get("/workflows/{workflow_id}/bundle", tags=["workflows"])
def export_workflow_bundle_route(workflow_id: int, db: Session = Depends(get_db)) -> dict:
    workflow = get_workflow_or_404(db, workflow_id)
    runs = list(
        db.scalars(
            select(WorkflowRun)
            .where(WorkflowRun.workflow_id == workflow_id)
            .order_by(WorkflowRun.id.desc())
            .limit(20)
        )
    )
    return {
        "format": "ai-studio-workflow-bundle",
        "format_version": 1,
        "exported_at": datetime.now(timezone.utc),
        "workflow": workflow_summary_payload(db, workflow),
        "graph_json": workflow.graph_json,
        "versions": [
            {
                "version_number": version.version_number,
                "version_note": version.version_note,
                "graph_json": version.graph_json,
                "created_at": version.created_at,
            }
            for version in workflow.versions
        ],
        "runs": [
            {
                "id": run.id,
                "status": run.status,
                "trigger_mode": run.trigger_mode,
                "latency_ms": run.latency_ms,
                "started_at": run.started_at,
                "completed_at": run.completed_at,
                "error_message": run.error_message,
            }
            for run in runs
        ],
        "files": [
            {
                "id": file.id,
                "original_name": file.original_name,
                "extension": file.extension,
                "size_bytes": file.size_bytes,
                "storage_path": file.storage_path,
                "created_at": file.created_at,
            }
            for file in workflow.uploaded_files
        ],
        "knowledge": [
            {
                "id": document.id,
                "collection_name": document.collection_name,
                "title": document.title,
                "source_path": document.source_path,
                "text_length": document.text_length,
                "chunk_count": len(document.chunks),
                "created_at": document.created_at,
            }
            for document in workflow.knowledge_documents
        ],
    }


@router.post(
    "/workflows/{workflow_id}/execute",
    response_model=WorkflowRunRead,
    status_code=status.HTTP_201_CREATED,
    tags=["execution"],
)
def execute_workflow_route(
    workflow_id: int,
    payload: ExecuteWorkflowRequest,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRunRead:
    get_authorized_workflow(db, workflow_id, current_user_id, required_role="runner")
    workflow_run = execute_workflow(db, workflow_id, payload, owner_user_id=current_user_id)
    return WorkflowRunRead.model_validate(workflow_run)


@router.post("/workflows/{workflow_id}/execute-async", status_code=status.HTTP_202_ACCEPTED, tags=["execution"])
def execute_workflow_async_route(
    workflow_id: int,
    payload: ExecuteWorkflowRequest,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> dict:
    get_authorized_workflow(db, workflow_id, current_user_id, required_role="runner")
    queued = enqueue_workflow_execution(workflow_id, payload, owner_user_id=current_user_id)
    return {
        "workflow_id": queued.workflow_id,
        "run_id": queued.run_id,
        "status": queued.status,
        "queued_at": queued.queued_at,
        "events_url": f"/workflows/{workflow_id}/runs/{queued.run_id}/events",
    }


@router.get("/workflows/{workflow_id}/runs/{run_id}", response_model=WorkflowRunRead, tags=["execution"])
def get_workflow_run_route(
    workflow_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRunRead:
    get_authorized_workflow(db, workflow_id, current_user_id)
    workflow_run = get_run_or_404(db, workflow_id, run_id)
    return WorkflowRunRead.model_validate(workflow_run)


@router.get("/workflows/{workflow_id}/runs", response_model=list[WorkflowRunRead], tags=["execution"])
def list_workflow_runs_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> list[WorkflowRunRead]:
    get_authorized_workflow(db, workflow_id, current_user_id)
    runs = list(
        db.scalars(
            select(WorkflowRun)
            .where(WorkflowRun.workflow_id == workflow_id)
            .order_by(WorkflowRun.id.desc())
            .limit(50)
        )
    )
    return [WorkflowRunRead.model_validate(run) for run in runs]


@router.get("/workflows/{workflow_id}/runs/{run_id}/events", tags=["execution"])
async def stream_workflow_run_events_route(
    workflow_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> StreamingResponse:
    get_authorized_workflow(db, workflow_id, current_user_id)

    async def event_stream():
        last_signature = ""
        while True:
            with SessionLocal() as stream_db:
                run = get_run_or_404(stream_db, workflow_id, run_id)
                payload = WorkflowRunRead.model_validate(run).model_dump(mode="json")
            signature = json.dumps(
                {
                    "status": payload["status"],
                    "node_count": len(payload.get("node_runs", [])),
                    "latency_ms": payload.get("latency_ms"),
                    "error_message": payload.get("error_message"),
                },
                sort_keys=True,
            )
            if signature != last_signature:
                last_signature = signature
                yield f"event: run_update\ndata: {json.dumps(payload)}\n\n"
            if payload["status"] in {"completed", "failed", "cancelled"}:
                yield f"event: run_done\ndata: {json.dumps(payload)}\n\n"
                break
            await asyncio.sleep(0.75)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/workflows/{workflow_id}/knowledge/collections", tags=["knowledge"])
def list_knowledge_collections_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> list[dict]:
    get_authorized_workflow(db, workflow_id, current_user_id)
    rows = db.execute(
        select(
            KnowledgeDocument.collection_name,
            func.count(distinct(KnowledgeDocument.id)),
            func.count(KnowledgeChunk.id),
        )
        .join(KnowledgeChunk, KnowledgeChunk.document_id == KnowledgeDocument.id, isouter=True)
        .where(KnowledgeDocument.workflow_id == workflow_id)
        .group_by(KnowledgeDocument.collection_name)
        .order_by(KnowledgeDocument.collection_name)
    ).all()
    return [
        {
            "collection_name": row[0],
            "document_count": row[1],
            "chunk_count": row[2],
        }
        for row in rows
    ]


@router.get("/workflows/{workflow_id}/knowledge/collections/{collection_name}/documents", tags=["knowledge"])
def list_collection_documents_route(
    workflow_id: int,
    collection_name: str,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> list[dict]:
    get_authorized_workflow(db, workflow_id, current_user_id)
    documents = list(
        db.scalars(
            select(KnowledgeDocument)
            .where(
                KnowledgeDocument.workflow_id == workflow_id,
                KnowledgeDocument.collection_name == collection_name,
            )
            .order_by(KnowledgeDocument.created_at.desc())
        )
    )
    return [
        {
            "id": document.id,
            "title": document.title,
            "source_path": document.source_path,
            "text_length": document.text_length,
            "metadata": document.metadata_json,
            "created_at": document.created_at,
            "chunk_count": len(document.chunks),
        }
        for document in documents
    ]


@router.get("/workflows/{workflow_id}/knowledge/documents/{document_id}/chunks", tags=["knowledge"])
def list_document_chunks_route(
    workflow_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> list[dict]:
    get_authorized_workflow(db, workflow_id, current_user_id)
    document = db.get(KnowledgeDocument, document_id)
    if document is None or document.workflow_id != workflow_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge document not found.")
    return [
        {
            "id": chunk.id,
            "chunk_index": chunk.chunk_index,
            "text": chunk.chunk_text,
            "token_estimate": chunk.token_estimate,
            "char_start": chunk.char_start,
            "char_end": chunk.char_end,
            "metadata": chunk.metadata_json,
        }
        for chunk in document.chunks
    ]


@router.post("/workflows/{workflow_id}/knowledge/collections/{collection_name}/retrieve", tags=["knowledge"])
def test_collection_retrieval_route(
    workflow_id: int,
    collection_name: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> dict:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id)
    query = str(payload.get("query", ""))
    top_k = int(payload.get("top_k", 4))
    rag_config = build_rag_config(
        {
            "collection": collection_name,
            "topK": top_k,
            "tags": str(payload.get("tags", "")),
        }
    )
    chunks = retrieve_relevant_chunks(db, workflow=workflow, rag_config=rag_config, query=query)
    return {
        "query": query,
        "collection_name": collection_name,
        "match_count": len(chunks),
        "confidence": calculate_retrieval_confidence(chunks),
        "matches": [
            {
                "chunk_id": chunk.chunk_id,
                "score": chunk.score,
                "relevance": score_to_relevance(chunk.score),
                "text": chunk.text,
                "metadata": chunk.metadata,
            }
            for chunk in chunks
        ],
    }


@router.delete("/workflows/{workflow_id}/knowledge/collections/{collection_name}", tags=["knowledge"])
def delete_collection_route(
    workflow_id: int,
    collection_name: str,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> dict:
    get_authorized_workflow(db, workflow_id, current_user_id, required_role="editor")
    document_ids = [
        row[0]
        for row in db.execute(
            select(KnowledgeDocument.id).where(
                KnowledgeDocument.workflow_id == workflow_id,
                KnowledgeDocument.collection_name == collection_name,
            )
        )
    ]
    if document_ids:
        db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id.in_(document_ids)))
        db.execute(delete(KnowledgeDocument).where(KnowledgeDocument.id.in_(document_ids)))
    db.commit()
    get_default_vector_store().delete_collection(collection_name=collection_name)
    return {"deleted": True, "collection_name": collection_name, "document_count": len(document_ids)}


@router.post("/workflows/{workflow_id}/knowledge/collections/{collection_name}/reingest", tags=["knowledge"])
def reingest_collection_route(
    workflow_id: int,
    collection_name: str,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> dict:
    workflow = get_authorized_workflow(db, workflow_id, current_user_id, required_role="editor")
    rag_config = build_rag_config({"collection": collection_name, "topK": 4})
    from app.services.embeddings import get_default_embedding_provider
    from app.services.rag import heal_vector_collection

    summary = heal_vector_collection(
        db,
        workflow=workflow,
        rag_config=rag_config,
        embedding_provider=get_default_embedding_provider(),
        vector_store=get_default_vector_store(),
    )
    return {"collection_name": collection_name, **summary}


@router.post(
    "/workflows/{workflow_id}/publish",
    response_model=PublishWorkflowResponse,
    tags=["publish"],
)
def publish_workflow_route(
    workflow_id: int,
    payload: PublishWorkflowRequest,
    db: Session = Depends(get_db),
) -> PublishWorkflowResponse:
    workflow = publish_workflow(db, workflow_id, payload.slug)
    return PublishWorkflowResponse(
        workflow_id=workflow.id,
        slug=workflow.published_slug or "",
        is_published=workflow.is_published,
        chat_endpoint=f"/published/chatbots/{workflow.published_slug}/messages",
    )


@router.post("/workflows/{workflow_id}/unpublish", response_model=WorkflowRead, tags=["publish"])
def unpublish_workflow_route(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> WorkflowRead:
    workflow = get_workflow_or_404(db, workflow_id)
    workflow.is_published = False
    workflow.published_slug = None
    workflow.published_version_id = None
    workflow.updated_by_user_id = current_user_id
    db.add(workflow)
    db.commit()
    return WorkflowRead.model_validate(get_workflow_or_404(db, workflow_id))


@router.get("/published/chatbots", response_model=list[WorkflowSummary], tags=["publish"])
def list_published_chatbots_route(db: Session = Depends(get_db)) -> list[dict]:
    workflows = list(
        db.scalars(
            select(Workflow)
            .where(
                Workflow.is_published.is_(True),
                Workflow.published_slug.is_not(None),
                Workflow.archived_at.is_(None),
            )
            .order_by(Workflow.updated_at.desc())
        )
    )
    return [workflow_summary_payload(db, workflow) for workflow in workflows]


@router.get(
    "/published/chatbots/{slug}",
    response_model=PublishWorkflowResponse,
    tags=["publish"],
)
def get_published_chatbot_route(slug: str, db: Session = Depends(get_db)) -> PublishWorkflowResponse:
    workflow = get_published_workflow_or_404(db, slug)
    return PublishWorkflowResponse(
        workflow_id=workflow.id,
        slug=workflow.published_slug or "",
        is_published=workflow.is_published,
        chat_endpoint=f"/published/chatbots/{workflow.published_slug}/messages",
    )


@router.post(
    "/published/chatbots/{slug}/messages",
    response_model=PublishedChatResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["publish"],
)
def published_chat_message_route(
    slug: str,
    payload: PublishedChatRequest,
    db: Session = Depends(get_db),
    current_user_id: int | None = Depends(get_current_user_id),
) -> PublishedChatResponse:
    workflow, workflow_run = execute_published_chat_message(db, slug=slug, payload=payload, owner_user_id=current_user_id)
    response_payload = extract_chatbot_response_from_run(workflow_run)
    return PublishedChatResponse(
        workflow_id=workflow.id,
        slug=workflow.published_slug or slug,
        session_id=payload.session_id,
        user_id=payload.user_id,
        run_id=workflow_run.id,
        answer=response_payload["answer"],
        citations=response_payload["citations"],
        source_chunks=response_payload["source_chunks"],
        output_payload=response_payload["output_payload"],
    )
