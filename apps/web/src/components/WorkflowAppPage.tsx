import { useEffect, useState } from "react";
import { ArrowLeft, Bot, Edit3, MessageSquareText, Play, UserRound, Workflow } from "lucide-react";
import {
  executeWorkflowAsync,
  getRunEventsUrl,
  getWorkflow,
  getWorkflowRun,
  listFiles,
  uploadRuntimeFile,
  type FileLibraryItem,
  type RuntimeUploadResponse,
  type WorkflowRecord,
  type WorkflowRunRecord,
} from "../lib/api";
import { explainError } from "../lib/friendlyErrors";
import type { BuilderNode } from "@vmb/shared";

type WorkflowAppPageProps = {
  workflowId: number;
  onBack: () => void;
  onOpenRun: (run: WorkflowRunRecord) => void;
  onOpenBuilder: (workflowId: number) => void;
};

type RuntimeState = Record<
  string,
  {
    value: string;
    files: File[];
    uploadedFiles: RuntimeUploadResponse[];
    status: "idle" | "uploading" | "ready" | "error";
    error?: string;
  }
>;

type OutputCard = {
  id: string;
  title: string;
  kind: string;
  summary: string;
  body: string;
  metadata?: unknown;
};

export function WorkflowAppPage({ workflowId, onBack, onOpenRun, onOpenBuilder }: WorkflowAppPageProps) {
  const [workflow, setWorkflow] = useState<WorkflowRecord | null>(null);
  const [runtimeInputs, setRuntimeInputs] = useState<RuntimeState>({});
  const [sessionId, setSessionId] = useState(() => `app-session-${Date.now()}`);
  const [userId, setUserId] = useState("local-preview-user");
  const [defaultMessage, setDefaultMessage] = useState("Run this workflow with my uploaded document.");
  const [run, setRun] = useState<WorkflowRunRecord | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<FileLibraryItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<Array<{ label: string; status: "pending" | "running" | "done" | "failed"; detail: string }>>([]);
  const [status, setStatus] = useState("Loading workflow app.");

  useEffect(() => {
    getWorkflow(workflowId)
      .then((record) => {
        setWorkflow(record);
        setStatus("Workflow app is ready.");
      })
      .catch((error) => setStatus(explainError(error)));
  }, [workflowId]);

  useEffect(() => {
    listFiles()
      .then((records) => setLibraryFiles(records.slice(0, 40)))
      .catch(() => setLibraryFiles([]));
  }, []);

  const runtimeNodes = (workflow?.graph_json.nodes || []).filter((node) =>
    ["chat_input", "text_input", "file_upload"].includes(node.data.blockType),
  );
  const appKind = getWorkflowAppKind(workflow);
  const outputCards = getOutputCards(run, workflow);

  function getInputState(nodeId: string) {
    const current = runtimeInputs[nodeId];
    return {
      value: current?.value || "",
      files: current?.files || [],
      uploadedFiles: current?.uploadedFiles || [],
      status: current?.status || "idle",
      error: current?.error,
    };
  }

  function updateValue(nodeId: string, value: string) {
    setRuntimeInputs((current) => ({
      ...current,
      [nodeId]: { ...getInputState(nodeId), value },
    }));
  }

  async function updateFiles(node: BuilderNode, files: FileList | null) {
    const selectedFiles = files ? Array.from(files) : [];
    setRuntimeInputs((current) => ({
      ...current,
      [node.id]: {
        ...getInputState(node.id),
        files: selectedFiles,
        uploadedFiles: [],
        status: selectedFiles.length ? "uploading" : "idle",
        error: undefined,
      },
    }));

    if (!selectedFiles.length) {
      return;
    }

    try {
      const uploadedFiles = await Promise.all(selectedFiles.map((file) => uploadRuntimeFile(file)));
      setRuntimeInputs((current) => ({
        ...current,
        [node.id]: {
          ...getInputState(node.id),
          files: selectedFiles,
          uploadedFiles,
          status: "ready",
          error: undefined,
        },
      }));
      setStatus(`${node.data.label}: ${uploadedFiles.length} file(s) ready.`);
    } catch (error) {
      setRuntimeInputs((current) => ({
        ...current,
        [node.id]: {
          ...getInputState(node.id),
          files: selectedFiles,
          uploadedFiles: [],
          status: "error",
          error: error instanceof Error ? error.message : "Upload failed.",
        },
      }));
    }
  }

  function useLibraryFile(node: BuilderNode, file: FileLibraryItem) {
    const uploadedFile: RuntimeUploadResponse = {
      original_name: file.original_name,
      stored_name: file.storage_path.split("/").pop() || file.original_name,
      extension: file.extension,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      storage_path: file.storage_path,
      relative_storage_path: String(file.metadata?.relative_storage_path || file.storage_path),
    };
    setRuntimeInputs((current) => ({
      ...current,
      [node.id]: {
        ...getInputState(node.id),
        files: [],
        uploadedFiles: [uploadedFile],
        status: "ready",
        error: undefined,
      },
    }));
    setStatus(`${file.original_name} selected from File Library for ${node.data.label}.`);
  }

  async function runWorkflowApp(runtimeOverride?: RuntimeState, messageOverride?: string) {
    if (!workflow) {
      return;
    }

    setIsRunning(true);
    setExecutionSteps([
      { label: "Validate inputs", status: "running", detail: "Checking files, text, session, and required runtime values." },
      { label: "Execute DAG", status: "pending", detail: `${workflow.graph_json.nodes.length} block(s) queued.` },
      { label: "Collect outputs", status: "pending", detail: "Preparing dashboard, JSON, chat, and log cards." },
    ]);
    setStatus("Executing workflow app.");

    try {
      const inputs: Record<string, { value: string; files: string[]; metadata: Record<string, string> }> = {};
      const sourceRuntime = runtimeOverride || runtimeInputs;
      for (const node of runtimeNodes) {
        const state = sourceRuntime[node.id] || getInputState(node.id);
        if (node.data.blockType === "file_upload" && !state.uploadedFiles.length && !node.data.config.defaultLocalPaths) {
          throw new Error(`File Upload node requires runtime file paths for ${node.data.label}.`);
        }
        if (node.data.blockType === "chat_input") {
          inputs[node.id] = {
            value: state.value || messageOverride || defaultMessage,
            files: [],
            metadata: { source: "workflow-app" },
          };
        }
        if (node.data.blockType === "text_input" && state.value) {
          inputs[node.id] = {
            value: state.value,
            files: [],
            metadata: { source: "workflow-app" },
          };
        }
        if (node.data.blockType === "file_upload") {
          inputs[node.id] = {
            value: "",
            files: state.uploadedFiles.map((file) => file.storage_path),
            metadata: { source: "workflow-app", uploaded_count: String(state.uploadedFiles.length) },
          };
        }
      }

      const queued = await executeWorkflowAsync(workflow.id, {
        trigger_mode: "workflow_app",
        session_id: sessionId,
        user_id: userId,
        inputs,
      });
      setExecutionSteps([
        { label: "Validate inputs", status: "done", detail: "Runtime inputs were accepted." },
        { label: "Execute DAG", status: "running", detail: `Run #${queued.run_id} is running in the background queue.` },
        { label: "Collect outputs", status: "pending", detail: "Waiting for final node outputs." },
      ]);
      const nextRun = await waitForRunEvents(workflow.id, queued.run_id);
      setRun(nextRun);
      setExecutionSteps([
        { label: "Validate inputs", status: "done", detail: "Runtime inputs were accepted." },
        {
          label: "Execute DAG",
          status: nextRun.status === "failed" ? "failed" : "done",
          detail: `${nextRun.node_runs?.length || workflow.graph_json.nodes.length} node run(s), ${nextRun.latency_ms || 0}ms.`,
        },
        {
          label: "Collect outputs",
          status: nextRun.status === "failed" ? "failed" : "done",
          detail: outputCards.length ? `${outputCards.length} output card(s) prepared.` : "Inspect run details for node-level outputs.",
        },
      ]);
      setStatus(nextRun.status === "completed" ? `Run #${nextRun.id} completed.` : `Run #${nextRun.id} ${nextRun.status}.`);
    } catch (error) {
      const message = explainError(error);
      setExecutionSteps((current) =>
        current.length
          ? current.map((step, index) => (index === 0 && step.status === "running" ? { ...step, status: "failed", detail: message } : step))
          : [{ label: "Run failed", status: "failed", detail: message }],
      );
      setStatus(message);
    } finally {
      setIsRunning(false);
    }
  }

  async function runSampleTest() {
    const sampleMessage =
      appKind === "chatbot"
        ? "What can you help me with?"
        : appKind === "document"
          ? "Summarize this document and extract key fields."
          : "Run a sample test and show the output.";
    const sampleRuntime: RuntimeState = { ...runtimeInputs };
    for (const node of runtimeNodes) {
      if (node.data.blockType === "file_upload" && !sampleRuntime[node.id]?.uploadedFiles?.length) {
        sampleRuntime[node.id] = {
          value: "",
          files: [],
          uploadedFiles: [
            {
              original_name: "sample_full_stack_document_ops.txt",
              stored_name: "sample_full_stack_document_ops.txt",
              extension: ".txt",
              mime_type: "text/plain",
              size_bytes: 0,
              storage_path: "storage/sample_full_stack_document_ops.txt",
              relative_storage_path: "storage/sample_full_stack_document_ops.txt",
            },
          ],
          status: "ready",
        };
      }
      if (node.data.blockType === "chat_input" || node.data.blockType === "text_input") {
        sampleRuntime[node.id] = {
          ...getInputState(node.id),
          value: sampleMessage,
        };
      }
    }
    setRuntimeInputs(sampleRuntime);
    setDefaultMessage(sampleMessage);
    await runWorkflowApp(sampleRuntime, sampleMessage);
  }

  function waitForRunEvents(nextWorkflowId: number, runId: number) {
    return new Promise<WorkflowRunRecord>((resolve, reject) => {
      const source = new EventSource(getRunEventsUrl(nextWorkflowId, runId));
      source.addEventListener("run_update", (event) => {
        const nextRun = JSON.parse((event as MessageEvent).data) as WorkflowRunRecord;
        setRun(nextRun);
        setStatus(`Run #${nextRun.id} ${nextRun.status}.`);
        setExecutionSteps((current) =>
          current.map((step) =>
            step.label === "Execute DAG"
              ? {
                  ...step,
                  status: nextRun.status === "failed" ? "failed" : nextRun.status === "completed" ? "done" : "running",
                  detail: `${nextRun.node_runs?.length || 0} node event(s), ${nextRun.latency_ms || 0}ms.`,
                }
              : step,
          ),
        );
      });
      source.addEventListener("run_done", (event) => {
        source.close();
        resolve(JSON.parse((event as MessageEvent).data) as WorkflowRunRecord);
      });
      source.onerror = async () => {
        source.close();
        try {
          resolve(await getWorkflowRun(nextWorkflowId, runId));
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_15%_10%,_rgba(182,255,135,0.38),_transparent_24%),radial-gradient(circle_at_90%_20%,_rgba(255,143,112,0.2),_transparent_22%),linear-gradient(135deg,_#f6fbf4_0%,_#fff7ec_100%)] px-4 py-6 text-ink lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-full bg-mist px-4 py-2 text-sm font-semibold">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Workflows
            </button>
            {workflow ? (
              <button type="button" onClick={() => onOpenBuilder(workflow.id)} className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
                <Edit3 className="h-4 w-4" aria-hidden />
                Edit Builder
              </button>
            ) : null}
          </div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.34em] text-ink/45">{appKind} App</p>
          <h1 className="mt-2 flex items-center gap-3 text-4xl font-bold tracking-tight">
            <Workflow className="h-9 w-9 text-lime" aria-hidden />
            {workflow?.name || `Workflow #${workflowId}`}
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink/62">
            {getWorkflowAppDescription(appKind, workflow?.description)}
          </p>
          <p className="mt-4 rounded-[1.35rem] bg-mist/80 p-3 text-sm font-semibold text-ink/72">{status}</p>

          <label className="mt-5 block">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <MessageSquareText className="h-4 w-4" aria-hidden />
              Default message / question
            </span>
            <textarea
              rows={3}
              value={defaultMessage}
              onChange={(event) => setDefaultMessage(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
            />
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <label className="block">
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4" aria-hidden />
                Session ID
              </span>
              <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none" />
            </label>
            <label className="block">
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <UserRound className="h-4 w-4" aria-hidden />
                Runtime User ID
              </span>
              <input value={userId} onChange={(event) => setUserId(event.target.value)} className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none" />
            </label>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Inputs</p>
                <h2 className="mt-2 text-2xl font-bold">Run this workflow</h2>
              </div>
              <button
                type="button"
                onClick={() => void runWorkflowApp()}
                disabled={isRunning || !workflow}
                className="inline-flex items-center gap-2 rounded-full bg-lime px-5 py-3 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-4 w-4" aria-hidden />
                {isRunning ? "Running..." : "Run App"}
              </button>
              <button
                type="button"
                onClick={() => void runSampleTest()}
                disabled={isRunning || !workflow}
                className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                Run Sample Test
              </button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {runtimeNodes.length ? runtimeNodes.map((node) => (
                <RuntimeInputCard
                  key={node.id}
                  node={node}
                  state={getInputState(node.id)}
                  onValueChange={(value) => updateValue(node.id, value)}
                  onFilesChange={(files) => void updateFiles(node, files)}
                  libraryFiles={libraryFiles}
                  onUseLibraryFile={(file) => useLibraryFile(node, file)}
                />
              )) : (
                <p className="rounded-[1.5rem] bg-mist/70 p-5 text-sm text-ink/62">
                  This workflow has no runtime inputs. Click Run App to execute the saved graph.
                </p>
              )}
            </div>
            <PreRunChecklist workflow={workflow} runtimeNodes={runtimeNodes} runtimeInputs={runtimeInputs} />
          </div>

          <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Dashboard Output</p>
                <h2 className="mt-2 text-2xl font-bold">Results</h2>
              </div>
              {run ? (
                <button type="button" onClick={() => onOpenRun(run)} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
                  Open Run Details
                </button>
              ) : null}
            </div>

            {run ? (
              <>
                <ExecutionTimeline steps={executionSteps} run={run} />
                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  {outputCards.length ? outputCards.map((card) => <OutputCardView key={card.id} card={card} />) : (
                    <p className="rounded-[1.5rem] bg-mist/70 p-5 text-sm text-ink/62">Run completed, but no output block returned a displayable result.</p>
                  )}
                </div>
              </>
            ) : (
              <>
                {executionSteps.length ? <ExecutionTimeline steps={executionSteps} run={null} /> : null}
                <div className="mt-5 rounded-[1.5rem] border border-dashed border-ink/15 bg-mist/70 p-8 text-sm leading-6 text-ink/62">
                  Upload files or edit text inputs, then run the app. Outputs from Dashboard/Preview,
                  Chat Output, JSON Output, and Logger blocks will appear here as cards.
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function RuntimeInputCard({
  node,
  state,
  onValueChange,
  onFilesChange,
  libraryFiles,
  onUseLibraryFile,
}: {
  node: BuilderNode;
  state: RuntimeState[string];
  onValueChange: (value: string) => void;
  onFilesChange: (files: FileList | null) => void;
  libraryFiles: FileLibraryItem[];
  onUseLibraryFile: (file: FileLibraryItem) => void;
}) {
  return (
    <article className="rounded-[1.5rem] border border-ink/8 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{node.data.label}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ink/45">{node.data.blockType.split("_").join(" ")}</p>
        </div>
        <span className="rounded-full px-2 py-1 text-[10px] font-bold text-white" style={{ backgroundColor: node.data.accentColor }}>
          {node.data.icon}
        </span>
      </div>

      {node.data.blockType === "file_upload" ? (
        <div className="mt-4">
          <input
            type="file"
            accept={String(node.data.config.accept || ".pdf,.docx,.txt,.csv,.json")}
            multiple={Boolean(node.data.config.multiple)}
            onChange={(event) => {
              onFilesChange(event.target.files);
              event.target.value = "";
            }}
            className="w-full rounded-2xl border border-dashed border-ink/20 bg-mist/60 px-4 py-4 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
          <p className="mt-2 text-xs text-ink/55">
            Accepted: {String(node.data.config.accept || ".pdf,.docx,.txt,.csv,.json")}
          </p>
          {state.status === "uploading" ? <p className="mt-2 rounded-xl bg-sand/70 px-3 py-2 text-xs font-semibold">Uploading...</p> : null}
          {state.status === "error" ? <p className="mt-2 rounded-xl bg-coral/15 px-3 py-2 text-xs font-semibold">{state.error}</p> : null}
          {state.uploadedFiles.length ? (
            <div className="mt-2 space-y-1">
              {state.uploadedFiles.map((file) => (
                <p key={file.storage_path} className="rounded-xl bg-lime/25 px-3 py-2 text-xs font-semibold">
                  Ready: {file.original_name}
                </p>
              ))}
            </div>
          ) : node.data.config.defaultLocalPaths ? (
            <p className="mt-2 rounded-xl bg-lime/15 px-3 py-2 text-xs text-ink/62">
              Uses default local file if no upload is selected.
            </p>
          ) : null}
          {libraryFiles.length ? (
            <div className="mt-4 rounded-2xl bg-mist/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink/45">Select From File Library</p>
              <div className="mt-2 max-h-40 space-y-2 overflow-auto">
                {libraryFiles.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => onUseLibraryFile(file)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-left text-xs font-semibold text-ink transition hover:bg-lime/25"
                  >
                    <span className="truncate">{file.original_name}</span>
                    <span className="shrink-0 text-ink/45">{(file.size_bytes / 1024).toFixed(1)} KB</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <textarea
          rows={4}
          value={state.value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={
            node.data.blockType === "chat_input"
              ? String(node.data.config.placeholder || "Ask a question...")
              : String(node.data.config.defaultText || "Optional runtime override...")
          }
          className="mt-4 w-full rounded-2xl border border-ink/10 bg-mist/50 px-4 py-3 text-sm outline-none"
        />
      )}
    </article>
  );
}

function PreRunChecklist({
  workflow,
  runtimeNodes,
  runtimeInputs,
}: {
  workflow: WorkflowRecord | null;
  runtimeNodes: BuilderNode[];
  runtimeInputs: RuntimeState;
}) {
  if (!workflow) return null;
  const fileNodes = runtimeNodes.filter((node) => node.data.blockType === "file_upload");
  const missingFiles = fileNodes.filter((node) => {
    const state = runtimeInputs[node.id];
    return !state?.uploadedFiles?.length && !node.data.config.defaultLocalPaths;
  });
  const ragNodes = workflow.graph_json.nodes.filter((node) => node.data.blockType === "rag_knowledge");
  const outputNodes = workflow.graph_json.nodes.filter((node) => ["chat_output", "json_output", "dashboard_preview", "logger"].includes(node.data.blockType));
  const checklist = [
    { label: "Runtime files", value: missingFiles.length ? `${missingFiles.length} missing` : "ready", ok: missingFiles.length === 0 },
    { label: "RAG blocks", value: `${ragNodes.length} configured`, ok: true },
    { label: "Output blocks", value: `${outputNodes.length} visible`, ok: outputNodes.length > 0 },
    { label: "Blocks to run", value: `${workflow.graph_json.nodes.length} total`, ok: workflow.graph_json.nodes.length > 0 },
  ];

  return (
    <div className="mt-5 rounded-[1.5rem] bg-ink p-4 text-white">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/42">Pre-run checklist</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {checklist.map((item) => (
          <div key={item.label} className="rounded-2xl bg-white/8 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">{item.label}</p>
            <p className={`mt-1 text-sm font-semibold ${item.ok ? "text-lime" : "text-coral"}`}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getWorkflowAppKind(workflow: WorkflowRecord | null) {
  const blockTypes = new Set((workflow?.graph_json.nodes || []).map((node) => node.data.blockType));
  if (blockTypes.has("file_upload") && blockTypes.has("extraction_ai")) return "extractor";
  if (blockTypes.has("file_upload")) return "document";
  if (blockTypes.has("chat_input") && blockTypes.has("chat_output")) return "chatbot";
  if (blockTypes.has("rag_knowledge")) return "rag";
  return "workflow";
}

function getWorkflowAppDescription(kind: string, fallback?: string | null) {
  if (fallback) return fallback;
  if (kind === "chatbot") return "A chat-first app with session-aware memory and clean answer cards.";
  if (kind === "document") return "A document-first app for upload, extraction, RAG, dashboard, and JSON workflows.";
  if (kind === "extractor") return "A file-to-JSON app for extracting structured fields from documents.";
  if (kind === "rag") return "A knowledge retrieval app for testing local collections and cited answers.";
  return "A shareable local app URL for text, file, dashboard, JSON, and agent workflows.";
}

function ExecutionTimeline({
  steps,
  run,
}: {
  steps: Array<{ label: string; status: "pending" | "running" | "done" | "failed"; detail: string }>;
  run: WorkflowRunRecord | null;
}) {
  if (!steps.length) return null;
  return (
    <div className="mt-5 rounded-[1.5rem] bg-ink p-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/42">Execution progress</p>
        {run ? <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">Run #{run.id}</span> : null}
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {steps.map((step) => (
          <div key={step.label} className="rounded-2xl bg-white/8 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <span className={`h-2 w-2 rounded-full ${step.status === "done" ? "bg-lime" : step.status === "failed" ? "bg-coral" : step.status === "running" ? "bg-sand" : "bg-white/25"}`} />
              {step.label}
            </p>
            <p className="mt-2 text-xs leading-5 text-white/55">{step.detail}</p>
          </div>
        ))}
      </div>
      {run?.node_runs?.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {run.node_runs.map((nodeRun) => (
            <div key={nodeRun.id} className="rounded-2xl bg-white/7 px-3 py-2 text-xs">
              <span className="font-semibold">{nodeRun.execution_index + 1}. {nodeRun.block_type}</span>
              <span className="ml-2 text-white/50">{nodeRun.status} · {nodeRun.latency_ms || 0}ms</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OutputCardView({ card }: { card: OutputCard }) {
  return (
    <article className="rounded-[1.6rem] border border-ink/8 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ink/45">{card.kind}</p>
          <h3 className="mt-2 text-xl font-semibold">{card.title}</h3>
        </div>
        <span className="rounded-full bg-lime/25 px-3 py-1 text-xs font-semibold text-ink">Output</span>
      </div>
      {card.summary ? <p className="mt-4 rounded-2xl bg-mist/70 px-4 py-3 text-sm leading-6 text-ink/65">{card.summary}</p> : null}
      <div className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-2xl bg-[#fbfcf8] p-4 text-sm leading-6 text-ink">
        {card.body || "No displayable output."}
      </div>
      {card.metadata ? (
        <details className="mt-4 rounded-2xl bg-mist/60 px-4 py-3 text-xs text-ink/65">
          <summary className="cursor-pointer font-semibold text-ink">Sources / metadata</summary>
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] leading-5">{JSON.stringify(card.metadata, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

function getOutputCards(run: WorkflowRunRecord | null, workflow: WorkflowRecord | null): OutputCard[] {
  if (!run) {
    return [];
  }
  const cards: OutputCard[] = [];
  for (const [nodeId, outputGroup] of Object.entries(run.output_payload || {})) {
    for (const [portId, payload] of Object.entries(outputGroup || {})) {
      const value = payload.value;
      const kind = String((payload as { type?: unknown }).type || portId);
      const title = getNodeLabel(workflow, nodeId);
      const metadata = payload.metadata;

      if (kind === "chat" && typeof value === "object" && value !== null && "answer" in value) {
        const chat = value as { answer?: unknown; citations?: unknown[]; source_chunks?: unknown[] };
        cards.push({
          id: `${nodeId}-${portId}`,
          title,
          kind: "Chat Output",
          summary: `${chat.citations?.length || 0} citation(s), ${chat.source_chunks?.length || 0} source chunk(s)`,
          body: String(chat.answer || ""),
          metadata: { citations: chat.citations || [], source_chunks: chat.source_chunks || [] },
        });
        continue;
      }

      if (kind === "preview" && typeof value === "object" && value !== null) {
        const preview = value as { summary?: unknown; content?: unknown };
        cards.push({
          id: `${nodeId}-${portId}`,
          title,
          kind: "Dashboard Preview",
          summary: stringifyPreview(preview.summary || payload.preview),
          body: stringifyPreview(preview.content || preview.summary || value),
          metadata,
        });
        continue;
      }

      cards.push({
        id: `${nodeId}-${portId}`,
        title,
        kind: kind === "json" ? "JSON Output" : kind === "log" ? "Logger" : kind,
        summary: stringifyPreview(payload.preview || metadata).slice(0, 220),
        body: stringifyPreview(value || payload.preview),
        metadata,
      });
    }
  }
  return cards;
}

function getNodeLabel(workflow: WorkflowRecord | null, nodeId: string) {
  return workflow?.graph_json.nodes.find((node) => node.id === nodeId)?.data.label || nodeId;
}

function stringifyPreview(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
