"""workflow ownership lifecycle

Revision ID: 20260420_000010
Revises: 20260420_000009
Create Date: 2026-04-21 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000010"
down_revision = "20260420_000009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.add_column(sa.Column("created_by_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("updated_by_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
        batch_op.create_foreign_key("fk_workflows_created_by_user_id", "app_users", ["created_by_user_id"], ["id"], ondelete="SET NULL")
        batch_op.create_foreign_key("fk_workflows_updated_by_user_id", "app_users", ["updated_by_user_id"], ["id"], ondelete="SET NULL")
        batch_op.create_index("ix_workflows_created_by_user_id", ["created_by_user_id"])
        batch_op.create_index("ix_workflows_updated_by_user_id", ["updated_by_user_id"])
        batch_op.create_index("ix_workflows_archived_at", ["archived_at"])

    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("owner_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("session_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("runtime_user_id", sa.String(length=255), nullable=True))
        batch_op.create_foreign_key("fk_workflow_runs_owner_user_id", "app_users", ["owner_user_id"], ["id"], ondelete="SET NULL")
        batch_op.create_index("ix_workflow_runs_owner_user_id", ["owner_user_id"])
        batch_op.create_index("ix_workflow_runs_session_id", ["session_id"])
        batch_op.create_index("ix_workflow_runs_runtime_user_id", ["runtime_user_id"])


def downgrade() -> None:
    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.drop_index("ix_workflow_runs_runtime_user_id")
        batch_op.drop_index("ix_workflow_runs_session_id")
        batch_op.drop_index("ix_workflow_runs_owner_user_id")
        batch_op.drop_constraint("fk_workflow_runs_owner_user_id", type_="foreignkey")
        batch_op.drop_column("runtime_user_id")
        batch_op.drop_column("session_id")
        batch_op.drop_column("owner_user_id")

    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.drop_index("ix_workflows_archived_at")
        batch_op.drop_index("ix_workflows_updated_by_user_id")
        batch_op.drop_index("ix_workflows_created_by_user_id")
        batch_op.drop_constraint("fk_workflows_updated_by_user_id", type_="foreignkey")
        batch_op.drop_constraint("fk_workflows_created_by_user_id", type_="foreignkey")
        batch_op.drop_column("archived_at")
        batch_op.drop_column("updated_by_user_id")
        batch_op.drop_column("created_by_user_id")
