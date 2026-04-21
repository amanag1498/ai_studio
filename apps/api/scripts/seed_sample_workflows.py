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
    "web_search": BlockSpec(
        "web_search",
        "Web Search",
        "knowledge",
        "Knowledge",
        "Prepare local-first search-style knowledge results.",
        "#6bc4ff",
        "WS",
        (Port("query", "Query", ("chat", "text")),),
        (Port("results", "Results", ("knowledge", "json")),),
        {"provider": "local-placeholder", "topK": 5},
    ),
    "web_page_reader": BlockSpec(
        "web_page_reader",
        "Web Page Reader",
        "knowledge",
        "Knowledge",
        "Normalize a URL into a document payload.",
        "#6fcbff",
        "WR",
        (Port("url", "URL", ("text",)),),
        (Port("document", "Document", ("document", "text")),),
        {"url": "https://example.com/security-handbook", "readerMode": "clean"},
    ),
    "browser_agent": BlockSpec(
        "browser_agent",
        "Browser Agent",
        "agent",
        "AI",
        "Plan safe browser automation steps for a task.",
        "#55c7d4",
        "BA",
        (Port("task", "Task", ("text", "chat")),),
        (Port("result", "Result", ("json", "text")),),
        {"task": "Inspect the page and summarize useful facts.", "safetyMode": "plan_only"},
    ),
    "query_rewriter": BlockSpec(
        "query_rewriter",
        "Query Rewriter",
        "knowledge",
        "Knowledge",
        "Improve vague questions before retrieval.",
        "#65d6ad",
        "QR",
        (Port("query", "Query", ("chat", "text")),),
        (Port("query", "Rewritten Query", ("text",)),),
        {"domainHint": "policy evidence"},
    ),
    "citation_verifier": BlockSpec(
        "citation_verifier",
        "Citation Verifier",
        "knowledge",
        "Knowledge",
        "Score whether an answer is supported by retrieved sources.",
        "#70d5a1",
        "CV",
        (
            Port("answer", "Answer", ("chat", "text")),
            Port("sources", "Sources", ("knowledge", "json")),
        ),
        (Port("verification", "Verification", ("json",)),),
        {"minimumSupport": 0.35},
    ),
    "re_ranker": BlockSpec(
        "re_ranker",
        "Re-ranker",
        "knowledge",
        "Knowledge",
        "Reorder retrieved chunks before answer generation.",
        "#70d5a1",
        "RR",
        (Port("knowledge", "Knowledge", ("knowledge", "json")),),
        (Port("knowledge", "Re-ranked Knowledge", ("knowledge", "json")),),
        {"strategy": "score_then_length", "topK": 5},
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


def sample_contract_text() -> str:
    return (
        "Master Services Agreement\n"
        "Supplier will provide analytics implementation services for Acme Operations. "
        "The agreement renews annually unless either party gives 45 days notice. "
        "Confidential data must be encrypted in transit and at rest. Supplier may not "
        "subcontract work without written approval. Liability is capped at fees paid in "
        "the prior 12 months except for confidentiality breaches, fraud, or gross negligence. "
        "Security incidents must be reported within 24 hours. Governing law is New York."
    )


def sample_ticket_text() -> str:
    return (
        "urgent: Enterprise customer cannot access the dashboard after an MFA reset. "
        "The account owner is blocked before payroll close. They need a safe workaround, "
        "an escalation path, and a customer-facing reply."
    )


def sample_insurance_policy_text() -> str:
    return (
        "Homeowners Policy HOP-4821\n"
        "Named insured: Priya Shah. Dwelling coverage limit: $450,000. Personal property "
        "coverage limit: $120,000. Wind and hail damage are covered after a $2,500 deductible. "
        "Flood damage is excluded unless a separate flood endorsement is active. Claims must be "
        "reported within 30 days of discovery. Emergency mitigation expenses are reimbursable "
        "when reasonable documentation is provided. Temporary housing is covered up to $15,000 "
        "when the property is uninhabitable due to a covered loss."
    )


def sample_insurance_claim_text() -> str:
    return (
        "Claim Notice CLM-7742\n"
        "Policy: HOP-4821. Loss date: 2026-04-12. Reported date: 2026-04-15. "
        "Cause of loss: wind storm damaged roof shingles and caused water intrusion in the attic. "
        "Estimated repair: roof $8,900; attic drywall $2,400; temporary tarp $450. "
        "Customer requests reimbursement and temporary housing guidance. No flood water observed. "
        "Photos and contractor invoice are attached. Adjuster notes: verify deductible and coverage."
    )


def sample_underwriting_application_text() -> str:
    return (
        "Commercial Property Application\n"
        "Applicant: Harbor Bistro LLC. Location: 125 Market Street. Construction: brick. "
        "Building age: 38 years. Sprinklers: partial. Annual revenue: $1,250,000. "
        "Prior losses: kitchen fire in 2023, paid $18,500; slip-and-fall in 2024, paid $7,200. "
        "Requested limits: property $900,000, general liability $2,000,000. "
        "Risk controls: hood cleaning quarterly, alarm monitored, no overnight cooking."
    )


def build_samples() -> list[dict[str, Any]]:
    return [
        graph(
            "advanced-multi-rag-contract-intelligence",
            "Advanced: Multi-RAG Contract Intelligence",
            [
                node("file_upload", "contract_file-1", 40, 170, {"defaultLocalPaths": "storage/sample_company_policy.txt", "multiple": True}),
                node("text_input", "contract_text-1", 40, 390, {"defaultText": sample_contract_text()}),
                node("chat_input", "question-1", 40, 640, {"placeholder": "Find confidentiality, renewal, and liability risks."}),
                node("text_extraction", "extract-1", 360, 170),
                node("pii_redactor", "redact-1", 680, 170),
                node("document_splitter", "splitter-1", 680, 390, {"mode": "paragraphs", "maxChars": 850}),
                node("query_rewriter", "rewrite-1", 360, 640, {"domainHint": "contract risk, policy exceptions, evidence"}),
                node("rag_knowledge", "contract_rag-1", 1010, 160, {"collection": "advanced-contract-intel-contracts", "chunkSize": 300, "overlap": 60, "topK": 6, "tags": "contract,legal,risk"}),
                node("rag_knowledge", "policy_rag-1", 1010, 430, {"collection": "advanced-contract-intel-policy", "chunkSize": 260, "overlap": 50, "topK": 5, "tags": "policy,approval,security"}),
                node("re_ranker", "contract_rerank-1", 1340, 160, {"strategy": "score_then_length", "topK": 5}),
                node("re_ranker", "policy_rerank-1", 1340, 430, {"strategy": "score_then_length", "topK": 4}),
                node("merge", "merge_sources-1", 1660, 295, {"mode": "append"}),
                node("conversation_memory", "memory-1", 700, 660, {"namespace": "contract-intelligence", "windowSize": 8}),
                node("chatbot", "chatbot-1", 1980, 295, {"systemPrompt": "You are a contract intelligence assistant. Compare contract clauses against policy context, identify risks, cite evidence, and recommend next actions.", "answerStyle": "structured risk brief"}),
                node("citation_verifier", "citation_check-1", 2320, 295, {"minimumSupport": 0.4}),
                node("citation_formatter", "citations-1", 2320, 520, {"style": "numbered"}),
                node("chat_output", "chat_output-1", 2660, 180),
                node("dashboard_preview", "dashboard-1", 2660, 390),
                node("json_output", "json_output-1", 2660, 600),
                node("logger", "logger-1", 2660, 800, {"level": "info"}),
            ],
            [
                edge("contract_file-1", "file", "extract-1", "file", "uploaded contract bundle"),
                edge("extract-1", "document", "redact-1", "content", "redact sensitive text"),
                edge("redact-1", "redacted", "contract_rag-1", "document", "ingest contract"),
                edge("contract_text-1", "text", "splitter-1", "document", "split contract sample"),
                edge("splitter-1", "sections", "policy_rag-1", "document", "ingest policy comparator"),
                edge("question-1", "message", "rewrite-1", "query", "rewrite vague risk request"),
                edge("rewrite-1", "query", "contract_rag-1", "query", "contract search"),
                edge("rewrite-1", "query", "policy_rag-1", "query", "policy search"),
                edge("contract_rag-1", "knowledge", "contract_rerank-1", "knowledge", "contract rerank"),
                edge("policy_rag-1", "knowledge", "policy_rerank-1", "knowledge", "policy rerank"),
                edge("contract_rerank-1", "knowledge", "merge_sources-1", "left", "contract evidence"),
                edge("policy_rerank-1", "knowledge", "merge_sources-1", "right", "policy evidence"),
                edge("question-1", "message", "memory-1", "message", "remember question"),
                edge("rewrite-1", "query", "chatbot-1", "message", "clear risk question"),
                edge("merge_sources-1", "merged", "chatbot-1", "context", "combined evidence"),
                edge("memory-1", "memory", "chatbot-1", "context", "session memory"),
                edge("chatbot-1", "reply", "citation_check-1", "answer", "verify claims"),
                edge("merge_sources-1", "merged", "citation_check-1", "sources", "verify against sources"),
                edge("merge_sources-1", "merged", "citations-1", "sources", "format source list"),
                edge("chatbot-1", "reply", "chat_output-1", "message", "risk answer"),
                edge("citation_check-1", "verification", "dashboard-1", "content", "support score"),
                edge("chatbot-1", "json", "json_output-1", "payload", "answer telemetry"),
                edge("citation_check-1", "verification", "logger-1", "payload", "citation audit"),
            ],
        ),
        graph(
            "advanced-persistent-policy-copilot",
            "Advanced: Persistent Policy Copilot",
            [
                node("text_input", "policy_text-1", 50, 70, {"defaultText": sample_policy_text()}),
                node("text_input", "security_text-1", 50, 290, {"defaultText": sample_security_text()}),
                node("text_input", "benefits_text-1", 50, 510, {"defaultText": sample_benefits_text()}),
                node("chat_input", "chat_input-1", 390, 720, {"placeholder": "Can I work from home, and what security rules apply?"}),
                node("query_rewriter", "query_rewriter-1", 720, 720, {"domainHint": "employee policy, benefits, security controls"}),
                node("conversation_memory", "conversation_memory-1", 720, 500, {"namespace": "persistent-policy-copilot", "windowSize": 12}),
                node("long_term_memory", "long_memory-1", 720, 930, {"scope": "policy-copilot-facts", "maxFacts": 25}),
                node("rag_knowledge", "rag_knowledge-1", 720, 250, {"collection": "advanced-persistent-policy-copilot", "chunkSize": 260, "overlap": 55, "topK": 7, "tags": "policy,security,benefits,copilot"}),
                node("re_ranker", "re_ranker-1", 1060, 250, {"strategy": "score_then_length", "topK": 5}),
                node("chatbot", "chatbot-1", 1400, 350, {"systemPrompt": "You are an internal employee policy copilot. Answer naturally, remember prior turns, cite sources, and clearly say when policy evidence is missing.", "answerStyle": "conversational with citations"}),
                node("citation_verifier", "citation_verifier-1", 1740, 350, {"minimumSupport": 0.35}),
                node("citation_formatter", "citation_formatter-1", 1740, 570, {"style": "numbered"}),
                node("chat_output", "chat_output-1", 2080, 250),
                node("dashboard_preview", "dashboard_preview-1", 2080, 480),
                node("logger", "logger-1", 2080, 700, {"level": "info"}),
            ],
            [
                edge("policy_text-1", "text", "rag_knowledge-1", "document", "policy document"),
                edge("security_text-1", "text", "rag_knowledge-1", "document", "security handbook"),
                edge("benefits_text-1", "text", "rag_knowledge-1", "document", "benefits guide"),
                edge("chat_input-1", "message", "conversation_memory-1", "message", "remember user turn"),
                edge("chat_input-1", "message", "long_memory-1", "content", "persist durable fact"),
                edge("chat_input-1", "message", "query_rewriter-1", "query", "rewrite question"),
                edge("query_rewriter-1", "query", "rag_knowledge-1", "query", "retrieval question"),
                edge("rag_knowledge-1", "knowledge", "re_ranker-1", "knowledge", "rank evidence"),
                edge("query_rewriter-1", "query", "chatbot-1", "message", "rewritten user question"),
                edge("re_ranker-1", "knowledge", "chatbot-1", "context", "ranked chunks"),
                edge("conversation_memory-1", "memory", "chatbot-1", "context", "session memory"),
                edge("long_memory-1", "memory", "chatbot-1", "context", "durable facts"),
                edge("chatbot-1", "reply", "citation_verifier-1", "answer", "verify answer"),
                edge("re_ranker-1", "knowledge", "citation_verifier-1", "sources", "source check"),
                edge("re_ranker-1", "knowledge", "citation_formatter-1", "sources", "format citations"),
                edge("chatbot-1", "reply", "chat_output-1", "message", "answer with sources"),
                edge("citation_verifier-1", "verification", "dashboard_preview-1", "content", "quality dashboard"),
                edge("chatbot-1", "json", "logger-1", "payload", "answer telemetry"),
            ],
        ),
        graph(
            "advanced-document-extractor-summarizer",
            "Advanced: Document Extractor + Summarizer",
            [
                node("file_upload", "file_upload-1", 60, 260, {"defaultLocalPaths": "storage/sample_company_policy.txt"}),
                node("text_extraction", "text_extraction-1", 360, 250),
                node("summarizer", "summarizer-1", 700, 50, {"style": "executive summary with risks", "maxWords": 220}),
                node("classifier", "classifier-1", 700, 250, {"labels": "hr policy\ninvoice\ncontract\nsecurity handbook\nbenefits guide\nother"}),
                node("table_extractor", "table_extractor-1", 700, 450),
                node("extraction_ai", "extraction_ai-1", 1040, 250, {"schemaPrompt": "Return JSON with keys: document_type, title, audience, key_rules, dates, obligations, exceptions, risks, owners, next_actions, confidence"}),
                node("schema_validator", "schema_validator-1", 1380, 250, {"requiredKeys": "document_type\ntitle\nsummary\nrisks\nnext_actions"}),
                node("merge", "merge-1", 1380, 480, {"mode": "append"}),
                node("csv_excel_export", "csv_export-1", 1720, 480, {"filename": "document-intelligence-export.csv"}),
                node("dashboard_preview", "dashboard_preview-1", 1720, 90),
                node("json_output", "json_output-1", 1720, 280),
                node("logger", "logger-1", 1720, 700, {"level": "debug"}),
            ],
            [
                edge("file_upload-1", "file", "text_extraction-1", "file", "local/default file"),
                edge("text_extraction-1", "document", "summarizer-1", "content", "document summary"),
                edge("text_extraction-1", "document", "classifier-1", "content", "document classification"),
                edge("text_extraction-1", "document", "table_extractor-1", "document", "tables"),
                edge("text_extraction-1", "document", "extraction_ai-1", "content", "structured fields"),
                edge("extraction_ai-1", "json", "schema_validator-1", "payload", "required fields"),
                edge("summarizer-1", "summary", "merge-1", "left", "summary"),
                edge("table_extractor-1", "tables", "merge-1", "right", "tables"),
                edge("summarizer-1", "summary", "dashboard_preview-1", "content", "summary preview"),
                edge("extraction_ai-1", "json", "json_output-1", "payload", "field JSON"),
                edge("merge-1", "merged", "csv_export-1", "data", "export rows"),
                edge("schema_validator-1", "validation", "logger-1", "payload", "validation audit"),
            ],
        ),
        graph(
            "advanced-finance-approval-field-extractor",
            "Advanced: Finance Approval Field Extractor",
            [
                node("text_input", "invoice_text-1", 60, 210, {"defaultText": sample_invoice_text()}),
                node("extraction_ai", "extraction_ai-1", 420, 120, {"schemaPrompt": "Extract invoice_number, vendor, customer, invoice_date, due_date, line_items, subtotal, total_due, payment_terms, anomalies, approval_status, and approval_reason as JSON.", "strictMode": True}),
                node("classifier", "classifier-1", 420, 360, {"labels": "ready_to_pay\nneeds_review\nmissing_fields\npossible_duplicate"}),
                node("schema_validator", "schema_validator-1", 780, 120, {"requiredKeys": "invoice_number\nvendor\ntotal_due\npayment_terms\napproval_status"}),
                node("condition", "condition-1", 780, 360, {"expression": "contains:needs_review"}),
                node("approval_step", "approval_step-1", 1120, 360, {"defaultDecision": "approved"}),
                node("database_writer", "database_writer-1", 1120, 120, {"table": "finance_approvals"}),
                node("email_sender", "email_sender-1", 1460, 230, {"to": "finance-review@example.com", "subject": "Invoice approval review"}),
                node("csv_excel_export", "csv_excel_export-1", 1460, 430, {"filename": "finance-approval-export.csv"}),
                node("json_output", "json_output-1", 1800, 120, {"prettyPrint": True}),
                node("dashboard_preview", "dashboard_preview-1", 1800, 330),
                node("logger", "logger-1", 1800, 540, {"level": "info"}),
            ],
            [
                edge("invoice_text-1", "text", "extraction_ai-1", "content", "invoice source"),
                edge("invoice_text-1", "text", "classifier-1", "content", "review classification"),
                edge("extraction_ai-1", "json", "schema_validator-1", "payload", "schema check"),
                edge("classifier-1", "classification", "condition-1", "value", "review rule"),
                edge("condition-1", "true", "approval_step-1", "request", "review gate"),
                edge("extraction_ai-1", "json", "database_writer-1", "row", "persist invoice"),
                edge("approval_step-1", "approved", "email_sender-1", "content", "send approval"),
                edge("extraction_ai-1", "json", "csv_excel_export-1", "data", "export finance rows"),
                edge("extraction_ai-1", "json", "json_output-1", "payload", "structured invoice"),
                edge("schema_validator-1", "validation", "dashboard_preview-1", "content", "validation status"),
                edge("database_writer-1", "record", "logger-1", "payload", "finance audit log"),
            ],
        ),
        graph(
            "advanced-support-triage-agent",
            "Advanced: Support Triage Agent",
            [
                node("webhook_trigger", "webhook_trigger-1", 50, 80, {"samplePayload": '{"event":"ticket.created","priority":"urgent","text":"Enterprise customer blocked after MFA reset"}'}),
                node("form_input", "form_input-1", 50, 310, {"fields": "customer:text\nemail:text\nissue:textarea\nseverity:select", "defaultValues": '{"customer":"Acme Operations","issue":"MFA reset blocked dashboard login","severity":"urgent"}'}),
                node("text_input", "ticket_text-1", 50, 550, {"defaultText": sample_ticket_text()}),
                node("merge", "merge_ticket-1", 380, 310, {"mode": "append"}),
                node("classifier", "classifier-1", 720, 110, {"labels": "urgent\nlogin\nbilling\nbug\nhow_to\nsecurity\nother"}),
                node("router_switch", "router_switch-1", 720, 310, {"routes": "urgent\nsecurity\nbilling\ntechnical\ndefault", "defaultRoute": "default"}),
                node("summarizer", "summarizer-1", 720, 530, {"style": "support handoff brief", "maxWords": 150}),
                node("chatbot", "chatbot-1", 1080, 310, {"systemPrompt": "You are a support triage assistant. Produce severity, owner, first response, escalation path, and safe customer-facing next steps.", "answerStyle": "support playbook"}),
                node("slack_notification", "slack_notification-1", 1420, 110, {"channel": "#support-urgent"}),
                node("email_sender", "email_sender-1", 1420, 310, {"to": "support-leads@example.com", "subject": "Urgent support triage"}),
                node("database_writer", "database_writer-1", 1420, 510, {"table": "support_triage"}),
                node("dashboard_preview", "dashboard_preview-1", 1760, 150),
                node("chat_output", "chat_output-1", 1760, 350),
                node("logger", "logger-1", 1760, 550, {"level": "warning"}),
            ],
            [
                edge("webhook_trigger-1", "payload", "merge_ticket-1", "left", "incoming webhook"),
                edge("form_input-1", "json", "merge_ticket-1", "right", "operator form"),
                edge("merge_ticket-1", "merged", "classifier-1", "content", "classify ticket"),
                edge("merge_ticket-1", "merged", "router_switch-1", "input", "route ticket"),
                edge("ticket_text-1", "text", "summarizer-1", "content", "handoff brief"),
                edge("summarizer-1", "summary", "chatbot-1", "message", "generate response"),
                edge("classifier-1", "classification", "chatbot-1", "context", "classification context"),
                edge("router_switch-1", "route", "slack_notification-1", "content", "route notification"),
                edge("chatbot-1", "reply", "email_sender-1", "content", "email team"),
                edge("chatbot-1", "json", "database_writer-1", "row", "persist triage"),
                edge("summarizer-1", "summary", "dashboard_preview-1", "content", "triage card"),
                edge("chatbot-1", "reply", "chat_output-1", "message", "agent response"),
                edge("database_writer-1", "record", "logger-1", "payload", "triage audit"),
            ],
        ),
        graph(
            "advanced-local-research-brief-generator",
            "Advanced: Local Research Brief Generator",
            [
                node("chat_input", "research_question-1", 60, 120, {"placeholder": "Create a brief on local-first RAG quality and governance."}),
                node("text_input", "url_input-1", 60, 360, {"defaultText": "https://example.com/local-first-ai-governance"}),
                node("query_rewriter", "query_rewriter-1", 390, 120, {"domainHint": "AI governance, local-first RAG, audit readiness"}),
                node("web_search", "web_search-1", 720, 120, {"provider": "local-placeholder", "topK": 5}),
                node("web_page_reader", "web_page_reader-1", 390, 360, {"url": "https://example.com/local-first-ai-governance", "readerMode": "clean"}),
                node("browser_agent", "browser_agent-1", 720, 360, {"task": "Plan how to inspect sources for AI governance evidence.", "safetyMode": "plan_only"}),
                node("merge", "merge_web-1", 1060, 240, {"mode": "append"}),
                node("summarizer", "summarizer-1", 1400, 160, {"style": "research brief with findings, gaps, and actions", "maxWords": 260}),
                node("retry_fallback_llm", "retry_fallback_llm-1", 1740, 160, {"systemPrompt": "Write a concise research brief with assumptions, evidence quality, and next research steps.", "maxRetries": 1}),
                node("citation_formatter", "citation_formatter-1", 1400, 420, {"style": "numbered"}),
                node("dashboard_preview", "dashboard_preview-1", 2080, 100),
                node("chat_output", "chat_output-1", 2080, 300),
                node("json_output", "json_output-1", 2080, 500),
            ],
            [
                edge("research_question-1", "message", "query_rewriter-1", "query", "research query"),
                edge("query_rewriter-1", "query", "web_search-1", "query", "local search prep"),
                edge("url_input-1", "text", "web_page_reader-1", "url", "reader URL"),
                edge("research_question-1", "message", "browser_agent-1", "task", "browser plan"),
                edge("web_search-1", "results", "merge_web-1", "left", "search results"),
                edge("web_page_reader-1", "document", "merge_web-1", "right", "reader document"),
                edge("merge_web-1", "merged", "summarizer-1", "content", "synthesize sources"),
                edge("summarizer-1", "summary", "retry_fallback_llm-1", "prompt", "brief prompt"),
                edge("web_search-1", "results", "citation_formatter-1", "sources", "format source list"),
                edge("summarizer-1", "summary", "dashboard_preview-1", "content", "research dashboard"),
                edge("retry_fallback_llm-1", "reply", "chat_output-1", "message", "brief"),
                edge("retry_fallback_llm-1", "json", "json_output-1", "payload", "llm telemetry"),
            ],
        ),
        graph(
            "advanced-compliance-evidence-dashboard",
            "Advanced: Compliance Evidence Dashboard",
            [
                node("text_input", "policy_text-1", 60, 100, {"defaultText": sample_policy_text()}),
                node("text_input", "security_text-1", 60, 300, {"defaultText": sample_security_text()}),
                node("chat_input", "chat_input-1", 60, 520, {"placeholder": "Show evidence for MFA and data handling controls."}),
                node("query_rewriter", "query_rewriter-1", 390, 520, {"domainHint": "audit evidence, MFA, customer data handling"}),
                node("rag_knowledge", "rag_knowledge-1", 720, 220, {"collection": "advanced-compliance-evidence", "chunkSize": 260, "overlap": 50, "topK": 6, "tags": "compliance,evidence,policy,security"}),
                node("re_ranker", "re_ranker-1", 1060, 220, {"strategy": "score_then_length", "topK": 5}),
                node("summarizer", "summarizer-1", 1400, 120, {"style": "audit evidence summary", "maxWords": 180}),
                node("extraction_ai", "extraction_ai-1", 1400, 340, {"schemaPrompt": "Return JSON with keys: controls, evidence, gaps, owners, confidence, source_notes"}),
                node("schema_validator", "schema_validator-1", 1740, 340, {"requiredKeys": "controls\nevidence\ngaps\nconfidence"}),
                node("dashboard_preview", "dashboard_preview-1", 2080, 120),
                node("json_output", "json_output-1", 2080, 340),
                node("logger", "logger-1", 2080, 560, {"level": "info"}),
            ],
            [
                edge("policy_text-1", "text", "rag_knowledge-1", "document", "policy evidence"),
                edge("security_text-1", "text", "rag_knowledge-1", "document", "security evidence"),
                edge("chat_input-1", "message", "query_rewriter-1", "query", "normalize audit query"),
                edge("query_rewriter-1", "query", "rag_knowledge-1", "query", "evidence request"),
                edge("rag_knowledge-1", "knowledge", "re_ranker-1", "knowledge", "rank evidence"),
                edge("re_ranker-1", "knowledge", "summarizer-1", "content", "evidence summary"),
                edge("summarizer-1", "summary", "extraction_ai-1", "content", "structured controls"),
                edge("extraction_ai-1", "json", "schema_validator-1", "payload", "validate controls"),
                edge("summarizer-1", "summary", "dashboard_preview-1", "content", "auditor view"),
                edge("extraction_ai-1", "json", "json_output-1", "payload", "controls JSON"),
                edge("schema_validator-1", "validation", "logger-1", "payload", "source trace"),
            ],
        ),
        graph(
            "advanced-guardrailed-document-qa",
            "Advanced: Guardrailed Document QA",
            [
                node("file_upload", "file_upload-1", 60, 170, {"defaultLocalPaths": "storage/sample_company_policy.txt"}),
                node("chat_input", "chat_input-1", 60, 430, {"placeholder": "What does the uploaded document say about work from home?"}),
                node("text_extraction", "text_extraction-1", 390, 170),
                node("guardrail", "input_guardrail-1", 390, 430, {"blockedTerms": "password\nsecret\napi key\nprivate key"}),
                node("rag_knowledge", "rag_knowledge-1", 720, 230, {"collection": "advanced-guardrailed-document-qa", "chunkSize": 250, "overlap": 45, "topK": 5, "tags": "guardrail,document,qa"}),
                node("re_ranker", "re_ranker-1", 1060, 230, {"strategy": "score_then_length", "topK": 4}),
                node("chatbot", "chatbot-1", 1400, 260, {"systemPrompt": "Answer only from the retrieved document context. If evidence is missing, say so plainly and suggest what document is needed.", "answerStyle": "safe cited answer"}),
                node("citation_verifier", "citation_verifier-1", 1740, 260, {"minimumSupport": 0.45}),
                node("guardrail", "output_guardrail-1", 1740, 500, {"blockedTerms": "password\nsecret\napi key\nprivate key"}),
                node("chat_output", "chat_output-1", 2080, 180),
                node("dashboard_preview", "dashboard_preview-1", 2080, 410),
                node("json_output", "json_output-1", 2080, 630),
                node("logger", "logger-1", 2080, 830, {"level": "info"}),
            ],
            [
                edge("file_upload-1", "file", "text_extraction-1", "file", "uploaded/default document"),
                edge("text_extraction-1", "document", "rag_knowledge-1", "document", "ingest document"),
                edge("chat_input-1", "message", "input_guardrail-1", "content", "screen question"),
                edge("input_guardrail-1", "safe", "rag_knowledge-1", "query", "safe retrieval query"),
                edge("rag_knowledge-1", "knowledge", "re_ranker-1", "knowledge", "rank document evidence"),
                edge("input_guardrail-1", "safe", "chatbot-1", "message", "safe question"),
                edge("re_ranker-1", "knowledge", "chatbot-1", "context", "ranked context"),
                edge("chatbot-1", "reply", "citation_verifier-1", "answer", "verify answer"),
                edge("re_ranker-1", "knowledge", "citation_verifier-1", "sources", "source evidence"),
                edge("chatbot-1", "reply", "output_guardrail-1", "content", "screen answer"),
                edge("output_guardrail-1", "safe", "chat_output-1", "message", "safe response"),
                edge("citation_verifier-1", "verification", "dashboard_preview-1", "content", "quality score"),
                edge("chatbot-1", "json", "json_output-1", "payload", "answer JSON"),
                edge("citation_verifier-1", "verification", "logger-1", "payload", "verification log"),
            ],
        ),
        graph(
            "advanced-publish-ready-intake-app",
            "Advanced: Publish-Ready Intake App",
            [
                node("form_input", "form_input-1", 60, 90, {"fields": "name:text\nemail:text\nrequest:textarea\npriority:select", "defaultValues": '{"name":"Aman","email":"aman@example.com","request":"Extract this document and prepare a manager preview.","priority":"normal"}'}),
                node("file_upload", "file_upload-1", 60, 340, {"defaultLocalPaths": "storage/sample_company_policy.txt"}),
                node("text_extraction", "text_extraction-1", 390, 340),
                node("summarizer", "summarizer-1", 720, 160, {"style": "manager dashboard card", "maxWords": 180}),
                node("extraction_ai", "extraction_ai-1", 720, 420, {"schemaPrompt": "Return JSON with keys: requester, document_type, summary, risks, decision_needed, recommended_action, source_notes"}),
                node("merge", "merge-1", 1060, 280, {"mode": "append"}),
                node("approval_step", "approval_step-1", 1400, 280, {"defaultDecision": "approved"}),
                node("database_writer", "database_writer-1", 1740, 150, {"table": "published_intake_runs"}),
                node("email_sender", "email_sender-1", 1740, 360, {"to": "intake-review@example.com", "subject": "Published intake workflow result"}),
                node("dashboard_preview", "dashboard_preview-1", 2080, 120),
                node("json_output", "json_output-1", 2080, 340),
                node("logger", "logger-1", 2080, 560, {"level": "info"}),
            ],
            [
                edge("file_upload-1", "file", "text_extraction-1", "file", "published app upload"),
                edge("text_extraction-1", "document", "summarizer-1", "content", "dashboard summary"),
                edge("text_extraction-1", "document", "extraction_ai-1", "content", "field extraction"),
                edge("summarizer-1", "summary", "merge-1", "left", "human summary"),
                edge("extraction_ai-1", "json", "merge-1", "right", "structured fields"),
                edge("merge-1", "merged", "approval_step-1", "request", "review package"),
                edge("approval_step-1", "approved", "database_writer-1", "row", "persist package"),
                edge("approval_step-1", "approved", "email_sender-1", "content", "notify reviewer"),
                edge("summarizer-1", "summary", "dashboard_preview-1", "content", "preview card"),
                edge("extraction_ai-1", "json", "json_output-1", "payload", "api response"),
                edge("database_writer-1", "record", "logger-1", "payload", "published app audit"),
            ],
        ),
        graph(
            "advanced-insurance-claims-coverage-desk",
            "Advanced: Insurance Claims Coverage Desk",
            [
                node("form_input", "claim_form-1", 40, 60, {"fields": "claim_number:text\npolicy_number:text\nloss_type:select\ncustomer_note:textarea", "defaultValues": '{"claim_number":"CLM-7742","policy_number":"HOP-4821","loss_type":"wind","customer_note":"Roof damage and attic water intrusion after storm."}'}),
                node("file_upload", "claim_files-1", 40, 310, {"defaultLocalPaths": "storage/sample_company_policy.txt", "multiple": True, "accept": ".pdf,.docx,.txt,.csv,.json", "maxSizeMb": 25}),
                node("text_input", "policy_text-1", 40, 560, {"defaultText": sample_insurance_policy_text()}),
                node("text_input", "claim_text-1", 40, 800, {"defaultText": sample_insurance_claim_text()}),
                node("text_extraction", "extract_files-1", 380, 310),
                node("pii_redactor", "redact_files-1", 700, 310, {"redactEmails": True, "redactPhones": True}),
                node("document_splitter", "split_policy-1", 380, 560, {"mode": "paragraphs", "maxChars": 700}),
                node("table_extractor", "claim_tables-1", 380, 800, {"delimiter": "auto"}),
                node("query_rewriter", "coverage_query-1", 700, 60, {"domainHint": "insurance coverage, deductible, exclusions, claim decision evidence"}),
                node("rag_knowledge", "policy_rag-1", 1030, 420, {"collection": "insurance-claims-coverage-policy", "chunkSize": 240, "overlap": 45, "topK": 6, "tags": "insurance,policy,coverage,claims"}),
                node("rag_knowledge", "claim_rag-1", 1030, 700, {"collection": "insurance-claims-coverage-file", "chunkSize": 260, "overlap": 50, "topK": 5, "tags": "insurance,claim,evidence"}),
                node("re_ranker", "policy_rerank-1", 1360, 420, {"strategy": "score_then_length", "topK": 5}),
                node("re_ranker", "claim_rerank-1", 1360, 700, {"strategy": "score_then_length", "topK": 5}),
                node("merge", "coverage_evidence-1", 1690, 560, {"mode": "append"}),
                node("extraction_ai", "claim_extractor-1", 1030, 960, {"schemaPrompt": "Return JSON with keys: claim_number, policy_number, insured_name, loss_date, reported_date, cause_of_loss, damaged_items, estimated_amounts, deductible, coverage_flags, exclusions, missing_documents, recommended_decision, confidence"}),
                node("schema_validator", "claim_schema-1", 1360, 960, {"requiredKeys": "claim_number\npolicy_number\nloss_date\ncause_of_loss\nrecommended_decision\nconfidence"}),
                node("classifier", "coverage_classifier-1", 1360, 1180, {"labels": "covered\npartially_covered\nexcluded\nneeds_adjuster_review\nmissing_documents\nfraud_review"}),
                node("condition", "review_condition-1", 1690, 1020, {"expression": "contains:needs"}),
                node("conversation_memory", "claim_memory-1", 1690, 1240, {"namespace": "insurance-claims-desk", "windowSize": 10}),
                node("chatbot", "coverage_chatbot-1", 2020, 560, {"systemPrompt": "You are an insurance coverage analyst. Use only policy and claim evidence. Explain likely coverage, deductible, exclusions, missing documents, and next adjuster actions with citations.", "answerStyle": "coverage decision memo"}),
                node("citation_verifier", "coverage_verifier-1", 2350, 560, {"minimumSupport": 0.45}),
                node("citation_formatter", "citation_formatter-1", 2350, 780, {"style": "numbered"}),
                node("approval_step", "supervisor_approval-1", 2020, 1020, {"defaultDecision": "approved"}),
                node("database_writer", "claim_record-1", 2350, 1020, {"table": "insurance_claim_decisions"}),
                node("csv_excel_export", "claim_export-1", 2350, 1240, {"filename": "insurance-claim-coverage-desk.csv"}),
                node("email_sender", "claim_email-1", 2680, 920, {"to": "claims-supervisor@example.com", "subject": "Claim coverage review ready"}),
                node("slack_notification", "claim_slack-1", 2680, 1120, {"channel": "#claims-review"}),
                node("chat_output", "claim_chat_output-1", 2680, 420),
                node("dashboard_preview", "claim_dashboard-1", 2680, 620),
                node("json_output", "claim_json-1", 2680, 780, {"prettyPrint": True}),
                node("logger", "claim_logger-1", 2680, 1320, {"level": "info"}),
            ],
            [
                edge("claim_form-1", "text", "coverage_query-1", "query", "coverage question"),
                edge("claim_files-1", "file", "extract_files-1", "file", "claim uploads"),
                edge("extract_files-1", "document", "redact_files-1", "content", "redact uploaded evidence"),
                edge("policy_text-1", "text", "split_policy-1", "document", "policy sections"),
                edge("claim_text-1", "text", "claim_tables-1", "document", "claim tables"),
                edge("split_policy-1", "sections", "policy_rag-1", "document", "ingest policy"),
                edge("redact_files-1", "redacted", "claim_rag-1", "document", "ingest uploaded evidence"),
                edge("claim_text-1", "text", "claim_rag-1", "document", "ingest claim notice"),
                edge("coverage_query-1", "query", "policy_rag-1", "query", "policy retrieval"),
                edge("coverage_query-1", "query", "claim_rag-1", "query", "claim retrieval"),
                edge("policy_rag-1", "knowledge", "policy_rerank-1", "knowledge", "rank policy"),
                edge("claim_rag-1", "knowledge", "claim_rerank-1", "knowledge", "rank claim"),
                edge("policy_rerank-1", "knowledge", "coverage_evidence-1", "left", "policy evidence"),
                edge("claim_rerank-1", "knowledge", "coverage_evidence-1", "right", "claim evidence"),
                edge("claim_text-1", "text", "claim_extractor-1", "content", "claim extraction"),
                edge("claim_extractor-1", "json", "claim_schema-1", "payload", "validate claim fields"),
                edge("claim_text-1", "text", "coverage_classifier-1", "content", "coverage classification"),
                edge("coverage_classifier-1", "classification", "review_condition-1", "value", "review branch"),
                edge("claim_form-1", "text", "claim_memory-1", "message", "remember claim request"),
                edge("coverage_query-1", "query", "coverage_chatbot-1", "message", "coverage prompt"),
                edge("coverage_evidence-1", "merged", "coverage_chatbot-1", "context", "coverage evidence"),
                edge("claim_memory-1", "memory", "coverage_chatbot-1", "context", "claim session memory"),
                edge("coverage_chatbot-1", "reply", "coverage_verifier-1", "answer", "verify decision"),
                edge("coverage_evidence-1", "merged", "coverage_verifier-1", "sources", "verify sources"),
                edge("coverage_evidence-1", "merged", "citation_formatter-1", "sources", "format citations"),
                edge("review_condition-1", "true", "supervisor_approval-1", "request", "needs supervisor"),
                edge("claim_extractor-1", "json", "claim_record-1", "row", "persist claim"),
                edge("claim_extractor-1", "json", "claim_export-1", "data", "export claim"),
                edge("supervisor_approval-1", "approved", "claim_email-1", "content", "email supervisor"),
                edge("supervisor_approval-1", "approved", "claim_slack-1", "content", "notify claims"),
                edge("coverage_chatbot-1", "reply", "claim_chat_output-1", "message", "coverage answer"),
                edge("coverage_verifier-1", "verification", "claim_dashboard-1", "content", "quality dashboard"),
                edge("coverage_chatbot-1", "json", "claim_json-1", "payload", "coverage JSON"),
                edge("claim_record-1", "record", "claim_logger-1", "payload", "claim audit"),
            ],
        ),
        graph(
            "advanced-insurance-underwriting-risk-workbench",
            "Advanced: Insurance Underwriting Risk Workbench",
            [
                node("webhook_trigger", "uw_webhook-1", 50, 80, {"samplePayload": '{"event":"submission.created","line":"commercial_property","priority":"high","producer":"North Agency"}'}),
                node("form_input", "uw_form-1", 50, 310, {"fields": "applicant:text\nline_of_business:select\nrequested_limit:text\nunderwriter_note:textarea", "defaultValues": '{"applicant":"Harbor Bistro LLC","line_of_business":"commercial_property","requested_limit":"property 900000, liability 2000000","underwriter_note":"Review prior losses and controls."}'}),
                node("text_input", "application_text-1", 50, 560, {"defaultText": sample_underwriting_application_text()}),
                node("text_input", "guideline_text-1", 50, 820, {"defaultText": "Underwriting Guideline\nRestaurants with prior fire losses require verified hood cleaning, monitored alarms, and sprinkler review. Property risks older than 30 years require roof, electrical, and plumbing updates. Decline when unresolved fire protection issues exist. Refer to senior underwriting for limits above $1,000,000 or two paid losses in 36 months."}),
                node("merge", "submission_merge-1", 390, 250, {"mode": "append"}),
                node("router_switch", "line_router-1", 720, 160, {"routes": "commercial_property\ngeneral_liability\nworkers_comp\nauto\ndefault", "defaultRoute": "default"}),
                node("classifier", "uw_classifier-1", 720, 380, {"labels": "preferred\nstandard\nrefer_to_senior\ndecline\nmissing_information\nloss_sensitive"}),
                node("query_rewriter", "uw_query-1", 720, 620, {"domainHint": "insurance underwriting risk appetite controls prior losses"}),
                node("rag_knowledge", "guideline_rag-1", 1060, 520, {"collection": "insurance-underwriting-guidelines", "chunkSize": 260, "overlap": 45, "topK": 6, "tags": "insurance,underwriting,guidelines"}),
                node("re_ranker", "uw_rerank-1", 1390, 520, {"strategy": "score_then_length", "topK": 5}),
                node("extraction_ai", "uw_extractor-1", 1060, 800, {"schemaPrompt": "Return JSON with keys: applicant, line_of_business, requested_limits, location, construction, building_age, protection_controls, prior_losses, risk_flags, missing_information, recommendation, pricing_notes, confidence"}),
                node("schema_validator", "uw_schema-1", 1390, 800, {"requiredKeys": "applicant\nline_of_business\nprior_losses\nrisk_flags\nrecommendation\nconfidence"}),
                node("condition", "uw_condition-1", 1720, 800, {"expression": "contains:refer"}),
                node("prompt_template", "uw_prompt-1", 1720, 520, {"template": "Prepare an underwriting referral memo from this submission and guideline evidence:\n\n{{input}}"}),
                node("retry_fallback_llm", "uw_llm-1", 2050, 520, {"systemPrompt": "You are a senior insurance underwriting assistant. Return a clear referral memo, risk score, coverage concerns, missing items, and suggested terms.", "temperature": 0.15, "maxRetries": 1}),
                node("guardrail", "uw_guardrail-1", 2380, 520, {"blockedTerms": "password\nsecret\nbank account\nssn"}),
                node("approval_step", "uw_approval-1", 2050, 800, {"defaultDecision": "approved"}),
                node("database_writer", "uw_record-1", 2380, 800, {"table": "underwriting_reviews"}),
                node("csv_excel_export", "uw_export-1", 2380, 1010, {"filename": "insurance-underwriting-risk-workbench.csv"}),
                node("email_sender", "uw_email-1", 2710, 720, {"to": "senior-underwriting@example.com", "subject": "Submission referral memo"}),
                node("dashboard_preview", "uw_dashboard-1", 2710, 430),
                node("json_output", "uw_json-1", 2710, 930),
                node("logger", "uw_logger-1", 2710, 1130, {"level": "info"}),
            ],
            [
                edge("uw_webhook-1", "payload", "submission_merge-1", "left", "submission event"),
                edge("uw_form-1", "json", "submission_merge-1", "right", "underwriter intake"),
                edge("submission_merge-1", "merged", "line_router-1", "input", "route line"),
                edge("application_text-1", "text", "uw_classifier-1", "content", "risk class"),
                edge("application_text-1", "text", "uw_query-1", "query", "rewrite risk query"),
                edge("guideline_text-1", "text", "guideline_rag-1", "document", "ingest guidelines"),
                edge("uw_query-1", "query", "guideline_rag-1", "query", "retrieve appetite"),
                edge("guideline_rag-1", "knowledge", "uw_rerank-1", "knowledge", "rank appetite"),
                edge("application_text-1", "text", "uw_extractor-1", "content", "extract submission"),
                edge("uw_extractor-1", "json", "uw_schema-1", "payload", "validate submission"),
                edge("uw_classifier-1", "classification", "uw_condition-1", "value", "referral check"),
                edge("uw_rerank-1", "knowledge", "uw_prompt-1", "variables", "guideline prompt"),
                edge("uw_prompt-1", "prompt", "uw_llm-1", "prompt", "underwriting memo"),
                edge("uw_llm-1", "reply", "uw_guardrail-1", "content", "screen memo"),
                edge("uw_condition-1", "true", "uw_approval-1", "request", "senior review"),
                edge("uw_extractor-1", "json", "uw_record-1", "row", "persist risk record"),
                edge("uw_extractor-1", "json", "uw_export-1", "data", "export underwriting"),
                edge("uw_approval-1", "approved", "uw_email-1", "content", "email referral"),
                edge("uw_guardrail-1", "safe", "uw_dashboard-1", "content", "memo preview"),
                edge("uw_extractor-1", "json", "uw_json-1", "payload", "structured submission"),
                edge("uw_record-1", "record", "uw_logger-1", "payload", "underwriting audit"),
            ],
        ),
        graph(
            "advanced-insurance-fraud-subrogation-triage",
            "Advanced: Insurance Fraud + Subrogation Triage",
            [
                node("chat_input", "investigator_question-1", 50, 110, {"placeholder": "Does this claim need SIU or subrogation review?"}),
                node("text_input", "claim_text-1", 50, 360, {"defaultText": sample_insurance_claim_text()}),
                node("text_input", "url_text-1", 50, 610, {"defaultText": "https://example.com/weather/storm-report-2026-04-12"}),
                node("query_rewriter", "fraud_query-1", 390, 110, {"domainHint": "insurance fraud indicators subrogation weather loss timeline"}),
                node("web_search", "weather_search-1", 720, 110, {"provider": "local-placeholder", "topK": 4}),
                node("web_page_reader", "weather_reader-1", 390, 610, {"url": "https://example.com/weather/storm-report-2026-04-12", "readerMode": "clean"}),
                node("browser_agent", "browser_agent-1", 720, 610, {"task": "Plan a read-only review of public weather and contractor evidence for claim triage.", "safetyMode": "plan_only"}),
                node("classifier", "fraud_classifier-1", 720, 360, {"labels": "routine\nsiu_review\nsubrogation_opportunity\ncoverage_dispute\nmissing_evidence\nurgent"}),
                node("extraction_ai", "fraud_extractor-1", 1060, 360, {"schemaPrompt": "Return JSON with keys: claim_number, timeline, loss_cause, fraud_indicators, subrogation_indicators, missing_evidence, severity, recommended_queue, confidence"}),
                node("merge", "external_merge-1", 1060, 110, {"mode": "append"}),
                node("summarizer", "fraud_summary-1", 1390, 180, {"style": "SIU and subrogation triage brief", "maxWords": 220}),
                node("condition", "siu_condition-1", 1390, 450, {"expression": "contains:siu"}),
                node("long_term_memory", "fraud_memory-1", 1390, 680, {"scope": "insurance-fraud-patterns", "maxFacts": 30}),
                node("chatbot", "fraud_chatbot-1", 1720, 260, {"systemPrompt": "You are an insurance SIU/subrogation triage assistant. Explain indicators, recommended queue, missing evidence, and next investigative steps. Avoid accusations; use neutral language.", "answerStyle": "investigation brief"}),
                node("citation_verifier", "fraud_verifier-1", 2050, 260, {"minimumSupport": 0.3}),
                node("approval_step", "siu_approval-1", 1720, 520, {"defaultDecision": "approved"}),
                node("database_writer", "fraud_record-1", 2050, 520, {"table": "insurance_siu_triage"}),
                node("slack_notification", "fraud_slack-1", 2380, 420, {"channel": "#siu-triage"}),
                node("http_request", "claim_system_payload-1", 2380, 620, {"method": "POST", "url": "https://example.com/claims/triage", "enableRequest": False}),
                node("chat_output", "fraud_chat_output-1", 2380, 180),
                node("dashboard_preview", "fraud_dashboard-1", 2380, 820),
                node("json_output", "fraud_json-1", 2380, 1020),
                node("logger", "fraud_logger-1", 2380, 1220, {"level": "warning"}),
            ],
            [
                edge("investigator_question-1", "message", "fraud_query-1", "query", "rewrite SIU query"),
                edge("fraud_query-1", "query", "weather_search-1", "query", "search weather evidence"),
                edge("url_text-1", "text", "weather_reader-1", "url", "read weather report"),
                edge("investigator_question-1", "message", "browser_agent-1", "task", "investigation plan"),
                edge("claim_text-1", "text", "fraud_classifier-1", "content", "classify claim"),
                edge("claim_text-1", "text", "fraud_extractor-1", "content", "extract indicators"),
                edge("weather_search-1", "results", "external_merge-1", "left", "search results"),
                edge("weather_reader-1", "document", "external_merge-1", "right", "reader evidence"),
                edge("external_merge-1", "merged", "fraud_summary-1", "content", "summarize external evidence"),
                edge("fraud_classifier-1", "classification", "siu_condition-1", "value", "SIU branch"),
                edge("claim_text-1", "text", "fraud_memory-1", "content", "remember claim pattern"),
                edge("investigator_question-1", "message", "fraud_chatbot-1", "message", "triage question"),
                edge("fraud_summary-1", "summary", "fraud_chatbot-1", "context", "external evidence"),
                edge("fraud_memory-1", "memory", "fraud_chatbot-1", "context", "known patterns"),
                edge("fraud_chatbot-1", "reply", "fraud_verifier-1", "answer", "verify triage"),
                edge("weather_search-1", "results", "fraud_verifier-1", "sources", "support check"),
                edge("siu_condition-1", "true", "siu_approval-1", "request", "SIU approval"),
                edge("fraud_extractor-1", "json", "fraud_record-1", "row", "persist triage"),
                edge("siu_approval-1", "approved", "fraud_slack-1", "content", "notify SIU"),
                edge("fraud_record-1", "record", "claim_system_payload-1", "body", "claims payload"),
                edge("fraud_chatbot-1", "reply", "fraud_chat_output-1", "message", "triage response"),
                edge("fraud_verifier-1", "verification", "fraud_dashboard-1", "content", "confidence dashboard"),
                edge("fraud_extractor-1", "json", "fraud_json-1", "payload", "structured triage"),
                edge("claim_system_payload-1", "response", "fraud_logger-1", "payload", "claim system audit"),
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
    old_workflows = session.scalars(
        select(Workflow).where((Workflow.description == SEED_DESCRIPTION) | Workflow.name.like("Advanced:%"))
    ).all()
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
