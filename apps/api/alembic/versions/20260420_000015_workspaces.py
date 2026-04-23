"""workspace tenancy foundation

Revision ID: 20260420_000015
Revises: 20260420_000014
Create Date: 2026-04-23
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260420_000015"
down_revision = "20260420_000014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("workflow_limit", sa.Integer(), server_default="100", nullable=False),
        sa.Column("monthly_run_limit", sa.Integer(), server_default="1000", nullable=False),
        sa.Column("storage_limit_mb", sa.Integer(), server_default="2048", nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["app_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_workspaces_slug"),
    )
    op.create_index(op.f("ix_workspaces_id"), "workspaces", ["id"], unique=False)
    op.create_index(op.f("ix_workspaces_slug"), "workspaces", ["slug"], unique=False)
    op.create_index(op.f("ix_workspaces_created_by_user_id"), "workspaces", ["created_by_user_id"], unique=False)
    op.create_index(op.f("ix_workspaces_created_at"), "workspaces", ["created_at"], unique=False)

    op.create_table(
        "workspace_memberships",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=50), server_default="member", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_memberships_workspace_user"),
    )
    op.create_index(op.f("ix_workspace_memberships_id"), "workspace_memberships", ["id"], unique=False)
    op.create_index(op.f("ix_workspace_memberships_workspace_id"), "workspace_memberships", ["workspace_id"], unique=False)
    op.create_index(op.f("ix_workspace_memberships_user_id"), "workspace_memberships", ["user_id"], unique=False)
    op.create_index(op.f("ix_workspace_memberships_created_at"), "workspace_memberships", ["created_at"], unique=False)

    with op.batch_alter_table("workflows") as batch_op:
        batch_op.add_column(sa.Column("workspace_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("published_visibility", sa.String(length=50), server_default="public", nullable=False))
        batch_op.add_column(sa.Column("publish_token_hash", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("is_template", sa.Boolean(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("template_scope", sa.String(length=50), nullable=True))
        batch_op.create_foreign_key("fk_workflows_workspace_id", "workspaces", ["workspace_id"], ["id"], ondelete="SET NULL")
    op.create_index(op.f("ix_workflows_workspace_id"), "workflows", ["workspace_id"], unique=False)
    op.create_index(op.f("ix_workflows_is_template"), "workflows", ["is_template"], unique=False)
    op.create_index(op.f("ix_workflows_template_scope"), "workflows", ["template_scope"], unique=False)

    with op.batch_alter_table("app_users") as batch_op:
        batch_op.add_column(sa.Column("default_workspace_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_app_users_default_workspace_id", "workspaces", ["default_workspace_id"], ["id"], ondelete="SET NULL")
    op.create_index(op.f("ix_app_users_default_workspace_id"), "app_users", ["default_workspace_id"], unique=False)

    op.execute(
        "INSERT INTO workspaces (name, slug, description, workflow_limit, monthly_run_limit, storage_limit_mb) "
        "VALUES ('Default Workspace', 'default-workspace', 'Migrated local workflows and users.', 500, 5000, 10240)"
    )
    op.execute("UPDATE workflows SET workspace_id = 1 WHERE workspace_id IS NULL")
    op.execute("UPDATE workflows SET is_template = 1, template_scope = 'system' WHERE description = 'Advanced seeded workflow for local testing.' OR name LIKE 'Basic:%' OR name LIKE 'Advanced:%'")
    op.execute("UPDATE app_users SET default_workspace_id = 1 WHERE default_workspace_id IS NULL")
    op.execute(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) "
        "SELECT 1, id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'viewer' END FROM app_users"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_app_users_default_workspace_id"), table_name="app_users")
    with op.batch_alter_table("app_users") as batch_op:
        batch_op.drop_constraint("fk_app_users_default_workspace_id", type_="foreignkey")
        batch_op.drop_column("default_workspace_id")

    op.drop_index(op.f("ix_workflows_template_scope"), table_name="workflows")
    op.drop_index(op.f("ix_workflows_is_template"), table_name="workflows")
    op.drop_index(op.f("ix_workflows_workspace_id"), table_name="workflows")
    with op.batch_alter_table("workflows") as batch_op:
        batch_op.drop_constraint("fk_workflows_workspace_id", type_="foreignkey")
        batch_op.drop_column("template_scope")
        batch_op.drop_column("is_template")
        batch_op.drop_column("publish_token_hash")
        batch_op.drop_column("published_visibility")
        batch_op.drop_column("workspace_id")

    op.drop_index(op.f("ix_workspace_memberships_created_at"), table_name="workspace_memberships")
    op.drop_index(op.f("ix_workspace_memberships_user_id"), table_name="workspace_memberships")
    op.drop_index(op.f("ix_workspace_memberships_workspace_id"), table_name="workspace_memberships")
    op.drop_index(op.f("ix_workspace_memberships_id"), table_name="workspace_memberships")
    op.drop_table("workspace_memberships")

    op.drop_index(op.f("ix_workspaces_created_at"), table_name="workspaces")
    op.drop_index(op.f("ix_workspaces_created_by_user_id"), table_name="workspaces")
    op.drop_index(op.f("ix_workspaces_slug"), table_name="workspaces")
    op.drop_index(op.f("ix_workspaces_id"), table_name="workspaces")
    op.drop_table("workspaces")
