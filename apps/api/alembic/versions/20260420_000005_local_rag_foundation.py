"""local rag foundation

Revision ID: 20260420_000005
Revises: 20260420_000004
Create Date: 2026-04-20 00:00:05.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000005"
down_revision = "20260420_000004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_documents",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("workflow_run_id", sa.Integer(), nullable=True),
        sa.Column("uploaded_file_id", sa.Integer(), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("collection_name", sa.String(length=255), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False, server_default="extracted"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("source_path", sa.String(length=1024), nullable=True),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("text_length", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_run_id"], ["workflow_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["uploaded_file_id"], ["uploaded_files.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_knowledge_documents_workflow_id", "knowledge_documents", ["workflow_id"])
    op.create_index("ix_knowledge_documents_workflow_run_id", "knowledge_documents", ["workflow_run_id"])
    op.create_index("ix_knowledge_documents_uploaded_file_id", "knowledge_documents", ["uploaded_file_id"])
    op.create_index("ix_knowledge_documents_node_id", "knowledge_documents", ["node_id"])
    op.create_index("ix_knowledge_documents_collection_name", "knowledge_documents", ["collection_name"])

    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("collection_name", sa.String(length=255), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("token_estimate", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("char_start", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("char_end", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("embedding_model", sa.String(length=255), nullable=False),
        sa.Column("vector_id", sa.String(length=255), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["knowledge_documents.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("document_id", "chunk_index", name="uq_knowledge_chunks_document_index"),
        sa.UniqueConstraint("vector_id", name="uq_knowledge_chunks_vector_id"),
    )
    op.create_index("ix_knowledge_chunks_workflow_id", "knowledge_chunks", ["workflow_id"])
    op.create_index("ix_knowledge_chunks_document_id", "knowledge_chunks", ["document_id"])
    op.create_index("ix_knowledge_chunks_node_id", "knowledge_chunks", ["node_id"])
    op.create_index("ix_knowledge_chunks_collection_name", "knowledge_chunks", ["collection_name"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_chunks_collection_name", table_name="knowledge_chunks")
    op.drop_index("ix_knowledge_chunks_node_id", table_name="knowledge_chunks")
    op.drop_index("ix_knowledge_chunks_document_id", table_name="knowledge_chunks")
    op.drop_index("ix_knowledge_chunks_workflow_id", table_name="knowledge_chunks")
    op.drop_table("knowledge_chunks")

    op.drop_index("ix_knowledge_documents_collection_name", table_name="knowledge_documents")
    op.drop_index("ix_knowledge_documents_node_id", table_name="knowledge_documents")
    op.drop_index("ix_knowledge_documents_uploaded_file_id", table_name="knowledge_documents")
    op.drop_index("ix_knowledge_documents_workflow_run_id", table_name="knowledge_documents")
    op.drop_index("ix_knowledge_documents_workflow_id", table_name="knowledge_documents")
    op.drop_table("knowledge_documents")
