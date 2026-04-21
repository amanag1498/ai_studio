"""phase3 observability collaboration rag

Revision ID: 20260420_000012
Revises: 20260420_000011
Create Date: 2026-04-21 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000012"
down_revision = "20260420_000011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=True),
        sa.Column("workflow_run_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("resource_type", sa.String(length=100), server_default="workflow", nullable=False),
        sa.Column("resource_id", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_run_id"], ["workflow_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["id", "workflow_id", "workflow_run_id", "user_id", "event_type", "resource_id", "action", "created_at"]:
        op.create_index(op.f(f"ix_audit_logs_{column}"), "audit_logs", [column], unique=False)

    op.create_table(
        "workflow_comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["id", "workflow_id", "user_id", "node_id", "created_at"]:
        op.create_index(op.f(f"ix_workflow_comments_{column}"), "workflow_comments", [column], unique=False)

    op.create_table(
        "workflow_change_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("change_type", sa.String(length=100), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("before_json", sa.JSON(), nullable=True),
        sa.Column("after_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["id", "workflow_id", "user_id", "change_type", "created_at"]:
        op.create_index(op.f(f"ix_workflow_change_events_{column}"), "workflow_change_events", [column], unique=False)

    op.create_table(
        "workflow_subflows",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("graph_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["id", "workflow_id", "created_by_user_id", "created_at"]:
        op.create_index(op.f(f"ix_workflow_subflows_{column}"), "workflow_subflows", [column], unique=False)

    op.create_table(
        "rag_evaluations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("collection_name", sa.String(length=255), nullable=False),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("expected_answer", sa.Text(), nullable=True),
        sa.Column("retrieved_chunk_ids", sa.JSON(), nullable=False),
        sa.Column("retrieval_score", sa.Float(), nullable=True),
        sa.Column("hallucination_risk", sa.String(length=50), server_default="unknown", nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ["id", "workflow_id", "collection_name", "created_at"]:
        op.create_index(op.f(f"ix_rag_evaluations_{column}"), "rag_evaluations", [column], unique=False)


def downgrade() -> None:
    for table, columns in [
        ("rag_evaluations", ["created_at", "collection_name", "workflow_id", "id"]),
        ("workflow_subflows", ["created_at", "created_by_user_id", "workflow_id", "id"]),
        ("workflow_change_events", ["created_at", "change_type", "user_id", "workflow_id", "id"]),
        ("workflow_comments", ["created_at", "node_id", "user_id", "workflow_id", "id"]),
        ("audit_logs", ["created_at", "action", "resource_id", "event_type", "user_id", "workflow_run_id", "workflow_id", "id"]),
    ]:
        for column in columns:
            op.drop_index(op.f(f"ix_{table}_{column}"), table_name=table)
        op.drop_table(table)
