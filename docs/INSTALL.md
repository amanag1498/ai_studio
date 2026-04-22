# AI Studio Install Guide

AI Studio is local-first and does not require Docker. Run the FastAPI backend and Vite frontend in two separate terminals.

## Prerequisites

- Python 3.11 or 3.12 is recommended. Python 3.13 can work locally, but some ML packages may be more predictable on 3.11/3.12.
- Node.js 20 LTS or newer.
- Git.
- An OpenRouter API key for LLM blocks. File extraction, local auth, workflow editing, and basic non-LLM flows can still run without it.
- Optional for OCR: Tesseract installed locally (`brew install tesseract` on macOS, or the Windows installer from the Tesseract project).
- Optional for live delivery/query blocks: SMTP credentials, a Slack/Discord/Teams-compatible webhook URL, and a read-only database connection URL.

## macOS

From the project root:

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```env
OPENROUTER_API_KEY=your_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=your_model_here
WEB_SEARCH_PROVIDER=duckduckgo
OCR_TESSERACT_CMD=tesseract
DATABASE_QUERY_ALLOW_WRITES=false
EXECUTION_QUEUE_MAX_WORKERS=3
EXECUTION_QUEUE_MAX_RETRIES=1
```

Start the backend:

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

Start the frontend in a second terminal:

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

Health checks:

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/system/health/details
```

## Windows

Use PowerShell from the project root.

Copy the environment file:

```powershell
copy .env.example .env
```

Edit `.env` and set:

```env
OPENROUTER_API_KEY=your_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=your_model_here
WEB_SEARCH_PROVIDER=duckduckgo
OCR_TESSERACT_CMD=tesseract
DATABASE_QUERY_ALLOW_WRITES=false
EXECUTION_QUEUE_MAX_WORKERS=3
EXECUTION_QUEUE_MAX_RETRIES=1
```

Start the backend:

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

If PowerShell blocks activation, run this in the same window:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Start the frontend in a second PowerShell window:

```powershell
cd apps\web
copy .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Seed Sample Workflows

Run this after migrations, from `apps/api` with the virtualenv active:

macOS:

```bash
PYTHONPATH=. python scripts/seed_sample_workflows.py
```

Windows PowerShell:

```powershell
$env:PYTHONPATH="."
python scripts\seed_sample_workflows.py
```

## Common Commands

Backend tests:

```bash
cd apps/api
source .venv/bin/activate
pytest tests
```

Frontend typecheck:

```bash
npm run typecheck:web
```

Frontend build:

```bash
npm run build:web
```

Frontend E2E smoke tests:

```bash
npm install
npx playwright install chromium
npm run e2e
```

If the backend is already running separately, set `E2E_SKIP_WEBSERVER=1` and `E2E_BASE_URL=http://127.0.0.1:5173`.

## Local Storage

AI Studio writes local data under:

```text
storage/sqlite/app.db
storage/chroma/
storage/uploads/
storage/logs/
```

These paths are ignored by Git except for `.gitkeep` placeholders.

## Optional Provider Setup

Web Search and Web Page Reader can perform live backend requests. Keep `WEB_SEARCH_TIMEOUT_SECONDS`, `WEB_READER_TIMEOUT_SECONDS`, and `WEB_READER_MAX_BYTES` conservative for local/dev use.

Email delivery uses SMTP when `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM_EMAIL` are set. If SMTP is blank, Email blocks return a safe `skipped` result instead of failing secretly.

Notifications use `NOTIFICATION_PROVIDER=webhook` plus `NOTIFICATION_WEBHOOK_URL` for Slack/Discord/Teams-style delivery. With `NOTIFICATION_PROVIDER=local`, notifications are captured in run output/logs.

Database Query and SQL Assistant default to read-only SQL and use `DATABASE_QUERY_DEFAULT_URL` when set. SQLite URLs look like `sqlite:////absolute/path/app.db`; managed Postgres can be configured later with a SQLAlchemy-compatible URL once the proper driver is installed.

OCR uses Tesseract through `OCR_TESSERACT_CMD`. If Tesseract is not installed, OCR blocks return a clear execution error while normal text extraction continues to work.

Async workflow execution is local-first but durable: run records live in SQLite, workers retry failed runs according to `EXECUTION_QUEUE_MAX_RETRIES`, and admins can inspect `/execution/queue`. Run cancellation is available through `/workflows/{workflow_id}/runs/{run_id}/cancel`.

## Troubleshooting

- If Chatbot/Summarizer/Classifier/Extraction AI fails, check `OPENROUTER_API_KEY` and restart the backend.
- If a file workflow says runtime file paths are missing, use the workflow app URL or builder runtime panel to upload a file before running.
- If RAG answers are generic, ingest documents first, then use the Knowledge tab to test retrieval and confirm chunks exist.
- If `pip install` reports a FastAPI conflict, keep `fastapi==0.115.9`; `chromadb==1.0.7` requires it.
- If OCR fails, run `tesseract --version` in the same terminal and confirm `OCR_TESSERACT_CMD` points to the executable.
