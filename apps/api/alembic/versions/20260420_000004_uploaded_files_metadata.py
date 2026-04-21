"""uploaded files metadata

Revision ID: 20260420_000004
Revises: 20260420_000003
Create Date: 2026-04-20 00:00:04.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000004"
down_revision = "20260420_000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uploaded_files",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("workflow_run_id", sa.Integer(), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("stored_name", sa.String(length=255), nullable=False),
        sa.Column("extension", sa.String(length=20), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_run_id"], ["workflow_runs.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_uploaded_files_workflow_id", "uploaded_files", ["workflow_id"])
    op.create_index("ix_uploaded_files_workflow_run_id", "uploaded_files", ["workflow_run_id"])
    op.create_index("ix_uploaded_files_node_id", "uploaded_files", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_uploaded_files_node_id", table_name="uploaded_files")
    op.drop_index("ix_uploaded_files_workflow_run_id", table_name="uploaded_files")
    op.drop_index("ix_uploaded_files_workflow_id", table_name="uploaded_files")
    op.drop_table("uploaded_files")
