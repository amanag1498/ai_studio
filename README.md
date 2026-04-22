# AI Studio

AI Studio is a local-first visual workflow builder for document, RAG, chatbot, extraction, and automation-style AI workflows. It runs without Docker, stores app data in SQLite, stores vectors in local ChromaDB, saves uploads on the local filesystem, and uses OpenRouter through an OpenAI-compatible provider wrapper for LLM calls.

## What It Can Do

- Build workflows visually with React Flow, drag-and-drop blocks, compatible ports, node badges, config sheets, minimap, controls, auto-layout, search, copy/paste-style actions, and polished full-canvas builder UI.
- Run workflows as shareable local app pages at `/app/:workflowId` with file upload forms, text/chat inputs, pre-run checklist, execution timeline, and user-friendly dashboard output cards.
- Persist workflows, versions, normalized nodes/edges, graph JSON snapshots, runs, node runs, latency, errors, logs, files, documents, chunks, users, auth events, memory, and permissions in SQLite.
- Upload and parse PDF, DOCX, TXT, CSV, and JSON files, with OCR available through the local parser abstraction when Tesseract is installed.
- Local-first provider adapters for web search, page reading, OCR, SMTP email, webhook notifications, and safe database querying.
- Ingest documents into RAG collections using chunking, local `sentence-transformers` embeddings, and ChromaDB vector storage.
- Retrieve relevant chunks with source metadata, confidence/relevance scoring, chunk viewer support, source preview, collection deletion, and retrieval testing.
- Execute MVP blocks through a DAG engine with topological ordering, typed payloads, per-node executors, workflow run logs, node run logs, errors, and previewable outputs.
- Use OpenRouter for Chatbot, Summarizer, Classifier, and Extraction AI style blocks through an injectable provider interface.
- Publish chat workflows as local chatbot endpoints and test them through `/chat/:slug`.
- Manage workflows from a premium AI Studio home shell with tabs for Workflows, Create, Templates, Usage, Runs, Publish, Files, Knowledge, Components, Blocks, Health, Bundles, and Account.
- Track local users, signup/login activity, workflow ownership, run ownership, usage stats, audit logs, published endpoints, and workflow permissions.
- Stream workflow execution updates through the async run queue and Server-Sent Events, with queue monitoring, cancellation, durable SQLite run state, and configurable retries/backoff.
- Upload documents into a global File Library before building/running workflows, then reuse those files in Builder and App Run file inputs.
- Add workflow comments, inspect change history, and save reusable subflow/components from workflow Activity panels.
- Export/import workflow bundles for review, sharing, or backup.

## Stack

- Frontend: React, TypeScript, Tailwind CSS, React Flow, Vite.
- Backend: FastAPI, SQLAlchemy, Alembic, Pydantic.
- Database: SQLite by default, with SQLAlchemy setup ready for a future Postgres URL.
- Vector store: ChromaDB local persistent mode.
- Embeddings: local `sentence-transformers` by default.
- LLM provider: OpenRouter through the OpenAI-compatible client.
- File storage: local filesystem under `storage/uploads`.

## Monorepo Layout

```text
.
├── apps
│   ├── api                 # FastAPI app, SQLAlchemy models, Alembic, services, tests
│   └── web                 # React app, builder UI, app runner, pages
├── docs
│   └── INSTALL.md          # macOS and Windows setup guide
├── packages
│   └── shared              # shared graph and block definitions
└── storage
    ├── chroma              # local ChromaDB data
    ├── logs                # optional local logs
    ├── sqlite              # SQLite app database
    └── uploads             # uploaded runtime files
```

## Install

Detailed macOS and Windows instructions are in [docs/INSTALL.md](/Users/amanagarwal/Desktop/hackathon_project/docs/INSTALL.md).

Short version:

```bash
cp .env.example .env
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

In another terminal:

```bash
cd apps/web
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

API health:

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/system/health/details
```

## Environment

Root `.env` is loaded by the backend. The important values are:

```env
OPENROUTER_API_KEY=your_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=your_model_here
OPENROUTER_TIMEOUT_SECONDS=30
OPENROUTER_MAX_RETRIES=2
LLM_PROVIDER=openrouter

APP_STORAGE_DIR=./storage
SQLALCHEMY_DATABASE_URL=sqlite:///./storage/sqlite/app.db
CHROMA_PERSIST_DIR=./storage/chroma
UPLOADS_DIR=./storage/uploads

