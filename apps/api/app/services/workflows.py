from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.block_registry import BLOCK_DEFINITIONS, is_port_compatible, validate_block_config
from app.models.workflow import Workflow, WorkflowEdge, WorkflowNode, WorkflowVersion
from app.schemas.workflows import BuilderEdgePayload, BuilderGraphPayload, BuilderNodePayload


@dataclass
class ValidatedGraph:
    graph_json: dict[str, Any]
    nodes: list[BuilderNodePayload]
    edges: list[BuilderEdgePayload]


def validate_graph(graph: BuilderGraphPayload) -> ValidatedGraph:
    node_map = {node.id: node for node in graph.nodes}
    if len(node_map) != len(graph.nodes):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Node IDs must be unique.")

    edge_ids = {edge.id for edge in graph.edges}
    if len(edge_ids) != len(graph.edges):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Edge IDs must be unique.")

    errors: list[str] = []

    for node in graph.nodes:
        if node.type != "builderBlock":
            errors.append(f"Node '{node.id}' must use type 'builderBlock'.")
        definition = BLOCK_DEFINITIONS.get(node.data.blockType)
        if definition is None:
            errors.append(f"Node '{node.id}' uses unsupported block type '{node.data.blockType}'.")
            continue

        errors.extend(validate_block_config(node.data.blockType, node.data.config))

    for edge in graph.edges:
        source_node = node_map.get(edge.source)
        target_node = node_map.get(edge.target)

        if source_node is None:
            errors.append(f"Edge '{edge.id}' references unknown source node '{edge.source}'.")
            continue
        if target_node is None:
            errors.append(f"Edge '{edge.id}' references unknown target node '{edge.target}'.")
            continue

        source_definition = BLOCK_DEFINITIONS.get(source_node.data.blockType)
        target_definition = BLOCK_DEFINITIONS.get(target_node.data.blockType)
        if source_definition is None or target_definition is None:
            continue

        source_port_id = _extract_handle_port_id(edge.sourceHandle, "out")
        target_port_id = _extract_handle_port_id(edge.targetHandle, "in")
        if source_port_id is None or target_port_id is None:
            errors.append(
                f"Edge '{edge.id}' must include both sourceHandle and targetHandle using out:/in: prefixes."
            )
            continue

        source_port = next((port for port in source_definition.outputs if port.id == source_port_id), None)
        target_port = next((port for port in target_definition.inputs if port.id == target_port_id), None)

        if source_port is None:
            errors.append(f"Edge '{edge.id}' references unknown source handle '{edge.sourceHandle}'.")
            continue
        if target_port is None:
            errors.append(f"Edge '{edge.id}' references unknown target handle '{edge.targetHandle}'.")
            continue
        if not is_port_compatible(source_port.data_types, target_port.data_types):
            errors.append(
                f"Edge '{edge.id}' connects incompatible ports '{edge.sourceHandle}' and '{edge.targetHandle}'."
            )

    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)

    return ValidatedGraph(graph_json=graph.model_dump(mode="json"), nodes=graph.nodes, edges=graph.edges)


def list_workflows(session: Session, *, include_archived: bool = False) -> list[Workflow]:
    statement = select(Workflow)
    if not include_archived:
        statement = statement.where(Workflow.archived_at.is_(None))
    statement = statement.order_by(Workflow.updated_at.desc())
    return list(session.scalars(statement))


def get_workflow_or_404(session: Session, workflow_id: int) -> Workflow:
    statement = (
        select(Workflow)
        .where(Workflow.id == workflow_id)
        .options(
            selectinload(Workflow.nodes),
            selectinload(Workflow.edges),
            selectinload(Workflow.versions),
        )
    )
    workflow = session.scalar(statement)
    if workflow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found.")
    return workflow


def create_workflow(
    session: Session,
    *,
    name: str,
    description: str | None,
    validated_graph: ValidatedGraph,
    user_id: int | None = None,
) -> Workflow:
    workflow = Workflow(
        name=name,
        description=description,
        status="draft",
        current_version=validated_graph.graph_json["version"],
        latest_saved_version=0,
        graph_json=validated_graph.graph_json,
        created_by_user_id=user_id,
        updated_by_user_id=user_id,
    )
    session.add(workflow)
    session.flush()
    _replace_normalized_graph(session, workflow, validated_graph)
    session.commit()
    session.refresh(workflow)
    return get_workflow_or_404(session, workflow.id)


