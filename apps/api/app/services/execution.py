from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.models.workflow import (
    ConversationMemoryMessage,
    UploadedFile,
    Workflow,
    WorkflowNodeRun,
    WorkflowRun,
)
from app.schemas.execution import ExecuteWorkflowRequest, RuntimeNodeInput
from app.schemas.workflows import BuilderGraphPayload
from app.services.files import parse_accept_extensions, parse_max_size_bytes, persist_uploaded_file
from app.services.database_query import execute_database_query as run_database_query
from app.services.database_query import introspect_schema, is_read_only_sql
from app.services.delivery import get_email_provider, get_notification_provider, split_recipients
from app.services.llm import LlmMessage, LlmProvider, get_default_llm_provider
from app.services.parsers import parse_uploaded_file
from app.services.rag import (
    build_rag_config,
    clear_collection_records,
    ingest_documents,
    retrieve_relevant_chunks,
    should_ingest_documents,
    should_retrieve_chunks,
)
from app.services.workflows import get_workflow_or_404, validate_graph
from app.services.web_reader import fetch_readable_page
from app.services.web_search import get_web_search_provider


OUTPUT_BLOCK_TYPES = {
    "chat_output",
    "json_output",
    "dashboard_preview",
    "logger",
    "citation_formatter",
    "email_sender",
    "email",
    "slack_notification",
    "notification",
    "csv_excel_export",
    "database_writer",
    "database_query",
}


@dataclass
class TypedPayload:
    data_type: str
    value: Any
    preview: Any
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.data_type,
            "value": self.value,
            "preview": self.preview,
            "metadata": self.metadata,
        }


@dataclass
class NodeExecutionResult:
    outputs: dict[str, TypedPayload]
    preview: dict[str, Any]
    logs: list[dict[str, Any]]


@dataclass
class ExecutionContext:
    session: Session
    workflow: Workflow
    workflow_run: WorkflowRun
    runtime_inputs: dict[str, RuntimeNodeInput]
    node_inputs: dict[str, dict[str, list[TypedPayload]]]
    node_outputs: dict[str, dict[str, TypedPayload]]
    memory_store: dict[str, list[str]]
    run_logs: list[dict[str, Any]]
    uploaded_files_by_node: dict[str, list[UploadedFile]]
    session_id: str = "default-session"
    user_id: str = "local-user"


def execute_workflow(
    session: Session,
    workflow_id: int,
    payload: ExecuteWorkflowRequest,
    *,
    owner_user_id: int | None = None,
) -> WorkflowRun:
    workflow = get_workflow_or_404(session, workflow_id)
    graph = validate_graph_json(workflow.graph_json)
    workflow_run = create_workflow_run(
        session,
        workflow=workflow,
        graph=graph,
        payload=payload,
        owner_user_id=owner_user_id,
        status_value="running",
    )
    return execute_prepared_workflow_run(session, workflow_run.id, payload)


def create_workflow_run(
    session: Session,
    *,
    workflow: Workflow,
    graph: dict[str, Any],
    payload: ExecuteWorkflowRequest,
    owner_user_id: int | None,
    status_value: str = "queued",
) -> WorkflowRun:
    workflow_run = WorkflowRun(
        workflow_id=workflow.id,
        status=status_value,
        trigger_mode=payload.trigger_mode,
        owner_user_id=owner_user_id,
        session_id=payload.session_id,
        runtime_user_id=payload.user_id,
        graph_version=graph["version"],
        graph_snapshot=graph,
        input_payload=_runtime_inputs_to_dict(payload.inputs),
        output_payload={},
        preview_payload={},
        log_messages=[],
    )
    session.add(workflow_run)
    session.flush()
    session.commit()
    return get_run_or_404(session, workflow.id, workflow_run.id)


def execute_prepared_workflow_run(
    session: Session,
    workflow_run_id: int,
    payload: ExecuteWorkflowRequest,
) -> WorkflowRun:
    workflow_run = session.get(WorkflowRun, workflow_run_id)
    if workflow_run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow run not found.")
    workflow = get_workflow_or_404(session, workflow_run.workflow_id)
    graph = validate_graph_json(workflow_run.graph_snapshot or workflow.graph_json)
    ordered_nodes, outgoing_edges = topological_order(graph)
    workflow_started_perf = perf_counter()
    workflow_run.status = "running"
    workflow_run.started_at = utc_now_naive()
    workflow_run.log_messages = list(workflow_run.log_messages or []) + [log_entry("info", "Workflow run started.")]
    workflow_audit_logs = list(workflow_run.log_messages or [])
    session.add(workflow_run)
    session.commit()

    context = ExecutionContext(
        session=session,
        workflow=workflow,
        workflow_run=workflow_run,
        runtime_inputs=payload.inputs,
        node_inputs=collect_node_inputs(graph),
        node_outputs={},
        memory_store={},
        run_logs=[],
        uploaded_files_by_node=defaultdict(list),
        session_id=payload.session_id,
        user_id=payload.user_id,
    )

    final_outputs: dict[str, Any] = {}
    preview_outputs: dict[str, Any] = {}

    try:
        for execution_index, node in enumerate(ordered_nodes):
            session.refresh(workflow_run)
            if workflow_run.status == "cancelled":
                workflow_run.completed_at = utc_now_naive()
                workflow_run.latency_ms = elapsed_ms(workflow_started_perf)
                workflow_run.output_payload = final_outputs
                workflow_run.preview_payload = preview_outputs
                workflow_run.log_messages = workflow_audit_logs + context.run_logs + [log_entry("warning", "Workflow run cancelled before the next node started.")]
                session.add(workflow_run)
                session.commit()
                return get_run_or_404(session, workflow.id, workflow_run.id)

            node_started_perf = perf_counter()
            node_run = WorkflowNodeRun(
                workflow_run_id=workflow_run.id,
                node_id=node["id"],
                block_type=node["data"]["blockType"],
                status="running",
                execution_index=execution_index,
                input_payload=serialize_node_inputs(context.node_inputs.get(node["id"], {})),
                output_payload={},
                preview_payload={},
                log_messages=[],
            )
            session.add(node_run)
            session.flush()

            try:
                result = execute_node(node, context)
                context.node_outputs[node["id"]] = result.outputs
                node_run.status = "completed"
                node_run.completed_at = utc_now_naive()
                node_run.latency_ms = elapsed_ms(node_started_perf)
                node_run.output_payload = {name: payload.to_dict() for name, payload in result.outputs.items()}
                node_run.preview_payload = result.preview
                node_run.log_messages = result.logs
                context.run_logs.extend(result.logs)

                for edge in outgoing_edges[node["id"]]:
                    source_port = extract_port_id(edge.get("sourceHandle"), "out")
                    target_port = extract_port_id(edge.get("targetHandle"), "in")
                    if source_port is None or target_port is None:
                        continue
                    payload_to_route = result.outputs.get(source_port)
                    if payload_to_route is None:
                        continue
                    context.node_inputs[edge["target"]][target_port].append(payload_to_route)

                if node["data"]["blockType"] in OUTPUT_BLOCK_TYPES:
                    final_outputs[node["id"]] = node_run.output_payload
                    preview_outputs[node["id"]] = node_run.preview_payload
            except Exception as exc:  # noqa: BLE001
                node_run.status = "failed"
                node_run.completed_at = utc_now_naive()
                node_run.latency_ms = elapsed_ms(node_started_perf)
                node_run.error_message = str(exc)
                node_run.log_messages = node_run.log_messages + [
                    {"level": "error", "message": str(exc), "timestamp": iso_now()}
                ]
                workflow_run.status = "failed"
                workflow_run.completed_at = utc_now_naive()
                workflow_run.latency_ms = elapsed_ms(workflow_started_perf)
                workflow_run.error_message = f"Node '{node['id']}' failed: {exc}"
                workflow_run.output_payload = final_outputs
                workflow_run.preview_payload = preview_outputs
                workflow_run.log_messages = workflow_audit_logs + context.run_logs + node_run.log_messages
                session.add(workflow_run)
                session.commit()
                return get_run_or_404(session, workflow.id, workflow_run.id)

        workflow_run.status = "completed"
        workflow_run.completed_at = utc_now_naive()
        workflow_run.latency_ms = elapsed_ms(workflow_started_perf)
        workflow_run.output_payload = final_outputs
        workflow_run.preview_payload = preview_outputs
        workflow_run.log_messages = workflow_audit_logs + context.run_logs
        session.add(workflow_run)
        session.commit()
        return get_run_or_404(session, workflow.id, workflow_run.id)
    except HTTPException:
        session.rollback()
        raise


def get_run_or_404(session: Session, workflow_id: int, run_id: int) -> WorkflowRun:
    statement = (
        select(WorkflowRun)
        .where(WorkflowRun.id == run_id, WorkflowRun.workflow_id == workflow_id)
        .options(selectinload(WorkflowRun.node_runs))
    )
    workflow_run = session.scalar(statement)
    if workflow_run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow run not found.")
    return workflow_run


def validate_graph_json(graph_json: dict[str, Any]) -> dict[str, Any]:
    payload = BuilderGraphPayload.model_validate(graph_json)
    validated = validate_graph(payload)
    return validated.graph_json


def topological_order(
    graph: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    nodes = graph["nodes"]
    edges = graph["edges"]
    node_map = {node["id"]: node for node in nodes}
    indegree = {node["id"]: 0 for node in nodes}
    outgoing_edges: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for edge in edges:
        outgoing_edges[edge["source"]].append(edge)
        indegree[edge["target"]] += 1

    queue = deque(node_id for node_id, degree in indegree.items() if degree == 0)
    ordered_node_ids: list[str] = []

    while queue:
        node_id = queue.popleft()
        ordered_node_ids.append(node_id)
        for edge in outgoing_edges[node_id]:
            indegree[edge["target"]] -= 1
            if indegree[edge["target"]] == 0:
                queue.append(edge["target"])

    if len(ordered_node_ids) != len(nodes):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Workflow graph must be a DAG for execution.",
        )

    return [node_map[node_id] for node_id in ordered_node_ids], outgoing_edges


def collect_node_inputs(graph: dict[str, Any]) -> dict[str, dict[str, list[TypedPayload]]]:
    node_inputs: dict[str, dict[str, list[TypedPayload]]] = {}
    for node in graph["nodes"]:
        node_inputs[node["id"]] = {
            input_port["id"]: [] for input_port in node["data"].get("inputs", [])
        }
    return node_inputs


def serialize_node_inputs(node_inputs: dict[str, list[TypedPayload]]) -> dict[str, list[dict[str, Any]]]:
    return {
        port_id: [payload.to_dict() for payload in payloads]
        for port_id, payloads in node_inputs.items()
    }


