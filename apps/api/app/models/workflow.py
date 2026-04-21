from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft", server_default="draft")
    current_version: Mapped[int] = mapped_column(Integer(), nullable=False, default=1, server_default="1")
    latest_saved_version: Mapped[int] = mapped_column(
        Integer(), nullable=False, default=0, server_default="0"
    )
    is_published: Mapped[bool] = mapped_column(Boolean(), nullable=False, default=False, server_default="0")
    published_slug: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    published_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True, index=True)
    graph_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    nodes: Mapped[list["WorkflowNode"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowNode.workflow_id",
        order_by=lambda: WorkflowNode.id,
    )
    edges: Mapped[list["WorkflowEdge"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowEdge.workflow_id",
        order_by=lambda: WorkflowEdge.id,
    )
    versions: Mapped[list["WorkflowVersion"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowVersion.workflow_id",
        order_by=lambda: WorkflowVersion.version_number.desc(),
    )
    runs: Mapped[list["WorkflowRun"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowRun.workflow_id",
        order_by=lambda: WorkflowRun.id.desc(),
    )
    uploaded_files: Mapped[list["UploadedFile"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="UploadedFile.workflow_id",
        order_by=lambda: UploadedFile.id.desc(),
    )
    knowledge_documents: Mapped[list["KnowledgeDocument"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="KnowledgeDocument.workflow_id",
        order_by=lambda: KnowledgeDocument.id.desc(),
    )
    knowledge_chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="KnowledgeChunk.workflow_id",
        order_by=lambda: KnowledgeChunk.id.desc(),
    )
    conversation_messages: Mapped[list["ConversationMemoryMessage"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="ConversationMemoryMessage.workflow_id",
        order_by=lambda: ConversationMemoryMessage.id.desc(),
    )
    published_version: Mapped["WorkflowVersion | None"] = relationship(
        foreign_keys=[published_version_id],
        post_update=True,
    )
    created_by_user: Mapped["AppUser | None"] = relationship(foreign_keys=[created_by_user_id])
    updated_by_user: Mapped["AppUser | None"] = relationship(foreign_keys=[updated_by_user_id])
    permissions: Mapped[list["WorkflowPermission"]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowPermission.workflow_id",
        order_by=lambda: WorkflowPermission.id.desc(),
    )


class WorkflowVersion(Base):
    __tablename__ = "workflow_versions"
    __table_args__ = (
        UniqueConstraint("workflow_id", "version_number", name="uq_workflow_versions_workflow_version"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int | None] = mapped_column(ForeignKey("workflows.id", ondelete="SET NULL"), nullable=True, index=True)
    version_number: Mapped[int] = mapped_column(Integer(), nullable=False)
    version_note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    graph_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())

    workflow: Mapped[Workflow] = relationship(
        back_populates="versions",
        foreign_keys=[workflow_id],
    )


class WorkflowPermission(Base):
    __tablename__ = "workflow_permissions"
    __table_args__ = (
        UniqueConstraint("workflow_id", "user_id", name="uq_workflow_permissions_workflow_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="viewer", server_default="viewer")
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())

    workflow: Mapped[Workflow] = relationship(back_populates="permissions", foreign_keys=[workflow_id])
    user: Mapped["AppUser"] = relationship(foreign_keys=[user_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int | None] = mapped_column(ForeignKey("workflows.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_run_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(100), nullable=False, default="workflow", server_default="workflow")
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now(), index=True)

    workflow: Mapped[Workflow | None] = relationship(foreign_keys=[workflow_id])
    workflow_run: Mapped["WorkflowRun | None"] = relationship(foreign_keys=[workflow_run_id])
    user: Mapped["AppUser | None"] = relationship(foreign_keys=[user_id])


class WorkflowComment(Base):
    __tablename__ = "workflow_comments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    node_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    body: Mapped[str] = mapped_column(Text(), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now(), index=True)

    workflow: Mapped[Workflow] = relationship(foreign_keys=[workflow_id])
    user: Mapped["AppUser | None"] = relationship(foreign_keys=[user_id])


class WorkflowChangeEvent(Base):
    __tablename__ = "workflow_change_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    change_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    summary: Mapped[str] = mapped_column(Text(), nullable=False)
    before_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now(), index=True)

    workflow: Mapped[Workflow] = relationship(foreign_keys=[workflow_id])
    user: Mapped["AppUser | None"] = relationship(foreign_keys=[user_id])


class WorkflowSubflow(Base):
    __tablename__ = "workflow_subflows"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int | None] = mapped_column(ForeignKey("workflows.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    graph_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now(), index=True)

    workflow: Mapped[Workflow | None] = relationship(foreign_keys=[workflow_id])
    created_by_user: Mapped["AppUser | None"] = relationship(foreign_keys=[created_by_user_id])


class RagEvaluation(Base):
    __tablename__ = "rag_evaluations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    collection_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    query: Mapped[str] = mapped_column(Text(), nullable=False)
    expected_answer: Mapped[str | None] = mapped_column(Text(), nullable=True)
    retrieved_chunk_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    retrieval_score: Mapped[float | None] = mapped_column(nullable=True)
    hallucination_risk: Mapped[str] = mapped_column(String(50), nullable=False, default="unknown", server_default="unknown")
    result_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now(), index=True)

    workflow: Mapped[Workflow] = relationship(foreign_keys=[workflow_id])


class WorkflowNode(Base):
    __tablename__ = "workflow_nodes"
    __table_args__ = (
        UniqueConstraint("workflow_id", "node_id", name="uq_workflow_nodes_workflow_node"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(String(255), nullable=False)
    node_type: Mapped[str] = mapped_column(String(100), nullable=False, default="builderBlock", server_default="builderBlock")
    block_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    position_x: Mapped[float] = mapped_column(nullable=False)
    position_y: Mapped[float] = mapped_column(nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    definition_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    workflow: Mapped[Workflow] = relationship(back_populates="nodes", foreign_keys=[workflow_id])


class WorkflowEdge(Base):
    __tablename__ = "workflow_edges"
    __table_args__ = (
        UniqueConstraint("workflow_id", "edge_id", name="uq_workflow_edges_workflow_edge"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    edge_id: Mapped[str] = mapped_column(String(255), nullable=False)
    source_node_id: Mapped[str] = mapped_column(String(255), nullable=False)
    target_node_id: Mapped[str] = mapped_column(String(255), nullable=False)
    source_handle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_handle: Mapped[str | None] = mapped_column(String(255), nullable=True)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    edge_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    workflow: Mapped[Workflow] = relationship(back_populates="edges", foreign_keys=[workflow_id])


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending", server_default="pending")
    trigger_mode: Mapped[str] = mapped_column(String(50), nullable=False, default="manual", server_default="manual")
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    runtime_user_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    graph_version: Mapped[int] = mapped_column(Integer(), nullable=False, default=1, server_default="1")
    graph_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    input_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    preview_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    log_messages: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)

    workflow: Mapped[Workflow] = relationship(back_populates="runs", foreign_keys=[workflow_id])
    owner_user: Mapped["AppUser | None"] = relationship(foreign_keys=[owner_user_id])
    node_runs: Mapped[list["WorkflowNodeRun"]] = relationship(
        back_populates="workflow_run",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowNodeRun.workflow_run_id",
        order_by=lambda: WorkflowNodeRun.execution_index,
    )


class WorkflowNodeRun(Base):
    __tablename__ = "workflow_node_runs"
    __table_args__ = (
        UniqueConstraint("workflow_run_id", "node_id", name="uq_workflow_node_runs_run_node"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_run_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    node_id: Mapped[str] = mapped_column(String(255), nullable=False)
    block_type: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending", server_default="pending")
    execution_index: Mapped[int] = mapped_column(Integer(), nullable=False, default=0, server_default="0")
    started_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    input_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    preview_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    log_messages: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)

    workflow_run: Mapped[WorkflowRun] = relationship(back_populates="node_runs", foreign_keys=[workflow_run_id])


class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    node_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(255), nullable=False)
    extension: Mapped[str] = mapped_column(String(20), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer(), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())

    workflow: Mapped[Workflow | None] = relationship(back_populates="uploaded_files", foreign_keys=[workflow_id])
    workflow_run: Mapped[WorkflowRun | None] = relationship(foreign_keys=[workflow_run_id])
    knowledge_documents: Mapped[list["KnowledgeDocument"]] = relationship(
        back_populates="uploaded_file",
        foreign_keys="KnowledgeDocument.uploaded_file_id",
    )


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    uploaded_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("uploaded_files.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    node_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    collection_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, default="extracted", server_default="extracted")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    text_length: Mapped[int] = mapped_column(Integer(), nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())

    workflow: Mapped[Workflow] = relationship(back_populates="knowledge_documents", foreign_keys=[workflow_id])
    workflow_run: Mapped[WorkflowRun | None] = relationship(foreign_keys=[workflow_run_id])
    uploaded_file: Mapped[UploadedFile | None] = relationship(
        back_populates="knowledge_documents",
        foreign_keys=[uploaded_file_id],
    )
    chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        foreign_keys="KnowledgeChunk.document_id",
        order_by=lambda: KnowledgeChunk.chunk_index,
    )


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_knowledge_chunks_document_index"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    node_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    collection_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer(), nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text(), nullable=False)
    token_estimate: Mapped[int] = mapped_column(Integer(), nullable=False, default=0, server_default="0")
    char_start: Mapped[int] = mapped_column(Integer(), nullable=False, default=0, server_default="0")
    char_end: Mapped[int] = mapped_column(Integer(), nullable=False, default=0, server_default="0")
    embedding_model: Mapped[str] = mapped_column(String(255), nullable=False)
    vector_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())

    workflow: Mapped[Workflow] = relationship(back_populates="knowledge_chunks", foreign_keys=[workflow_id])
    document: Mapped[KnowledgeDocument] = relationship(back_populates="chunks", foreign_keys=[document_id])


class ConversationMemoryMessage(Base):
    __tablename__ = "conversation_memory_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    node_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    namespace: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="message", server_default="message")
    content: Mapped[str] = mapped_column(Text(), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())

    workflow: Mapped[Workflow] = relationship(back_populates="conversation_messages", foreign_keys=[workflow_id])
    workflow_run: Mapped[WorkflowRun | None] = relationship(foreign_keys=[workflow_run_id])


class AppUser(Base):
    __tablename__ = "app_users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_app_users_email"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="user", server_default="user")
    is_active: Mapped[bool] = mapped_column(Boolean(), nullable=False, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    auth_events: Mapped[list["AuthEvent"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="AuthEvent.user_id",
        order_by=lambda: AuthEvent.id.desc(),
    )


class AuthEvent(Base):
    __tablename__ = "auth_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("app_users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, server_default=func.now())

    user: Mapped[AppUser | None] = relationship(back_populates="auth_events", foreign_keys=[user_id])
