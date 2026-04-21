import { useEffect, useState } from "react";
import { ArrowLeft, Clock3, FileJson, GitBranch, ListChecks } from "lucide-react";
import { getWorkflowRun, type WorkflowRunRecord } from "../lib/api";
import { explainError } from "../lib/friendlyErrors";

type RunPageProps = {
  workflowId: number;
  runId: number;
  onBack: () => void;
};

export function RunPage({ workflowId, runId, onBack }: RunPageProps) {
  const [run, setRun] = useState<WorkflowRunRecord | null>(null);
  const [status, setStatus] = useState("Loading run details.");

  useEffect(() => {
    getWorkflowRun(workflowId, runId)
      .then((record) => {
        setRun(record);
        setStatus(`Run #${record.id} loaded.`);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load run."));
  }, [workflowId, runId]);

  const outputCards = run ? getOutputCards(run) : [];

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,_#f5fbf7,_#fff7ed)] px-4 py-6 text-ink">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] bg-white/85 p-6 shadow-panel">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
          <h1 className="mt-4 flex items-center gap-3 text-4xl font-bold">
            <ListChecks className="h-9 w-9 text-lime" aria-hidden />
            Workflow Run Details
          </h1>
          <p className="mt-2 text-sm text-ink/62">{status}</p>
        </header>

        {run ? (
          <section className="mt-5 grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="rounded-[2rem] bg-white/85 p-5 shadow-panel">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">
                <Clock3 className="h-4 w-4" aria-hidden />
                Run #{run.id}
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{run.status}</h2>
              <div className="mt-4 grid gap-2 text-sm">
                <Info label="Workflow" value={`#${run.workflow_id}`} />
                <Info label="Trigger" value={run.trigger_mode || "manual"} />
                <Info label="Latency" value={run.latency_ms ? `${run.latency_ms} ms` : "n/a"} />
                <Info label="Started" value={run.started_at ? new Date(run.started_at).toLocaleString() : "n/a"} />
              </div>
              {run.error_message ? (
                <p className="mt-4 rounded-2xl bg-coral/20 p-3 text-sm font-semibold">{explainError(run.error_message)}</p>
              ) : null}
            </aside>

            <div className="space-y-5">
              <section className="rounded-[2rem] bg-white/85 p-5 shadow-panel">
                <h2 className="flex items-center gap-2 text-xl font-semibold">
                  <GitBranch className="h-5 w-5" aria-hidden />
                  Node Timeline
                </h2>
                <p className="mt-3 rounded-2xl bg-lime/20 px-4 py-3 text-sm leading-6 text-ink">
                  {explainWorkflowRun(run)}
                </p>
                <div className="mt-4 grid gap-3">
                  {(run.node_runs || []).map((nodeRun) => (
                    <article key={nodeRun.id} className="rounded-2xl border border-ink/8 bg-mist/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{nodeRun.node_id}</p>
                          <p className="text-xs uppercase tracking-[0.2em] text-ink/45">{nodeRun.block_type}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${nodeRun.status === "completed" ? "bg-lime/40" : "bg-coral/25"}`}>
                          {nodeRun.status} {nodeRun.latency_ms ? `· ${nodeRun.latency_ms} ms` : ""}
                        </span>
                      </div>
                      {nodeRun.error_message ? <p className="mt-3 text-sm text-coral">{explainError(nodeRun.error_message)}</p> : null}
                      <details className="mt-3 text-xs">
                        <summary className="cursor-pointer font-semibold">Inputs / Outputs / Logs</summary>
                        <pre className="mt-2 max-h-80 overflow-auto rounded-2xl bg-white p-3">{JSON.stringify(nodeRun, null, 2)}</pre>
                      </details>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-[2rem] bg-white/85 p-5 shadow-panel">
                <h2 className="flex items-center gap-2 text-xl font-semibold">
                  <FileJson className="h-5 w-5" aria-hidden />
                  Final Outputs
                </h2>
                {outputCards.length ? (
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    {outputCards.map((card) => (
                      <article key={card.id} className="rounded-[1.5rem] border border-ink/8 bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ink/45">{card.kind}</p>
                        <h3 className="mt-2 text-lg font-semibold">{card.title}</h3>
                        {card.summary ? (
                          <p className="mt-3 rounded-2xl bg-mist/70 px-3 py-2 text-xs leading-5 text-ink/65">{card.summary}</p>
                        ) : null}
                        <div className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-[#fbfcf8] p-3 text-sm leading-6">
                          {card.body}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <pre className="mt-4 max-h-[520px] overflow-auto rounded-2xl bg-[#fbfcf8] p-4 text-xs leading-6">
                    {JSON.stringify(run.output_payload, null, 2)}
                  </pre>
                )}
              </section>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function explainWorkflowRun(run: WorkflowRunRecord) {
  const nodeRuns = run.node_runs || [];
  const completed = nodeRuns.filter((node) => node.status === "completed").length;
  const failed = nodeRuns.filter((node) => node.status === "failed").length;
  const blockTypes = nodeRuns.map((node) => node.block_type);
  const parts = [`${completed}/${nodeRuns.length || Object.keys(run.output_payload || {}).length} block(s) completed`];
  if (blockTypes.includes("file_upload")) parts.push("files were staged locally");
  if (blockTypes.includes("text_extraction")) parts.push("text was extracted");
  if (blockTypes.includes("rag_knowledge")) parts.push("knowledge was indexed/retrieved");
  if (blockTypes.includes("chatbot")) parts.push("an answer was generated");
  if (blockTypes.includes("citation_verifier")) parts.push("citations were checked");
  if (failed) parts.push(`${failed} block(s) failed`);
  if (run.latency_ms) parts.push(`total latency ${run.latency_ms}ms`);
  return parts.join(", ") + ".";
}

function getOutputCards(run: WorkflowRunRecord) {
  const cards: Array<{ id: string; title: string; kind: string; summary: string; body: string }> = [];
  for (const [nodeId, outputGroup] of Object.entries(run.output_payload || {})) {
    for (const [portId, payload] of Object.entries(outputGroup || {})) {
      const value = payload.value;
      const kind = payload.type || portId;
      if (kind === "chat" && typeof value === "object" && value !== null && "answer" in value) {
        const chat = value as { answer?: unknown; citations?: unknown[]; source_chunks?: unknown[] };
        cards.push({
          id: `${nodeId}-${portId}`,
          title: nodeId,
          kind: "Chat Output",
          summary: `${chat.citations?.length || 0} citation(s), ${chat.source_chunks?.length || 0} source chunk(s)`,
          body: String(chat.answer || ""),
        });
        continue;
      }
      if (kind === "preview" && typeof value === "object" && value !== null) {
        const preview = value as { summary?: unknown; content?: unknown };
        cards.push({
          id: `${nodeId}-${portId}`,
          title: nodeId,
          kind: "Dashboard Preview",
          summary: stringify(preview.summary || payload.preview),
          body: stringify(preview.content || preview.summary || value),
        });
        continue;
      }
      cards.push({
        id: `${nodeId}-${portId}`,
        title: nodeId,
        kind: kind === "json" ? "JSON Output" : kind === "log" ? "Logger" : kind,
        summary: stringify(payload.preview).slice(0, 180),
        body: stringify(value || payload.preview),
      });
    }
  }
  return cards;
}

function stringify(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-mist/70 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ink/45">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
