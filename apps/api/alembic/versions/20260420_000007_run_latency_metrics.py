"""run latency metrics

Revision ID: 20260420_000007
Revises: 20260420_000006
Create Date: 2026-04-20 00:00:07.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000007"
down_revision = "20260420_000006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("latency_ms", sa.Integer(), nullable=True))

    with op.batch_alter_table("workflow_node_runs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("latency_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("workflow_node_runs", schema=None) as batch_op:
        batch_op.drop_column("latency_ms")

    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.drop_column("latency_ms")
