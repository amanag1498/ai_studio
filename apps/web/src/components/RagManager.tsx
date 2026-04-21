import { useEffect, useState } from "react";
import {
  deleteKnowledgeCollection,
  listCollectionDocuments,
  listDocumentChunks,
  listKnowledgeCollections,
  reingestKnowledgeCollection,
  testKnowledgeRetrieval,
  type KnowledgeChunkRecord,
  type KnowledgeCollection,
  type KnowledgeDocumentRecord,
  type RetrievalTestResponse,
} from "../lib/api";

type RagManagerProps = {
  workflowId: number | null;
};

export function RagManager({ workflowId }: RagManagerProps) {
  const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [documents, setDocuments] = useState<KnowledgeDocumentRecord[]>([]);
  const [chunks, setChunks] = useState<KnowledgeChunkRecord[]>([]);
  const [query, setQuery] = useState("work from home");
  const [retrieval, setRetrieval] = useState<RetrievalTestResponse | null>(null);
  const [status, setStatus] = useState("Save or load a workflow to inspect RAG collections.");

  useEffect(() => {
    if (!workflowId) {
      setCollections([]);
      setSelectedCollection("");
      return;
    }
    refreshCollections();
  }, [workflowId]);

  async function refreshCollections() {
    if (!workflowId) return;
    const records = await listKnowledgeCollections(workflowId);
    setCollections(records);
    setSelectedCollection((current) => current || records[0]?.collection_name || "");
    setStatus(records.length ? `${records.length} collection(s) found.` : "No RAG collections yet. Run a RAG workflow first.");
  }

  async function loadDocuments(collectionName: string) {
    if (!workflowId || !collectionName) return;
    const records = await listCollectionDocuments(workflowId, collectionName);
    setDocuments(records);
    setChunks([]);
  }

  async function loadChunks(documentId: number) {
    if (!workflowId) return;
    setChunks(await listDocumentChunks(workflowId, documentId));
  }

  async function runRetrievalTest() {
    if (!workflowId || !selectedCollection) return;
    setRetrieval(await testKnowledgeRetrieval(workflowId, selectedCollection, query));
  }

  async function removeCollection() {
    if (!workflowId || !selectedCollection) return;
    await deleteKnowledgeCollection(workflowId, selectedCollection);
    setSelectedCollection("");
    setDocuments([]);
    setChunks([]);
    setRetrieval(null);
    await refreshCollections();
  }

  async function reingestCollection() {
    if (!workflowId || !selectedCollection) return;
    setStatus(`Re-ingesting ${selectedCollection} from SQLite chunks into Chroma.`);
    const result = await reingestKnowledgeCollection(workflowId, selectedCollection);
    setStatus(`Self-healed ${result.chunks_repaired}/${result.chunks_seen} chunk(s): ${result.reason}.`);
    await refreshCollections();
  }

  useEffect(() => {
    if (selectedCollection) {
      void loadDocuments(selectedCollection);
    }
  }, [selectedCollection]);

  return (
    <div className="rounded-[1.4rem] bg-white p-4 ring-1 ring-ink/6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">RAG Manager</p>
          <p className="mt-1 text-xs leading-5 text-ink/55">{status}</p>
        </div>
        <button type="button" onClick={() => void refreshCollections()} className="rounded-full bg-mist px-3 py-2 text-xs font-semibold">
          Refresh
        </button>
      </div>

      <select
        value={selectedCollection}
        onChange={(event) => setSelectedCollection(event.target.value)}
        className="mt-3 w-full rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm"
      >
        <option value="">Select collection</option>
        {collections.map((collection) => (
          <option key={collection.collection_name} value={collection.collection_name}>
            {collection.collection_name} ({collection.document_count} docs, {collection.chunk_count} chunks)
          </option>
        ))}
      </select>

      <div className="mt-3 flex gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 rounded-2xl border border-ink/10 px-3 py-2 text-sm" />
        <button type="button" onClick={() => void runRetrievalTest()} className="rounded-2xl bg-ink px-3 py-2 text-sm font-semibold text-white">
          Test
        </button>
      </div>

      {retrieval ? (
        <div className="mt-3 rounded-2xl bg-lime/20 p-3 text-xs">
          <p className="font-semibold">Confidence: {(retrieval.confidence * 100).toFixed(0)}% · {retrieval.match_count} match(es)</p>
          <div className="mt-2 space-y-2">
            {retrieval.matches.map((match) => (
              <p key={match.chunk_id} className="rounded-xl bg-white/80 p-2">
                {(match.relevance * 100).toFixed(0)}% relevance · {match.text.slice(0, 220)}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 max-h-56 space-y-2 overflow-auto">
        {documents.map((document) => (
          <button key={document.id} type="button" onClick={() => void loadChunks(document.id)} className="w-full rounded-2xl bg-mist/70 p-3 text-left text-xs">
            <strong>{document.title}</strong>
            <span className="ml-2 text-ink/55">{document.chunk_count} chunks</span>
          </button>
        ))}
      </div>

      {chunks.length ? (
        <div className="mt-3 max-h-56 space-y-2 overflow-auto rounded-2xl bg-mist/50 p-2">
          {chunks.map((chunk) => (
            <p key={chunk.id} className="rounded-xl bg-white p-2 text-xs leading-5">
              #{chunk.chunk_index}: {chunk.text}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => void reingestCollection()} disabled={!selectedCollection} className="rounded-2xl bg-lime/30 px-3 py-2 text-sm font-semibold disabled:opacity-50">
          Re-ingest / Self-heal
        </button>
        <button type="button" onClick={() => void removeCollection()} disabled={!selectedCollection} className="rounded-2xl border border-coral/30 bg-coral/10 px-3 py-2 text-sm font-semibold disabled:opacity-50">
          Delete Collection
        </button>
      </div>
    </div>
  );
}
