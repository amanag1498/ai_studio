"""workflow permissions

Revision ID: 20260420_000011
Revises: 20260420_000010
Create Date: 2026-04-21 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000011"
down_revision = "20260420_000010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workflow_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=50), server_default="viewer", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workflow_id", "user_id", name="uq_workflow_permissions_workflow_user"),
    )
    op.create_index(op.f("ix_workflow_permissions_id"), "workflow_permissions", ["id"], unique=False)
    op.create_index(op.f("ix_workflow_permissions_user_id"), "workflow_permissions", ["user_id"], unique=False)
    op.create_index(op.f("ix_workflow_permissions_workflow_id"), "workflow_permissions", ["workflow_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_workflow_permissions_workflow_id"), table_name="workflow_permissions")
    op.drop_index(op.f("ix_workflow_permissions_user_id"), table_name="workflow_permissions")
    op.drop_index(op.f("ix_workflow_permissions_id"), table_name="workflow_permissions")
    op.drop_table("workflow_permissions")
