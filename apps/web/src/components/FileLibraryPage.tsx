import { useEffect, useState } from "react";
import { ArrowLeft, FileText, FolderOpen, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { deleteFile, getFile, listFiles, reprocessFile, uploadLibraryFile, type FileLibraryDetail, type FileLibraryItem } from "../lib/api";

type FileLibraryPageProps = {
  onBack: () => void;
  onOpenWorkflow: (workflowId: number) => void;
};

export function FileLibraryPage({ onBack, onOpenWorkflow }: FileLibraryPageProps) {
  const [files, setFiles] = useState<FileLibraryItem[]>([]);
  const [selected, setSelected] = useState<FileLibraryDetail | null>(null);
  const [status, setStatus] = useState("Loading uploaded files.");
  const [isUploading, setIsUploading] = useState(false);

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

  async function uploadFiles(fileList: FileList | null) {
    const selectedFiles = fileList ? Array.from(fileList) : [];
    if (!selectedFiles.length) return;
    setIsUploading(true);
    setStatus(`Uploading ${selectedFiles.length} file(s) to the local File Library.`);
    try {
      await Promise.all(selectedFiles.map((file) => uploadLibraryFile(file)));
      await refreshFiles();
      setStatus(`${selectedFiles.length} file(s) uploaded to File Library. They can now be reused in builder/runtime file inputs.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not upload files.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_8%,_rgba(182,255,135,0.36),_transparent_24%),radial-gradient(circle_at_90%_18%,_rgba(126,211,255,0.24),_transparent_23%),linear-gradient(135deg,_#f7fbf4,_#fff8ed)] p-4 text-ink lg:p-6">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="rounded-[2rem] border border-white/70 bg-ink p-5 text-white shadow-panel">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2 text-sm font-semibold">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.32em] text-white/42">AI Studio</p>
          <h1 className="mt-2 flex items-center gap-3 text-4xl font-bold">
            <FolderOpen className="h-9 w-9 text-lime" aria-hidden />
            File Library
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/62">{status}</p>
          <div className="mt-6 grid gap-2">
            <Info label="Files" value={String(files.length)} dark />
            <Info label="Selected" value={selected ? selected.original_name : "none"} dark />
          </div>
          <button type="button" onClick={() => void refreshFiles()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-lime px-4 py-3 text-sm font-bold text-ink">
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh Library
          </button>
          <label className="mt-3 block rounded-2xl border border-dashed border-white/20 bg-white/8 p-4 text-sm font-semibold text-white">
            <span className="inline-flex items-center gap-2">
              <UploadCloud className="h-4 w-4" aria-hidden />
              Upload Documents
            </span>
            <span className="mt-1 block text-xs font-normal leading-5 text-white/48">
              Add PDFs, DOCX, TXT, CSV, or JSON before building/running a workflow.
            </span>
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.csv,.json"
              disabled={isUploading}
              onChange={(event) => {
                void uploadFiles(event.target.files);
                event.target.value = "";
              }}
              className="mt-3 w-full text-xs text-white/70 file:mr-3 file:rounded-full file:border-0 file:bg-lime file:px-3 file:py-2 file:text-xs file:font-bold file:text-ink disabled:opacity-50"
            />
          </label>
        </aside>

        <section className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <div className="rounded-[2rem] border border-white/70 bg-white/82 p-4 shadow-panel backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <p className="inline-flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" aria-hidden />
                Uploaded Documents
              </p>
              <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-ink/55">{files.length}</span>
            </div>
            <div className="max-h-[calc(100vh-9rem)] space-y-3 overflow-auto pr-1">
            {files.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => void openFile(file.id)}
                className={`w-full rounded-[1.5rem] p-4 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 ${selected?.id === file.id ? "bg-ink text-white ring-ink/10" : "bg-white ring-ink/6"}`}
              >
                <p className="font-semibold">{file.original_name}</p>
                <p className={`mt-1 text-xs uppercase tracking-[0.2em] ${selected?.id === file.id ? "text-white/45" : "text-ink/45"}`}>
                  {file.extension} · {(file.size_bytes / 1024).toFixed(1)} KB · {file.workflow_id ? `workflow #${file.workflow_id}` : "library upload"}
                </p>
                <p className={`mt-2 text-sm ${selected?.id === file.id ? "text-white/58" : "text-ink/58"}`}>{file.knowledge_document_count} knowledge document(s)</p>
              </button>
            ))}
            {!files.length ? (
              <p className="rounded-[1.5rem] border border-dashed border-ink/15 bg-mist/70 p-5 text-sm leading-6 text-ink/58">
                No uploaded files yet. Run a workflow with a File Upload block and documents will appear here automatically.
              </p>
            ) : null}
            </div>
          </div>

          <section className="rounded-[2rem] border border-white/70 bg-white/86 p-5 shadow-panel backdrop-blur">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Selected File</p>
                    <h2 className="mt-2 text-2xl font-semibold">{selected.original_name}</h2>
                  </div>
                  {selected.workflow_id ? (
                    <button
                      type="button"
                      onClick={() => selected.workflow_id && onOpenWorkflow(selected.workflow_id)}
                      className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                    >
                      <FolderOpen className="h-4 w-4" aria-hidden />
                      Open Workflow
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void reprocessSelectedFile()} className="inline-flex items-center gap-2 rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink">
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    Reprocess
                  </button>
                  <button type="button" onClick={() => void deleteSelectedFile()} className="inline-flex items-center gap-2 rounded-full bg-coral/20 px-4 py-2 text-sm font-semibold text-ink">
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Delete File
                  </button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Info label="Run" value={selected.workflow_run_id ? `#${selected.workflow_run_id}` : "n/a"} />
                  <Info label="Node" value={selected.node_id} />
                  <Info label="Documents" value={String(selected.knowledge_documents.length)} />
                </div>
                <h3 className="mt-6 text-lg font-semibold">Extracted/Text Preview</h3>
                <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-2xl border border-ink/6 bg-[#fbfcf8] p-4 text-sm leading-6">
                  {selected.preview}
                </pre>
                <details className="mt-4 rounded-2xl bg-mist/70 p-4 text-xs">
                  <summary className="cursor-pointer font-semibold">Metadata</summary>
                  <pre className="mt-3 overflow-auto">{JSON.stringify(selected, null, 2)}</pre>
                </details>
              </>
            ) : (
              <div className="grid min-h-[420px] place-items-center rounded-[1.6rem] border border-dashed border-ink/15 bg-mist/60 p-8 text-center">
                <div>
                  <p className="text-lg font-semibold">Select a document</p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-ink/58">
                    Preview extracted text, metadata, associated workflows, and reprocess/delete actions in one safe panel.
                  </p>
                </div>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function Info({ label, value, dark = false }: { label: string; value: string; dark?: boolean }) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${dark ? "bg-white/8" : "bg-mist/70"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${dark ? "text-white/42" : "text-ink/45"}`}>{label}</p>
      <p className={`mt-1 truncate font-semibold ${dark ? "text-white" : "text-ink"}`}>{value}</p>
    </div>
  );
}
