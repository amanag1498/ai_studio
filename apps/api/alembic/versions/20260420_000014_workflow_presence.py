"""workflow presence

Revision ID: 20260420_000014
Revises: 20260420_000013
Create Date: 2026-04-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000014"
down_revision = "20260420_000013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_presence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("session_id", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=True),
        sa.Column("cursor_json", sa.JSON(), nullable=False),
        sa.Column("graph_version", sa.Integer(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_id", "session_id", name="uq_workflow_presence_workflow_session"),
    )
    op.create_index(op.f("ix_workflow_presence_id"), "workflow_presence", ["id"], unique=False)
    op.create_index(op.f("ix_workflow_presence_workflow_id"), "workflow_presence", ["workflow_id"], unique=False)
    op.create_index(op.f("ix_workflow_presence_user_id"), "workflow_presence", ["user_id"], unique=False)
    op.create_index(op.f("ix_workflow_presence_session_id"), "workflow_presence", ["session_id"], unique=False)
    op.create_index(op.f("ix_workflow_presence_node_id"), "workflow_presence", ["node_id"], unique=False)
    op.create_index(op.f("ix_workflow_presence_last_seen_at"), "workflow_presence", ["last_seen_at"], unique=False)
    op.create_index(op.f("ix_workflow_presence_created_at"), "workflow_presence", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_workflow_presence_created_at"), table_name="workflow_presence")
    op.drop_index(op.f("ix_workflow_presence_last_seen_at"), table_name="workflow_presence")
    op.drop_index(op.f("ix_workflow_presence_node_id"), table_name="workflow_presence")
    op.drop_index(op.f("ix_workflow_presence_session_id"), table_name="workflow_presence")
    op.drop_index(op.f("ix_workflow_presence_user_id"), table_name="workflow_presence")
    op.drop_index(op.f("ix_workflow_presence_workflow_id"), table_name="workflow_presence")
    op.drop_index(op.f("ix_workflow_presence_id"), table_name="workflow_presence")
    op.drop_table("workflow_presence")

