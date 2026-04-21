"""workflow publish slug

Revision ID: 20260420_000008
Revises: 20260420_000007
Create Date: 2026-04-20 00:00:08.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000008"
down_revision = "20260420_000007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.add_column(sa.Column("published_slug", sa.String(length=255), nullable=True))
        batch_op.create_unique_constraint("uq_workflows_published_slug", ["published_slug"])


def downgrade() -> None:
    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.drop_constraint("uq_workflows_published_slug", type_="unique")
        batch_op.drop_column("published_slug")
