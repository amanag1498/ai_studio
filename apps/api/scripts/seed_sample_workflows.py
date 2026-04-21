from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.db.session import SessionLocal, create_db_and_storage_dirs
from app.models.workflow import Workflow
from app.schemas.workflows import BuilderGraphPayload
from app.services.publish import publish_workflow, slugify
from app.services.workflows import create_workflow, get_workflow_or_404, update_workflow, validate_graph

SEED_DESCRIPTION = "Advanced seeded workflow for local testing."


@dataclass(frozen=True)
class Port:
    id: str
    label: str
    data_types: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "dataTypes": list(self.data_types)}


@dataclass(frozen=True)
class BlockSpec:
    block_type: str
    title: str
    kind: str
    category: str
    description: str
    accent_color: str
    icon: str
    inputs: tuple[Port, ...]
    outputs: tuple[Port, ...]
    config: dict[str, Any]


BLOCKS: dict[str, BlockSpec] = {
    "chat_input": BlockSpec(
        "chat_input",
        "Chat Input",
        "input",
        "Inputs",
        "Accept a user chat message at runtime.",
        "#0f766e",
        "CI",
        (),
        (Port("message", "Message", ("chat", "text")),),
        {"placeholder": "Ask me anything about this workflow.", "persistHistory": True},
    ),
    "text_input": BlockSpec(
        "text_input",
        "Text Input",
        "input",
        "Inputs",
        "Provide static text or a runtime text value.",
        "#2563eb",
        "TI",
        (),
        (Port("text", "Text", ("text",)),),
        {"defaultText": ""},
    ),
    "file_upload": BlockSpec(
        "file_upload",
        "File Upload",
        "input",
        "Inputs",
        "Accept runtime files from the builder and save them locally.",
        "#f2c66e",
        "FU",
        (),
        (Port("file", "File", ("file",)),),
        {
            "accept": ".pdf,.docx,.txt,.csv,.json",
            "multiple": False,
            "maxSizeMb": 10,
            "defaultLocalPaths": "",
        },
    ),
    "text_extraction": BlockSpec(
        "text_extraction",
        "Text Extraction",
        "knowledge",
        "Knowledge",
        "Extract normalized text and metadata from uploaded files.",
        "#74d4b6",
        "TE",
        (Port("file", "File", ("file",)),),
        (Port("document", "Document", ("document", "text")),),
        {"strategy": "auto"},
    ),
    "rag_knowledge": BlockSpec(
        "rag_knowledge",
        "RAG Knowledge",
        "processor",
        "Knowledge",
        "Ingest documents and retrieve relevant source chunks for a query.",
        "#7c3aed",
        "RK",
        (
            Port("document", "Document", ("document", "text")),
            Port("query", "Query", ("chat", "text")),
        ),
        (Port("knowledge", "Knowledge", ("knowledge",)),),
        {
            "ingestMode": "ingest_and_retrieve",
            "collection": "sample-knowledge",
            "chunkSize": 500,
            "overlap": 80,
            "topK": 3,
            "tags": "sample",
            "allowedFileTypes": ".pdf,.docx,.txt,.csv,.json",
        },
    ),
    "chatbot": BlockSpec(
        "chatbot",
        "Chatbot",
        "ai",
        "AI",
        "Generate an answer with the configured LLM provider.",
        "#db2777",
        "CB",
        (
            Port("message", "Message", ("chat", "text")),
            Port("context", "Context", ("knowledge", "text", "json")),
        ),
        (
            Port("reply", "Reply", ("chat", "text")),
            Port("json", "JSON", ("json",)),
        ),
        {
            "model": "openai/gpt-4o-mini",
            "systemPrompt": "You are a concise, helpful assistant.",
            "answerStyle": "conversational",
            "temperature": 0.2,
        },
    ),
    "summarizer": BlockSpec(
        "summarizer",
        "Summarizer",
        "agent",
        "AI",
        "Summarize documents, text, or retrieved knowledge.",
        "#67b8ff",
        "SU",
        (Port("content", "Content", ("text", "document", "knowledge")),),
        (Port("summary", "Summary", ("text", "json")),),
        {"model": "openai/gpt-4o-mini", "style": "concise bullets", "maxWords": 150},
    ),
    "classifier": BlockSpec(
        "classifier",
        "Classifier",
        "agent",
        "AI",
        "Classify documents or text into configured labels.",
        "#62b6b7",
        "CL",
        (Port("content", "Content", ("text", "document", "chat")),),
        (Port("classification", "Classification", ("json", "text")),),
        {
            "model": "openai/gpt-4o-mini",
            "labels": "policy\ncontract\ninvoice\nsupport\nother",
            "multiLabel": False,
        },
    ),
    "extraction_ai": BlockSpec(
        "extraction_ai",
        "Extraction AI",
        "agent",
        "AI",
        "Extract structured JSON fields from text or documents.",
        "#6ad3c8",
        "EA",
        (Port("content", "Content", ("text", "document")),),
        (Port("json", "JSON", ("json",)),),
        {
            "model": "openai/gpt-4o-mini",
            "schemaPrompt": "Return JSON with keys: title, summary, important_dates, action_items, risks",
            "strictMode": True,
        },
    ),
    "conversation_memory": BlockSpec(
        "conversation_memory",
        "Conversation Memory",
        "memory",
        "Memory",
        "Persist recent chat messages by workflow, session, and user.",
        "#9333ea",
        "CM",
        (Port("message", "Message", ("chat", "text")),),
        (Port("memory", "Memory", ("memory", "text")),),
        {"namespace": "sample-session", "windowSize": 6},
    ),
    "merge": BlockSpec(
        "merge",
        "Merge",
        "logic",
        "Logic",
        "Combine two upstream payloads into one structured payload.",
        "#f97316",
        "MG",
        (
            Port("left", "Left", ("text", "chat", "json", "knowledge", "any")),
            Port("right", "Right", ("text", "chat", "json", "knowledge", "any")),
        ),
        (Port("merged", "Merged", ("text", "json", "any")),),
        {"mode": "append"},
    ),
    "condition": BlockSpec(
        "condition",
        "Condition",
        "logic",
        "Logic",
        "Branch based on a simple exists, equals, contains, or boolean rule.",
        "#eab308",
        "CD",
        (Port("value", "Value", ("text", "chat", "boolean", "json")),),
        (
            Port("true", "True", ("any",)),
            Port("false", "False", ("any",)),
        ),
        {"expression": "contains:urgent"},
    ),
    "chat_output": BlockSpec(
        "chat_output",
        "Chat Output",
        "output",
        "Outputs",
        "Show a final chat answer with citations when available.",
        "#16a34a",
        "CO",
        (Port("message", "Message", ("chat", "text")),),
        (),
        {"stream": True},
    ),
    "json_output": BlockSpec(
        "json_output",
        "JSON Output",
        "output",
        "Outputs",
        "Show structured JSON output.",
        "#0891b2",
        "JO",
        (Port("payload", "Payload", ("json", "text")),),
        (),
        {"prettyPrint": True},
    ),
    "dashboard_preview": BlockSpec(
        "dashboard_preview",
        "Dashboard/Preview",
        "output",
        "Outputs",
        "Preview intermediate or final payloads in a dashboard-friendly shape.",
        "#4f46e5",
        "DP",
        (Port("content", "Content", ("text", "json", "preview", "chat")),),
        (),
        {"view": "auto"},
    ),
    "logger": BlockSpec(
        "logger",
        "Logger",
        "system",
        "System",
        "Persist a readable debugging log for upstream payloads.",
        "#475569",
        "LG",
        (Port("payload", "Payload", ("any", "text", "json", "chat")),),
        (Port("log", "Log", ("log",)),),
        {"level": "info"},
    ),
    "prompt_template": BlockSpec(
        "prompt_template",
        "Prompt Template",
        "agent",
        "AI",
        "Render a reusable prompt from upstream variables.",
        "#5b8def",
        "PT",
        (Port("variables", "Variables", ("text", "json", "chat", "document", "knowledge", "any")),),
        (Port("prompt", "Prompt", ("text",)),),
        {"template": "Use this context and produce a useful result:\n\n{{input}}"},
    ),
    "document_splitter": BlockSpec(
        "document_splitter",
        "Document Splitter",
        "knowledge",
        "Knowledge",
        "Split long documents into reviewable sections.",
        "#43c6ac",
        "DS",
        (Port("document", "Document", ("document", "text")),),
        (Port("sections", "Sections", ("json", "text")),),
        {"mode": "paragraphs", "maxChars": 1200},
    ),
    "table_extractor": BlockSpec(
        "table_extractor",
        "Table Extractor",
        "knowledge",
        "Knowledge",
        "Extract simple tables into JSON rows.",
        "#39b7dd",
        "TX",
        (Port("document", "Document", ("document", "text")),),
        (Port("tables", "Tables", ("json",)),),
        {"delimiter": "auto"},
    ),
    "schema_validator": BlockSpec(
        "schema_validator",
        "Schema Validator",
        "logic",
        "Logic",
        "Validate JSON for required fields.",
        "#f6ad55",
        "SV",
        (Port("payload", "Payload", ("json", "text")),),
        (Port("validation", "Validation", ("json", "boolean")),),
        {"requiredKeys": "summary\nrisks\nnext_actions"},
    ),
    "retry_fallback_llm": BlockSpec(
        "retry_fallback_llm",
        "Retry/Fallback LLM",
        "agent",
        "AI",
        "Run an LLM call with retry and fallback model metadata.",
        "#7c8cff",
        "RF",
        (Port("prompt", "Prompt", ("text", "chat")),),
        (Port("reply", "Reply", ("chat", "text")), Port("json", "Telemetry", ("json",))),
        {
            "model": "openai/gpt-4o-mini",
            "fallbackModel": "openai/gpt-4o-mini",
            "systemPrompt": "You are a reliable assistant.",
            "temperature": 0.2,
            "maxRetries": 1,
        },
    ),
    "citation_formatter": BlockSpec(
        "citation_formatter",
        "Citation Formatter",
        "output",
        "Outputs",
        "Format RAG citations and source chunks.",
        "#65d6ad",
        "CF",
        (Port("sources", "Sources", ("knowledge", "chat", "json")),),
        (Port("text", "Text", ("text",)), Port("json", "JSON", ("json",))),
        {"style": "numbered"},
    ),
    "form_input": BlockSpec(
        "form_input",
        "Form Input",
        "input",
        "Inputs",
        "Capture structured runtime form data.",
        "#ffbd59",
        "FI",
        (),
        (Port("json", "JSON", ("json",)), Port("text", "Text", ("text",))),
        {"fields": "name:text\nemail:text\nrequest:textarea", "defaultValues": '{"name":"Aman","request":"Review the uploaded file"}'},
    ),
    "webhook_trigger": BlockSpec(
        "webhook_trigger",
        "Webhook Trigger",
        "input",
        "Inputs",
        "Accept or simulate an incoming webhook payload.",
        "#ff9f68",
        "WH",
        (),
        (Port("payload", "Payload", ("json",)),),
        {"samplePayload": '{"event":"document.created","priority":"urgent","text":"Please review this."}'},
    ),
    "http_request": BlockSpec(
        "http_request",
        "HTTP Request",
        "system",
        "System",
        "Prepare a safe external API request payload.",
        "#7785ff",
        "HR",
        (Port("body", "Body", ("json", "text", "any")),),
        (Port("response", "Response", ("json",)),),
        {"method": "POST", "url": "https://example.com/api/review", "enableRequest": False},
    ),
    "data_mapper": BlockSpec(
        "data_mapper",
        "Data Mapper",
        "logic",
        "Logic",
        "Map and rename JSON fields.",
        "#ff9f9f",
        "DM",
        (Port("input", "Input", ("json", "text", "any")),),
        (Port("mapped", "Mapped", ("json",)),),
        {"mappings": "extracted.summary:summary\nextracted.risks:risks\nextracted.next_actions:next_actions"},
    ),
    "loop_for_each": BlockSpec(
        "loop_for_each",
        "Loop / For Each",
        "logic",
        "Logic",
        "Normalize lists into iterable items.",
        "#f59e0b",
        "LF",
        (Port("items", "Items", ("json", "text", "any")),),
        (Port("items", "Items", ("json",)),),
        {"limit": 25},
    ),
    "approval_step": BlockSpec(
        "approval_step",
        "Approval Step",
        "logic",
        "Logic",
        "Gate a workflow with an MVP approval decision.",
        "#ff9b5c",
        "AP",
        (Port("request", "Request", ("text", "json", "chat")),),
        (Port("approved", "Approved", ("any",)), Port("rejected", "Rejected", ("any",))),
        {"defaultDecision": "approved"},
    ),
    "email_sender": BlockSpec(
        "email_sender",
        "Email Sender",
        "output",
        "Outputs",
        "Prepare an email provider payload.",
        "#ffb347",
        "ES",
        (Port("content", "Content", ("text", "json", "chat")),),
        (Port("status", "Status", ("json", "text")),),
        {"to": "reviewer@example.com", "subject": "AI Studio workflow result"},
    ),
    "slack_notification": BlockSpec(
        "slack_notification",
        "Slack/Teams Notification",
        "output",
        "Outputs",
        "Prepare a team notification payload.",
        "#ffc36f",
        "SN",
        (Port("content", "Content", ("text", "json", "chat")),),
        (Port("status", "Status", ("json", "text")),),
        {"channel": "#ai-studio"},
    ),
    "database_writer": BlockSpec(
        "database_writer",
        "Database Writer",
        "system",
        "System",
        "Capture a row as local run evidence.",
        "#5d9cef",
        "DW",
        (Port("row", "Row", ("json", "text", "any")),),
        (Port("record", "Record", ("json",)),),
        {"table": "workflow_results"},
    ),
    "csv_excel_export": BlockSpec(
        "csv_excel_export",
        "CSV/Excel Export",
        "output",
        "Outputs",
        "Export structured rows to a local CSV file.",
        "#4dd0e1",
        "CE",
        (Port("data", "Data", ("json", "text", "any")),),
        (Port("file", "File", ("file", "json")),),
        {"filename": "workflow-export.csv"},
    ),
    "pii_redactor": BlockSpec(
        "pii_redactor",
        "PII Redactor",
        "system",
        "System",
        "Mask emails and phone numbers.",
        "#f26b6b",
        "PR",
        (Port("content", "Content", ("text", "json", "chat")),),
        (Port("redacted", "Redacted", ("text",)), Port("json", "Stats", ("json",))),
        {"redactEmails": True, "redactPhones": True},
    ),
    "guardrail": BlockSpec(
        "guardrail",
        "Guardrail",
        "system",
        "System",
        "Route content by simple policy checks.",
        "#f26b6b",
        "GR",
        (Port("content", "Content", ("text", "json", "chat", "any")),),
        (Port("safe", "Safe", ("any",)), Port("blocked", "Blocked", ("any",))),
        {"blockedTerms": "password\nsecret\napi key"},
    ),
    "router_switch": BlockSpec(
        "router_switch",
        "Router / Switch",
        "logic",
        "Logic",
        "Select a route from configured keywords.",
        "#ffa65c",
        "RS",
        (Port("input", "Input", ("text", "json", "chat")),),
        (Port("route", "Route", ("any",)),),
        {"routes": "urgent\nbilling\ntechnical\ndefault", "defaultRoute": "default"},
    ),
    "long_term_memory": BlockSpec(
        "long_term_memory",
        "Long-Term Memory",
        "memory",
        "Memory",
        "Persist durable facts across runs.",
        "#9a7dff",
        "LM",
        (Port("content", "Content", ("text", "chat", "memory", "knowledge")),),
        (Port("memory", "Memory", ("memory", "knowledge", "text")),),
        {"scope": "workflow", "maxFacts": 20},
    ),
}


