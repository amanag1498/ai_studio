"""Allow global file library uploads.

Revision ID: 20260420_000013
Revises: 20260420_000012
Create Date: 2026-04-22
"""

from alembic import op
import sqlalchemy as sa


revision = "20260420_000013"
down_revision = "20260420_000012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("uploaded_files") as batch_op:
        batch_op.alter_column("workflow_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("uploaded_files") as batch_op:
        batch_op.alter_column("workflow_id", existing_type=sa.Integer(), nullable=False)