EMBEDDING_PROVIDER=sentence-transformers
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_ALLOW_DOWNLOAD=false
VECTOR_BACKEND=chromadb

WEB_SEARCH_PROVIDER=duckduckgo
WEB_READER_MAX_BYTES=2000000
OCR_PROVIDER=tesseract
OCR_TESSERACT_CMD=tesseract
SMTP_HOST=
SMTP_PORT=587
SMTP_FROM_EMAIL=
NOTIFICATION_PROVIDER=local
NOTIFICATION_WEBHOOK_URL=
DATABASE_QUERY_DEFAULT_URL=
DATABASE_QUERY_ALLOW_WRITES=false
EXECUTION_QUEUE_MAX_WORKERS=3
EXECUTION_QUEUE_MAX_RETRIES=1
EXECUTION_QUEUE_RETRY_BACKOFF_SECONDS=1.5
```

Frontend env:

```env
VITE_API_BASE_URL=http://localhost:8000
```

`fastapi==0.115.9` is intentionally pinned because `chromadb==1.0.7` depends on that exact FastAPI version.

## Main Pages

- `/`: AI Studio shell with workflow library, creation wizard, templates, usage dashboard, run history, publish manager, file library, knowledge manager, reusable components, block marketplace, health checks, bundle import/export, and account/login.
- `/builder/:workflowId`: visual React Flow builder for editing and running workflows with tabbed inspector, version notes, no-change save guard, runtime file selection, block testing, fixes, publish controls, and RAG tools.
- `/app/:workflowId`: shareable local app UI for file/text/chat workflows, File Library selection, pre-run checklist, live execution timeline, and dashboard outputs.
- `/runs/:workflowId/:runId`: clean run details page with logs, node outputs, errors, timings, and final results.
- `/chat/:slug`: published chatbot session UI.
- `/files`: file library with proactive document upload, uploaded document metadata, preview, delete, and reprocess actions.

## MVP Blocks

Block contracts are schema-driven in [packages/shared/src/blocks.ts](/Users/amanagarwal/Desktop/hackathon_project/packages/shared/src/blocks.ts), backend validation is mirrored in [apps/api/app/core/block_registry.py](/Users/amanagarwal/Desktop/hackathon_project/apps/api/app/core/block_registry.py), and implemented runtime behavior lives in [apps/api/app/services/execution.py](/Users/amanagarwal/Desktop/hackathon_project/apps/api/app/services/execution.py).

### Inputs

| Block | What it does | Needs | Outputs |
| --- | --- | --- | --- |
| Chat Input | Accepts a runtime user message for chatbot, RAG, router, or memory flows. | Placeholder text and optional history persistence. Runtime message is supplied from Builder/App/Published Chat. | `message` as chat/text. |
| Text Input | Provides static text, policy content, prompts, URLs, examples, or inline documents. | `defaultText` or runtime override. | `text`. |
| File Upload | Stages files for parsing and downstream document workflows. Supports runtime upload, default local paths, and first-class File Library reuse through saved library file IDs. Validates extension and size. | Accepted extensions, max size, source mode, optional File Library IDs/default paths. | `file` metadata list and `metadata` JSON with source mode, accepted types, file count, and library IDs. |
| Form Input | Captures structured runtime form data for app-like workflows. | Field list and optional default values JSON. | `json` and text representation. |
| Webhook Trigger | Simulates or accepts an incoming webhook-style payload. | Sample payload JSON. | `payload` JSON. |

### Knowledge And RAG

| Block | What it does | Needs | Outputs |
| --- | --- | --- | --- |
| Text Extraction | Parses PDF, DOCX, TXT, CSV, and JSON into normalized document text. Emits extraction quality metadata: parser, page/line/word counts, failed files, warnings, detected table hints, and preview snippets. OCR strategy can call the local OCR parser. | File Upload output and extraction strategy. | `document`, `text`, and `metadata`. |
| OCR | Uses the parser abstraction with local Tesseract OCR for image-heavy files and OCR-capable PDFs when Tesseract supports them. | File input, optional OCR provider/language hints, local Tesseract installed. | `document`, `text`, and `metadata`. |
| RAG Knowledge | Ingests documents, chunks text, embeds locally with sentence-transformers, stores in ChromaDB, and retrieves source chunks. Modes: Ingest Only, Retrieve Only, Ingest + Retrieve, Refresh Collection. Retrieval strategies: hybrid vector+keyword, vector only, keyword only. Built-in rerank can reorder source chunks. | Collection name, mode, chunk size, overlap, top-k, retrieval strategy, rerank toggle, tags, allowed file types. | `knowledge`, `matches`, and `diagnostics`. |
| Document Splitter | Splits long text/documents into reviewable sections for loops, extraction, or exports. | Document/text input, split mode, max characters. | `sections`. |
| Table Extractor | Extracts simple row/table-like content into JSON rows. | Document/text input and delimiter mode. | `tables` JSON. |
| Query Rewriter | Improves vague user queries before RAG or web search. | Query input and optional domain hint. | Rewritten `query`. |
| Re-ranker | Reorders retrieved chunks by score/content quality before answer generation. | Knowledge/matches input and top-k. | Re-ranked `knowledge`. |
| Citation Verifier | Scores whether answer terms are supported by retrieved sources. | Answer plus knowledge/source JSON. | `verification` JSON with support score and unsupported terms. |
| Citation Formatter | Converts citations/source chunks into readable text or JSON source lists. | Knowledge/chat/json sources. | `text` and `json`. |
| Web Search | Runs through a swappable provider interface. Default live adapter uses DuckDuckGo HTML search; local adapter remains available for offline/dev runs. Results are normalized with title, URL, snippet, provider/source, and rank. | Query, provider, top-k, timeout settings. | `results` knowledge/json. |
| Web Page Reader | Fetches HTTP/HTTPS pages with timeout, content-type checks, byte limits, title/meta extraction, readable text extraction, and optional markdown formatting. | URL text and reader mode. | `document`. |

### AI Blocks

| Block | What it does | Needs | Outputs |
| --- | --- | --- | --- |
| Chatbot | Calls the injectable LLM provider, OpenRouter by default. Uses system prompt, user message, RAG context, optional memory, citations, and output mode. Output modes include chat answer, markdown report, decision memo, table, and JSON schema. | Model, system prompt, answer style, output mode, optional response schema, temperature, message, optional context. | `reply`, structured `json`, and `citations`. |
| Summarizer | Summarizes text, documents, or knowledge into a controlled style and length. | Model, style, max words, content input. | `summary`. |
| Classifier | Classifies text/document/chat content into configured labels with optional multi-label behavior. | Model, labels, multi-label toggle, content input. | `classification`. |
| Extraction AI | Extracts structured JSON from text/documents. Supports schema prompt plus visual schema fields with name/type/required/description/example metadata. | Model, schema prompt or visual fields, strict mode, content input. | `json`. |
| Prompt Template | Renders reusable prompts from upstream variables using `{{input}}` style placeholders. | Template and upstream variables. | `prompt`. |
| Retry/Fallback LLM | Runs an LLM call with retry/fallback model metadata. | Primary model, fallback model, system prompt, retry count, prompt input. | `reply`, telemetry `json`, and citations metadata. |
| Browser Agent | Local-safe browser automation planner. It creates a plan only; real browser execution is adapter-gated. | Task and safety mode. | `result` JSON/text. |

### Logic And Control

| Block | What it does | Needs | Outputs |
| --- | --- | --- | --- |
| Merge | Combines two upstream payloads. Modes include append, JSON merge, template, select fields, flatten arrays, deduplicate chunks, and preserve metadata. | Left/right inputs, mode, optional field paths. | `merged` plus merge details `json`. |
| Condition | Branches based on simple rules. Supports legacy expressions and visual rules JSON with AND/OR groups using exists, equals, contains, and boolean operators. | Value input, expression or visual rules JSON. | `true`, `false`, and `evaluation`. |
| Schema Validator | Validates JSON/text for required keys. | Payload and required keys. | `validation`. |
| Data Mapper | Maps/renames JSON fields using source:target mappings. | Input payload and mappings. | `mapped`. |
| Loop / For Each | Normalizes lists/sections/items so later blocks can process iterable-style payloads. | Items input and limit. | `items`. |
| Approval Step | Simulates a human approval gate for MVP workflows. | Request input and default decision. | `approved` or `rejected`. |
| Router / Switch | Selects a route by matching route names/keywords in input text. | Input payload, routes, default route. | `route`. |

### Memory

| Block | What it does | Needs | Outputs |
| --- | --- | --- | --- |
| Conversation Memory | Stores recent chat messages in SQLite by workflow/session/user and emits recent history for Chatbot context. | Message input, namespace, window size. | `memory` and `history`. |
| Long-Term Memory | Persists durable facts/chunks across runs for a workflow-scoped memory store. | Content input, scope, max facts. | `memory`. |

### Outputs And Observability

| Block | What it does | Needs | Outputs |
| --- | --- | --- | --- |
| Chat Output | Produces final chat answer cards with citations/source chunks when available. | Message input and streaming toggle. | Rendered chat `result`. |
| JSON Output | Produces structured JSON output for API/app/dashboard use. | Payload input and pretty-print toggle. | Rendered JSON `result`. |
| Dashboard/Preview | Builds user-friendly preview payloads. Modes include auto, markdown, table, JSON, summary card, metric cards, citations, file preview, and error panel. Emits configurable cards with summary, metrics, citations, files, errors, and JSON. | Content input, preview mode, card layout. | Preview `result`. |
| Logger | Captures local debug traces. Friendly mode explains what happened, why it ran, data in/out, and what failed; raw/failure-analysis modes are also available. | Payload input, trace mode, log level. | `log`. |
| CSV/Excel Export | Writes structured rows to a local CSV file under storage uploads/exports. | Data input and filename. | File/json metadata. |
| Email Sender | Sends through the SMTP provider when configured, otherwise returns a skipped status with no secret leakage. Supports to/cc/bcc, subject, text body, optional HTML body, and structured delivery logs. | Content, recipient, subject, SMTP env. | Status JSON/text. |
| Slack/Teams Notification | Delivers through webhook-style providers when configured, or captures a local in-app/run-log notification in dev. Works for Slack, Discord, Teams, and generic webhooks. | Content, channel/provider, optional webhook env. | Status JSON/text. |

### System And Safety

| Block | What it does | Needs | Outputs |
| --- | --- | --- | --- |
| HTTP Request | Prepares a safe external API request payload. Live request execution is disabled unless enabled/configured. | Body input, method, URL, enable flag. | Response JSON. |
| Database Writer | Captures a row as local run evidence and returns a record-style payload. | Row input and table label. | `record`. |
| Database Query | Executes controlled SQLite/Postgres-compatible SQL through SQLAlchemy. Read-only by default, parameterized execution supported, multi-statement/destructive SQL blocked unless admin-enabled. | Query input, connection URL/env, optional limit. | Rows/columns JSON. |
| SQL Assistant | Introspects the configured database schema and produces a safe read-only starter query plan, with optional execution through Database Query. | Natural-language question and database connection. | SQL text and plan JSON. |
| PII Redactor | Masks emails and phone numbers before AI/RAG/output steps. | Text/json/chat content and redaction toggles. | `redacted` text and stats JSON. |
| Guardrail | Routes content to safe/blocked based on configured blocked terms. | Content input and blocked terms. | `safe` or `blocked`. |

### Phase 2/3 Scaffolds

The block registry also includes placeholders/interfaces for Summarizer variants, Classifier variants, Intent Router, Publish API, Error Handler, Re-ranker, Research Agent, Human Approval, Guardrail, Access Control, and Long-Term Memory expansion. OCR, Web Search, Web Page Reader, SQL Assistant, Database Query, Email, and Notification now have first usable provider-backed implementations while preserving the same extension seams.

## What Each Workflow Needs To Run Well

- File workflows need either a runtime upload, a selected File Library item, saved File Library IDs on the File Upload block, or valid default local paths.
- RAG workflows need documents ingested into the configured collection before Retrieve Only mode can answer well.
- Chatbot, Summarizer, Classifier, Extraction AI, and Retry/Fallback LLM need `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and `OPENROUTER_MODEL` configured.
- Local embeddings need `EMBEDDING_MODEL`; if `EMBEDDING_ALLOW_DOWNLOAD=false`, the model must already exist locally.
- Dashboard/Preview and Logger are best connected near the end of workflows and also to intermediate nodes when debugging.
- Web Search and Web Page Reader can make live network requests from the backend. Keep provider/timeouts/byte limits configured for your environment.
- Email and webhook notifications only deliver externally when SMTP/webhook env vars are set; otherwise they return explicit skipped/captured statuses.
- OCR requires Tesseract installed locally and `OCR_TESSERACT_CMD` pointing to the executable.
- Database Query/SQL Assistant are read-only by default. Set `DATABASE_QUERY_DEFAULT_URL` for a non-app database and only enable writes in trusted admin environments.

