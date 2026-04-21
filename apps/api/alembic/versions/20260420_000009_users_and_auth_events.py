"""users and auth events

Revision ID: 20260420_000009
Revises: 20260420_000008
Create Date: 2026-04-21 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000009"
down_revision = "20260420_000008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column("role", sa.String(length=50), server_default="user", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_app_users_email"),
    )
    op.create_index(op.f("ix_app_users_id"), "app_users", ["id"], unique=False)
    op.create_index(op.f("ix_app_users_email"), "app_users", ["email"], unique=False)

    op.create_table(
        "auth_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_auth_events_id"), "auth_events", ["id"], unique=False)
    op.create_index(op.f("ix_auth_events_user_id"), "auth_events", ["user_id"], unique=False)
    op.create_index(op.f("ix_auth_events_event_type"), "auth_events", ["event_type"], unique=False)
    op.create_index(op.f("ix_auth_events_email"), "auth_events", ["email"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_auth_events_email"), table_name="auth_events")
    op.drop_index(op.f("ix_auth_events_event_type"), table_name="auth_events")
    op.drop_index(op.f("ix_auth_events_user_id"), table_name="auth_events")
    op.drop_index(op.f("ix_auth_events_id"), table_name="auth_events")
    op.drop_table("auth_events")
    op.drop_index(op.f("ix_app_users_email"), table_name="app_users")
    op.drop_index(op.f("ix_app_users_id"), table_name="app_users")
    op.drop_table("app_users")
