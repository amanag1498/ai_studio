from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BlockFieldDefinition:
    key: str
    required: bool = False
    allow_blank: bool = True


@dataclass(frozen=True)
class BlockPortDefinition:
    id: str
    data_types: tuple[str, ...]
    required: bool = False


@dataclass(frozen=True)
class BlockDefinition:
    block_type: str
    inputs: tuple[BlockPortDefinition, ...]
    outputs: tuple[BlockPortDefinition, ...]
    fields: tuple[BlockFieldDefinition, ...]


BLOCK_DEFINITIONS: dict[str, BlockDefinition] = {
    "chat_input": BlockDefinition(
        block_type="chat_input",
        inputs=(),
        outputs=(BlockPortDefinition(id="message", data_types=("chat", "text")),),
        fields=(
            BlockFieldDefinition(key="placeholder", required=True, allow_blank=False),
            BlockFieldDefinition(key="persistHistory", required=True),
        ),
    ),
    "text_input": BlockDefinition(
        block_type="text_input",
        inputs=(),
        outputs=(BlockPortDefinition(id="text", data_types=("text",)),),
        fields=(BlockFieldDefinition(key="defaultText", required=True),),
    ),
    "file_upload": BlockDefinition(
        block_type="file_upload",
        inputs=(),
        outputs=(BlockPortDefinition(id="file", data_types=("file",)),),
        fields=(
            BlockFieldDefinition(key="accept", required=True, allow_blank=False),
            BlockFieldDefinition(key="multiple", required=True),
            BlockFieldDefinition(key="defaultLocalPaths", required=False),
        ),
    ),
    "text_extraction": BlockDefinition(
        block_type="text_extraction",
        inputs=(BlockPortDefinition(id="file", data_types=("file",), required=True),),
        outputs=(BlockPortDefinition(id="document", data_types=("document", "text")),),
        fields=(BlockFieldDefinition(key="strategy", required=True, allow_blank=False),),
    ),
    "rag_knowledge": BlockDefinition(
        block_type="rag_knowledge",
        inputs=(
            BlockPortDefinition(id="document", data_types=("document", "text")),
            BlockPortDefinition(id="query", data_types=("chat", "text")),
        ),
        outputs=(BlockPortDefinition(id="knowledge", data_types=("knowledge",)),),
        fields=(
            BlockFieldDefinition(key="ingestMode", required=True, allow_blank=False),
            BlockFieldDefinition(key="collection", required=True, allow_blank=False),
            BlockFieldDefinition(key="chunkSize", required=True),
            BlockFieldDefinition(key="overlap", required=True),
            BlockFieldDefinition(key="topK", required=True),
            BlockFieldDefinition(key="tags", required=True),
            BlockFieldDefinition(key="allowedFileTypes", required=True, allow_blank=False),
        ),
    ),
    "chatbot": BlockDefinition(
        block_type="chatbot",
        inputs=(
            BlockPortDefinition(id="message", data_types=("chat", "text"), required=True),
            BlockPortDefinition(id="context", data_types=("knowledge", "text", "json")),
        ),
        outputs=(
            BlockPortDefinition(id="reply", data_types=("chat", "text")),
            BlockPortDefinition(id="json", data_types=("json",)),
        ),
        fields=(
            BlockFieldDefinition(key="model", required=True, allow_blank=False),
            BlockFieldDefinition(key="systemPrompt", required=True, allow_blank=False),
            BlockFieldDefinition(key="answerStyle", required=False, allow_blank=False),
            BlockFieldDefinition(key="temperature", required=True),
        ),
    ),
    "summarizer": BlockDefinition(
        block_type="summarizer",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "document", "knowledge"), required=True),),
        outputs=(BlockPortDefinition(id="summary", data_types=("text", "json")),),
        fields=(
            BlockFieldDefinition(key="model", required=True, allow_blank=False),
            BlockFieldDefinition(key="style", required=True, allow_blank=False),
            BlockFieldDefinition(key="maxWords", required=True),
        ),
    ),
    "classifier": BlockDefinition(
        block_type="classifier",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "document", "chat"), required=True),),
        outputs=(BlockPortDefinition(id="classification", data_types=("json", "text")),),
        fields=(
            BlockFieldDefinition(key="model", required=True, allow_blank=False),
            BlockFieldDefinition(key="labels", required=True, allow_blank=False),
            BlockFieldDefinition(key="multiLabel", required=True),
        ),
    ),
    "extraction_ai": BlockDefinition(
        block_type="extraction_ai",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "document"), required=True),),
        outputs=(BlockPortDefinition(id="json", data_types=("json",)),),
        fields=(
            BlockFieldDefinition(key="model", required=True, allow_blank=False),
            BlockFieldDefinition(key="schemaPrompt", required=True, allow_blank=False),
            BlockFieldDefinition(key="strictMode", required=True),
        ),
    ),
    "prompt_template": BlockDefinition(
        block_type="prompt_template",
        inputs=(BlockPortDefinition(id="variables", data_types=("text", "json", "chat", "document", "knowledge", "any")),),
        outputs=(BlockPortDefinition(id="prompt", data_types=("text",)),),
        fields=(BlockFieldDefinition(key="template", required=True, allow_blank=False),),
    ),
    "document_splitter": BlockDefinition(
        block_type="document_splitter",
        inputs=(BlockPortDefinition(id="document", data_types=("document", "text"), required=True),),
        outputs=(BlockPortDefinition(id="sections", data_types=("json", "text")),),
        fields=(BlockFieldDefinition(key="mode", required=True, allow_blank=False), BlockFieldDefinition(key="maxChars", required=True)),
    ),
    "table_extractor": BlockDefinition(
        block_type="table_extractor",
        inputs=(BlockPortDefinition(id="document", data_types=("document", "text"), required=True),),
        outputs=(BlockPortDefinition(id="tables", data_types=("json",)),),
        fields=(BlockFieldDefinition(key="delimiter", required=True, allow_blank=False),),
    ),
    "schema_validator": BlockDefinition(
        block_type="schema_validator",
        inputs=(BlockPortDefinition(id="payload", data_types=("json", "text"), required=True),),
        outputs=(BlockPortDefinition(id="validation", data_types=("json", "boolean")),),
        fields=(BlockFieldDefinition(key="requiredKeys", required=True, allow_blank=False),),
    ),
    "retry_fallback_llm": BlockDefinition(
        block_type="retry_fallback_llm",
        inputs=(BlockPortDefinition(id="prompt", data_types=("text", "chat"), required=True),),
        outputs=(BlockPortDefinition(id="reply", data_types=("chat", "text")), BlockPortDefinition(id="json", data_types=("json",))),
        fields=(
            BlockFieldDefinition(key="model", required=True, allow_blank=False),
            BlockFieldDefinition(key="fallbackModel", required=True, allow_blank=False),
            BlockFieldDefinition(key="systemPrompt", required=True, allow_blank=False),
            BlockFieldDefinition(key="temperature", required=True),
            BlockFieldDefinition(key="maxRetries", required=True),
        ),
    ),
    "citation_formatter": BlockDefinition(
        block_type="citation_formatter",
        inputs=(BlockPortDefinition(id="sources", data_types=("knowledge", "chat", "json"), required=True),),
        outputs=(BlockPortDefinition(id="text", data_types=("text",)), BlockPortDefinition(id="json", data_types=("json",))),
        fields=(BlockFieldDefinition(key="style", required=True, allow_blank=False),),
    ),
    "form_input": BlockDefinition(
        block_type="form_input",
        inputs=(),
        outputs=(BlockPortDefinition(id="json", data_types=("json",)), BlockPortDefinition(id="text", data_types=("text",))),
        fields=(BlockFieldDefinition(key="fields", required=True, allow_blank=False), BlockFieldDefinition(key="defaultValues", required=True)),
    ),
    "webhook_trigger": BlockDefinition(
        block_type="webhook_trigger",
        inputs=(),
        outputs=(BlockPortDefinition(id="payload", data_types=("json",)),),
        fields=(BlockFieldDefinition(key="samplePayload", required=True, allow_blank=False),),
    ),
    "http_request": BlockDefinition(
        block_type="http_request",
        inputs=(BlockPortDefinition(id="body", data_types=("json", "text", "any")),),
        outputs=(BlockPortDefinition(id="response", data_types=("json",)),),
        fields=(
            BlockFieldDefinition(key="method", required=True, allow_blank=False),
            BlockFieldDefinition(key="url", required=True, allow_blank=False),
            BlockFieldDefinition(key="enableRequest", required=True),
        ),
    ),
    "data_mapper": BlockDefinition(
        block_type="data_mapper",
        inputs=(BlockPortDefinition(id="input", data_types=("json", "text", "any"), required=True),),
        outputs=(BlockPortDefinition(id="mapped", data_types=("json",)),),
        fields=(BlockFieldDefinition(key="mappings", required=False),),
    ),
    "loop_for_each": BlockDefinition(
        block_type="loop_for_each",
        inputs=(BlockPortDefinition(id="items", data_types=("json", "text", "any"), required=True),),
        outputs=(BlockPortDefinition(id="items", data_types=("json",)),),
        fields=(BlockFieldDefinition(key="limit", required=True),),
    ),
    "approval_step": BlockDefinition(
        block_type="approval_step",
        inputs=(BlockPortDefinition(id="request", data_types=("text", "json", "chat"), required=True),),
        outputs=(BlockPortDefinition(id="approved", data_types=("any",)), BlockPortDefinition(id="rejected", data_types=("any",))),
        fields=(BlockFieldDefinition(key="defaultDecision", required=True, allow_blank=False),),
    ),
    "email_sender": BlockDefinition(
        block_type="email_sender",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "json", "chat"), required=True),),
        outputs=(BlockPortDefinition(id="status", data_types=("json", "text")),),
        fields=(BlockFieldDefinition(key="to", required=True, allow_blank=False), BlockFieldDefinition(key="subject", required=True, allow_blank=False)),
    ),
    "slack_notification": BlockDefinition(
        block_type="slack_notification",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "json", "chat"), required=True),),
        outputs=(BlockPortDefinition(id="status", data_types=("json", "text")),),
        fields=(BlockFieldDefinition(key="channel", required=True, allow_blank=False),),
    ),
    "database_writer": BlockDefinition(
        block_type="database_writer",
        inputs=(BlockPortDefinition(id="row", data_types=("json", "text", "any"), required=True),),
        outputs=(BlockPortDefinition(id="record", data_types=("json",)),),
        fields=(BlockFieldDefinition(key="table", required=True, allow_blank=False),),
    ),
    "csv_excel_export": BlockDefinition(
        block_type="csv_excel_export",
        inputs=(BlockPortDefinition(id="data", data_types=("json", "text", "any"), required=True),),
        outputs=(BlockPortDefinition(id="file", data_types=("file", "json")),),
        fields=(BlockFieldDefinition(key="filename", required=True, allow_blank=False),),
    ),
    "pii_redactor": BlockDefinition(
        block_type="pii_redactor",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "json", "chat"), required=True),),
        outputs=(BlockPortDefinition(id="redacted", data_types=("text",)), BlockPortDefinition(id="json", data_types=("json",))),
        fields=(BlockFieldDefinition(key="redactEmails", required=True), BlockFieldDefinition(key="redactPhones", required=True)),
    ),
    "guardrail": BlockDefinition(
        block_type="guardrail",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "json", "chat", "any"), required=True),),
        outputs=(BlockPortDefinition(id="safe", data_types=("any",)), BlockPortDefinition(id="blocked", data_types=("any",))),
        fields=(BlockFieldDefinition(key="blockedTerms", required=True, allow_blank=False),),
    ),
    "router_switch": BlockDefinition(
        block_type="router_switch",
        inputs=(BlockPortDefinition(id="input", data_types=("text", "json", "chat"), required=True),),
        outputs=(BlockPortDefinition(id="route", data_types=("any",)),),
        fields=(BlockFieldDefinition(key="routes", required=True, allow_blank=False), BlockFieldDefinition(key="defaultRoute", required=True, allow_blank=False)),
    ),
    "long_term_memory": BlockDefinition(
        block_type="long_term_memory",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "chat", "memory", "knowledge")),),
        outputs=(BlockPortDefinition(id="memory", data_types=("memory", "knowledge", "text")),),
        fields=(BlockFieldDefinition(key="scope", required=True, allow_blank=False), BlockFieldDefinition(key="maxFacts", required=True)),
    ),
    "conversation_memory": BlockDefinition(
        block_type="conversation_memory",
        inputs=(BlockPortDefinition(id="message", data_types=("chat", "text")),),
        outputs=(BlockPortDefinition(id="memory", data_types=("memory", "text")),),
        fields=(
            BlockFieldDefinition(key="namespace", required=True, allow_blank=False),
            BlockFieldDefinition(key="windowSize", required=True),
        ),
    ),
    "merge": BlockDefinition(
        block_type="merge",
        inputs=(
            BlockPortDefinition(id="left", data_types=("text", "chat", "json", "knowledge", "any")),
            BlockPortDefinition(id="right", data_types=("text", "chat", "json", "knowledge", "any")),
        ),
        outputs=(BlockPortDefinition(id="merged", data_types=("text", "json", "any")),),
        fields=(BlockFieldDefinition(key="mode", required=True, allow_blank=False),),
    ),
    "condition": BlockDefinition(
        block_type="condition",
        inputs=(BlockPortDefinition(id="value", data_types=("text", "chat", "boolean", "json"), required=True),),
        outputs=(
            BlockPortDefinition(id="true", data_types=("any",)),
            BlockPortDefinition(id="false", data_types=("any",)),
        ),
        fields=(BlockFieldDefinition(key="expression", required=True, allow_blank=False),),
    ),
    "chat_output": BlockDefinition(
        block_type="chat_output",
        inputs=(BlockPortDefinition(id="message", data_types=("chat", "text"), required=True),),
        outputs=(),
        fields=(BlockFieldDefinition(key="stream", required=True),),
    ),
    "json_output": BlockDefinition(
        block_type="json_output",
        inputs=(BlockPortDefinition(id="payload", data_types=("json", "text"), required=True),),
        outputs=(),
        fields=(BlockFieldDefinition(key="prettyPrint", required=True),),
    ),
    "dashboard_preview": BlockDefinition(
        block_type="dashboard_preview",
        inputs=(BlockPortDefinition(id="content", data_types=("text", "json", "preview", "chat")),),
        outputs=(),
        fields=(BlockFieldDefinition(key="view", required=True, allow_blank=False),),
    ),
    "logger": BlockDefinition(
        block_type="logger",
        inputs=(BlockPortDefinition(id="payload", data_types=("any", "text", "json", "chat")),),
        outputs=(BlockPortDefinition(id="log", data_types=("log",)),),
        fields=(BlockFieldDefinition(key="level", required=True, allow_blank=False),),
    ),
}


def is_port_compatible(source_types: tuple[str, ...], target_types: tuple[str, ...]) -> bool:
    return "any" in source_types or "any" in target_types or any(
        source_type in target_types for source_type in source_types
    )


def validate_block_config(block_type: str, config: dict[str, Any]) -> list[str]:
    definition = BLOCK_DEFINITIONS.get(block_type)
    if definition is None:
        return [f"Unsupported node type '{block_type}'."]

    errors: list[str] = []
    for field in definition.fields:
        value = config.get(field.key)
        if field.required and value is None:
            errors.append(f"Missing required config '{field.key}' for node type '{block_type}'.")
            continue
        if isinstance(value, str) and not field.allow_blank and not value.strip():
            errors.append(f"Config '{field.key}' for node type '{block_type}' cannot be blank.")

    return errors