def execute_node(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    block_type = node["data"]["blockType"]
    if block_type == "chat_input":
        return execute_chat_input(node, context)
    if block_type == "text_input":
        return execute_text_input(node, context)
    if block_type == "file_upload":
        return execute_file_upload(node, context)
    if block_type == "text_extraction":
        return execute_text_extraction(node, context)
    if block_type == "ocr":
        return execute_ocr(node, context)
    if block_type == "rag_knowledge":
        return execute_rag_knowledge(node, context)
    if block_type == "chatbot":
        return execute_chatbot(node, context)
    if block_type == "summarizer":
        return execute_summarizer(node, context)
    if block_type == "classifier":
        return execute_classifier(node, context)
    if block_type == "extraction_ai":
        return execute_extraction_ai(node, context)
    if block_type == "prompt_template":
        return execute_prompt_template(node, context)
    if block_type == "document_splitter":
        return execute_document_splitter(node, context)
    if block_type == "table_extractor":
        return execute_table_extractor(node, context)
    if block_type == "schema_validator":
        return execute_schema_validator(node, context)
    if block_type == "retry_fallback_llm":
        return execute_retry_fallback_llm(node, context)
    if block_type == "citation_formatter":
        return execute_citation_formatter(node, context)
    if block_type == "form_input":
        return execute_form_input(node, context)
    if block_type == "webhook_trigger":
        return execute_webhook_trigger(node, context)
    if block_type == "http_request":
        return execute_http_request(node, context)
    if block_type == "data_mapper":
        return execute_data_mapper(node, context)
    if block_type == "loop_for_each":
        return execute_loop_for_each(node, context)
    if block_type == "approval_step":
        return execute_approval_step(node, context)
    if block_type in {"email_sender", "email"}:
        return execute_email_sender(node, context)
    if block_type in {"slack_notification", "notification"}:
        return execute_slack_notification(node, context)
    if block_type == "database_writer":
        return execute_database_writer(node, context)
    if block_type == "csv_excel_export":
        return execute_csv_excel_export(node, context)
    if block_type == "pii_redactor":
        return execute_pii_redactor(node, context)
    if block_type == "guardrail":
        return execute_guardrail(node, context)
    if block_type == "router_switch":
        return execute_router_switch(node, context)
    if block_type == "long_term_memory":
        return execute_long_term_memory(node, context)
    if block_type == "web_search":
        return execute_web_search(node, context)
    if block_type == "web_page_reader":
        return execute_web_page_reader(node, context)
    if block_type == "database_query":
        return execute_database_query_node(node, context)
    if block_type == "sql_assistant":
        return execute_sql_assistant(node, context)
    if block_type == "browser_agent":
        return execute_browser_agent(node, context)
    if block_type == "re_ranker":
        return execute_re_ranker(node, context)
    if block_type == "query_rewriter":
        return execute_query_rewriter(node, context)
    if block_type == "citation_verifier":
        return execute_citation_verifier(node, context)
    if block_type == "conversation_memory":
        return execute_conversation_memory(node, context)
    if block_type == "merge":
        return execute_merge(node, context)
    if block_type == "condition":
        return execute_condition(node, context)
    if block_type == "chat_output":
        return execute_chat_output(node, context)
    if block_type == "json_output":
        return execute_json_output(node, context)
    if block_type == "dashboard_preview":
        return execute_dashboard_preview(node, context)
    if block_type == "logger":
        return execute_logger(node, context)
    raise ValueError(f"Unsupported executor for block type '{block_type}'.")


def execute_chat_input(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    runtime = context.runtime_inputs.get(node["id"])
    placeholder = str(node["data"]["config"].get("placeholder", ""))
    message = runtime.value if runtime and runtime.value is not None else placeholder
    payload = typed_payload("chat", message, preview_text(message), {"source": "runtime"})
    return single_output_result(
        "message",
        payload,
        node["data"]["label"],
        f"Chat input received {len(str(message))} characters.",
    )


def execute_text_input(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    runtime = context.runtime_inputs.get(node["id"])
    value = runtime.value if runtime and runtime.value is not None else node["data"]["config"].get("defaultText", "")
    payload = typed_payload("text", value, preview_text(value), {"source": "config_or_runtime"})
    return single_output_result("text", payload, node["data"]["label"], "Text input prepared.")


def execute_file_upload(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    runtime = context.runtime_inputs.get(node["id"])
    files = runtime.files if runtime else []
    if not files and runtime and isinstance(runtime.value, list):
        files = [str(item) for item in runtime.value]
    source_mode = str(node["data"]["config"].get("sourceMode", "runtime_or_library"))
    library_file_ids: list[int] = []
    library_files: list[UploadedFile] = []

    # Runtime uploads are an explicit user action, so they always win over saved
    # library/default configuration. This keeps reusable workflows from quietly
    # answering from an old sample document after the user chooses a new file.
    if not files and source_mode in {"runtime_or_library", "library"}:
        library_file_ids = parse_library_file_ids(node["data"]["config"].get("libraryFileIds"))
        library_files = load_library_files(context, library_file_ids)
    if not files and not library_files and source_mode in {"runtime_or_library", "default_path"}:
        files = parse_default_file_paths(node["data"]["config"].get("defaultLocalPaths"))
    if not files and not library_files:
        raise ValueError("File Upload node requires runtime file paths.")

    max_size_bytes = parse_max_size_bytes(node["data"]["config"])
    accepted_extensions = parse_accept_extensions(node["data"]["config"].get("accept"))
    persisted_files: list[UploadedFile] = []
    persisted_file_metadata: list[dict[str, Any]] = []
    for library_file in library_files:
        if library_file.extension not in accepted_extensions:
            raise ValueError(
                f"Library file '{library_file.original_name}' has extension '{library_file.extension}'. "
                f"Allowed types: {', '.join(sorted(accepted_extensions))}."
            )
        if library_file.size_bytes > max_size_bytes:
            raise ValueError(f"Library file '{library_file.original_name}' exceeds max upload size of {max_size_bytes} bytes.")
        context.uploaded_files_by_node[node["id"]].append(library_file)
        persisted_files.append(library_file)
        persisted_file_metadata.append(uploaded_file_metadata(library_file, source="file_library"))
    for file_path in files:
        resolved = resolve_runtime_file_path(file_path)
        uploaded_file = persist_uploaded_file(
            context.session,
            source_path=resolved,
            workflow=context.workflow,
            workflow_run=context.workflow_run,
            node_id=node["id"],
            max_size_bytes=max_size_bytes,
            accepted_extensions=accepted_extensions,
        )
        context.uploaded_files_by_node[node["id"]].append(uploaded_file)
        persisted_files.append(uploaded_file)
        persisted_file_metadata.append(uploaded_file_metadata(uploaded_file, source="runtime_or_default_path"))

    payload = typed_payload(
        "file",
        persisted_file_metadata,
        {"files": persisted_file_metadata, "count": len(persisted_file_metadata)},
        {"count": len(persisted_file_metadata)},
    )
    metadata_payload = typed_payload(
        "json",
        {
            "files": persisted_file_metadata,
            "accepted_extensions": sorted(accepted_extensions),
            "max_size_bytes": max_size_bytes,
            "source_mode": source_mode,
            "library_file_ids": library_file_ids,
            "count": len(persisted_file_metadata),
        },
        {"count": len(persisted_file_metadata), "extensions": sorted({file["extension"] for file in persisted_file_metadata})},
        {"count": len(persisted_file_metadata)},
    )
    return NodeExecutionResult(
        outputs={"file": payload, "metadata": metadata_payload},
        preview={"label": node["data"]["label"], "output": payload.preview, "metadata": metadata_payload.preview},
        logs=[log_entry("info", f"{len(persisted_files)} file(s) staged.")],
    )


def uploaded_file_metadata(uploaded_file: UploadedFile, *, source: str) -> dict[str, Any]:
    return {
        "id": uploaded_file.id,
        "original_name": uploaded_file.original_name,
        "storage_path": uploaded_file.storage_path,
        "extension": uploaded_file.extension,
        "size_bytes": uploaded_file.size_bytes,
        "mime_type": uploaded_file.mime_type,
        "source": source,
    }


def parse_library_file_ids(value: Any) -> list[int]:
    if value is None:
        return []
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = str(value).replace("\n", ",").split(",")
    ids: list[int] = []
    for item in raw_items:
        text = str(item).strip()
        if not text:
            continue
        try:
            ids.append(int(text))
        except ValueError:
            raise ValueError(f"Invalid File Library id '{text}'.")
    return ids


def load_library_files(context: ExecutionContext, file_ids: list[int]) -> list[UploadedFile]:
    if not file_ids:
        return []
    files = list(context.session.scalars(select(UploadedFile).where(UploadedFile.id.in_(file_ids))))
    found_ids = {file.id for file in files}
    missing_ids = [file_id for file_id in file_ids if file_id not in found_ids]
    if missing_ids:
        raise ValueError(f"File Library file(s) not found: {', '.join(str(file_id) for file_id in missing_ids)}.")
    return files


def parse_default_file_paths(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not isinstance(value, str):
        return []

    paths: list[str] = []
    for item in value.replace(",", "\n").splitlines():
        path = item.strip()
        if path:
            paths.append(path)
    return paths


def resolve_runtime_file_path(file_path: str) -> Path:
    path = Path(file_path)
    if path.is_absolute():
        return path

    repo_root = Path(settings.app_storage_dir).resolve().parent
    return (repo_root / path).resolve()


def build_extraction_quality_report(uploaded_file: UploadedFile, text: str, parser_metadata: dict[str, Any]) -> dict[str, Any]:
    words = re.findall(r"\w+", text)
    warnings: list[str] = []
    if not text.strip():
        warnings.append("No extractable text found. Try the OCR block/strategy for scanned or image-heavy files.")
    if uploaded_file.extension == ".pdf" and parser_metadata.get("page_count") and len(words) < 20:
        warnings.append("PDF text is very short for its page count; it may be scanned or image-heavy.")
    detected_tables = int(parser_metadata.get("row_count", 0) or text.count("\n|"))
    return {
        "file_id": uploaded_file.id,
        "file_name": uploaded_file.original_name,
        "parser": parser_metadata.get("parser", "unknown"),
        "extension": uploaded_file.extension,
        "page_count": parser_metadata.get("page_count"),
        "line_count": parser_metadata.get("line_count", len(text.splitlines())),
        "word_count": len(words),
        "character_count": len(text),
        "detected_tables": detected_tables,
        "warnings": warnings,
        "preview_snippet": preview_text(text, 500),
    }


def summarize_extraction_quality(quality_reports: list[dict[str, Any]], failed_documents: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "parser_names": sorted({str(report.get("parser")) for report in quality_reports if report.get("parser")}),
        "document_count": len(quality_reports),
        "failed_count": len(failed_documents),
        "total_words": sum(int(report.get("word_count", 0) or 0) for report in quality_reports),
        "total_characters": sum(int(report.get("character_count", 0) or 0) for report in quality_reports),
        "total_detected_tables": sum(int(report.get("detected_tables", 0) or 0) for report in quality_reports),
        "warnings": [warning for report in quality_reports for warning in report.get("warnings", [])],
        "documents": quality_reports,
    }


def execute_text_extraction(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    file_payloads = context.node_inputs[node["id"]].get("file", [])
    if not file_payloads:
        raise ValueError("Text Extraction requires a file input.")

    strategy = str(node["data"]["config"].get("strategy", "auto"))
    include_quality_report = bool(node["data"]["config"].get("qualityReport", True))
    extracted_documents: list[dict[str, Any]] = []
    combined_text_parts: list[str] = []
    quality_reports: list[dict[str, Any]] = []
    failed_documents: list[dict[str, Any]] = []
    for payload in file_payloads:
        upload_entries = payload.value if isinstance(payload.value, list) else [payload.value]
        for upload_entry in upload_entries:
            uploaded_file = resolve_uploaded_file(context, upload_entry)
            try:
                parsed_document = parse_uploaded_file(uploaded_file, strategy=strategy)
            except Exception as exc:
                failed_documents.append({"id": uploaded_file.id, "original_name": uploaded_file.original_name, "error": str(exc)})
                continue
            combined_text_parts.append(parsed_document.text)
            quality = build_extraction_quality_report(uploaded_file, parsed_document.text, parsed_document.metadata)
            quality_reports.append(quality)
            extracted_documents.append(
                {
                    "id": uploaded_file.id,
                    "source_path": uploaded_file.storage_path,
                    "text": parsed_document.text,
                    "metadata": {
                        "original_name": uploaded_file.original_name,
                        "extension": uploaded_file.extension,
                        "size_bytes": uploaded_file.size_bytes,
                        "quality": quality,
                        **parsed_document.metadata,
                    },
                }
            )
    if failed_documents and not extracted_documents:
        raise ValueError(f"Text Extraction failed for all files: {failed_documents[0]['error']}")

    combined_text = "\n\n".join(combined_text_parts)
    aggregate_quality = summarize_extraction_quality(quality_reports, failed_documents)
    payload = typed_payload(
        "document",
        {
            "documents": extracted_documents,
            "combined_text": combined_text,
            "metadata": {"document_count": len(extracted_documents), "strategy": strategy, "quality": aggregate_quality},
        },
        {
            "text_preview": preview_text(combined_text),
            "document_count": len(extracted_documents),
            "strategy": strategy,
            "quality": aggregate_quality if include_quality_report else None,
        },
        {"document_count": len(extracted_documents), "strategy": strategy, "failed_count": len(failed_documents)},
    )
    text_payload = typed_payload(
        "text",
        combined_text,
        preview_text(combined_text),
        {"document_count": len(extracted_documents), "strategy": strategy},
    )
    metadata_payload = typed_payload(
        "json",
        {
            "document_count": len(extracted_documents),
            "strategy": strategy,
            "documents": [document["metadata"] for document in extracted_documents],
            "text_length": len(combined_text),
            "quality": aggregate_quality,
            "failed_documents": failed_documents,
        },
        {"document_count": len(extracted_documents), "text_length": len(combined_text), "failed_count": len(failed_documents)},
        {"strategy": strategy, "failed_count": len(failed_documents)},
    )
    return NodeExecutionResult(
        outputs={"document": payload, "text": text_payload, "metadata": metadata_payload},
        preview={"label": node["data"]["label"], "output": payload.preview, "text": text_payload.preview},
        logs=[log_entry("info", f"Extracted text from {len(extracted_documents)} document(s); {len(failed_documents)} failed.")],
    )


def execute_ocr(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    ocr_node = {
        **node,
        "data": {
            **node["data"],
            "config": {
                **node["data"].get("config", {}),
                "strategy": "ocr",
                "qualityReport": True,
            },
        },
    }
    result = execute_text_extraction(ocr_node, context)
    result.logs.append(log_entry("info", "OCR block used the parser abstraction with the configured local OCR provider."))
    return result


def execute_rag_knowledge(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    document_payloads = context.node_inputs[node["id"]].get("document", [])
    query_payloads = context.node_inputs[node["id"]].get("query", [])
    rag_config = build_rag_config(node["data"]["config"])

    documents = flatten_document_payloads(document_payloads)
    ingest_summary = {
        "documents_seen": len(documents),
        "documents_indexed": 0,
        "chunks_indexed": 0,
        "collection_name": rag_config.collection_name,
        "mode": rag_config.ingest_mode,
        "refresh": None,
    }
    if rag_config.ingest_mode == "refresh_collection":
        ingest_summary["refresh"] = clear_collection_records(context.session, workflow=context.workflow, rag_config=rag_config)
    if documents and should_ingest_documents(rag_config):
        refresh_summary = ingest_summary.get("refresh")
        ingest_summary = ingest_documents(
            context.session,
            workflow=context.workflow,
            workflow_run=context.workflow_run,
            node_id=node["id"],
            rag_config=rag_config,
            documents=documents,
        )
        ingest_summary["refresh"] = refresh_summary

    query = str(first_payload_value(query_payloads) or "")
    retrieved_chunks = (
        retrieve_relevant_chunks(
            context.session,
            workflow=context.workflow,
            rag_config=rag_config,
            query=query,
        )
        if query.strip() and should_retrieve_chunks(rag_config)
        else []
    )
    ranked_documents = [
        {
            "chunk_id": item.chunk_id,
            "vector_id": item.vector_id,
            "score": item.score,
            "snippet": preview_text(item.text, 300),
            "metadata": item.metadata,
        }
        for item in retrieved_chunks
    ]
    if rag_config.rerank:
        ranked_documents.sort(key=lambda item: ((item["score"] if item["score"] is not None else 999), -len(str(item.get("snippet", "")))))
    payload = typed_payload(
        "knowledge",
        {
            "query": query,
            "matches": ranked_documents,
            "ingest_summary": ingest_summary,
        },
        {
            "query": query,
            "matches": ranked_documents,
            "answer_guidance": "Pass this into a Chatbot context input to generate a natural answer with citations.",
            "ingest_summary": ingest_summary,
            "mode": rag_config.ingest_mode,
            "retrieval_strategy": rag_config.retrieval_strategy,
            "rerank": rag_config.rerank,
            "source_metadata": [item["metadata"] for item in ranked_documents],
        },
        {
            "match_count": len(ranked_documents),
            "collection_name": rag_config.collection_name,
            "mode": rag_config.ingest_mode,
            "tags": rag_config.tags,
            "retrieval_strategy": rag_config.retrieval_strategy,
            "rerank": rag_config.rerank,
        },
    )
    matches_payload = typed_payload(
        "json",
        ranked_documents,
        {"match_count": len(ranked_documents), "top_score": ranked_documents[0]["score"] if ranked_documents else None},
        {"collection_name": rag_config.collection_name},
    )
    diagnostics_payload = typed_payload(
        "json",
        {
            "collection_name": rag_config.collection_name,
            "mode": rag_config.ingest_mode,
            "query": query,
            "documents_seen": ingest_summary["documents_seen"],
            "documents_indexed": ingest_summary["documents_indexed"],
            "chunks_indexed": ingest_summary["chunks_indexed"],
            "matches_returned": len(ranked_documents),
            "has_query": bool(query.strip()),
            "tags": rag_config.tags,
            "retrieval_strategy": rag_config.retrieval_strategy,
            "rerank": rag_config.rerank,
            "refresh": ingest_summary.get("refresh"),
        },
        {"collection_name": rag_config.collection_name, "matches_returned": len(ranked_documents), "chunks_indexed": ingest_summary["chunks_indexed"]},
        {"collection_name": rag_config.collection_name},
    )
    return NodeExecutionResult(
        outputs={"knowledge": payload, "matches": matches_payload, "diagnostics": diagnostics_payload},
        preview={"label": node["data"]["label"], "output": payload.preview, "diagnostics": diagnostics_payload.preview},
        logs=[
            log_entry(
                "info",
                (
                    f"Indexed {ingest_summary['chunks_indexed']} chunk(s) and retrieved "
                    f"{len(ranked_documents)} knowledge match(es) in mode '{rag_config.ingest_mode}'."
                ),
            )
        ],
    )


def execute_chatbot(
    node: dict[str, Any],
    context: ExecutionContext,
    provider: LlmProvider | None = None,
) -> NodeExecutionResult:
    message = str(first_payload_value(context.node_inputs[node["id"]].get("message", [])) or "")
    context_payloads = context.node_inputs[node["id"]].get("context", [])
    context_value = merge_payload_values(context_payloads)
    system_prompt = str(node["data"]["config"].get("systemPrompt", ""))
    model = str(node["data"]["config"].get("model", settings.openrouter_model))
    temperature = float(node["data"]["config"].get("temperature", 0.2))
    answer_style = str(node["data"]["config"].get("answerStyle", "conversational"))
    output_mode = str(node["data"]["config"].get("outputMode", "chat"))
    response_schema = str(node["data"]["config"].get("responseSchema", "")).strip()

    context_text = render_chatbot_context(context_value)
    memory_text = render_memory_context(context_payloads)
    citations = extract_citations(context_payloads)
    source_chunks = collect_source_chunks(context_payloads)
    llm_provider = provider or get_default_llm_provider()

    messages = build_chatbot_messages(
        system_prompt=system_prompt,
        user_message=message,
        context_text=context_text,
        memory_text=memory_text,
        answer_style=answer_style,
        output_mode=output_mode,
        response_schema=response_schema,
    )
    llm_response = llm_provider.generate(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    answer_text = append_citations(llm_response.output_text, citations)
    reply_payload = typed_payload(
        "chat",
        answer_text,
        preview_text(answer_text),
        {
            "model": model,
            "provider": llm_response.provider,
            "citations": citations,
            "source_chunks": source_chunks,
        },
    )
    json_payload = typed_payload(
        "json",
        {
            "provider": llm_response.provider,
            "model": model,
            "message": message,
            "system_prompt": system_prompt,
            "answer_style": answer_style,
            "output_mode": output_mode,
            "response_schema": response_schema,
            "context_used": context_text,
            "memory_used": memory_text,
            "citations": citations,
            "source_chunks": source_chunks,
            "reply": answer_text,
            "raw_response": llm_response.raw_response,
        },
        {
            "reply": preview_text(answer_text),
            "model": model,
            "provider": llm_response.provider,
            "citation_count": len(citations),
        },
        {
            "model": model,
            "provider": llm_response.provider,
            "citation_count": len(citations),
            "source_chunk_count": len(source_chunks),
            "answer_style": answer_style,
            "output_mode": output_mode,
        },
    )
    citations_payload = typed_payload(
        "json",
        {"citations": citations, "source_chunks": source_chunks, "citation_count": len(citations), "source_chunk_count": len(source_chunks)},
        {"citation_count": len(citations), "source_chunk_count": len(source_chunks)},
        {"model": model, "provider": llm_response.provider},
    )
    return NodeExecutionResult(
        outputs={"reply": reply_payload, "json": json_payload, "citations": citations_payload},
        preview={
            "reply": preview_text(answer_text),
            "model": model,
            "provider": llm_response.provider,
            "citations": citations,
            "source_chunks": source_chunks,
            "answer_style": answer_style,
            "output_mode": output_mode,
        },
        logs=[
            log_entry(
                "info",
                (
                    f"Chatbot node generated a response with provider '{llm_response.provider}' "
                    f"and model '{model}'."
                ),
            )
        ],
    )


def execute_summarizer(
    node: dict[str, Any],
    context: ExecutionContext,
    provider: LlmProvider | None = None,
) -> NodeExecutionResult:
    content_payloads = context.node_inputs[node["id"]].get("content", [])
    content_text = render_content_payloads(content_payloads)
    if not content_text.strip():
        raise ValueError("Summarizer requires text, document, or knowledge content.")

    model = str(node["data"]["config"].get("model", settings.openrouter_model))
    style = str(node["data"]["config"].get("style", "concise bullets"))
    max_words = int(node["data"]["config"].get("maxWords", 150))
    llm_provider = provider or get_default_llm_provider()
    messages = [
        LlmMessage(
            role="system",
            content=(
                "You summarize business documents. Return only the summary text. "
                f"Style: {style}. Maximum words: {max_words}."
            ),
        ),
        LlmMessage(role="user", content=f"Summarize this content:\n\n{content_text}"),
    ]
    response = llm_provider.generate(model=model, messages=messages, temperature=0.2)
    summary_text = response.output_text.strip()
    payload = typed_payload(
        "json",
        {
            "summary": summary_text,
            "style": style,
            "max_words": max_words,
            "model": model,
            "provider": response.provider,
        },
        {"summary_preview": preview_text(summary_text), "style": style},
        {"model": model, "provider": response.provider},
    )
    return single_output_result(
        "summary",
        payload,
        node["data"]["label"],
        f"Summarized {len(content_text)} character(s) with provider '{response.provider}'.",
    )


def execute_classifier(
    node: dict[str, Any],
    context: ExecutionContext,
    provider: LlmProvider | None = None,
) -> NodeExecutionResult:
    content_payloads = context.node_inputs[node["id"]].get("content", [])
    content_text = render_content_payloads(content_payloads)
    if not content_text.strip():
        raise ValueError("Classifier requires text, document, or chat content.")

    model = str(node["data"]["config"].get("model", settings.openrouter_model))
    labels = parse_label_list(str(node["data"]["config"].get("labels", "")))
    multi_label = bool(node["data"]["config"].get("multiLabel", False))
    llm_provider = provider or get_default_llm_provider()
    messages = [
        LlmMessage(
            role="system",
            content=(
                "Classify the content into the provided labels. "
                "Return compact JSON only with keys: labels, confidence, rationale. "
                f"Allowed labels: {', '.join(labels)}. "
                f"Multi-label allowed: {multi_label}."
            ),
        ),
        LlmMessage(role="user", content=content_text),
    ]
    response = llm_provider.generate(model=model, messages=messages, temperature=0.0)
    parsed = parse_json_or_text(response.output_text, fallback_key="classification")
    payload = typed_payload(
        "json",
        {
            "classification": parsed,
            "allowed_labels": labels,
            "multi_label": multi_label,
            "model": model,
            "provider": response.provider,
        },
        {"classification": preview_text(parsed), "labels": labels},
        {"model": model, "provider": response.provider, "labels": labels},
    )
    return single_output_result(
        "classification",
        payload,
        node["data"]["label"],
        f"Classified content against {len(labels)} label(s).",
    )


def execute_extraction_ai(
    node: dict[str, Any],
    context: ExecutionContext,
    provider: LlmProvider | None = None,
) -> NodeExecutionResult:
    content_payloads = context.node_inputs[node["id"]].get("content", [])
    content_text = render_content_payloads(content_payloads)
    if not content_text.strip():
        raise ValueError("Extraction AI requires text or document content.")

    model = str(node["data"]["config"].get("model", settings.openrouter_model))
    schema_prompt = str(node["data"]["config"].get("schemaPrompt", ""))
    schema_fields = parse_schema_fields(node["data"]["config"].get("schemaFields", ""))
    strict_mode = bool(node["data"]["config"].get("strictMode", True))
    llm_provider = provider or get_default_llm_provider()
    messages = [
        LlmMessage(
            role="system",
            content=(
                "Extract structured information from the content. "
                "Return JSON only, with no markdown fences. "
                f"Strict JSON mode: {strict_mode}. Schema instructions: {schema_prompt}. "
                f"Visual schema fields: {json.dumps(schema_fields, default=str)}"
            ),
        ),
        LlmMessage(role="user", content=content_text),
    ]
    response = llm_provider.generate(model=model, messages=messages, temperature=0.0)
    extracted = parse_json_or_text(response.output_text, fallback_key="raw_extraction")
    payload = typed_payload(
        "json",
        {
            "extracted": extracted,
            "schema_prompt": schema_prompt,
            "schema_fields": schema_fields,
            "strict_mode": strict_mode,
            "model": model,
            "provider": response.provider,
        },
        {"extracted_preview": preview_text(extracted), "strict_mode": strict_mode, "field_count": len(schema_fields)},
        {"model": model, "provider": response.provider, "strict_mode": strict_mode, "field_count": len(schema_fields)},
    )
    return single_output_result(
        "json",
        payload,
        node["data"]["label"],
        f"Extracted structured JSON with provider '{response.provider}'.",
    )


def execute_prompt_template(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    template = str(node["data"]["config"].get("template", "{{input}}"))
    payloads = context.node_inputs[node["id"]].get("variables", [])
    value = merge_payload_values(payloads)
    variables = value if isinstance(value, dict) else {"input": value or ""}
    rendered = template
    for key, variable_value in variables.items():
        rendered = rendered.replace("{{" + str(key) + "}}", str(variable_value))
    rendered = rendered.replace("{{input}}", render_content_payloads(payloads))
    payload = typed_payload("text", rendered, preview_text(rendered), {"variable_count": len(variables)})
    return single_output_result("prompt", payload, node["data"]["label"], "Prompt template rendered.")


def execute_document_splitter(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    content = render_content_payloads(context.node_inputs[node["id"]].get("document", []))
    if not content.strip():
        raise ValueError("Document Splitter requires document or text content.")
    mode = str(node["data"]["config"].get("mode", "paragraphs"))
    max_chars = int(node["data"]["config"].get("maxChars", 1200))
    sections = split_text_sections(content, mode=mode, max_chars=max_chars)
    payload = typed_payload(
        "json",
        {"mode": mode, "sections": sections, "section_count": len(sections)},
        {"section_count": len(sections), "first_section": preview_text(sections[0]["text"] if sections else "")},
        {"mode": mode, "section_count": len(sections)},
    )
    return single_output_result("sections", payload, node["data"]["label"], f"Split document into {len(sections)} section(s).")


def execute_table_extractor(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    content = render_content_payloads(context.node_inputs[node["id"]].get("document", []))
    delimiter = str(node["data"]["config"].get("delimiter", "auto"))
    tables = extract_simple_tables(content, delimiter)
    payload = typed_payload(
        "json",
        {"tables": tables, "table_count": len(tables)},
        {"table_count": len(tables), "row_count": sum(len(table["rows"]) for table in tables)},
        {"delimiter": delimiter},
    )
    return single_output_result("tables", payload, node["data"]["label"], f"Extracted {len(tables)} table(s).")


def execute_schema_validator(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    value = merge_payload_values(context.node_inputs[node["id"]].get("payload", []))
    required_keys = parse_label_list(str(node["data"]["config"].get("requiredKeys", "")))
    payload_object = unwrap_json_payload(value)
    missing = [key for key in required_keys if key not in payload_object or payload_object.get(key) in (None, "")]
    valid = not missing
    result = {"valid": valid, "missing_keys": missing, "required_keys": required_keys, "payload": payload_object}
    payload = typed_payload("json", result, {"valid": valid, "missing_keys": missing}, {"required_key_count": len(required_keys)})
    return single_output_result("validation", payload, node["data"]["label"], "Schema validation completed.")


def execute_retry_fallback_llm(
    node: dict[str, Any],
    context: ExecutionContext,
    provider: LlmProvider | None = None,
) -> NodeExecutionResult:
    prompt = render_content_payloads(context.node_inputs[node["id"]].get("prompt", []))
    if not prompt.strip():
        raise ValueError("Retry/Fallback LLM requires a prompt input.")
    model = str(node["data"]["config"].get("model", settings.openrouter_model))
    fallback_model = str(node["data"]["config"].get("fallbackModel", model))
    max_retries = int(node["data"]["config"].get("maxRetries", 1))
    system_prompt = str(node["data"]["config"].get("systemPrompt", "You are a reliable assistant."))
    llm_provider = provider or get_default_llm_provider()
    attempts: list[dict[str, Any]] = []
    last_error = ""
    for index in range(max_retries + 1):
        attempt_model = model if index < max_retries else fallback_model
        try:
            response = llm_provider.generate(
                model=attempt_model,
                messages=[LlmMessage(role="system", content=system_prompt), LlmMessage(role="user", content=prompt)],
                temperature=float(node["data"]["config"].get("temperature", 0.2)),
            )
            attempts.append({"model": attempt_model, "status": "completed", "attempt": index + 1})
            payload = typed_payload(
                "chat",
                response.output_text,
                preview_text(response.output_text),
                {"model": attempt_model, "provider": response.provider, "attempts": attempts},
            )
            json_payload = typed_payload("json", {"reply": response.output_text, "attempts": attempts}, {"attempts": attempts})
            return NodeExecutionResult(
                outputs={"reply": payload, "json": json_payload},
                preview={"reply": preview_text(response.output_text), "attempts": attempts},
                logs=[log_entry("info", f"Retry/Fallback LLM completed after {len(attempts)} attempt(s).")],
            )
        except Exception as error:  # noqa: BLE001 - this block intentionally captures provider failures for fallback.
            last_error = str(error)
            attempts.append({"model": attempt_model, "status": "failed", "attempt": index + 1, "error": last_error})
    raise ValueError(f"Retry/Fallback LLM failed after {len(attempts)} attempt(s): {last_error}")


def execute_citation_formatter(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    payloads = context.node_inputs[node["id"]].get("sources", [])
    citations = collect_payload_citations(payloads) or extract_citations(payloads)
    chunks = collect_source_chunks(payloads)
    style = str(node["data"]["config"].get("style", "numbered"))
    formatted = format_citations(citations, chunks, style)
    payload = typed_payload("text", formatted, preview_text(formatted), {"citation_count": len(citations), "chunk_count": len(chunks)})
    json_payload = typed_payload("json", {"citations": citations, "source_chunks": chunks, "formatted": formatted}, {"citation_count": len(citations)})
    return NodeExecutionResult(outputs={"text": payload, "json": json_payload}, preview={"formatted": formatted}, logs=[log_entry("info", "Citations formatted.")])


def execute_form_input(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    runtime = context.runtime_inputs.get(node["id"])
    defaults = parse_json_or_text(str(node["data"]["config"].get("defaultValues", "{}")), fallback_key="value")
    value = parse_json_or_text(runtime.value, fallback_key="value") if runtime and runtime.value else defaults
    payload = typed_payload("json", value, summarize_preview_content(value), {"source": "runtime_or_defaults"})
    text_payload = typed_payload("text", json.dumps(value, default=str), preview_text(value), {"source": "runtime_or_defaults"})
    return NodeExecutionResult(outputs={"json": payload, "text": text_payload}, preview={"form": value}, logs=[log_entry("info", "Form input prepared.")])


def execute_webhook_trigger(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    runtime = context.runtime_inputs.get(node["id"])
    sample = node["data"]["config"].get("samplePayload", '{"event":"test"}')
    value = parse_json_or_text(runtime.value, fallback_key="payload") if runtime and runtime.value else parse_json_or_text(str(sample), fallback_key="payload")
    payload = typed_payload("json", value, summarize_preview_content(value), {"source": "webhook_runtime_or_sample"})
    return single_output_result("payload", payload, node["data"]["label"], "Webhook payload prepared.")


def execute_http_request(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    body = merge_payload_values(context.node_inputs[node["id"]].get("body", []))
    method = str(node["data"]["config"].get("method", "POST")).upper()
    url = str(node["data"]["config"].get("url", ""))
    enabled = bool(node["data"]["config"].get("enableRequest", False))
    result = {
        "mode": "prepared" if not enabled else "executed_not_implemented",
        "method": method,
        "url": url,
        "body": body,
        "note": "External HTTP is disabled by default for local-first safety. Set enableRequest later when an adapter is added.",
    }
    payload = typed_payload("json", result, summarize_preview_content(result), {"method": method, "enabled": enabled})
    return single_output_result("response", payload, node["data"]["label"], "HTTP request block prepared a request payload.")


def execute_data_mapper(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    value = merge_payload_values(context.node_inputs[node["id"]].get("input", []))
    source = unwrap_json_payload(value)
    mappings = parse_mappings(str(node["data"]["config"].get("mappings", "")))
    mapped = {target: get_nested_value(source, source_key) for source_key, target in mappings}
    if not mappings:
        mapped = source
    payload = typed_payload("json", mapped, summarize_preview_content(mapped), {"mapping_count": len(mappings)})
    return single_output_result("mapped", payload, node["data"]["label"], f"Mapped {len(mapped)} field(s).")


def execute_loop_for_each(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    value = merge_payload_values(context.node_inputs[node["id"]].get("items", []))
    items = normalize_items(value)
    limit = int(node["data"]["config"].get("limit", 25))
    processed = [{"index": index, "item": item, "preview": preview_text(item, 100)} for index, item in enumerate(items[:limit])]
    payload = typed_payload("json", {"items": processed, "count": len(processed), "truncated": len(items) > limit}, {"count": len(processed)})
    return single_output_result("items", payload, node["data"]["label"], f"Prepared {len(processed)} loop item(s).")


def execute_approval_step(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    request_value = merge_payload_values(context.node_inputs[node["id"]].get("request", []))
    decision = str(node["data"]["config"].get("defaultDecision", "approved"))
    approved = decision == "approved"
    payload = typed_payload("any", {"approved": approved, "decision": decision, "request": request_value}, {"approved": approved, "decision": decision})
    return NodeExecutionResult(
        outputs={"approved" if approved else "rejected": payload},
        preview={"approved": approved, "decision": decision},
        logs=[log_entry("info", f"Human approval MVP auto-routed as '{decision}'.")],
    )


def execute_email_sender(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    content = merge_payload_values(context.node_inputs[node["id"]].get("content", []))
    config = node["data"]["config"]
    provider = get_email_provider()
    to = split_recipients(str(config.get("to", "")))
    subject = str(config.get("subject", "AI Studio notification") or "AI Studio notification")
    body = str(content if content is not None else config.get("body", ""))
    try:
        delivery = provider.send(
            to=to,
            cc=split_recipients(str(config.get("cc", ""))),
            bcc=split_recipients(str(config.get("bcc", ""))),
            subject=subject,
            text_body=body,
            html_body=str(config.get("htmlBody", "") or "") or None,
        )
        status_value = delivery.status
        detail = delivery.detail
        metadata = delivery.metadata
    except Exception as exc:
        status_value = "failed"
        detail = str(exc)
        metadata = {"to_count": len(to)}
    message = {
        "to": to,
        "subject": subject,
        "status": status_value,
        "provider": provider.provider_name,
        "detail": detail,
        "metadata": metadata,
    }
    payload = typed_payload("json", message, summarize_preview_content(message))
    return single_output_result("status", payload, node["data"]["label"], f"Email delivery {status_value}.")


def execute_slack_notification(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    content = merge_payload_values(context.node_inputs[node["id"]].get("content", []))
    config = node["data"]["config"]
    channel = str(config.get("channel", "#ai-studio") or "#ai-studio")
    provider = get_notification_provider(str(config.get("provider", "")))
    try:
        delivery = provider.deliver(channel=channel, content=content, title=str(config.get("title", "AI Studio notification")))
        status_value = delivery.status
        detail = delivery.detail
        metadata = delivery.metadata
    except Exception as exc:
        status_value = "failed"
        detail = str(exc)
        metadata = {"channel": channel}
    message = {
        "channel": channel,
        "status": status_value,
        "provider": provider.provider_name,
        "detail": detail,
        "metadata": metadata,
    }
    payload = typed_payload("json", message, summarize_preview_content(message))
    return single_output_result("status", payload, node["data"]["label"], f"Notification delivery {status_value}.")


def execute_database_writer(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    row = merge_payload_values(context.node_inputs[node["id"]].get("row", []))
    table = str(node["data"]["config"].get("table", "workflow_results"))
    record = {
        "table": table,
        "row": row,
        "workflow_id": context.workflow.id,
        "run_id": context.workflow_run.id,
        "status": "captured_in_run_log",
    }
    context.run_logs.append(log_entry("info", f"Database Writer captured row for table '{table}': {preview_text(row)}"))
    payload = typed_payload("json", record, summarize_preview_content(record), {"table": table})
    return single_output_result("record", payload, node["data"]["label"], "Database write captured as local run evidence.")


def execute_csv_excel_export(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    value = merge_payload_values(context.node_inputs[node["id"]].get("data", []))
    rows = normalize_rows(value)
    filename = str(node["data"]["config"].get("filename", f"workflow-{context.workflow.id}-run-{context.workflow_run.id}.csv"))
    if not filename.endswith(".csv"):
        filename = f"{filename}.csv"
    export_dir = Path(settings.uploads_dir) / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    export_path = export_dir / filename
    export_path.write_text(render_csv(rows), encoding="utf-8")
    payload = typed_payload(
        "file",
        {"path": str(export_path), "filename": filename, "row_count": len(rows), "format": "csv"},
        {"filename": filename, "row_count": len(rows)},
        {"format": "csv"},
    )
    return single_output_result("file", payload, node["data"]["label"], f"CSV export written to {export_path}.")


def execute_pii_redactor(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    value = merge_payload_values(context.node_inputs[node["id"]].get("content", []))
    text = str(value or "")
    redacted, counts = redact_pii(text)
    payload = typed_payload("text", redacted, preview_text(redacted), counts)
    json_payload = typed_payload("json", {"redacted_text": redacted, "counts": counts}, {"counts": counts})
    return NodeExecutionResult(outputs={"redacted": payload, "json": json_payload}, preview={"counts": counts}, logs=[log_entry("info", "PII redaction completed.")])


def execute_guardrail(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    value = merge_payload_values(context.node_inputs[node["id"]].get("content", []))
    rules = parse_label_list(str(node["data"]["config"].get("blockedTerms", "password,secret,api key")))
    text = str(value or "").lower()
    hits = [rule for rule in rules if rule.lower() in text]
    blocked = bool(hits)
    payload = typed_payload("any", {"blocked": blocked, "hits": hits, "content": value}, {"blocked": blocked, "hits": hits})
    return NodeExecutionResult(
        outputs={"blocked" if blocked else "safe": payload},
        preview={"blocked": blocked, "hits": hits},
        logs=[log_entry("warning" if blocked else "info", f"Guardrail {'blocked' if blocked else 'passed'} content.")],
    )


def execute_router_switch(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    value = merge_payload_values(context.node_inputs[node["id"]].get("input", []))
    routes = parse_label_list(str(node["data"]["config"].get("routes", "default")))
    default_route = str(node["data"]["config"].get("defaultRoute", routes[0] if routes else "default"))
    text = str(value or "").lower()
    selected = next((route for route in routes if route.lower() in text), default_route)
    payload = typed_payload("any", {"route": selected, "input": value, "available_routes": routes}, {"route": selected})
    return single_output_result("route", payload, node["data"]["label"], f"Router selected route '{selected}'.")


def execute_long_term_memory(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    scope = str(node["data"]["config"].get("scope", "workflow"))
    content = merge_payload_values(context.node_inputs[node["id"]].get("content", []))
    namespace = f"long-term:{scope}"
    if content not in (None, ""):
        context.session.add(
            ConversationMemoryMessage(
                workflow_id=context.workflow.id,
                workflow_run_id=context.workflow_run.id,
                node_id=node["id"],
                session_id=context.session_id,
                user_id=context.user_id,
                namespace=namespace,
                role="fact",
                content=str(content),
                metadata_json={"source": "long_term_memory", "scope": scope},
            )
        )
        context.session.flush()
    history = persist_and_load_conversation_memory(
        context=context,
        node_id=node["id"],
        namespace=namespace,
        messages=[],
        window_size=int(node["data"]["config"].get("maxFacts", 20)),
    )
    payload = typed_payload("memory", {"scope": scope, "facts": history}, {"scope": scope, "fact_count": len(history)})
    return single_output_result("memory", payload, node["data"]["label"], f"Long-term memory loaded {len(history)} fact(s).")


def execute_web_search(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    query = str(first_payload_value(context.node_inputs[node["id"]].get("query", [])) or "")
    top_k = min(max(int(node["data"]["config"].get("topK", 5)), 1), settings.web_search_max_results)
    provider = get_web_search_provider(str(node["data"]["config"].get("provider", "")))
    try:
        search_results = provider.search(query, top_k=top_k)
        results = [
            {
                "title": item.title,
                "url": item.url,
                "snippet": item.snippet,
                "source": item.source,
                "provider": item.source,
                "rank": item.rank,
            }
            for item in search_results
        ]
        status_value = "ok"
        error = None
    except Exception as exc:
        results = []
        status_value = "failed"
        error = str(exc)
    payload = typed_payload(
        "knowledge",
        {"query": query, "matches": results, "provider": provider.provider_name, "status": status_value, "error": error},
        {"query": query, "match_count": len(results), "provider": provider.provider_name, "status": status_value},
    )
    return single_output_result("results", payload, node["data"]["label"], f"Web Search returned {len(results)} result(s).")


def execute_web_page_reader(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    url = str(first_payload_value(context.node_inputs[node["id"]].get("url", [])) or node["data"]["config"].get("url", ""))
    reader_mode = str(node["data"]["config"].get("readerMode", "text"))
    page = fetch_readable_page(url, markdown=reader_mode == "markdown")
    payload = typed_payload(
        "document",
        {
            "documents": [
                {
                    "source_path": page.url,
                    "text": page.text,
                    "metadata": {"url": page.url, "title": page.title, **page.metadata},
                }
            ],
            "combined_text": page.text,
            "metadata": {"title": page.title, **page.metadata},
        },
        {"text_preview": preview_text(page.text), "url": page.url, "title": page.title, "word_count": page.metadata.get("word_count")},
        {"url": page.url, "title": page.title, "word_count": page.metadata.get("word_count")},
    )
    return single_output_result("document", payload, node["data"]["label"], "Web Page Reader fetched readable content.")


def execute_database_query_node(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    incoming = first_payload_value(context.node_inputs[node["id"]].get("query", []))
    config = node["data"]["config"]
    sql = str((incoming.get("sql") if isinstance(incoming, dict) else incoming) or config.get("query", ""))
    parameters = incoming.get("parameters", {}) if isinstance(incoming, dict) else {}
    connection_url = str(config.get("connectionUrl", "") or settings.database_query_default_url or "")
    limit = int(config.get("limit", 100) or 100)
    allow_writes = bool(config.get("allowWrites", settings.database_query_allow_writes))
    try:
        result = run_database_query(sql, connection_url=connection_url or None, parameters=parameters, allow_writes=allow_writes, limit=limit)
        payload_value = {
            "columns": result.columns,
            "rows": result.rows,
            "row_count": result.row_count,
            "dialect": result.dialect,
            "read_only": result.read_only,
            "sql": sql,
        }
        message = f"Database Query returned {result.row_count} row(s)."
    except Exception as exc:
        payload_value = {"columns": [], "rows": [], "row_count": 0, "sql": sql, "error": str(exc), "status": "failed"}
        message = f"Database Query failed: {exc}"
    payload = typed_payload("json", payload_value, summarize_preview_content(payload_value), {"read_only": is_read_only_sql(sql)})
    return single_output_result("rows", payload, node["data"]["label"], message)


def execute_sql_assistant(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    question = str(first_payload_value(context.node_inputs[node["id"]].get("question", [])) or node["data"]["config"].get("question", ""))
    config = node["data"]["config"]
    connection_url = str(config.get("connectionUrl", "") or settings.database_query_default_url or "")
    schema = introspect_schema(connection_url=connection_url or None)
    table_names = [table["name"] for table in schema.get("tables", [])]
    selected_table = next((table for table in table_names if table.lower() in question.lower()), table_names[0] if table_names else "")
    limit = int(config.get("limit", 50) or 50)
    generated_sql = f"SELECT * FROM {selected_table} LIMIT {limit}" if selected_table else "-- No tables found for this connection"
    execute_query = bool(config.get("executeQuery", False))
    execution_result: dict[str, Any] | None = None
    if execute_query and selected_table:
        result = run_database_query(generated_sql, connection_url=connection_url or None, limit=limit)
        execution_result = {"columns": result.columns, "rows": result.rows, "row_count": result.row_count}
    payload_value = {
        "question": question,
        "schema": schema,
        "sql": generated_sql,
        "read_only": is_read_only_sql(generated_sql),
        "explanation": "SQL Assistant introspected the configured database and generated a safe read-only starter query. Review before enabling execution.",
        "execution": execution_result,
    }
    payload = typed_payload("json", payload_value, {"sql": generated_sql, "tables": table_names, "executed": execution_result is not None})
    return NodeExecutionResult(
        outputs={"query": typed_payload("text", generated_sql, generated_sql), "plan": payload},
        preview=payload.preview,
        logs=[log_entry("info", "SQL Assistant generated a read-only query plan.")],
    )


def execute_browser_agent(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    task = str(first_payload_value(context.node_inputs[node["id"]].get("task", [])) or node["data"]["config"].get("task", "Inspect page"))
    plan = {
        "task": task,
        "steps": [
            "Open target page",
            "Inspect visible content",
            "Extract requested fields",
            "Return structured result",
        ],
        "mode": "planned_not_executed",
        "note": "Browser automation adapter is scaffolded but disabled in local MVP.",
    }
    payload = typed_payload("json", plan, summarize_preview_content(plan))
    return single_output_result("result", payload, node["data"]["label"], "Browser Agent produced a safe execution plan.")


def execute_re_ranker(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    value = merge_payload_values(context.node_inputs[node["id"]].get("knowledge", []))
    top_k = int(node["data"]["config"].get("topK", 5))
    if not isinstance(value, dict):
        raise ValueError("Re-ranker requires knowledge/json input.")
    matches = list(value.get("matches", []))
    matches.sort(key=lambda match: (match.get("score") is None, match.get("score", 999), -len(str(match.get("snippet", "")))))
    reranked = {**value, "matches": matches[:top_k], "rerank_strategy": node["data"]["config"].get("strategy", "score_then_length")}
    payload = typed_payload("knowledge", reranked, {"match_count": len(reranked["matches"]), "strategy": reranked["rerank_strategy"]})
    return single_output_result("knowledge", payload, node["data"]["label"], f"Re-ranked {len(matches)} match(es).")


def execute_query_rewriter(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    query = str(first_payload_value(context.node_inputs[node["id"]].get("query", [])) or "")
    domain = str(node["data"]["config"].get("domainHint", "")).strip()
    rewritten = query.strip()
    if domain and domain.lower() not in rewritten.lower():
        rewritten = f"{rewritten} ({domain})"
    if len(rewritten.split()) < 4:
        rewritten = f"{rewritten} policy requirements exceptions owners evidence".strip()
    payload = typed_payload("text", rewritten, preview_text(rewritten), {"original_query": query, "domain_hint": domain})
    return single_output_result("query", payload, node["data"]["label"], "Query rewritten for retrieval.")


def execute_citation_verifier(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    answer = str(first_payload_value(context.node_inputs[node["id"]].get("answer", [])) or "")
    source_payloads = context.node_inputs[node["id"]].get("sources", [])
    source_text = render_content_payloads(source_payloads)
    answer_terms = {term.lower().strip(".,:;!?") for term in answer.split() if len(term) > 4}
    supported_terms = {term for term in answer_terms if term in source_text.lower()}
    support_score = round(len(supported_terms) / len(answer_terms), 3) if answer_terms else 0.0
    result = {
        "support_score": support_score,
        "verified": support_score >= float(node["data"]["config"].get("minimumSupport", 0.35)),
        "supported_terms": sorted(supported_terms),
        "unsupported_terms": sorted(answer_terms - supported_terms)[:25],
    }
    payload = typed_payload("json", result, {"support_score": support_score, "verified": result["verified"]})
    return single_output_result("verification", payload, node["data"]["label"], "Citation support verification completed.")


def execute_conversation_memory(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    namespace = str(node["data"]["config"].get("namespace", "default-session"))
    window_size = int(node["data"]["config"].get("windowSize", 8))
    input_payloads = context.node_inputs[node["id"]].get("message", [])
    messages = [str(payload.value) for payload in input_payloads if payload.value not in (None, "")]
    history = persist_and_load_conversation_memory(
        context=context,
        node_id=node["id"],
        namespace=namespace,
        messages=messages,
        window_size=window_size,
    )
    memory_text = "\n".join(history)
    payload = typed_payload(
        "memory",
        {
            "namespace": namespace,
            "session_id": context.session_id,
            "user_id": context.user_id,
            "history": history,
        },
        {
            "namespace": namespace,
            "session_id": context.session_id,
            "user_id": context.user_id,
            "history_preview": preview_text(memory_text),
        },
        {"window_size": window_size, "session_id": context.session_id, "user_id": context.user_id},
    )
    history_payload = typed_payload(
        "json",
        {"history": history, "history_text": memory_text, "window_size": window_size},
        {"history_count": len(history), "history_preview": preview_text(memory_text)},
        {"window_size": window_size},
    )
    return NodeExecutionResult(
        outputs={"memory": payload, "history": history_payload},
        preview={"label": node["data"]["label"], "output": payload.preview, "history": history_payload.preview},
        logs=[
            log_entry(
                "info",
                (
                    f"Conversation memory updated in namespace '{namespace}' for "
                    f"session '{context.session_id}' and user '{context.user_id}'."
                ),
            )
        ],
    )


def execute_merge(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    mode = str(node["data"]["config"].get("mode", "append"))
    field_paths = parse_field_paths(node["data"]["config"].get("fieldPaths", ""))
    left_payloads = context.node_inputs[node["id"]].get("left", [])
    right_payloads = context.node_inputs[node["id"]].get("right", [])
    merged_value = merge_structured_payloads(mode, left_payloads, right_payloads, field_paths=field_paths)

    payload = typed_payload(
        "json",
        merged_value,
        {
            "mode": mode,
            "combined_preview": preview_text(merged_value.get("combined_text", merged_value)),
            "input_count": merged_value["input_count"],
        },
        {"mode": mode, "input_count": merged_value["input_count"], "field_paths": field_paths},
    )
    details_payload = typed_payload(
        "json",
        {"mode": mode, "merged": merged_value, "input_count": merged_value["input_count"], "field_paths": field_paths},
        {"mode": mode, "input_count": merged_value["input_count"]},
        {"mode": mode},
    )
    return NodeExecutionResult(
        outputs={"merged": payload, "json": details_payload},
        preview={"label": node["data"]["label"], "output": payload.preview},
        logs=[log_entry("info", f"Merge completed with mode '{mode}'.")],
    )


def execute_condition(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    expression = str(node["data"]["config"].get("expression", ""))
    rules = str(node["data"]["config"].get("rules", "") or "")
    value = merge_payload_values(context.node_inputs[node["id"]].get("value", []))
    evaluation = evaluate_condition_rules(rules, value) if rules.strip() else evaluate_condition_rule(expression, value)
    branch = "true" if evaluation["matched"] else "false"
    payload = typed_payload(
        "any",
        {
            "branch": branch,
            "matched": evaluation["matched"],
            "rule": evaluation["rule"],
            "input_value": value,
        },
        {
            "branch": branch,
            "matched": evaluation["matched"],
            "rule": evaluation["rule"],
            "input_preview": preview_text(value),
        },
        {"expression": expression, "rules": rules, "branch": branch},
    )
    evaluation_payload = typed_payload("json", evaluation, {"matched": evaluation["matched"], "rule": evaluation["rule"], "branch": branch}, {"expression": expression})
    outputs: dict[str, TypedPayload] = {branch: payload, "evaluation": evaluation_payload}
    return NodeExecutionResult(
        outputs=outputs,
        preview={"matched": evaluation["matched"], "rule": evaluation["rule"], "branch": branch},
        logs=[
            log_entry(
                "info",
                f"Condition evaluated branch '{branch}' with rule '{evaluation['rule']}'.",
            )
        ],
    )


def execute_chat_output(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    message_payloads = context.node_inputs[node["id"]].get("message", [])
    message = merge_payload_values(message_payloads)
    citations = collect_payload_citations(message_payloads)
    source_chunks = collect_source_chunks(message_payloads)
    value = {
        "answer": message,
        "citations": citations,
        "source_chunks": source_chunks,
        "stream": bool(node["data"]["config"].get("stream", True)),
    }
    payload = typed_payload(
        "chat",
        value,
        {
            "answer_preview": preview_text(message),
            "citation_count": len(citations),
            "source_chunk_count": len(source_chunks),
        },
        {"stream": value["stream"], "citation_count": len(citations)},
    )
    return single_output_result("result", payload, node["data"]["label"], "Chat output prepared for display.")


def execute_json_output(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    payload_value = merge_payload_values(context.node_inputs[node["id"]].get("payload", []))
    pretty_print = bool(node["data"]["config"].get("prettyPrint", True))
    structured_value = payload_value if isinstance(payload_value, dict) else {"value": payload_value}
    payload = typed_payload(
        "json",
        {
            "data": structured_value,
            "pretty_json": json.dumps(structured_value, indent=2 if pretty_print else None, default=str),
        },
        {
            "keys": sorted(structured_value.keys()) if isinstance(structured_value, dict) else [],
            "preview": preview_text(structured_value),
        },
        {"prettyPrint": pretty_print},
    )
    return single_output_result("result", payload, node["data"]["label"], "Structured JSON output prepared.")


def execute_dashboard_preview(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    content = merge_payload_values(context.node_inputs[node["id"]].get("content", []))
    preview_mode = str(node["data"]["config"].get("view", "auto"))
    card_layout = str(node["data"]["config"].get("cardLayout", "balanced"))
    cards = build_preview_cards(content, preview_mode)
    payload = typed_payload(
        "preview",
        {
            "mode": preview_mode,
            "layout": card_layout,
            "content": content,
            "summary": summarize_preview_content(content),
            "cards": cards,
        },
        {
            "mode": preview_mode,
            "layout": card_layout,
            "summary": summarize_preview_content(content),
            "card_count": len(cards),
        },
        {"view": preview_mode, "cardLayout": card_layout},
    )
    return single_output_result("result", payload, node["data"]["label"], "Dashboard preview generated.")


def execute_logger(node: dict[str, Any], context: ExecutionContext) -> NodeExecutionResult:
    payload_inputs = context.node_inputs[node["id"]].get("payload", [])
    payload_value = merge_payload_values(payload_inputs)
    level = str(node["data"]["config"].get("level", "info"))
    trace_mode = str(node["data"]["config"].get("traceMode", "friendly"))
    debug_trace = build_debug_trace(payload_value, payload_inputs, trace_mode)
    log = log_entry(level, debug_trace["what_happened"])
    payload = typed_payload(
        "log",
        {
            "level": level,
            "trace_mode": trace_mode,
            "payload": payload_value,
            "summary": summarize_preview_content(payload_value),
            "debug_trace": debug_trace,
        },
        {
            "level": level,
            "trace_mode": trace_mode,
            "summary": summarize_preview_content(payload_value),
            "what_happened": debug_trace["what_happened"],
        },
        {"level": level, "traceMode": trace_mode},
    )
    return NodeExecutionResult(outputs={"log": payload}, preview={"level": level, "payload": payload_value}, logs=[log])


def single_output_result(port_id: str, payload: TypedPayload, label: str, message: str) -> NodeExecutionResult:
    return NodeExecutionResult(
        outputs={port_id: payload},
        preview={"label": label, "output": payload.preview},
        logs=[log_entry("info", message)],
    )


def typed_payload(data_type: str, value: Any, preview: Any, metadata: dict[str, Any] | None = None) -> TypedPayload:
    return TypedPayload(data_type=data_type, value=value, preview=preview, metadata=metadata or {})


def extract_port_id(handle: str | None, prefix: str) -> str | None:
    expected_prefix = f"{prefix}:"
    if handle is None or not handle.startswith(expected_prefix):
        return None
    return handle[len(expected_prefix) :]


def first_payload_value(payloads: list[TypedPayload]) -> Any:
    return payloads[0].value if payloads else None


def merge_payload_values(payloads: list[TypedPayload]) -> Any:
    if not payloads:
        return None
    if len(payloads) == 1:
        return payloads[0].value
    values = [payload.value for payload in payloads]
    if all(isinstance(value, dict) for value in values):
        merged: dict[str, Any] = {}
        for value in values:
            merged.update(value)
        return merged
    return "\n".join(str(value) for value in values)


def flatten_document_payloads(payloads: list[TypedPayload]) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    for payload in payloads:
        value = payload.value
        if isinstance(value, dict) and "documents" in value:
            documents.extend(value["documents"])
        else:
            documents.append({"source_path": "inline", "text": str(value), "metadata": {"source": "inline"}})
    return documents


def evaluate_condition_rule(expression: str, value: Any) -> dict[str, Any]:
    text_value = "" if value is None else str(value)
    if expression.startswith("contains:"):
        needle = expression.split(":", 1)[1]
        return {"matched": needle.lower() in text_value.lower(), "rule": expression}
    if expression.startswith("equals:"):
        expected = expression.split(":", 1)[1]
        return {"matched": text_value == expected, "rule": expression}
    if expression == "exists":
        return {"matched": value not in (None, "", [], {}), "rule": expression}
    if expression == "boolean":
        return {"matched": bool(value), "rule": expression}
    return {"matched": bool(value), "rule": expression or "truthy"}


def evaluate_condition_rules(raw_rules: str, value: Any) -> dict[str, Any]:
    try:
        payload = json.loads(raw_rules)
    except json.JSONDecodeError:
        return {"matched": False, "rule": "invalid rules json", "error": "Rules must be valid JSON."}
    logic = str(payload.get("logic", "and")).lower() if isinstance(payload, dict) else "and"
    rules = payload.get("rules", []) if isinstance(payload, dict) else []
    evaluations = [evaluate_single_visual_rule(rule, value) for rule in rules if isinstance(rule, dict)]
    if not evaluations:
        return {"matched": bool(value), "rule": "empty visual rules", "evaluations": []}
    matched = any(item["matched"] for item in evaluations) if logic == "or" else all(item["matched"] for item in evaluations)
    return {"matched": matched, "rule": f"visual:{logic}", "logic": logic, "evaluations": evaluations}


def evaluate_single_visual_rule(rule: dict[str, Any], value: Any) -> dict[str, Any]:
    field = str(rule.get("field", "") or "")
    operator = str(rule.get("operator", "exists") or "exists")
    expected = rule.get("value", "")
    target = get_nested_value(value, field) if field and isinstance(value, dict) else value
    text_target = "" if target is None else str(target)
    if operator == "exists":
        matched = target not in (None, "", [], {})
    elif operator == "equals":
        matched = text_target == str(expected)
    elif operator == "contains":
        matched = str(expected).lower() in text_target.lower()
    elif operator == "boolean":
        matched = bool(target)
    else:
        matched = False
    return {"field": field, "operator": operator, "expected": expected, "actual_preview": preview_text(target), "matched": matched}


def merge_structured_payloads(
    mode: str,
    left_payloads: list[TypedPayload],
    right_payloads: list[TypedPayload],
    *,
    field_paths: list[str] | None = None,
) -> dict[str, Any]:
    left_values = [payload.value for payload in left_payloads]
    right_values = [payload.value for payload in right_payloads]
    by_port = {
        "left": left_values,
        "right": right_values,
    }
    all_values = left_values + right_values

    if mode == "json_merge":
        merged_object: dict[str, Any] = {}
        for value in all_values:
            if isinstance(value, dict):
                merged_object.update(value)
        combined_text = json.dumps(merged_object, default=str) if merged_object else ""
    elif mode == "template":
        combined_text = f"LEFT:\n{merge_payload_values(left_payloads)}\n\nRIGHT:\n{merge_payload_values(right_payloads)}"
        merged_object = {"template": combined_text}
    elif mode == "select_fields":
        source = merge_payload_values(left_payloads + right_payloads)
        selected = {path: get_nested_value(source, path) for path in (field_paths or []) if isinstance(source, dict)}
        merged_object = {"selected": selected}
        combined_text = json.dumps(selected, default=str)
    elif mode == "flatten_arrays":
        flattened: list[Any] = []
        for value in all_values:
            flattened.extend(normalize_items(value))
        merged_object = {"items": flattened}
        combined_text = json.dumps(flattened, default=str)
    elif mode == "dedupe_chunks":
        seen: set[str] = set()
        chunks: list[Any] = []
        for value in all_values:
            for item in normalize_items(value):
                key = json.dumps(item, sort_keys=True, default=str) if isinstance(item, (dict, list)) else str(item)
                if key not in seen:
                    seen.add(key)
                    chunks.append(item)
        merged_object = {"items": chunks, "deduplicated_count": len(chunks)}
        combined_text = json.dumps(chunks, default=str)
    elif mode == "preserve_metadata":
        merged_object = {
            "values": all_values,
            "metadata": [payload.metadata for payload in left_payloads + right_payloads],
        }
        combined_text = json.dumps(merged_object, default=str)
    else:
        combined_text = "\n".join(str(value) for value in all_values if value not in (None, ""))
        merged_object = {"text": combined_text}

    return {
        "mode": mode,
        "input_count": len(all_values),
        "by_port": by_port,
        "combined_text": combined_text,
        "merged_object": merged_object,
    }


def parse_field_paths(raw: Any) -> list[str]:
    return [item.strip() for item in str(raw or "").replace("\n", ",").split(",") if item.strip()]


def split_text_sections(content: str, *, mode: str, max_chars: int) -> list[dict[str, Any]]:
    if mode == "headings":
        raw_sections = re.split(r"\n(?=#+\s+|[A-Z][^\n]{2,80}\n)", content)
    else:
        raw_sections = re.split(r"\n\s*\n", content)
    sections: list[dict[str, Any]] = []
    for raw in raw_sections:
        text = raw.strip()
        if not text:
            continue
        while len(text) > max_chars:
            chunk, text = text[:max_chars], text[max_chars:]
            sections.append({"index": len(sections), "title": f"Section {len(sections) + 1}", "text": chunk.strip()})
        if text.strip():
            title = text.splitlines()[0][:80] if text.splitlines() else f"Section {len(sections) + 1}"
            sections.append({"index": len(sections), "title": title, "text": text.strip()})
    return sections


def extract_simple_tables(content: str, delimiter: str) -> list[dict[str, Any]]:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if delimiter == "auto":
        delimiter = "," if any("," in line for line in lines) else "|" if any("|" in line for line in lines) else "\t"
    table_lines = [line for line in lines if delimiter in line]
    if not table_lines:
        return []
    rows = [[cell.strip() for cell in line.strip("|").split(delimiter)] for line in table_lines]
    headers = rows[0]
    data_rows = []
    for row in rows[1:]:
        if len(row) == len(headers):
            data_rows.append(dict(zip(headers, row, strict=False)))
        else:
            data_rows.append({"cells": row})
    return [{"headers": headers, "rows": data_rows}]


def unwrap_json_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        if "data" in value and isinstance(value["data"], dict):
            return value["data"]
        if "extracted" in value and isinstance(value["extracted"], dict):
            return value["extracted"]
        return value
    if isinstance(value, str):
        parsed = parse_json_or_text(value, fallback_key="value")
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    return {"value": value}


def format_citations(citations: list[dict[str, Any]], chunks: list[dict[str, Any]], style: str) -> str:
    if citations:
        lines = []
        for index, citation in enumerate(citations, start=1):
            title = citation.get("title") or citation.get("source_path") or f"Source {index}"
            prefix = f"[{index}]" if style == "numbered" else "-"
            lines.append(f"{prefix} {title}")
        return "\n".join(lines)
    if chunks:
        return "\n".join(f"[{index}] {chunk.get('snippet', '')}" for index, chunk in enumerate(chunks, start=1))
    return "No citations available."


def parse_mappings(raw: str) -> list[tuple[str, str]]:
    mappings: list[tuple[str, str]] = []
    for line in raw.replace(",", "\n").splitlines():
        if ":" not in line:
            continue
        source, target = line.split(":", 1)
        source_key = source.strip()
        target_key = target.strip()
        if source_key and target_key:
            mappings.append((source_key, target_key))
    return mappings


def parse_schema_fields(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return [field for field in raw if isinstance(field, dict)]
    text = str(raw or "").strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return [
            {"name": line.strip().lstrip("-").split(":", 1)[0].strip(), "type": "string", "required": True}
            for line in text.splitlines()
            if line.strip()
        ]
    if isinstance(parsed, list):
        return [field for field in parsed if isinstance(field, dict)]
    if isinstance(parsed, dict):
        return [{"name": key, **(value if isinstance(value, dict) else {"type": str(value)})} for key, value in parsed.items()]
    return []


def get_nested_value(source: dict[str, Any], key: str) -> Any:
    value: Any = source
    for part in key.split("."):
        if isinstance(value, dict):
            value = value.get(part)
        else:
            return None
    return value


def normalize_items(value: Any) -> list[Any]:
    if isinstance(value, dict):
        for key in ("items", "rows", "sections", "matches"):
            if isinstance(value.get(key), list):
                return value[key]
        return [value]
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        return [line.strip() for line in value.splitlines() if line.strip()]
    return [] if value is None else [value]


def normalize_rows(value: Any) -> list[dict[str, Any]]:
    items = normalize_items(value)
    rows: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, dict):
            rows.append({key: preview_text(val, 500) if isinstance(val, (dict, list)) else val for key, val in item.items()})
        else:
            rows.append({"value": item})
    return rows or [{"value": value}]


def build_preview_cards(content: Any, mode: str) -> list[dict[str, Any]]:
    summary = summarize_preview_content(content)
    cards = [{"type": "summary", "title": "Summary", "value": summary}]
    if isinstance(content, dict):
        if content.get("citations") or content.get("source_chunks"):
            cards.append({"type": "citations", "title": "Sources", "value": content.get("citations") or content.get("source_chunks")})
        if content.get("errors") or content.get("error"):
            cards.append({"type": "error", "title": "Errors", "value": content.get("errors") or content.get("error")})
        numeric_items = {key: value for key, value in content.items() if isinstance(value, (int, float))}
        if numeric_items:
            cards.append({"type": "metrics", "title": "Metrics", "value": numeric_items})
        if content.get("files") or content.get("documents"):
            cards.append({"type": "files", "title": "Files", "value": content.get("files") or content.get("documents")})
    if mode in {"json", "auto"}:
        cards.append({"type": "json", "title": "JSON", "value": content})
    return cards


def build_debug_trace(payload_value: Any, payload_inputs: list[TypedPayload], trace_mode: str) -> dict[str, Any]:
    input_types = [payload.data_type for payload in payload_inputs]
    summary = summarize_preview_content(payload_value)
    if trace_mode == "raw":
        what_happened = f"Logger captured raw payload with {len(payload_inputs)} input(s)."
    elif trace_mode == "failure_analysis":
        what_happened = "Logger prepared failure analysis context for the incoming payload."
    else:
        what_happened = f"Logger captured {len(payload_inputs)} input(s): {preview_text(summary)}"
    return {
        "what_happened": what_happened,
        "why_this_ran": "A connected upstream node produced data for the Logger payload input.",
        "data_entered": {"input_count": len(payload_inputs), "input_types": input_types},
        "data_exited": {"output_type": "log", "summary": summary},
        "what_failed": payload_value.get("error") if isinstance(payload_value, dict) else None,
    }


def render_csv(rows: list[dict[str, Any]]) -> str:
    headers: list[str] = []
    for row in rows:
        for key in row:
            if key not in headers:
                headers.append(key)
    lines = [",".join(csv_escape(header) for header in headers)]
    for row in rows:
        lines.append(",".join(csv_escape(row.get(header, "")) for header in headers))
    return "\n".join(lines) + "\n"


def csv_escape(value: Any) -> str:
    text = str(value)
    if any(char in text for char in [",", '"', "\n"]):
        return '"' + text.replace('"', '""') + '"'
    return text


def redact_pii(text: str) -> tuple[str, dict[str, int]]:
    email_pattern = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
    phone_pattern = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)")
    redacted, email_count = email_pattern.subn("[REDACTED_EMAIL]", text)
    redacted, phone_count = phone_pattern.subn("[REDACTED_PHONE]", redacted)
    return redacted, {"emails": email_count, "phones": phone_count}


def persist_and_load_conversation_memory(
    *,
    context: ExecutionContext,
    node_id: str,
    namespace: str,
    messages: list[str],
    window_size: int,
) -> list[str]:
    for message in messages:
        context.session.add(
            ConversationMemoryMessage(
                workflow_id=context.workflow.id,
                workflow_run_id=context.workflow_run.id,
                node_id=node_id,
                session_id=context.session_id,
                user_id=context.user_id,
                namespace=namespace,
                role="message",
                content=message,
                metadata_json={"source": "conversation_memory"},
            )
        )
    context.session.flush()

    statement = (
        select(ConversationMemoryMessage)
        .where(
            ConversationMemoryMessage.workflow_id == context.workflow.id,
            ConversationMemoryMessage.session_id == context.session_id,
            ConversationMemoryMessage.user_id == context.user_id,
            ConversationMemoryMessage.namespace == namespace,
        )
        .order_by(ConversationMemoryMessage.id.desc())
        .limit(window_size)
    )
    rows = list(context.session.scalars(statement))
    history = [row.content for row in reversed(rows)]
    context.memory_store[namespace] = history
    return history


def build_chatbot_messages(
    *,
    system_prompt: str,
    user_message: str,
    context_text: str,
    memory_text: str,
    answer_style: str = "conversational",
    output_mode: str = "chat",
    response_schema: str = "",
) -> list[LlmMessage]:
    system_sections = []
    if system_prompt.strip():
        system_sections.append(system_prompt.strip())
    system_sections.append(format_answer_style_instructions(answer_style))
    system_sections.append(format_output_mode_instructions(output_mode, response_schema))
    if context_text.strip():
        system_sections.append(
            "Retrieved evidence:\n"
            f"{context_text.strip()}\n\n"
            "Use the evidence only when it helps answer the user. Do not paste the evidence verbatim. "
            "Synthesize a natural answer. If the evidence is insufficient, say what is missing instead of guessing."
        )
    if memory_text.strip():
        system_sections.append(f"Conversation memory:\n{memory_text.strip()}")

    messages: list[LlmMessage] = []
    if system_sections:
        messages.append(LlmMessage(role="system", content="\n\n".join(system_sections)))
    messages.append(LlmMessage(role="user", content=user_message))
    return messages


def format_answer_style_instructions(answer_style: str) -> str:
    styles = {
        "concise": (
            "Answer style: concise. Reply in 1-3 short paragraphs, avoid long quoted passages, "
            "and only include essential details."
        ),
        "detailed": (
            "Answer style: detailed. Explain clearly with useful structure, but still synthesize "
            "instead of dumping raw retrieved chunks."
        ),
        "conversational": (
            "Answer style: conversational. Respond like a normal helpful chatbot: direct, natural, "
            "and easy to read. Do not output raw retrieved lines."
        ),
    }
    return styles.get(answer_style, styles["conversational"])


def format_output_mode_instructions(output_mode: str, response_schema: str = "") -> str:
    modes = {
        "chat": "Output mode: chat answer. Return a natural answer for an end user.",
        "markdown_report": "Output mode: markdown report. Use clear headings, bullets, and a short conclusion.",
        "decision_memo": "Output mode: decision memo. Include decision, rationale, evidence, risks, and next actions.",
        "table": "Output mode: table. Prefer a compact markdown table plus a one-sentence takeaway.",
        "json_schema": (
            "Output mode: JSON schema. Return valid JSON only, with no markdown fences. "
            f"Schema to follow: {response_schema or '{\"answer\":\"string\",\"citations\":[],\"confidence\":0.0}'}"
        ),
    }
    return modes.get(output_mode, modes["chat"])


def render_chatbot_context(context_value: Any) -> str:
    if isinstance(context_value, dict):
        if "matches" in context_value:
            rendered_matches = []
            for index, match in enumerate(context_value.get("matches", []), start=1):
                metadata = match.get("metadata", {})
                title = metadata.get("title") or metadata.get("source_path") or f"Source {index}"
                rendered_matches.append(
                    f"[Source {index}: {title}]\n"
                    f"Excerpt: {match.get('snippet', '')}\n"
                    f"Metadata: {json.dumps(metadata, default=str)}"
                )
            return "\n\n".join(rendered_matches)
        return json.dumps(context_value, indent=2, default=str)
    return str(context_value) if context_value is not None else ""


def render_content_payloads(payloads: list[TypedPayload]) -> str:
    rendered: list[str] = []
    for payload in payloads:
        value = payload.value
        if payload.data_type == "document":
            documents = flatten_document_payloads([payload])
            rendered.extend(str(document.get("text", "")) for document in documents)
            continue
        if payload.data_type == "knowledge" and isinstance(value, dict):
            rendered.append(render_chatbot_context(value))
            continue
        if isinstance(value, dict):
            if "combined_text" in value:
                rendered.append(str(value["combined_text"]))
            elif "text" in value:
                rendered.append(str(value["text"]))
            else:
                rendered.append(json.dumps(value, indent=2, default=str))
            continue
        rendered.append(str(value))
    return "\n\n".join(item for item in rendered if item.strip())


def parse_label_list(raw_labels: str) -> list[str]:
    labels: list[str] = []
    for line in raw_labels.replace(",", "\n").splitlines():
        label = line.strip()
        if label:
            labels.append(label)
    return labels or ["other"]


def parse_json_or_text(raw_text: str, *, fallback_key: str) -> Any:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {fallback_key: raw_text}


def render_memory_context(context_payloads: list[TypedPayload]) -> str:
    memory_sections = []
    for payload in context_payloads:
        if payload.data_type == "memory" and isinstance(payload.value, dict):
            history = payload.value.get("history", [])
            if history:
                memory_sections.append("\n".join(str(item) for item in history))
    return "\n\n".join(memory_sections)


def extract_citations(context_payloads: list[TypedPayload]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    seen = set()
    for payload in context_payloads:
        if payload.data_type != "knowledge":
            continue
        value = payload.value if isinstance(payload.value, dict) else {}
        for match in value.get("matches", []):
            metadata = match.get("metadata", {})
            key = (
                match.get("chunk_id"),
                metadata.get("document_id"),
                metadata.get("title"),
            )
            if key in seen:
                continue
            seen.add(key)
            citations.append(
                {
                    "chunk_id": match.get("chunk_id"),
                    "document_id": metadata.get("document_id"),
                    "title": metadata.get("title"),
                    "source_path": metadata.get("source_path"),
                    "score": match.get("score"),
                }
            )
    return citations


def append_citations(answer_text: str, citations: list[dict[str, Any]]) -> str:
    if not citations:
        return answer_text
    citation_lines = []
    for index, citation in enumerate(citations, start=1):
        title = citation.get("title") or citation.get("source_path") or "source"
        source_path = citation.get("source_path")
        score = citation.get("score")
        citation_lines.append(
            f"[{index}] {title}"
            + (f" ({source_path})" if source_path else "")
            + (f" score={score}" if score is not None else "")
        )
    return f"{answer_text}\n\nSources:\n" + "\n".join(citation_lines)


def collect_payload_citations(payloads: list[TypedPayload]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for payload in payloads:
        metadata_citations = payload.metadata.get("citations", []) if isinstance(payload.metadata, dict) else []
        if isinstance(metadata_citations, list):
            citations.extend(metadata_citations)
        if isinstance(payload.value, dict) and "citations" in payload.value and isinstance(payload.value["citations"], list):
            citations.extend(payload.value["citations"])
    return dedupe_citations(citations)


def collect_source_chunks(payloads: list[TypedPayload]) -> list[dict[str, Any]]:
    source_chunks: list[dict[str, Any]] = []
    for payload in payloads:
        metadata_chunks = payload.metadata.get("source_chunks", []) if isinstance(payload.metadata, dict) else []
        if isinstance(metadata_chunks, list):
            source_chunks.extend(metadata_chunks)
        if isinstance(payload.value, dict) and "source_chunks" in payload.value and isinstance(payload.value["source_chunks"], list):
            source_chunks.extend(payload.value["source_chunks"])
        if payload.data_type == "knowledge" and isinstance(payload.value, dict):
            for match in payload.value.get("matches", []):
                source_chunks.append(
                    {
                        "chunk_id": match.get("chunk_id"),
                        "snippet": match.get("snippet"),
                        "metadata": match.get("metadata", {}),
                        "score": match.get("score"),
                    }
                )
    return source_chunks


def dedupe_citations(citations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen = set()
    for citation in citations:
        key = (
            citation.get("chunk_id"),
            citation.get("document_id"),
            citation.get("title"),
            citation.get("source_path"),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(citation)
    return deduped


def summarize_preview_content(content: Any) -> dict[str, Any]:
    if isinstance(content, dict):
        return {
            "type": "object",
            "keys": sorted(content.keys()),
            "preview": preview_text(content),
        }
    if isinstance(content, list):
        return {
            "type": "list",
            "length": len(content),
            "preview": preview_text(content),
        }
    return {
        "type": type(content).__name__,
        "preview": preview_text(content),
    }


def preview_text(value: Any, limit: int = 180) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= limit else f"{text[:limit]}..."


def log_entry(level: str, message: str) -> dict[str, Any]:
    return {"level": level, "message": message, "timestamp": iso_now()}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def elapsed_ms(started_perf: float) -> int:
    return int((perf_counter() - started_perf) * 1000)


def _runtime_inputs_to_dict(inputs: dict[str, RuntimeNodeInput]) -> dict[str, Any]:
    return {
        node_id: {
            "value": runtime_input.value,
            "files": runtime_input.files,
            "metadata": runtime_input.metadata,
        }
        for node_id, runtime_input in inputs.items()
    }


def resolve_uploaded_file(context: ExecutionContext, upload_entry: Any) -> UploadedFile:
    upload_id = upload_entry.get("id") if isinstance(upload_entry, dict) else None
    if upload_id is None:
        raise ValueError("Text Extraction expects uploaded file metadata with an 'id'.")

    for uploaded_files in context.uploaded_files_by_node.values():
        for uploaded_file in uploaded_files:
            if uploaded_file.id == upload_id:
                return uploaded_file

    statement = select(UploadedFile).where(
        UploadedFile.id == upload_id,
        UploadedFile.workflow_id == context.workflow.id,
    )
    uploaded_file = context.session.scalar(statement)
    if uploaded_file is None:
        raise ValueError(f"Uploaded file with id '{upload_id}' was not found.")
    return uploaded_file