## Backend Capabilities

- Workflow CRUD, archive, restore, duplicate, delete.
- Workflow templates and advanced seeded sample workflows.
- Workflow versions, restore, and compare.
- Workflow permissions metadata.
- Workflow comments, change history, and reusable subflows/components.
- Workflow execution with DAG ordering, typed payloads, async queue, Server-Sent Events, logs, latency, errors, and preview payloads.
- File runtime upload, global file library upload, extraction preview, reprocess, delete.
- RAG collection list, diagnostics, document list, chunk list, retrieval test, evaluation, delete collection, and collection re-ingest/self-heal.
- Global knowledge collection inventory.
- Published chatbot manager and session-aware chat endpoint.
- Admin usage dashboard.
- Admin audit logs and observability dashboard.
- Credential/config health endpoint.
- Block marketplace metadata endpoint.
- Workflow bundle export/import.

## Important API Endpoints

```text
GET    /health
GET    /system/health/details
GET    /blocks/marketplace

POST   /auth/signup
POST   /auth/login
GET    /admin/usage
GET    /admin/audit-logs
GET    /admin/observability

GET    /workflows
POST   /workflows
GET    /workflows/{workflow_id}
PUT    /workflows/{workflow_id}
PATCH  /workflows/{workflow_id}/metadata
POST   /workflows/{workflow_id}/archive
POST   /workflows/{workflow_id}/restore
POST   /workflows/{workflow_id}/duplicate
DELETE /workflows/{workflow_id}

POST   /workflows/{workflow_id}/versions
POST   /workflows/{workflow_id}/versions/{version_id}/restore
GET    /workflows/{workflow_id}/versions/{version_id}/compare

GET    /workflows/{workflow_id}/permissions
POST   /workflows/{workflow_id}/permissions
DELETE /workflows/{workflow_id}/permissions/{permission_id}

GET    /workflows/{workflow_id}/comments
POST   /workflows/{workflow_id}/comments
GET    /workflows/{workflow_id}/history
GET    /subflows
POST   /workflows/{workflow_id}/subflows

POST   /workflows/{workflow_id}/execute
POST   /workflows/{workflow_id}/execute-async
GET    /workflows/{workflow_id}/runs
GET    /workflows/{workflow_id}/runs/{run_id}
GET    /workflows/{workflow_id}/runs/{run_id}/events
POST   /workflows/{workflow_id}/nodes/{node_id}/test

POST   /files/runtime-upload
POST   /files/library-upload
GET    /files
GET    /files/{file_id}
DELETE /files/{file_id}
POST   /files/{file_id}/reprocess

GET    /knowledge/collections
GET    /workflows/{workflow_id}/knowledge/collections
GET    /workflows/{workflow_id}/knowledge/collections/{collection}/documents
GET    /workflows/{workflow_id}/knowledge/documents/{document_id}/chunks
POST   /workflows/{workflow_id}/knowledge/collections/{collection}/retrieve
POST   /workflows/{workflow_id}/knowledge/collections/{collection}/evaluate
GET    /workflows/{workflow_id}/knowledge/evaluations
DELETE /workflows/{workflow_id}/knowledge/collections/{collection}
POST   /workflows/{workflow_id}/knowledge/collections/{collection}/reingest

POST   /workflows/{workflow_id}/publish
POST   /workflows/{workflow_id}/unpublish
GET    /published/chatbots
GET    /published/chatbots/{slug}
POST   /published/chatbots/{slug}/messages

GET    /workflows/{workflow_id}/bundle
POST   /workflows/import-bundle
```

