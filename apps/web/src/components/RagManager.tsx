import { useEffect, useState } from "react";
import {
  deleteKnowledgeCollection,
  evaluateKnowledgeCollection,
  getKnowledgeCollectionDiagnostics,
  listCollectionDocuments,
  listDocumentChunks,
  listKnowledgeCollections,
  listRagEvaluations,
  reingestKnowledgeCollection,
  testKnowledgeRetrieval,
  type KnowledgeChunkRecord,
  type KnowledgeCollection,
  type KnowledgeDocumentRecord,
  type RagCollectionDiagnostics,
  type RagEvaluationRecord,
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
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [retrieval, setRetrieval] = useState<RetrievalTestResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<RagCollectionDiagnostics | null>(null);
  const [evaluations, setEvaluations] = useState<RagEvaluationRecord[]>([]);
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
    const [records, health, evals] = await Promise.all([
      listCollectionDocuments(workflowId, collectionName),
      getKnowledgeCollectionDiagnostics(workflowId, collectionName),
      listRagEvaluations(workflowId),
    ]);
    setDocuments(records);
    setDiagnostics(health);
    setEvaluations(evals.filter((item) => item.collection_name === collectionName).slice(0, 5));
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

  async function runEvaluation() {
    if (!workflowId || !selectedCollection || !query.trim()) return;
    const evaluation = await evaluateKnowledgeCollection(workflowId, selectedCollection, {
      query,
      expected_answer: expectedAnswer || undefined,
      top_k: 5,
    });
    setEvaluations((current) => [evaluation, ...current].slice(0, 5));
    setRetrieval({
      query,
      collection_name: selectedCollection,
      match_count: evaluation.matches.length,
      confidence: evaluation.retrieval_score || 0,
      matches: evaluation.matches,
    });
    setStatus(`Evaluation saved. Retrieval score ${(Number(evaluation.retrieval_score || 0) * 100).toFixed(0)}%, hallucination risk ${evaluation.hallucination_risk}.`);
  }

  async function removeCollection() {
    if (!workflowId || !selectedCollection) return;
    await deleteKnowledgeCollection(workflowId, selectedCollection);
    setSelectedCollection("");
    setDocuments([]);
    setChunks([]);
    setRetrieval(null);
    setDiagnostics(null);
    setEvaluations([]);
    await refreshCollections();
  }

  async function reingestCollection() {
    if (!workflowId || !selectedCollection) return;
    setStatus(`Re-ingesting ${selectedCollection} from SQLite chunks into Chroma.`);
    const result = await reingestKnowledgeCollection(workflowId, selectedCollection);
    setStatus(`Self-healed ${result.chunks_repaired}/${result.chunks_seen} chunk(s): ${result.reason}.`);
    await refreshCollections();
    await loadDocuments(selectedCollection);
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
      <div className="mt-2 flex gap-2">
        <input
          value={expectedAnswer}
          onChange={(event) => setExpectedAnswer(event.target.value)}
          placeholder="Expected answer for eval suite (optional)"
          className="min-w-0 flex-1 rounded-2xl border border-ink/10 px-3 py-2 text-sm"
        />
        <button type="button" onClick={() => void runEvaluation()} className="rounded-2xl bg-lime/50 px-3 py-2 text-sm font-semibold text-ink">
          Evaluate
        </button>
      </div>

      {diagnostics ? (
        <div className="mt-3 rounded-2xl bg-ink p-3 text-xs text-white">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Self-healing health</p>
            <span className="rounded-full bg-white/15 px-2 py-1">{diagnostics.health_score}/100</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <span className="rounded-xl bg-white/10 p-2">{diagnostics.document_count} docs</span>
            <span className="rounded-xl bg-white/10 p-2">{diagnostics.chunk_count} chunks</span>
            <span className="rounded-xl bg-white/10 p-2">{diagnostics.stale_embedding_count} stale</span>
          </div>
          {diagnostics.recommendations.length ? (
            <div className="mt-3 space-y-1 text-white/75">
              {diagnostics.recommendations.map((recommendation) => (
                <p key={recommendation}>Fix: {recommendation}</p>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-white/75">No obvious collection issues detected.</p>
          )}
        </div>
      ) : null}

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

      {evaluations.length ? (
        <div className="mt-3 rounded-2xl bg-mist/70 p-3">
          <p className="text-xs font-semibold text-ink">Recent RAG evaluations</p>
          <div className="mt-2 space-y-2">
            {evaluations.map((evaluation) => (
              <div key={evaluation.id} className="rounded-xl bg-white p-2 text-xs">
                <p className="font-semibold">{evaluation.query}</p>
                <p className="text-ink/55">
                  score {(Number(evaluation.retrieval_score || 0) * 100).toFixed(0)}% · risk {evaluation.hallucination_risk || "unknown"}
                </p>
              </div>
            ))}
          </div>
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
