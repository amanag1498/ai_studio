# AI Studio

AI Studio is a local-first visual workflow builder for document, RAG, chatbot, extraction, and automation-style AI workflows. It runs without Docker, stores app data in SQLite, stores vectors in local ChromaDB, saves uploads on the local filesystem, and uses OpenRouter through an OpenAI-compatible provider wrapper for LLM calls.

## What It Can Do

- Build workflows visually with React Flow, drag-and-drop blocks, compatible ports, node badges, config sheets, minimap, controls, auto-layout, search, copy/paste-style actions, and polished full-canvas builder UI.
- Run workflows as shareable local app pages at `/app/:workflowId` with file upload forms, text/chat inputs, pre-run checklist, execution timeline, and user-friendly dashboard output cards.
- Persist workflows, versions, normalized nodes/edges, graph JSON snapshots, runs, node runs, latency, errors, logs, files, documents, chunks, users, auth events, memory, and permissions in SQLite.
- Upload and parse PDF, DOCX, TXT, CSV, and JSON files with parser abstractions ready for future OCR.
- Ingest documents into RAG collections using chunking, local `sentence-transformers` embeddings, and ChromaDB vector storage.
- Retrieve relevant chunks with source metadata, confidence/relevance scoring, chunk viewer support, source preview, collection deletion, and retrieval testing.
- Execute MVP blocks through a DAG engine with topological ordering, typed payloads, per-node executors, workflow run logs, node run logs, errors, and previewable outputs.
- Use OpenRouter for Chatbot, Summarizer, Classifier, and Extraction AI style blocks through an injectable provider interface.
- Publish chat workflows as local chatbot endpoints and test them through `/chat/:slug`.
- Manage workflows from a premium AI Studio home shell with tabs for Workflows, Create, Templates, Usage, Runs, Publish, Files, Knowledge, Components, Blocks, Health, Bundles, and Account.
- Track local users, signup/login activity, workflow ownership, run ownership, usage stats, audit logs, published endpoints, and workflow permissions.
- Stream workflow execution updates through the async run queue and Server-Sent Events.
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

- Inputs: Chat Input, Text Input, File Upload.
- Knowledge: Text Extraction, RAG Knowledge.
- AI: Chatbot, Summarizer, Classifier, Extraction AI, Prompt Template, Retry/Fallback LLM.
- Knowledge: Document Splitter, Table Extractor.
- Logic: Merge, Condition, Schema Validator, Data Mapper, Loop/For Each, Approval Step, Router/Switch.
- Memory: Conversation Memory, Long-Term Memory.
- Outputs: Chat Output, JSON Output, Dashboard/Preview, Logger, Citation Formatter, Email Sender, Slack/Teams Notification, CSV/Excel Export.
- System: HTTP Request, Webhook Trigger, Database Writer, PII Redactor, Guardrail.
- System/future scaffolds: OCR, Web Search, Web Page Reader, Publish API, Error Handler, Re-ranker, Research Agent, SQL Assistant, Database Query, Email, Notification, Human Approval, Guardrail, Access Control, Long-Term Memory.

Block contracts are schema-driven in [packages/shared/src/blocks.ts](/Users/amanagarwal/Desktop/hackathon_project/packages/shared/src/blocks.ts) and backend validation is mirrored in [apps/api/app/core/block_registry.py](/Users/amanagarwal/Desktop/hackathon_project/apps/api/app/core/block_registry.py).

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

The refined samples cover multi-collection RAG, persistent conversation memory, query rewriting, re-ranking, citation verification, document upload/extraction, AI field extraction, schema validation, insurance claim coverage review, underwriting risk scoring, SIU/subrogation triage, approvals, notifications, exports, guardrails, web-search/page-reader placeholders, dashboard previews, JSON outputs, and run logging.

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
```

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