## Seed Sample Workflows

From `apps/api` with the virtualenv active:

```bash
PYTHONPATH=. python scripts/seed_sample_workflows.py
```

This replaces old seeded/advanced sample workflows and creates 12 advanced local workflows:

- `Advanced: Multi-RAG Contract Intelligence`
- `Advanced: Persistent Policy Copilot`
- `Advanced: Document Extractor + Summarizer`
- `Advanced: Finance Approval Field Extractor`
- `Advanced: Support Triage Agent`
- `Advanced: Local Research Brief Generator`
- `Advanced: Compliance Evidence Dashboard`
- `Advanced: Guardrailed Document QA`
- `Advanced: Publish-Ready Intake App`
- `Advanced: Insurance Claims Coverage Desk`
- `Advanced: Insurance Underwriting Risk Workbench`
- `Advanced: Insurance Fraud + Subrogation Triage`

The refined samples cover multi-collection RAG, persistent conversation memory, query rewriting, re-ranking, citation verification, document upload/extraction, OCR-ready extraction, AI field extraction, schema validation, insurance claim coverage review, underwriting risk scoring, SIU/subrogation triage, approvals, SMTP/webhook-ready notifications, exports, guardrails, live web search/page reading, dashboard previews, JSON outputs, and run logging.

## Validation

