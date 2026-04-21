import { useEffect, useState } from "react";
import { deleteFile, getFile, listFiles, reprocessFile, type FileLibraryDetail, type FileLibraryItem } from "../lib/api";

type FileLibraryPageProps = {
  onBack: () => void;
  onOpenWorkflow: (workflowId: number) => void;
};

export function FileLibraryPage({ onBack, onOpenWorkflow }: FileLibraryPageProps) {
  const [files, setFiles] = useState<FileLibraryItem[]>([]);
  const [selected, setSelected] = useState<FileLibraryDetail | null>(null);
  const [status, setStatus] = useState("Loading uploaded files.");

  useEffect(() => {
    refreshFiles();
  }, []);

  async function refreshFiles() {
    listFiles()
      .then((records) => {
        setFiles(records);
        setStatus(`${records.length} file(s) found.`);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load files."));
  }

  async function openFile(fileId: number) {
    const detail = await getFile(fileId);
    setSelected(detail);
  }

  async function deleteSelectedFile() {
    if (!selected) return;
    await deleteFile(selected.id);
    setSelected(null);
    await refreshFiles();
    setStatus("File deleted from local storage.");
  }

  async function reprocessSelectedFile() {
    if (!selected) return;
    const result = await reprocessFile(selected.id);
    setSelected({ ...selected, preview: result.document.text_preview });
    setStatus(`Reprocessed ${selected.original_name}: ${result.document.text_length} characters extracted.`);
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,_#f6fbf7,_#eef8ff)] px-4 py-6 text-ink">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[2rem] bg-white/85 p-6 shadow-panel">
          <button type="button" onClick={onBack} className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold">
            Back
          </button>
          <h1 className="mt-4 text-4xl font-bold">File Library</h1>
          <p className="mt-2 text-sm text-ink/62">{status}</p>
        </header>

        <section className="mt-5 grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-3">
            {files.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => void openFile(file.id)}
                className="w-full rounded-[1.5rem] bg-white/85 p-4 text-left shadow-sm transition hover:-translate-y-0.5"
              >
                <p className="font-semibold">{file.original_name}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ink/45">
                  {file.extension} · {(file.size_bytes / 1024).toFixed(1)} KB · workflow #{file.workflow_id}
                </p>
                <p className="mt-2 text-sm text-ink/58">{file.knowledge_document_count} knowledge document(s)</p>
              </button>
            ))}
          </div>

          <section className="rounded-[2rem] bg-white/85 p-5 shadow-panel">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Selected File</p>
                    <h2 className="mt-2 text-2xl font-semibold">{selected.original_name}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenWorkflow(selected.workflow_id)}
                    className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                  >
                    Open Workflow
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void reprocessSelectedFile()} className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink">
                    Reprocess
                  </button>
                  <button type="button" onClick={() => void deleteSelectedFile()} className="rounded-full bg-coral/20 px-4 py-2 text-sm font-semibold text-ink">
                    Delete File
                  </button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Info label="Run" value={selected.workflow_run_id ? `#${selected.workflow_run_id}` : "n/a"} />
                  <Info label="Node" value={selected.node_id} />
                  <Info label="Documents" value={String(selected.knowledge_documents.length)} />
                </div>
                <h3 className="mt-6 text-lg font-semibold">Extracted/Text Preview</h3>
                <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl bg-[#fbfcf8] p-4 text-sm leading-6">
                  {selected.preview}
                </pre>
                <details className="mt-4 rounded-2xl bg-mist/70 p-4 text-xs">
                  <summary className="cursor-pointer font-semibold">Metadata</summary>
                  <pre className="mt-3 overflow-auto">{JSON.stringify(selected, null, 2)}</pre>
                </details>
              </>
            ) : (
              <p className="text-sm text-ink/60">Select a file to preview extracted text, metadata, and associated workflows.</p>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-mist/70 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ink/45">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