def update_workflow(
    session: Session,
    workflow: Workflow,
    *,
    name: str,
    description: str | None,
    status_value: str | None,
    validated_graph: ValidatedGraph,
    user_id: int | None = None,
) -> Workflow:
    workflow.name = name
    workflow.description = description
    workflow.graph_json = validated_graph.graph_json
    workflow.current_version = validated_graph.graph_json["version"]
    workflow.updated_by_user_id = user_id
    if status_value:
        workflow.status = status_value

    _replace_normalized_graph(session, workflow, validated_graph)
    session.add(workflow)
    session.commit()
    session.refresh(workflow)
    return get_workflow_or_404(session, workflow.id)


def archive_workflow(session: Session, workflow: Workflow, *, user_id: int | None = None) -> Workflow:
    workflow.archived_at = datetime.now(timezone.utc).replace(tzinfo=None)
    workflow.status = "archived"
    workflow.updated_by_user_id = user_id
    session.add(workflow)
    session.commit()
    return get_workflow_or_404(session, workflow.id)


def restore_workflow(session: Session, workflow: Workflow, *, user_id: int | None = None) -> Workflow:
    workflow.archived_at = None
    workflow.status = "draft"
    workflow.updated_by_user_id = user_id
    session.add(workflow)
    session.commit()
    return get_workflow_or_404(session, workflow.id)


def duplicate_workflow(session: Session, workflow: Workflow, *, user_id: int | None = None) -> Workflow:
    graph_json = dict(workflow.graph_json)
    graph_json["id"] = f"{graph_json.get('id', 'workflow')}-copy"
    graph_json["name"] = f"{workflow.name} Copy"
    validated_graph = validate_graph(BuilderGraphPayload.model_validate(graph_json))
    return create_workflow(
        session,
        name=graph_json["name"],
        description=workflow.description,
        validated_graph=validated_graph,
        user_id=user_id,
    )


def save_workflow_version(
    session: Session,
    workflow: Workflow,
    *,
    version_note: str | None,
    validated_graph: ValidatedGraph,
) -> WorkflowVersion:
    next_version_number = workflow.latest_saved_version + 1
    versioned_graph_json = {**validated_graph.graph_json, "version": next_version_number}
    versioned_graph = ValidatedGraph(
        graph_json=versioned_graph_json,
        nodes=validated_graph.nodes,
        edges=validated_graph.edges,
    )
    workflow.graph_json = versioned_graph.graph_json
    workflow.current_version = next_version_number
    workflow.latest_saved_version = next_version_number

    _replace_normalized_graph(session, workflow, versioned_graph)

    version = WorkflowVersion(
        workflow_id=workflow.id,
        version_number=next_version_number,
        version_note=version_note,
        graph_json=versioned_graph.graph_json,
    )
    session.add(version)
    session.add(workflow)
    session.commit()
    session.refresh(version)
    return version


def _replace_normalized_graph(session: Session, workflow: Workflow, validated_graph: ValidatedGraph) -> None:
    workflow.nodes.clear()
    workflow.edges.clear()
    session.flush()

    for node in validated_graph.nodes:
        workflow.nodes.append(
            WorkflowNode(
                node_id=node.id,
                block_type=node.data.blockType,
                label=node.data.label,
                node_type=node.type,
                kind=node.data.kind,
                category=node.data.category,
                position_x=node.position.x,
                position_y=node.position.y,
                config_json=node.data.config,
                definition_json=node.data.model_dump(mode="json"),
            )
        )

    for edge in validated_graph.edges:
        workflow.edges.append(
            WorkflowEdge(
                edge_id=edge.id,
                source_node_id=edge.source,
                target_node_id=edge.target,
                source_handle=edge.sourceHandle,
                target_handle=edge.targetHandle,
                label=edge.label,
                edge_json=edge.model_dump(mode="json"),
            )
        )


def _extract_handle_port_id(handle: str | None, expected_prefix: str) -> str | None:
    prefix = f"{expected_prefix}:"
    if handle is None or not handle.startswith(prefix):
        return None
    return handle[len(prefix) :]