Backend:

```bash
cd apps/api
source .venv/bin/activate
pytest tests
python -m compileall app
alembic upgrade head
```

Frontend:

```bash
npm run typecheck:web
npm run build:web
npm run e2e
```

E2E tests use Playwright. Run `npm install` after pulling changes so `@playwright/test` is installed, then run `npx playwright install chromium` once if the browser binary is missing.

Last known local validation:

```text
44 backend tests passed
frontend TypeScript check passed
Alembic upgraded to head
```

## Local-First Storage

- `storage/sqlite/app.db`: SQLite app database.
- `storage/chroma/`: ChromaDB vector persistence.
- `storage/uploads/`: runtime uploads and workflow files.
- `storage/logs/`: optional local log output.

These directories are intentionally ignored by Git except `.gitkeep` placeholders. The app is designed to run offline/local except for LLM calls to OpenRouter and optional model downloads if enabled.

## Current Product Surfaces

- `Workflows`: searchable workflow library with rename, quality score, latest output, run health, RAG health, versions, permissions, activity, duplicate, archive, restore, delete, app links, publish, and export actions.
- `Create`: blank builder launch plus guided auto-build recipes and advanced template cloning.
- `Templates`: polished gallery for seeded advanced workflow templates.
- `Usage`: admin usage dashboard with users, auth events, workflow runs, failures, files, RAG chunks, latency, audit events, and observability metrics.
- `Runs`: cross-workflow execution history with statuses, timings, errors, owner/session metadata, and links to clean run detail pages.
- `Publish`: published chatbot manager with chat links, API snippets, iframe embeds, copy actions, unpublish, and app preview.
- `Files`: global File Library upload and inventory for documents reusable in Builder and App Run file inputs.
- `Knowledge`: global RAG collection inventory with chunk/document counts, ingest freshness, retrieval testing, and workflow links.
- `Components`: saved reusable subflows/components with graph JSON copy and source workflow links.
- `Blocks`: schema-driven block marketplace with ports and config metadata.
- `Health`: backend, storage, OpenRouter, Chroma, embeddings, SQLite, and environment readiness checks.
- `Bundles`: workflow bundle export/import for review and backup.
- `Account`: local-first signup/login/logout so ownership and permissions are tracked.

## Recommended Next Improvements

- Add multiplayer editing presence and conflict resolution for collaborative builder sessions.
- Add a visual insertion flow for saved Components so subflows can be dropped back onto the canvas as grouped blocks.
- Add provider adapters for email, Slack/Teams, database writes, and browser automation where current blocks intentionally prepare local payloads first.
- Add production auth/token handling if this moves beyond local-first use.
- Add E2E browser tests around upload -> extract -> RAG -> chatbot -> output and publish chat flows.
- Add automated frontend E2E tests for builder interactions and workflow app uploads.
- Add Postgres migration notes and a production deployment profile when moving beyond local-first.

## Troubleshooting

- Generic RAG answer: confirm the collection has documents/chunks in the Knowledge tab, then run retrieval test with the same query.
- Missing file error: upload a file in the workflow app or builder runtime panel before running File Upload workflows.
- Chatbot block fails: confirm `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and `OPENROUTER_MODEL`, then restart the backend.
- Dependency conflict: keep `fastapi==0.115.9` with `chromadb==1.0.7`.
- Frontend cannot reach backend: check `apps/web/.env` has `VITE_API_BASE_URL=http://localhost:8000` and backend CORS includes the Vite origin.
