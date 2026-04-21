"""conversation memory messages

Revision ID: 20260420_000006
Revises: 20260420_000005
Create Date: 2026-04-20 00:00:06.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000006"
down_revision = "20260420_000005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversation_memory_messages",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("workflow_run_id", sa.Integer(), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("session_id", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("namespace", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False, server_default="message"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_run_id"], ["workflow_runs.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_conversation_memory_messages_workflow_id", "conversation_memory_messages", ["workflow_id"])
    op.create_index("ix_conversation_memory_messages_workflow_run_id", "conversation_memory_messages", ["workflow_run_id"])
    op.create_index("ix_conversation_memory_messages_node_id", "conversation_memory_messages", ["node_id"])
    op.create_index("ix_conversation_memory_messages_session_id", "conversation_memory_messages", ["session_id"])
    op.create_index("ix_conversation_memory_messages_user_id", "conversation_memory_messages", ["user_id"])
    op.create_index("ix_conversation_memory_messages_namespace", "conversation_memory_messages", ["namespace"])


def downgrade() -> None:
    op.drop_index("ix_conversation_memory_messages_namespace", table_name="conversation_memory_messages")
    op.drop_index("ix_conversation_memory_messages_user_id", table_name="conversation_memory_messages")
    op.drop_index("ix_conversation_memory_messages_session_id", table_name="conversation_memory_messages")
    op.drop_index("ix_conversation_memory_messages_node_id", table_name="conversation_memory_messages")
    op.drop_index("ix_conversation_memory_messages_workflow_run_id", table_name="conversation_memory_messages")
    op.drop_index("ix_conversation_memory_messages_workflow_id", table_name="conversation_memory_messages")
    op.drop_table("conversation_memory_messages")