def node(block_type: str, node_id: str, x: int, y: int, config: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = BLOCKS[block_type]
    return {
        "id": node_id,
        "type": "builderBlock",
        "position": {"x": x, "y": y},
        "data": {
            "blockType": spec.block_type,
            "label": spec.title,
            "kind": spec.kind,
            "category": spec.category,
            "description": spec.description,
            "accentColor": spec.accent_color,
            "icon": spec.icon,
            "inputs": [port.as_dict() for port in spec.inputs],
            "outputs": [port.as_dict() for port in spec.outputs],
            "config": {**spec.config, **(config or {})},
        },
    }


def edge(source: str, source_port: str, target: str, target_port: str, label: str) -> dict[str, Any]:
    return {
        "id": f"edge-{source}-{source_port}-{target}-{target_port}",
        "source": source,
        "sourceHandle": f"out:{source_port}",
        "target": target,
        "targetHandle": f"in:{target_port}",
        "label": label,
    }


def graph(graph_id: str, name: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return {"id": graph_id, "name": name, "version": 1, "nodes": nodes, "edges": edges}


def sample_policy_text() -> str:
    policy_path = Path(__file__).resolve().parents[3] / "storage" / "sample_company_policy.txt"
    return policy_path.read_text(encoding="utf-8")


def sample_security_text() -> str:
    return (
        "Security Handbook\n"
        "All employees must use multi-factor authentication for company systems. "
        "Customer data may not be copied to personal devices. Incidents should be reported "
        "to security within one hour. Vendor access must be reviewed every quarter."
    )


def sample_benefits_text() -> str:
    return (
        "Benefits Guide\n"
        "Employees receive 20 paid vacation days, 10 sick days, and health insurance after "
        "30 days of employment. Learning stipends are capped at $1,500 per year. Parental "
        "leave is 12 weeks for primary caregivers and 6 weeks for secondary caregivers."
    )


def sample_invoice_text() -> str:
    return (
        "Invoice INV-2048\n"
        "Vendor: Northstar Supplies\n"
        "Customer: Acme Operations\n"
        "Invoice date: 2026-04-01\n"
        "Due date: 2026-04-30\n"
        "Line items: Ergonomic chairs $2,400; Monitor arms $850; Delivery $120\n"
        "Total due: $3,370\n"
        "Payment terms: Net 30\n"
    )


def build_samples() -> list[dict[str, Any]]:
    return [
        graph(
            "advanced-full-stack-document-ops",
            "Advanced: Full-Stack Document Ops",
            [
                node("form_input", "form_input-1", 40, 40, {"defaultValues": '{"name":"Aman","email":"aman@example.com","request":"Extract risks and create an approval brief."}'}),
                node("webhook_trigger", "webhook_trigger-1", 40, 250),
                node("file_upload", "file_upload-1", 40, 470, {"defaultLocalPaths": "storage/sample_company_policy.txt"}),
                node("text_extraction", "text_extraction-1", 330, 470),
                node("document_splitter", "document_splitter-1", 640, 320, {"mode": "paragraphs", "maxChars": 700}),
                node("table_extractor", "table_extractor-1", 640, 520),
                node("pii_redactor", "pii_redactor-1", 640, 720),
                node("rag_knowledge", "rag_knowledge-1", 950, 240, {"collection": "advanced-full-stack-ops", "chunkSize": 260, "overlap": 45, "topK": 4, "tags": "full-stack,ops"}),
                node("extraction_ai", "extraction_ai-1", 950, 470, {"schemaPrompt": "Return JSON with keys: summary, risks, owners, next_actions, approval_needed"}),
                node("schema_validator", "schema_validator-1", 1260, 450, {"requiredKeys": "summary\nrisks\nnext_actions"}),
                node("data_mapper", "data_mapper-1", 1260, 640, {"mappings": "extracted.summary:summary\nextracted.risks:risks\nextracted.next_actions:next_actions"}),
                node("loop_for_each", "loop_for_each-1", 1260, 820, {"limit": 12}),
                node("csv_excel_export", "csv_excel_export-1", 1580, 820, {"filename": "document-ops-export.csv"}),
                node("citation_formatter", "citation_formatter-1", 1260, 230),
                node("prompt_template", "prompt_template-1", 1580, 240, {"template": "Create an approval-ready response from this context:\n\n{{input}}"}),
                node("retry_fallback_llm", "retry_fallback_llm-1", 1900, 240, {"systemPrompt": "You produce concise approval memos with citations and action items.", "maxRetries": 1}),
                node("guardrail", "guardrail-1", 2220, 240, {"blockedTerms": "secret\npassword\napi key"}),
                node("approval_step", "approval_step-1", 2540, 240, {"defaultDecision": "approved"}),
                node("email_sender", "email_sender-1", 2860, 120, {"to": "reviewer@example.com", "subject": "Document approval memo"}),
                node("slack_notification", "slack_notification-1", 2860, 300, {"channel": "#document-ops"}),
                node("http_request", "http_request-1", 2860, 480, {"method": "POST", "url": "https://example.com/approval", "enableRequest": False}),
                node("database_writer", "database_writer-1", 2860, 660, {"table": "approval_runs"}),
                node("router_switch", "router_switch-1", 330, 250, {"routes": "urgent\nnormal\ndefault", "defaultRoute": "default"}),
                node("long_term_memory", "long_term_memory-1", 330, 40, {"scope": "document_ops", "maxFacts": 20}),
                node("dashboard_preview", "dashboard_preview-1", 3180, 220),
                node("json_output", "json_output-1", 3180, 520),
                node("logger", "logger-1", 3180, 720, {"level": "info"}),
            ],
            [
                edge("form_input-1", "text", "long_term_memory-1", "content", "remember form request"),
                edge("webhook_trigger-1", "payload", "router_switch-1", "input", "route webhook"),
                edge("file_upload-1", "file", "text_extraction-1", "file", "uploaded/default document"),
                edge("text_extraction-1", "document", "document_splitter-1", "document", "split sections"),
                edge("text_extraction-1", "document", "table_extractor-1", "document", "extract tables"),
                edge("text_extraction-1", "document", "pii_redactor-1", "content", "redact before AI"),
                edge("pii_redactor-1", "redacted", "rag_knowledge-1", "document", "safe RAG ingest"),
                edge("form_input-1", "text", "rag_knowledge-1", "query", "form question"),
                edge("pii_redactor-1", "redacted", "extraction_ai-1", "content", "extract fields"),
                edge("extraction_ai-1", "json", "schema_validator-1", "payload", "validate fields"),
                edge("extraction_ai-1", "json", "data_mapper-1", "input", "map fields"),
                edge("document_splitter-1", "sections", "loop_for_each-1", "items", "loop sections"),
                edge("loop_for_each-1", "items", "csv_excel_export-1", "data", "export sections"),
                edge("rag_knowledge-1", "knowledge", "citation_formatter-1", "sources", "format sources"),
                edge("citation_formatter-1", "text", "prompt_template-1", "variables", "citation prompt"),
                edge("prompt_template-1", "prompt", "retry_fallback_llm-1", "prompt", "approval prompt"),
                edge("retry_fallback_llm-1", "reply", "guardrail-1", "content", "policy check"),
                edge("guardrail-1", "safe", "approval_step-1", "request", "safe approval request"),
                edge("approval_step-1", "approved", "email_sender-1", "content", "email reviewer"),
                edge("approval_step-1", "approved", "slack_notification-1", "content", "notify channel"),
                edge("approval_step-1", "approved", "http_request-1", "body", "prepared API call"),
                edge("data_mapper-1", "mapped", "database_writer-1", "row", "capture mapped row"),
                edge("email_sender-1", "status", "dashboard_preview-1", "content", "status preview"),
                edge("http_request-1", "response", "json_output-1", "payload", "api payload"),
                edge("database_writer-1", "record", "logger-1", "payload", "database audit"),
            ],
        ),
        graph(
            "advanced-enterprise-policy-copilot",
            "Advanced: Enterprise Policy Copilot",
            [
                node("text_input", "policy_text-1", 60, 40, {"defaultText": sample_policy_text()}),
                node("text_input", "security_text-1", 60, 230, {"defaultText": sample_security_text()}),
                node("text_input", "benefits_text-1", 60, 420, {"defaultText": sample_benefits_text()}),
                node(
                    "chat_input",
                    "chat_input-1",
                    390,
                    520,
                    {"placeholder": "Can I work from home and what security rules apply?"},
                ),
                node(
                    "conversation_memory",
                    "conversation_memory-1",
                    390,
                    690,
                    {"namespace": "enterprise-policy-copilot", "windowSize": 10},
                ),
                node(
                    "rag_knowledge",
                    "rag_knowledge-1",
                    430,
                    210,
                    {
                        "collection": "advanced-enterprise-policy",
                        "chunkSize": 280,
                        "overlap": 55,
                        "topK": 6,
                        "tags": "policy,security,benefits,advanced",
                    },
                ),
                node(
                    "chatbot",
                    "chatbot-1",
                    790,
                    305,
                    {
                        "systemPrompt": (
                            "You are an internal policy copilot. Synthesize across retrieved policy, "
                            "security, benefits, and recent conversation memory. Cite sources and avoid guessing."
                        ),
                        "answerStyle": "detailed",
                    },
                ),
                node("chat_output", "chat_output-1", 1140, 250),
                node("dashboard_preview", "dashboard_preview-1", 1140, 470),
                node("logger", "logger-1", 1140, 650, {"level": "info"}),
            ],
            [
                edge("policy_text-1", "text", "rag_knowledge-1", "document", "policy document"),
                edge("security_text-1", "text", "rag_knowledge-1", "document", "security handbook"),
                edge("benefits_text-1", "text", "rag_knowledge-1", "document", "benefits guide"),
                edge("chat_input-1", "message", "conversation_memory-1", "message", "remember user turn"),
                edge("chat_input-1", "message", "rag_knowledge-1", "query", "question"),
                edge("chat_input-1", "message", "chatbot-1", "message", "user question"),
                edge("rag_knowledge-1", "knowledge", "chatbot-1", "context", "retrieved chunks"),
                edge("conversation_memory-1", "memory", "chatbot-1", "context", "session memory"),
                edge("chatbot-1", "reply", "chat_output-1", "message", "answer with sources"),
                edge("chatbot-1", "json", "dashboard_preview-1", "content", "answer telemetry"),
                edge("rag_knowledge-1", "knowledge", "logger-1", "payload", "retrieval audit"),
            ],
        ),
        graph(
            "advanced-document-intelligence-intake",
            "Advanced: Document Intelligence Intake",
            [
                node(
                    "file_upload",
                    "file_upload-1",
                    60,
                    250,
                    {"defaultLocalPaths": "storage/sample_company_policy.txt"},
                ),
                node("text_extraction", "text_extraction-1", 360, 250),
                node("summarizer", "summarizer-1", 700, 50, {"style": "executive summary with risks", "maxWords": 220}),
                node("classifier", "classifier-1", 700, 250, {"labels": "hr policy\ninvoice\ncontract\nsecurity handbook\nbenefits guide\nother"}),
                node(
                    "extraction_ai",
                    "extraction_ai-1",
                    700,
                    450,
                    {
                        "schemaPrompt": (
                            "Return JSON with keys: document_type, audience, key_rules, dates, "
                            "obligations, exceptions, risks, owners, next_actions"
                        ),
                    },
                ),
                node("merge", "merge-1", 1070, 350, {"mode": "append"}),
                node("dashboard_preview", "dashboard_preview-1", 1410, 130),
                node("json_output", "json_output-1", 1410, 350),
                node("logger", "logger-1", 1410, 560, {"level": "debug"}),
            ],
            [
                edge("file_upload-1", "file", "text_extraction-1", "file", "local/default file"),
                edge("text_extraction-1", "document", "summarizer-1", "content", "document summary"),
                edge("text_extraction-1", "document", "classifier-1", "content", "document classification"),
                edge("text_extraction-1", "document", "extraction_ai-1", "content", "structured fields"),
                edge("summarizer-1", "summary", "merge-1", "left", "summary"),
                edge("extraction_ai-1", "json", "merge-1", "right", "fields"),
                edge("summarizer-1", "summary", "dashboard_preview-1", "content", "summary preview"),
                edge("merge-1", "merged", "json_output-1", "payload", "combined JSON"),
                edge("classifier-1", "classification", "logger-1", "payload", "classification audit"),
            ],
        ),
        graph(
            "advanced-finance-field-extractor",
            "Advanced: Finance Field Extractor + Review",
            [
                node("text_input", "invoice_text-1", 60, 210, {"defaultText": sample_invoice_text()}),
                node(
                    "extraction_ai",
                    "extraction_ai-1",
                    420,
                    120,
                    {
                        "schemaPrompt": (
                            "Extract invoice_number, vendor, customer, invoice_date, due_date, "
                            "line_items, subtotal, total_due, payment_terms, anomalies, and approval_status as JSON."
                        ),
                        "strictMode": True,
                    },
                ),
                node("classifier", "classifier-1", 420, 360, {"labels": "ready_to_pay\nneeds_review\nmissing_fields\npossible_duplicate"}),
                node("condition", "condition-1", 780, 360, {"expression": "contains:needs_review"}),
                node("json_output", "json_output-1", 1120, 120, {"prettyPrint": True}),
                node("dashboard_preview", "dashboard_preview-1", 1120, 320),
                node("logger", "logger-1", 1120, 520, {"level": "info"}),
            ],
            [
                edge("invoice_text-1", "text", "extraction_ai-1", "content", "invoice source"),
                edge("invoice_text-1", "text", "classifier-1", "content", "review classification"),
                edge("classifier-1", "classification", "condition-1", "value", "review rule"),
                edge("extraction_ai-1", "json", "json_output-1", "payload", "structured invoice"),
                edge("condition-1", "true", "dashboard_preview-1", "content", "needs review"),
                edge("extraction_ai-1", "json", "logger-1", "payload", "finance audit log"),
            ],
        ),
        graph(
            "advanced-support-triage-agent",
            "Advanced: Support Triage Agent",
            [
                node(
                    "text_input",
                    "ticket_text-1",
                    60,
                    180,
                    {"defaultText": "urgent: customer cannot log in after MFA reset. Account owner is blocked."},
                ),
                node("classifier", "classifier-1", 390, 80, {"labels": "urgent\nlogin\nbilling\nbug\nhow_to\nother"}),
                node("condition", "condition-1", 390, 300, {"expression": "contains:urgent"}),
                node("summarizer", "summarizer-1", 720, 80, {"style": "support handoff brief", "maxWords": 120}),
                node(
                    "chatbot",
                    "chatbot-1",
                    720,
                    300,
                    {
                        "systemPrompt": (
                            "You are a support triage assistant. Create a practical response, "
                            "recommended owner, urgency, and next action from the ticket context."
                        ),
                    },
                ),
                node("dashboard_preview", "dashboard_preview-1", 1080, 80),
                node("chat_output", "chat_output-1", 1080, 300),
                node("logger", "logger-1", 1080, 500, {"level": "warning"}),
            ],
            [
                edge("ticket_text-1", "text", "classifier-1", "content", "ticket classification"),
                edge("ticket_text-1", "text", "condition-1", "value", "urgent check"),
                edge("ticket_text-1", "text", "summarizer-1", "content", "handoff brief"),
                edge("ticket_text-1", "text", "chatbot-1", "message", "ticket response"),
                edge("summarizer-1", "summary", "dashboard_preview-1", "content", "triage card"),
                edge("chatbot-1", "reply", "chat_output-1", "message", "agent response"),
                edge("condition-1", "true", "logger-1", "payload", "urgent audit"),
            ],
        ),
        graph(
            "advanced-knowledge-pack-builder",
            "Advanced: Knowledge Pack Builder",
            [
                node(
                    "file_upload",
                    "file_upload-1",
                    60,
                    120,
                    {"defaultLocalPaths": "storage/sample_company_policy.txt", "multiple": True},
                ),
                node("text_input", "security_text-1", 60, 330, {"defaultText": sample_security_text()}),
                node("text_extraction", "text_extraction-1", 390, 120),
                node("chat_input", "chat_input-1", 390, 520, {"placeholder": "What knowledge was ingested and what does it say about MFA?"}),
                node(
                    "rag_knowledge",
                    "rag_knowledge-1",
                    720,
                    260,
                    {
                        "collection": "advanced-knowledge-pack",
                        "chunkSize": 240,
                        "overlap": 45,
                        "topK": 5,
                        "tags": "pack,policy,security",
                    },
                ),
                node(
                    "chatbot",
                    "chatbot-1",
                    1080,
                    260,
                    {
                        "systemPrompt": (
                            "You are a knowledge base QA assistant. Explain which chunks were useful, "
                            "answer naturally, and include citations when source metadata is present."
                        ),
                    },
                ),
                node("chat_output", "chat_output-1", 1420, 220),
                node("dashboard_preview", "dashboard_preview-1", 1420, 420),
            ],
            [
                edge("file_upload-1", "file", "text_extraction-1", "file", "uploaded/default docs"),
                edge("text_extraction-1", "document", "rag_knowledge-1", "document", "extracted file knowledge"),
                edge("security_text-1", "text", "rag_knowledge-1", "document", "security memo"),
                edge("chat_input-1", "message", "rag_knowledge-1", "query", "question"),
                edge("chat_input-1", "message", "chatbot-1", "message", "user question"),
                edge("rag_knowledge-1", "knowledge", "chatbot-1", "context", "knowledge pack context"),
                edge("chatbot-1", "reply", "chat_output-1", "message", "answer"),
                edge("chatbot-1", "json", "dashboard_preview-1", "content", "answer telemetry"),
            ],
        ),
        graph(
            "advanced-compliance-evidence-dashboard",
            "Advanced: Compliance Evidence Dashboard",
            [
                node("text_input", "policy_text-1", 60, 100, {"defaultText": sample_policy_text()}),
                node("text_input", "security_text-1", 60, 300, {"defaultText": sample_security_text()}),
                node("chat_input", "chat_input-1", 60, 520, {"placeholder": "Show evidence for MFA and data handling controls."}),
                node(
                    "rag_knowledge",
                    "rag_knowledge-1",
                    410,
                    220,
                    {
                        "collection": "advanced-compliance-evidence",
                        "chunkSize": 260,
                        "overlap": 50,
                        "topK": 5,
                        "tags": "compliance,evidence,policy,security",
                    },
                ),
                node("summarizer", "summarizer-1", 760, 120, {"style": "audit evidence summary", "maxWords": 180}),
                node("extraction_ai", "extraction_ai-1", 760, 340, {"schemaPrompt": "Return JSON with keys: controls, evidence, gaps, owners, confidence, source_notes"}),
                node("dashboard_preview", "dashboard_preview-1", 1120, 120),
                node("json_output", "json_output-1", 1120, 340),
                node("logger", "logger-1", 1120, 560, {"level": "info"}),
            ],
            [
                edge("policy_text-1", "text", "rag_knowledge-1", "document", "policy evidence"),
                edge("security_text-1", "text", "rag_knowledge-1", "document", "security evidence"),
                edge("chat_input-1", "message", "rag_knowledge-1", "query", "evidence request"),
                edge("rag_knowledge-1", "knowledge", "summarizer-1", "content", "evidence summary"),
                edge("summarizer-1", "summary", "extraction_ai-1", "content", "structured controls"),
                edge("summarizer-1", "summary", "dashboard_preview-1", "content", "auditor view"),
                edge("extraction_ai-1", "json", "json_output-1", "payload", "controls JSON"),
                edge("rag_knowledge-1", "knowledge", "logger-1", "payload", "source trace"),
            ],
        ),
        graph(
            "advanced-approval-ready-document-review",
            "Advanced: Approval-Ready Document Review",
            [
                node(
                    "file_upload",
                    "file_upload-1",
                    60,
                    220,
                    {"defaultLocalPaths": "storage/sample_company_policy.txt"},
                ),
                node("text_extraction", "text_extraction-1", 360, 220),
                node("summarizer", "summarizer-1", 700, 30, {"style": "approval memo", "maxWords": 200}),
                node("classifier", "classifier-1", 700, 220, {"labels": "approved\nneeds_legal_review\nneeds_security_review\nmissing_information"}),
                node(
                    "extraction_ai",
                    "extraction_ai-1",
                    700,
                    420,
                    {
                        "schemaPrompt": (
                            "Return JSON with keys: document_type, audience, key_rules, dates, "
                            "obligations, exceptions, risks, next_actions"
                        ),
                    },
                ),
                node("condition", "condition-1", 1060, 220, {"expression": "contains:needs"}),
                node("dashboard_preview", "summary_preview-1", 1400, 40),
                node("json_output", "field_json-1", 1400, 300),
                node("logger", "logger-1", 1400, 540, {"level": "debug"}),
            ],
            [
                edge("file_upload-1", "file", "text_extraction-1", "file", "uploaded/default document"),
                edge("text_extraction-1", "document", "summarizer-1", "content", "document to summary"),
                edge("text_extraction-1", "document", "classifier-1", "content", "document to classifier"),
                edge("text_extraction-1", "document", "extraction_ai-1", "content", "document to field extractor"),
                edge("classifier-1", "classification", "condition-1", "value", "approval route"),
                edge("summarizer-1", "summary", "summary_preview-1", "content", "summary preview"),
                edge("extraction_ai-1", "json", "field_json-1", "payload", "field JSON"),
                edge("condition-1", "true", "logger-1", "payload", "review needed log"),
            ],
        ),
    ]


def upsert_workflow(session, graph_json: dict[str, Any]) -> Workflow:
    payload = BuilderGraphPayload.model_validate(graph_json)
    validated = validate_graph(payload)
    expected_slug = slugify(graph_json["name"])
    existing = session.scalar(select(Workflow).where(Workflow.published_slug == expected_slug))
    if existing is None:
        existing = session.scalar(select(Workflow).where(Workflow.name == graph_json["name"]))

    if existing is None:
        return create_workflow(
            session,
            name=graph_json["name"],
            description=SEED_DESCRIPTION,
            validated_graph=validated,
        )

    return update_workflow(
        session,
        get_workflow_or_404(session, existing.id),
        name=graph_json["name"],
        description=SEED_DESCRIPTION,
        status_value="draft",
        validated_graph=validated,
    )


def reset_seeded_workflows(session) -> None:
    old_workflows = session.scalars(select(Workflow)).all()
    for workflow in old_workflows:
        workflow.published_version_id = None
        workflow.published_slug = None
        workflow.is_published = False
        session.delete(workflow)
    session.flush()


def main() -> None:
    create_db_and_storage_dirs()
    with SessionLocal() as session:
        reset_seeded_workflows(session)
        created: list[Workflow] = []
        for sample in build_samples():
            workflow = upsert_workflow(session, sample)
            created.append(workflow)

        for workflow in created:
            block_types = {node["data"]["blockType"] for node in workflow.graph_json.get("nodes", [])}
            if {"chat_input", "chat_output"}.issubset(block_types):
                publish_workflow(session, workflow.id, None)

        print("Seeded sample workflows:")
        for workflow in created:
            refreshed = get_workflow_or_404(session, workflow.id)
            published = f" /chat/{refreshed.published_slug}" if refreshed.published_slug else ""
            print(f"- #{refreshed.id}: {refreshed.name}{published}")


if __name__ == "__main__":
    main()
