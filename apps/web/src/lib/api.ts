import type { BuilderGraph } from "@vmb/shared";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
export const WEB_BASE_URL = window.location.origin;

function getLocalUserId() {
  try {
    const savedUser = localStorage.getItem("vmb-local-user");
    return savedUser ? (JSON.parse(savedUser) as { id?: number }).id : undefined;
  } catch {
    return undefined;
  }
}

export type WorkflowSummary = {
  id: number;
  name: string;
  description: string | null;
  status: string;
  current_version: number;
  latest_saved_version: number;
  is_published: boolean;
  published_slug: string | null;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  archived_at: string | null;
  run_count: number;
  failed_run_count: number;
  avg_latency_ms: number | null;
  last_run_id: number | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_run_at: string | null;
  last_run_preview: string | null;
  workflow_type: string;
  quality_score: number;
  quality_checks: Record<string, boolean>;
  quality_recommendations: string[];
  rag_document_count: number;
  rag_chunk_count: number;
  rag_last_ingested_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowRecord = WorkflowSummary & {
  graph_json: BuilderGraph;
  published_version_id: number | null;
  versions: WorkflowVersionRecord[];
};

export type WorkflowVersionRecord = {
  id: number;
  version_number: number;
  version_note: string | null;
  graph_json: BuilderGraph;
  created_at: string;
};

export type AppUser = {
  id: number;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export type AuthResponse = {
  user: AppUser;
  local_session_token: string;
  message: string;
};

export type UsageDashboard = {
  totals: {
    workflows: number;
    published_workflows: number;
    runs: number;
    failed_runs: number;
    runs_last_7d: number;
    users: number;
    active_memory_users: number;
    login_events: number;
    signup_events: number;
    files_uploaded: number;
    knowledge_documents: number;
    knowledge_chunks: number;
    avg_run_latency_ms: number;
    avg_node_latency_ms: number;
  };
  top_workflows: Array<{
    id: number;
    name: string;
    is_published: boolean;
    run_count: number;
    latency_sum_ms: number;
    last_run_at: string | null;
  }>;
  recent_users: Array<{
    id: number;
    email: string;
    display_name: string;
    role: string;
    created_at: string;
    last_login_at: string | null;
    event_count: number;
  }>;
  recent_auth_events: Array<{
    id: number;
    user_id: number | null;
    email: string | null;
    event_type: string;
    created_at: string;
    metadata: Record<string, unknown>;
  }>;
};

export type WorkflowRunRecord = {
  id: number;
  workflow_id: number;
  status: string;
  trigger_mode?: string;
  owner_user_id?: number | null;
  session_id?: string | null;
  runtime_user_id?: string | null;
  started_at?: string;
  completed_at?: string | null;
  latency_ms?: number | null;
  input_payload?: Record<string, unknown>;
  output_payload: Record<string, Record<string, { type?: string; value?: unknown; preview?: unknown; metadata?: unknown }>>;
  preview_payload: Record<string, unknown>;
  log_messages?: Array<Record<string, unknown>>;
  error_message: string | null;
  node_runs?: Array<{
    id: number;
    node_id: string;
    block_type: string;
    status: string;
    execution_index: number;
    latency_ms: number | null;
    input_payload: Record<string, unknown>;
    output_payload: Record<string, unknown>;
    preview_payload: Record<string, unknown>;
    log_messages: Array<Record<string, unknown>>;
    error_message: string | null;
  }>;
};

export type FileLibraryItem = {
  id: number;
  workflow_id: number | null;
  workflow_run_id: number | null;
  node_id: string;
  original_name: string;
  extension: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  metadata: Record<string, unknown>;
  created_at: string;
  knowledge_document_count: number;
};

export type FileLibraryDetail = FileLibraryItem & {
  preview: string;
  knowledge_documents: Array<Record<string, unknown>>;
};

export type KnowledgeCollection = {
  collection_name: string;
  document_count: number;
  chunk_count: number;
  diagnostics?: RagCollectionDiagnostics;
};

export type RagCollectionDiagnostics = {
  collection_name: string;
  document_count: number;
  chunk_count: number;
  duplicate_document_count: number;
  failed_document_count: number;
  stale_embedding_count: number;
  broken_collection: boolean;
  last_ingested_at: string | null;
  self_healing_available: boolean;
  health_score: number;
  recommendations: string[];
};

export type KnowledgeDocumentRecord = {
  id: number;
  title: string;
  source_path: string | null;
  text_length: number;
  metadata: Record<string, unknown>;
  created_at: string;
  chunk_count: number;
};

export type KnowledgeChunkRecord = {
  id: number;
  chunk_index: number;
  text: string;
  token_estimate: number;
  char_start: number;
  char_end: number;
  metadata: Record<string, unknown>;
};

export type RetrievalTestResponse = {
  query: string;
  collection_name: string;
  match_count: number;
  confidence: number;
  matches: Array<{
    chunk_id: number;
    score: number | null;
    relevance: number;
    text: string;
    metadata: Record<string, unknown>;
  }>;
};

export type RagEvaluationRecord = {
  id: number;
  collection_name: string;
  query: string;
  expected_answer: string | null;
  retrieval_score: number | null;
  hallucination_risk: string | null;
  result: Record<string, unknown>;
  created_at: string;
};

export type AuditLogRecord = {
  id: number;
  workflow_id: number | null;
  workflow_run_id: number | null;
  user_id: number | null;
  event_type: string;
  resource_type: string;
  resource_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ObservabilityDashboard = {
  status: string;
  generated_at: string;
  metrics: Record<string, number>;
  recent_failures: Array<Record<string, unknown>>;
};

export type WorkflowComment = {
  id: number;
  workflow_id: number;
  node_id: string | null;
  user_id: number | null;
  body: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type WorkflowChangeEvent = {
  id: number;
  workflow_id: number;
  user_id: number | null;
  change_type: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  created_at: string;
};

export type WorkflowSubflow = {
  id: number;
  workflow_id: number;
  name: string;
  description: string | null;
  graph_json?: BuilderGraph;
  created_at: string;
};

export type WorkflowPresence = {
  id: number;
  workflow_id: number;
  user_id: number | null;
  session_id: string;
  display_name: string | null;
  node_id: string | null;
  cursor: Record<string, unknown>;
  graph_version: number | null;
  last_seen_at: string;
  created_at: string;
};

export type CollaborationState = {
  workflow_id: number;
  current_version: number;
  latest_saved_version: number;
  updated_at: string;
  active_presence: WorkflowPresence[];
};

export type WorkflowConflictCheck = {
  workflow_id: number;
  has_conflict: boolean;
  server_version: number;
  server_updated_at: string;
  client_version: number | null;
  client_updated_at: string | null;
  active_presence: WorkflowPresence[];
  resolution: string;
};

export type PublishWorkflowResponse = {
  workflow_id: number;
  slug: string;
  is_published: boolean;
  chat_endpoint: string;
};

export type PublishedChatResponse = {
  workflow_id: number;
  slug: string;
  session_id: string;
  user_id: string;
  run_id: number;
  answer: string;
  citations: Array<Record<string, unknown>>;
  source_chunks: Array<Record<string, unknown>>;
  output_payload: Record<string, unknown>;
};

export type RuntimeUploadResponse = {
  original_name: string;
  stored_name: string;
  extension: string;
  mime_type: string | null;
  size_bytes: number;
  storage_path: string;
  relative_storage_path: string;
};

export type SystemHealthDetails = {
  status: string;
  app: string;
  generated_at: string;
  checks: Array<{ key: string; label: string; status: string; detail: string }>;
  paths: Record<string, string>;
  providers: Record<string, string>;
};

export type BlockMarketplaceItem = {
  type: string;
  title: string;
  status: string;
  phase: string;
  inputs: Array<{ id: string; data_types: string[]; required: boolean }>;
  outputs: Array<{ id: string; data_types: string[]; required: boolean }>;
  fields: Array<{ key: string; required: boolean; allow_blank: boolean }>;
};

export type GlobalKnowledgeCollection = KnowledgeCollection & {
  workflow_id: number;
  workflow_name: string;
  last_ingested_at: string | null;
};

export type WorkflowPermission = {
  id: number;
  workflow_id: number;
  user_id: number;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
};

export type VersionCompare = {
  workflow_id: number;
  version_id: number;
  version_number: number;
  current_version: number;
  comparison_base: string;
  comparison_label: string;
  base_version_number: number | null;
  diff: {
    summary: Record<string, number>;
    added_nodes: string[];
    removed_nodes: string[];
    changed_nodes: Array<{ node_id: string; changes: string[] }>;
    added_edges: string[];
    removed_edges: string[];
    changed_edges: string[];
  };
};

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const localUserId = getLocalUserId();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(localUserId ? { "X-Local-User-Id": String(localUserId) } : {}),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const errorBody = (await response.json()) as { detail?: string };
      if (errorBody.detail) {
        detail = errorBody.detail;
      }
    } catch {
      // Keep the HTTP fallback when the response is not JSON.
    }

    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export function listWorkflows(includeArchived = false) {
  return requestJson<WorkflowSummary[]>(`/workflows${includeArchived ? "?include_archived=true" : ""}`);
}

export function getWorkflow(workflowId: number) {
  return requestJson<WorkflowRecord>(`/workflows/${workflowId}`);
}

export function updateWorkflowMetadata(
  workflowId: number,
  payload: { name?: string; description?: string; status?: string },
) {
  return requestJson<WorkflowRecord>(`/workflows/${workflowId}/metadata`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function archiveWorkflow(workflowId: number) {
  return requestJson<WorkflowRecord>(`/workflows/${workflowId}/archive`, { method: "POST", body: JSON.stringify({}) });
}

export function restoreWorkflow(workflowId: number) {
  return requestJson<WorkflowRecord>(`/workflows/${workflowId}/restore`, { method: "POST", body: JSON.stringify({}) });
}

export function duplicateWorkflow(workflowId: number) {
  return requestJson<WorkflowRecord>(`/workflows/${workflowId}/duplicate`, { method: "POST", body: JSON.stringify({}) });
}

export function deleteWorkflow(workflowId: number) {
  return requestJson<{ deleted: boolean; workflow_id: number }>(`/workflows/${workflowId}`, { method: "DELETE" });
}

export function listWorkflowTemplates() {
  return requestJson<WorkflowSummary[]>("/workflow-templates");
}

export function createWorkflowFromTemplate(workflowId: number) {
  return requestJson<WorkflowRecord>(`/workflow-templates/${workflowId}/create`, { method: "POST", body: JSON.stringify({}) });
}

export function createWorkflow(graph: BuilderGraph) {
  return requestJson<WorkflowRecord>("/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: graph.name,
      description: "Builder workflow saved from the React Flow canvas.",
      graph,
    }),
  });
}

export function autoBuildWorkflow(payload: { prompt: string; name?: string }) {
  return requestJson<WorkflowRecord>("/workflows/autobuild", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWorkflow(workflowId: number, graph: BuilderGraph) {
  return requestJson<WorkflowRecord>(`/workflows/${workflowId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: graph.name,
      description: "Builder workflow saved from the React Flow canvas.",
      status: "draft",
      graph,
    }),
  });
}

export function saveWorkflowVersion(workflowId: number, graph: BuilderGraph, versionNote?: string) {
  return requestJson<WorkflowVersionRecord>(`/workflows/${workflowId}/versions`, {
    method: "POST",
    body: JSON.stringify({
      version_note: versionNote || null,
      graph,
    }),
  });
}

export function executeWorkflow(
  workflowId: number,
  payload: {
    trigger_mode: string;
    session_id: string;
    user_id: string;
    inputs: Record<string, { value: string; files: string[]; metadata: Record<string, string> }>;
  },
) {
  return requestJson<WorkflowRunRecord>(`/workflows/${workflowId}/execute`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function executeWorkflowAsync(
  workflowId: number,
  payload: {
    trigger_mode: string;
    session_id: string;
    user_id: string;
    inputs: Record<string, { value: string; files: string[]; metadata: Record<string, string> }>;
  },
) {
  return requestJson<{ workflow_id: number; run_id: number; status: string; queued_at: string; events_url: string }>(
    `/workflows/${workflowId}/execute-async`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getRunEventsUrl(workflowId: number, runId: number) {
  return `${API_BASE_URL}/workflows/${workflowId}/runs/${runId}/events`;
}

export function listWorkflowRuns(workflowId: number) {
  return requestJson<WorkflowRunRecord[]>(`/workflows/${workflowId}/runs`);
}

export function getWorkflowRun(workflowId: number, runId: number) {
  return requestJson<WorkflowRunRecord>(`/workflows/${workflowId}/runs/${runId}`);
}

export function publishWorkflow(workflowId: number) {
  return requestJson<PublishWorkflowResponse>(`/workflows/${workflowId}/publish`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function unpublishWorkflow(workflowId: number) {
  return requestJson<WorkflowRecord>(`/workflows/${workflowId}/unpublish`, { method: "POST", body: JSON.stringify({}) });
}

export function listPublishedChatbots() {
  return requestJson<WorkflowSummary[]>("/published/chatbots");
}

export function restoreWorkflowVersion(workflowId: number, versionId: number) {
  return requestJson<WorkflowRecord>(`/workflows/${workflowId}/versions/${versionId}/restore`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getPublishedChatbot(slug: string) {
  return requestJson<PublishWorkflowResponse>(`/published/chatbots/${slug}`);
}

export function sendPublishedChatMessage(
  slug: string,
  payload: { message: string; session_id: string; user_id: string; metadata?: Record<string, unknown> },
) {
  return requestJson<PublishedChatResponse>(`/published/chatbots/${slug}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getChatUrl(slug: string) {
  return `${WEB_BASE_URL}/chat/${slug}`;
}

export function signup(payload: { email: string; display_name: string; password: string }) {
  return requestJson<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { email: string; password: string }) {
  return requestJson<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getUsageDashboard() {
  return requestJson<UsageDashboard>("/admin/usage");
}

export function getObservabilityDashboard() {
  return requestJson<ObservabilityDashboard>("/admin/observability");
}

export function listAuditLogs(params: { workflow_id?: number; limit?: number } = {}) {
  const search = new URLSearchParams();
  if (params.workflow_id) search.set("workflow_id", String(params.workflow_id));
  if (params.limit) search.set("limit", String(params.limit));
  return requestJson<AuditLogRecord[]>(`/admin/audit-logs${search.toString() ? `?${search.toString()}` : ""}`);
}

export function getSystemHealthDetails() {
  return requestJson<SystemHealthDetails>("/system/health/details");
}

export function listBlockMarketplace() {
  return requestJson<BlockMarketplaceItem[]>("/blocks/marketplace");
}

export function listFiles() {
  return requestJson<FileLibraryItem[]>("/files");
}

export function getFile(fileId: number) {
  return requestJson<FileLibraryDetail>(`/files/${fileId}`);
}

export function deleteFile(fileId: number) {
  return requestJson<{ deleted: boolean; file_id: number }>(`/files/${fileId}`, { method: "DELETE" });
}

export function reprocessFile(fileId: number) {
  return requestJson<{ file_id: number; document: { text_preview: string; metadata: Record<string, unknown>; text_length: number } }>(
    `/files/${fileId}/reprocess`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function listKnowledgeCollections(workflowId: number) {
  return requestJson<KnowledgeCollection[]>(`/workflows/${workflowId}/knowledge/collections`);
}

export function getKnowledgeCollectionDiagnostics(workflowId: number, collectionName: string) {
  return requestJson<RagCollectionDiagnostics>(
    `/workflows/${workflowId}/knowledge/collections/${encodeURIComponent(collectionName)}/diagnostics`,
  );
}

export function listAllKnowledgeCollections() {
  return requestJson<GlobalKnowledgeCollection[]>("/knowledge/collections");
}

export function listCollectionDocuments(workflowId: number, collectionName: string) {
  return requestJson<KnowledgeDocumentRecord[]>(
    `/workflows/${workflowId}/knowledge/collections/${encodeURIComponent(collectionName)}/documents`,
  );
}

export function listDocumentChunks(workflowId: number, documentId: number) {
  return requestJson<KnowledgeChunkRecord[]>(`/workflows/${workflowId}/knowledge/documents/${documentId}/chunks`);
}

export function testKnowledgeRetrieval(workflowId: number, collectionName: string, query: string, topK = 4) {
  return requestJson<RetrievalTestResponse>(
    `/workflows/${workflowId}/knowledge/collections/${encodeURIComponent(collectionName)}/retrieve`,
    {
      method: "POST",
      body: JSON.stringify({ query, top_k: topK }),
    },
  );
}

export function evaluateKnowledgeCollection(
  workflowId: number,
  collectionName: string,
  payload: { query: string; expected_answer?: string; top_k?: number },
) {
  return requestJson<RagEvaluationRecord & { matches: RetrievalTestResponse["matches"] }>(
    `/workflows/${workflowId}/knowledge/collections/${encodeURIComponent(collectionName)}/evaluate`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function listRagEvaluations(workflowId: number) {
  return requestJson<RagEvaluationRecord[]>(`/workflows/${workflowId}/knowledge/evaluations`);
}

export function deleteKnowledgeCollection(workflowId: number, collectionName: string) {
  return requestJson<{ deleted: boolean; collection_name: string; document_count: number }>(
    `/workflows/${workflowId}/knowledge/collections/${encodeURIComponent(collectionName)}`,
    { method: "DELETE" },
  );
}

export function reingestKnowledgeCollection(workflowId: number, collectionName: string) {
  return requestJson<{ collection_name: string; chunks_seen: number; chunks_repaired: number; reason: string }>(
    `/workflows/${workflowId}/knowledge/collections/${encodeURIComponent(collectionName)}/reingest`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function compareWorkflowVersion(workflowId: number, versionId: number, base: "previous" | "current" = "previous") {
  return requestJson<VersionCompare>(`/workflows/${workflowId}/versions/${versionId}/compare?base=${base}`);
}

export function listWorkflowPermissions(workflowId: number) {
  return requestJson<WorkflowPermission[]>(`/workflows/${workflowId}/permissions`);
}

export function addWorkflowPermission(workflowId: number, payload: { email: string; role: string }) {
  return requestJson<WorkflowPermission>(`/workflows/${workflowId}/permissions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteWorkflowPermission(workflowId: number, permissionId: number) {
  return requestJson<{ deleted: boolean; permission_id: number }>(`/workflows/${workflowId}/permissions/${permissionId}`, {
    method: "DELETE",
  });
}

export function exportWorkflowBundle(workflowId: number) {
  return requestJson<Record<string, unknown>>(`/workflows/${workflowId}/bundle`);
}

export function importWorkflowBundle(bundle: Record<string, unknown>) {
  return requestJson<WorkflowRecord>("/workflows/import-bundle", {
    method: "POST",
    body: JSON.stringify(bundle),
  });
}

export function listWorkflowComments(workflowId: number) {
  return requestJson<WorkflowComment[]>(`/workflows/${workflowId}/comments`);
}

export function createWorkflowComment(workflowId: number, payload: { body: string; node_id?: string | null }) {
  return requestJson<WorkflowComment>(`/workflows/${workflowId}/comments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listWorkflowHistory(workflowId: number) {
  return requestJson<WorkflowChangeEvent[]>(`/workflows/${workflowId}/history`);
}

export function listSubflows() {
  return requestJson<WorkflowSubflow[]>("/subflows");
}

export function createWorkflowSubflow(
  workflowId: number,
  payload: { name: string; description?: string | null; graph_json: BuilderGraph },
) {
  return requestJson<WorkflowSubflow>(`/workflows/${workflowId}/subflows`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getWorkflowCollaborationState(workflowId: number, sessionId?: string) {
  const suffix = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  return requestJson<CollaborationState>(`/workflows/${workflowId}/collaboration/state${suffix}`);
}

export function heartbeatWorkflowPresence(
  workflowId: number,
  payload: { session_id: string; display_name?: string; node_id?: string | null; cursor?: Record<string, unknown>; graph_version?: number | null },
) {
  return requestJson<WorkflowPresence>(`/workflows/${workflowId}/collaboration/presence`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function checkWorkflowConflicts(
  workflowId: number,
  payload: { base_version?: number | null; base_updated_at?: string | null },
) {
  return requestJson<WorkflowConflictCheck>(`/workflows/${workflowId}/collaboration/conflicts/check`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function testWorkflowNode(
  workflowId: number,
  nodeId: string,
  payload: { inputs: Record<string, unknown> },
) {
  return requestJson<{
    run_id: number;
    node_id: string;
    outputs: Record<string, unknown>;
    preview: Record<string, unknown>;
    logs: Array<Record<string, unknown>>;
  }>(`/workflows/${workflowId}/nodes/${encodeURIComponent(nodeId)}/test`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadRuntimeFile(file: File): Promise<RuntimeUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/files/runtime-upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const errorBody = (await response.json()) as { detail?: string };
      if (errorBody.detail) {
        detail = errorBody.detail;
      }
    } catch {
      // Keep the HTTP fallback when the response is not JSON.
    }

    throw new Error(detail);
  }

  return (await response.json()) as RuntimeUploadResponse;
}

export async function uploadLibraryFile(file: File): Promise<FileLibraryItem> {
  const formData = new FormData();
  formData.append("file", file);

  const localUserId = getLocalUserId();
  const response = await fetch(`${API_BASE_URL}/files/library-upload`, {
    method: "POST",
    headers: {
      ...(localUserId ? { "X-Local-User-Id": String(localUserId) } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const errorBody = (await response.json()) as { detail?: string };
      if (errorBody.detail) {
        detail = errorBody.detail;
      }
    } catch {
      // Keep the HTTP fallback when the response is not JSON.
    }

    throw new Error(detail);
  }

  return (await response.json()) as FileLibraryItem;
}
