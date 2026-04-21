import { useEffect, useState, type FormEvent } from "react";
import {
  API_BASE_URL,
  addWorkflowPermission,
  archiveWorkflow,
  compareWorkflowVersion,
  createWorkflowFromTemplate,
  deleteWorkflow,
  deleteWorkflowPermission,
  duplicateWorkflow,
  exportWorkflowBundle,
  getChatUrl,
  getSystemHealthDetails,
  getUsageDashboard,
  getWorkflow,
  importWorkflowBundle,
  listAllKnowledgeCollections,
  listBlockMarketplace,
  listPublishedChatbots,
  listWorkflowPermissions,
  listWorkflowTemplates,
  listWorkflows,
  login,
  publishWorkflow,
  restoreWorkflow,
  restoreWorkflowVersion,
  signup,
  testKnowledgeRetrieval,
  unpublishWorkflow,
  updateWorkflowMetadata,
  type AppUser,
  type BlockMarketplaceItem,
  type GlobalKnowledgeCollection,
  type SystemHealthDetails,
  type UsageDashboard,
  type VersionCompare,
  type WorkflowPermission,
  type WorkflowRecord,
  type WorkflowSummary,
} from "../lib/api";
import type { BuilderGraph } from "@vmb/shared";

type WorkflowsPageProps = {
  onCreateWorkflow: () => void;
  onOpenWorkflow: (workflowId: number) => void;
  onOpenWorkflowApp: (workflowId: number) => void;
  onOpenChat: (slug: string) => void;
  onOpenFiles: () => void;
};

type HomeView = "workflows" | "create" | "templates" | "usage" | "publish" | "knowledge" | "marketplace" | "health" | "bundle" | "account";

export function WorkflowsPage({ onCreateWorkflow, onOpenWorkflow, onOpenWorkflowApp, onOpenChat, onOpenFiles }: WorkflowsPageProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowKinds, setWorkflowKinds] = useState<Record<number, "chat" | "builder">>({});
  const [usage, setUsage] = useState<UsageDashboard | null>(null);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    try {
      const savedUser = localStorage.getItem("vmb-local-user");
      return savedUser ? (JSON.parse(savedUser) as AppUser) : null;
    } catch {
      return null;
    }
  });
  const [templates, setTemplates] = useState<WorkflowSummary[]>([]);
  const [publishedChatbots, setPublishedChatbots] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowDetails, setSelectedWorkflowDetails] = useState<WorkflowRecord | null>(null);
  const [versionCompare, setVersionCompare] = useState<VersionCompare | null>(null);
  const [permissionWorkflow, setPermissionWorkflow] = useState<WorkflowSummary | null>(null);
  const [permissions, setPermissions] = useState<WorkflowPermission[]>([]);
  const [permissionForm, setPermissionForm] = useState({ email: "", role: "viewer" });
  const [systemHealth, setSystemHealth] = useState<SystemHealthDetails | null>(null);
  const [globalKnowledge, setGlobalKnowledge] = useState<GlobalKnowledgeCollection[]>([]);
  const [marketplaceBlocks, setMarketplaceBlocks] = useState<BlockMarketplaceItem[]>([]);
  const [bundleImportText, setBundleImportText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingWorkflowId, setEditingWorkflowId] = useState<number | null>(null);
  const [editingWorkflowName, setEditingWorkflowName] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authForm, setAuthForm] = useState({ email: "", display_name: "", password: "" });
  const [activeView, setActiveView] = useState<HomeView>("workflows");
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Loading workflows from the local API.");

  useEffect(() => {
    void refreshWorkflows();
    void refreshUsage();
    void refreshTemplates();
    void refreshPublishedChatbots();
    void refreshProductSurfaces();
  }, [showArchived]);

  const filteredWorkflows = workflows.filter((workflow) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return [
      workflow.name,
      workflow.description || "",
      workflow.status,
      workflow.published_slug || "",
      `#${workflow.id}`,
      workflowKinds[workflow.id] || "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  async function refreshWorkflows() {
    setIsLoading(true);

    try {
      const records = await listWorkflows(showArchived);
      setWorkflows(records);
      const classifiedEntries = await Promise.all(
        records.map(async (record) => {
          try {
            const workflow = await getWorkflow(record.id);
            return [record.id, isChatWorkflow(workflow.graph_json) ? "chat" : "builder"] as const;
          } catch {
            return [record.id, "builder"] as const;
          }
        }),
      );
      setWorkflowKinds(Object.fromEntries(classifiedEntries));
      setStatusMessage(records.length ? `${records.length} workflow(s) found.` : "No workflows yet.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load workflows.";
      setStatusMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshUsage() {
    try {
      setUsage(await getUsageDashboard());
    } catch {
      setUsage(null);
    }
  }

  async function refreshTemplates() {
    try {
      setTemplates(await listWorkflowTemplates());
    } catch {
      setTemplates([]);
    }
  }

  async function refreshPublishedChatbots() {
    try {
      setPublishedChatbots(await listPublishedChatbots());
    } catch {
      setPublishedChatbots([]);
    }
  }

  async function refreshAll() {
    await Promise.all([refreshWorkflows(), refreshUsage(), refreshTemplates(), refreshPublishedChatbots(), refreshProductSurfaces()]);
  }

  async function refreshProductSurfaces() {
    const [health, knowledge, blocks] = await Promise.allSettled([
      getSystemHealthDetails(),
      listAllKnowledgeCollections(),
      listBlockMarketplace(),
    ]);
    if (health.status === "fulfilled") setSystemHealth(health.value);
    if (knowledge.status === "fulfilled") setGlobalKnowledge(knowledge.value);
    if (blocks.status === "fulfilled") setMarketplaceBlocks(blocks.value);
  }

  async function publishAndOpen(workflowId: number) {
    if (!currentUser) {
      setStatusMessage("Login locally before publishing so ownership is tracked.");
      return;
    }
    try {
      setStatusMessage(`Publishing workflow ${workflowId}.`);
      const workflow = await getWorkflow(workflowId);
      if (!isChatWorkflow(workflow.graph_json)) {
        setStatusMessage(
          "This is not a chat workflow. Open it in Builder and run it there to see document/JSON outputs.",
        );
        return;
      }
      const published = await publishWorkflow(workflowId);
      await refreshAll();
      onOpenChat(published.slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not publish workflow.";
      setStatusMessage(message);
    }
  }

  function guardedCreateWorkflow() {
    if (!currentUser) {
      setStatusMessage("Login locally before creating workflows so ownership is tracked.");
      return;
    }
    onCreateWorkflow();
  }

  async function createFromTemplate(workflowId: number) {
    if (!currentUser) {
      setStatusMessage("Login locally before creating from a template.");
      return;
    }
    try {
      const workflow = await createWorkflowFromTemplate(workflowId);
      setStatusMessage(`Created ${workflow.name} from template.`);
      await refreshAll();
      onOpenWorkflow(workflow.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not create from template.");
    }
  }

  async function lifecycleAction(action: "archive" | "restore" | "delete" | "duplicate", workflow: WorkflowSummary) {
    try {
      if (action === "archive") {
        await archiveWorkflow(workflow.id);
      }
      if (action === "restore") {
        await restoreWorkflow(workflow.id);
      }
      if (action === "duplicate") {
        await duplicateWorkflow(workflow.id);
      }
      if (action === "delete") {
        const confirmed = window.confirm(`Delete "${workflow.name}" permanently? This removes runs, files, and versions for this workflow.`);
        if (!confirmed) return;
        await deleteWorkflow(workflow.id);
      }
      setStatusMessage(`${action} completed for workflow #${workflow.id}.`);
      await refreshAll();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `Could not ${action} workflow.`);
    }
  }

  async function openVersions(workflowId: number) {
    try {
      setSelectedWorkflowDetails(await getWorkflow(workflowId));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not load versions.");
    }
  }

  async function restoreVersion(workflowId: number, versionId: number) {
    try {
      await restoreWorkflowVersion(workflowId, versionId);
      setSelectedWorkflowDetails(null);
      setStatusMessage(`Restored version #${versionId}.`);
      await refreshAll();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not restore version.");
    }
  }

  async function compareVersion(workflowId: number, versionId: number) {
    try {
      setVersionCompare(await compareWorkflowVersion(workflowId, versionId));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not compare workflow version.");
    }
  }

  async function openPermissions(workflow: WorkflowSummary) {
    try {
      setPermissionWorkflow(workflow);
      setPermissions(await listWorkflowPermissions(workflow.id));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not load permissions.");
    }
  }

  async function submitPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!permissionWorkflow) return;
    try {
      await addWorkflowPermission(permissionWorkflow.id, permissionForm);
      setPermissionForm({ email: "", role: "viewer" });
      setPermissions(await listWorkflowPermissions(permissionWorkflow.id));
      setStatusMessage("Workflow permission saved.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save workflow permission.");
    }
  }

  async function removePermission(permission: WorkflowPermission) {
    if (!permissionWorkflow) return;
    try {
      await deleteWorkflowPermission(permissionWorkflow.id, permission.id);
      setPermissions(await listWorkflowPermissions(permissionWorkflow.id));
      setStatusMessage("Workflow permission removed.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not remove workflow permission.");
    }
  }

  async function downloadBundle(workflow: WorkflowSummary) {
    try {
      const bundle = await exportWorkflowBundle(workflow.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "workflow"}-bundle.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatusMessage(`Exported bundle for ${workflow.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not export workflow bundle.");
    }
  }

  async function importBundle() {
    try {
      const bundle = JSON.parse(bundleImportText) as Record<string, unknown>;
      const workflow = await importWorkflowBundle(bundle);
      setBundleImportText("");
      setStatusMessage(`Imported ${workflow.name}.`);
      await refreshAll();
      onOpenWorkflow(workflow.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not import workflow bundle JSON.");
    }
  }

  async function unpublish(workflowId: number) {
    try {
      await unpublishWorkflow(workflowId);
      setStatusMessage(`Unpublished workflow #${workflowId}.`);
      await refreshAll();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not unpublish chatbot.");
    }
  }

  async function testRagHealth(workflow: WorkflowSummary) {
    try {
      const record = await getWorkflow(workflow.id);
      const ragNode = record.graph_json.nodes.find((node) => node.data.blockType === "rag_knowledge");
      const collection = String(ragNode?.data.config.collection || "");
      if (!collection) {
        setStatusMessage("No RAG collection configured on this workflow.");
        return;
      }
      const response = await testKnowledgeRetrieval(workflow.id, collection, "health check", 3);
      setStatusMessage(
        `RAG health for ${workflow.name}: ${response.match_count} matches, confidence ${Math.round(response.confidence * 100)}%.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not test RAG health.");
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatusMessage("Copied to clipboard.");
    } catch {
      setStatusMessage(value);
    }
  }

  function getWorkflowAppUrl(workflowId: number) {
    return `${window.location.origin}/app/${workflowId}`;
  }

  const navItems: Array<{ id: HomeView; label: string; short: string; detail: string }> = [
    { id: "workflows", label: "Workflows", short: "WF", detail: `${workflows.length} saved` },
    { id: "create", label: "Create", short: "CR", detail: "wizard" },
    { id: "templates", label: "Templates", short: "TP", detail: `${templates.length} recipes` },
    { id: "usage", label: "Usage", short: "US", detail: `${usage?.totals.runs || 0} runs` },
    { id: "publish", label: "Publish", short: "PB", detail: `${publishedChatbots.length} live` },
    { id: "knowledge", label: "Knowledge", short: "KG", detail: `${globalKnowledge.length} collections` },
    { id: "marketplace", label: "Blocks", short: "BX", detail: `${marketplaceBlocks.length} blocks` },
    { id: "health", label: "Health", short: "HL", detail: systemHealth ? "checked" : "setup" },
    { id: "bundle", label: "Bundles", short: "BD", detail: "import/export" },
    { id: "account", label: "Account", short: "AC", detail: currentUser ? currentUser.role : "login" },
  ];
  const activeTitle: Record<HomeView, string> = {
    workflows: "Operate your AI workflows",
    create: "Create a workflow workspace",
    templates: "Launch from proven blueprints",
    usage: "Read the studio pulse",
    publish: "Ship local chatbot endpoints",
    knowledge: "Manage local RAG collections",
    marketplace: "Browse block capabilities",
    health: "Check studio readiness",
    bundle: "Move workflows safely",
    account: "Control identity and ownership",
  };
  const activeSubtitle: Record<HomeView, string> = {
    workflows: "Search, run, rename, publish, archive, and inspect every workflow from one focused library.",
    create: "Start blank or clone an advanced template with ownership, app URLs, and future publishing already wired.",
    templates: "Turn advanced sample workflows into editable workspaces without rebuilding the graph by hand.",
    usage: "Monitor users, runs, failures, latency, files, and RAG activity from the local SQLite app database.",
    publish: "Manage live chatbot links, API snippets, unpublish actions, and quick test launches.",
    knowledge: "Inspect all RAG collections, chunk counts, ingest freshness, and jump to the owning workflow.",
    marketplace: "See implemented and upcoming blocks, their ports, config fields, and extension phase.",
    health: "Validate SQLite, local storage, Chroma, OpenRouter, embedding, and environment configuration.",
    bundle: "Export project bundles or import a workflow JSON bundle into a fresh editable workspace.",
    account: "Use local-first login so created workflows, runs, and publish actions have clear ownership.",
  };

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAuthBusy(true);
    try {
      const response =
        authMode === "signup"
          ? await signup(authForm)
          : await login({ email: authForm.email, password: authForm.password });
      localStorage.setItem("vmb-local-user", JSON.stringify(response.user));
      localStorage.setItem("vmb-local-session-token", response.local_session_token);
      setCurrentUser(response.user);
      setStatusMessage(response.message);
      setAuthForm({ email: "", display_name: "", password: "" });
      await refreshUsage();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsAuthBusy(false);
    }
  }

  function logoutLocalUser() {
    localStorage.removeItem("vmb-local-user");
    localStorage.removeItem("vmb-local-session-token");
    setCurrentUser(null);
    setStatusMessage("Logged out locally.");
  }

  function startRename(workflow: WorkflowSummary) {
    setEditingWorkflowId(workflow.id);
    setEditingWorkflowName(workflow.name);
  }

  async function saveWorkflowName(workflow: WorkflowSummary) {
    const nextName = editingWorkflowName.trim();
    if (!nextName || nextName === workflow.name) {
      setEditingWorkflowId(null);
      return;
    }

    try {
      await updateWorkflowMetadata(workflow.id, { name: nextName });
      setStatusMessage(`Renamed workflow #${workflow.id}.`);
      setEditingWorkflowId(null);
      await refreshAll();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not rename workflow.");
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_8%,_rgba(182,255,135,0.34),_transparent_24%),radial-gradient(circle_at_88%_14%,_rgba(255,143,112,0.18),_transparent_22%),radial-gradient(circle_at_bottom_right,_rgba(126,211,255,0.30),_transparent_26%),linear-gradient(135deg,_#f6fbf4_0%,_#f3eadc_48%,_#fffaf5_100%)] p-3 text-ink">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-3 lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="rounded-[2rem] border border-white/70 bg-ink p-3 text-white shadow-panel">
          <div className="flex h-full flex-row items-center gap-2 overflow-auto lg:flex-col lg:items-stretch">
            <div className="hidden rounded-[1.5rem] bg-[linear-gradient(135deg,_rgba(255,255,255,0.16),_rgba(255,255,255,0.06))] p-4 lg:block">
              <p className="text-xl font-black tracking-tight">AI Studio</p>
              <p className="mt-2 text-xs leading-5 text-white/48">Local-first workflow command center.</p>
            </div>
            <div className="flex flex-1 gap-2 lg:flex-col">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`group min-w-36 rounded-[1.25rem] px-3 py-3 text-left transition lg:min-w-0 ${
                    activeView === item.id ? "bg-lime text-ink shadow-lg shadow-lime/10" : "bg-white/7 text-white hover:bg-white/13"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${activeView === item.id ? "bg-ink" : "bg-white/28"}`} />
                    <span className="text-sm font-bold">{item.label}</span>
                  </span>
                  <span className={`mt-1 block text-xs ${activeView === item.id ? "text-ink/58" : "text-white/42"}`}>{item.detail}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                void refreshAll();
              }}
              className="rounded-[1.25rem] bg-white/10 px-3 py-3 text-xs font-bold uppercase tracking-[0.18em] text-white transition hover:bg-white/16"
            >
              Sync Data
            </button>
          </div>
        </aside>

        <div className="min-w-0 overflow-hidden rounded-[2rem] border border-white/70 bg-white/48 shadow-panel backdrop-blur">
          <div className="mx-auto max-w-7xl p-4 lg:p-6">
        <header className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,_#081018_0%,_#17302e_58%,_#31413b_100%)] p-5 text-white shadow-panel lg:flex lg:items-end lg:justify-between">
          <div className="relative">
            <div className="absolute -left-16 -top-20 h-40 w-40 rounded-full bg-lime/20 blur-3xl" />
            <p className="relative mb-3 text-xs font-semibold uppercase tracking-[0.35em] text-white/45">
              AI Studio
            </p>
            <h1 className="relative max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
              {activeTitle[activeView]}
            </h1>
            <p className="relative mt-3 max-w-2xl text-sm leading-6 text-white/64">
              {activeSubtitle[activeView]}
            </p>
            <div className="relative mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/70">
                {statusMessage}
              </span>
              <span className="rounded-full bg-lime/20 px-3 py-1.5 text-xs font-semibold text-lime">
                {currentUser ? `Owner: ${currentUser.display_name}` : "Login recommended"}
              </span>
            </div>
          </div>
          <div className="relative mt-5 flex flex-wrap gap-2 lg:mt-0 lg:justify-end">
            <button
              type="button"
              onClick={() => {
                void refreshAll();
              }}
              className="rounded-full bg-white/12 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/18"
            >
              Sync
            </button>
            <button
              type="button"
              onClick={onOpenFiles}
              className="rounded-full bg-white/12 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/18"
            >
              Files
            </button>
            <button
              type="button"
              onClick={() => setActiveView("create")}
              className="rounded-full bg-lime px-4 py-2 text-sm font-bold text-ink transition hover:brightness-95"
            >
              Create
            </button>
          </div>
        </header>

        {activeView === "create" ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[2rem] border border-white/70 bg-ink p-5 text-white shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">Creation Wizard</p>
              <h2 className="mt-2 text-3xl font-bold">Start with intent</h2>
              <p className="mt-3 text-sm leading-6 text-white/62">
                Choose a blank builder canvas when you are designing from scratch, or clone a template when you want a tested file/RAG/chat pipeline immediately.
              </p>
              <button
                type="button"
                onClick={guardedCreateWorkflow}
                className="mt-5 w-full rounded-[1.4rem] bg-lime px-5 py-4 text-left text-sm font-bold text-ink transition hover:brightness-95"
              >
                Blank AI workflow
                <span className="mt-1 block text-xs font-semibold text-ink/55">Chat input, memory, chatbot, and output starter graph.</span>
              </button>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoCard title="Pre-run Checklist" body="The app run page validates files, API key hints, and required inputs before execution." />
                <InfoCard title="Shareable App URL" body="Every workflow gets /app/:workflowId for file forms, chat forms, dashboards, and clean outputs." />
              </div>
            </div>
            <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Template Fast Start</p>
              <h2 className="mt-2 text-2xl font-bold">Clone an advanced workflow</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {templates.slice(0, 8).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => void createFromTemplate(template.id)}
                    className="rounded-[1.4rem] border border-ink/8 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <span className="block text-sm font-semibold">{template.name.replace("Advanced: ", "")}</span>
                    <span className="mt-2 block text-xs leading-5 text-ink/56">
                      {template.rag_document_count} docs · {template.rag_chunk_count} chunks · {template.run_count} runs
                    </span>
                  </button>
                ))}
                {!templates.length ? (
                  <p className="rounded-[1.4rem] bg-mist/70 p-4 text-sm text-ink/58">
                    No templates yet. Run the sample workflow seeder from the backend scripts folder.
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {activeView === "usage" ? (
        <section className="mt-6 grid gap-4 xl:grid-cols-[1.5fr_0.9fr]">
          <div className="rounded-[2rem] border border-white/70 bg-ink p-5 text-white shadow-panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/50">
                  Admin Usage Dashboard
                </p>
                <h2 className="mt-2 text-2xl font-bold">Local activity pulse</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/62">
                  Tracks local users, signups, logins, workflow runs, files, RAG chunks, latency,
                  failures, and published workflows from SQLite.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshUsage()}
                className="rounded-full bg-white/12 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/18"
              >
                Refresh Stats
              </button>
            </div>

            {usage ? (
              <>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard label="Users" value={usage.totals.users} detail={`${usage.totals.active_memory_users} active in memory`} />
                  <MetricCard label="Runs" value={usage.totals.runs} detail={`${usage.totals.runs_last_7d} in last 7 days`} />
                  <MetricCard label="Failure Rate" value={`${usage.totals.runs ? Math.round((usage.totals.failed_runs / usage.totals.runs) * 100) : 0}%`} detail={`${usage.totals.failed_runs} failed runs`} />
                  <MetricCard label="RAG Chunks" value={usage.totals.knowledge_chunks} detail={`${usage.totals.knowledge_documents} documents`} />
                  <MetricCard label="Workflows" value={usage.totals.workflows} detail={`${usage.totals.published_workflows} published`} />
                  <MetricCard label="Files" value={usage.totals.files_uploaded} detail="local uploads saved" />
                  <MetricCard label="Avg Run" value={`${usage.totals.avg_run_latency_ms}ms`} detail="workflow latency" />
                  <MetricCard label="Auth" value={usage.totals.login_events} detail={`${usage.totals.signup_events} signups`} />
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[1.5rem] bg-white/8 p-4">
                    <p className="text-sm font-semibold">Top Workflows</p>
                    <div className="mt-3 space-y-2">
                      {usage.top_workflows.length ? usage.top_workflows.map((workflow) => (
                        <button
                          key={workflow.id}
                          type="button"
                          onClick={() => onOpenWorkflow(workflow.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/8 px-3 py-2 text-left text-sm transition hover:bg-white/12"
                        >
                          <span className="truncate">{workflow.name}</span>
                          <span className="shrink-0 rounded-full bg-white/12 px-2 py-1 text-[11px] font-semibold">
                            {workflow.run_count} runs
                          </span>
                        </button>
                      )) : (
                        <p className="rounded-2xl bg-white/8 px-3 py-2 text-sm text-white/55">No runs yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] bg-white/8 p-4">
                    <p className="text-sm font-semibold">Recent Auth Activity</p>
                    <div className="mt-3 space-y-2">
                      {usage.recent_auth_events.length ? usage.recent_auth_events.slice(0, 6).map((event) => (
                        <div key={event.id} className="rounded-2xl bg-white/8 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold">{event.event_type}</span>
                            <span className="text-[11px] text-white/45">{new Date(event.created_at).toLocaleString()}</span>
                          </div>
                          <p className="mt-1 truncate text-xs text-white/55">{event.email || "anonymous/local"}</p>
                        </div>
                      )) : (
                        <p className="rounded-2xl bg-white/8 px-3 py-2 text-sm text-white/55">No login/signup events yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-5 rounded-[1.5rem] bg-white/8 p-4 text-sm text-white/60">
                Usage stats unavailable. Start the backend and run migrations to enable admin metrics.
              </p>
            )}
          </div>

        </section>
        ) : null}

        {activeView === "templates" || activeView === "publish" ? (
        <section className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          {activeView === "templates" ? (
          <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur xl:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Template Gallery</p>
                <h2 className="mt-2 text-2xl font-bold">Curated launchpads</h2>
                <p className="mt-1 text-sm text-ink/58">Pick a proven AI workflow and turn it into your own editable workspace.</p>
              </div>
              <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-ink/55">
                {templates.length} templates
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {templates.slice(0, 6).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => void createFromTemplate(template.id)}
                  className="rounded-[1.4rem] border border-ink/8 bg-[linear-gradient(180deg,_#ffffff,_#fbfcf8)] p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <p className="text-sm font-semibold text-ink">{template.name.replace("Advanced: ", "")}</p>
                  <p className="mt-2 text-xs leading-5 text-ink/56">
                    {template.run_count} runs · {template.rag_chunk_count} RAG chunks · {template.is_published ? "publishable" : "builder workflow"}
                  </p>
                </button>
              ))}
              {!templates.length ? (
                <p className="rounded-[1.4rem] bg-mist/70 p-4 text-sm text-ink/58">
                  Run the sample seeder to populate advanced templates.
                </p>
              ) : null}
            </div>
          </div>
          ) : null}

          {activeView === "publish" ? (
          <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur xl:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Publish Manager</p>
                <h2 className="mt-2 text-2xl font-bold">Live endpoints</h2>
                <p className="mt-1 text-sm text-ink/58">Test chatbots, copy API snippets, and unpublish endpoints from one quiet control room.</p>
              </div>
              <span className="rounded-full bg-lime/30 px-3 py-1 text-xs font-semibold text-ink/70">
                {publishedChatbots.length} live
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {publishedChatbots.map((workflow) => (
                <div key={workflow.id} className="rounded-[1.4rem] bg-white p-4 ring-1 ring-ink/6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{workflow.name}</p>
                      <button
                        type="button"
                        onClick={() => workflow.published_slug && onOpenChat(workflow.published_slug)}
                        className="mt-1 truncate text-xs font-semibold text-ink/56 hover:text-ink"
                      >
                        {workflow.published_slug ? getChatUrl(workflow.published_slug) : "No slug"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void unpublish(workflow.id)}
                      className="rounded-full bg-coral/15 px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Unpublish
                    </button>
                  </div>
                  <pre className="mt-3 overflow-auto rounded-2xl bg-mist/70 p-3 text-[11px] text-ink/65">
                    {`fetch("${API_BASE_URL}/published/chatbots/${workflow.published_slug}/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, session_id, user_id })
})`}
                  </pre>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => workflow.published_slug && onOpenChat(workflow.published_slug)}
                      className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Test Chat
                    </button>
                    <button
                      type="button"
                      onClick={() => workflow.published_slug && void copyText(getChatUrl(workflow.published_slug))}
                      className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Copy Link
                    </button>
                    <button
                      type="button"
                      onClick={() => workflow.published_slug && void copyText(`${API_BASE_URL}/published/chatbots/${workflow.published_slug}/messages`)}
                      className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Copy API
                    </button>
                  </div>
                </div>
              ))}
              {!publishedChatbots.length ? (
                <p className="rounded-[1.4rem] bg-mist/70 p-4 text-sm text-ink/58">
                  Publish a chat workflow to create a local chatbot endpoint.
                </p>
              ) : null}
            </div>
          </div>
          ) : null}
        </section>
        ) : null}

        {activeView === "knowledge" ? (
          <section className="mt-6 rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">RAG Collection Manager</p>
                <h2 className="mt-2 text-2xl font-bold">Local knowledge inventory</h2>
                <p className="mt-1 text-sm text-ink/58">Collections are grouped by workflow so you can spot empty RAG pipelines quickly.</p>
              </div>
              <button type="button" onClick={() => void refreshProductSurfaces()} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
                Refresh Knowledge
              </button>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {globalKnowledge.map((collection) => (
                <article key={`${collection.workflow_id}-${collection.collection_name}`} className="rounded-[1.5rem] bg-white p-4 ring-1 ring-ink/6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">{collection.collection_name}</p>
                      <p className="mt-1 text-sm text-ink/58">{collection.workflow_name}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${collection.chunk_count ? "bg-lime/35 text-ink" : "bg-coral/15 text-ink"}`}>
                      {collection.chunk_count ? "Healthy" : "Empty"}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-2xl bg-mist/70 px-3 py-2 text-sm"><strong>{collection.document_count}</strong> docs</div>
                    <div className="rounded-2xl bg-mist/70 px-3 py-2 text-sm"><strong>{collection.chunk_count}</strong> chunks</div>
                    <div className="rounded-2xl bg-mist/70 px-3 py-2 text-sm">{collection.last_ingested_at ? new Date(collection.last_ingested_at).toLocaleDateString() : "Not ingested"}</div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => onOpenWorkflow(collection.workflow_id)} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">Open Builder</button>
                    <button type="button" onClick={() => onOpenWorkflowApp(collection.workflow_id)} className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink">Open App URL</button>
                    <button
                      type="button"
                      onClick={() => void testKnowledgeRetrieval(collection.workflow_id, collection.collection_name, "health check", 4).then((response) => setStatusMessage(`${collection.collection_name}: ${response.match_count} matches, ${Math.round(response.confidence * 100)}% confidence.`))}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
                    >
                      Test Retrieval
                    </button>
                  </div>
                </article>
              ))}
              {!globalKnowledge.length ? (
                <p className="rounded-[1.5rem] bg-mist/70 p-5 text-sm text-ink/58">No RAG collections yet. Run a file upload → text extraction → RAG ingest workflow.</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeView === "marketplace" ? (
          <section className="mt-6 rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Block Marketplace</p>
                <h2 className="mt-2 text-2xl font-bold">Capabilities and extension seams</h2>
                <p className="mt-1 text-sm text-ink/58">Schema-driven metadata for UI config forms, execution validation, and future plugins.</p>
              </div>
              <span className="rounded-full bg-mist px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/55">{marketplaceBlocks.length} blocks</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {marketplaceBlocks.map((block) => (
                <article key={block.type} className="rounded-[1.45rem] bg-white p-4 ring-1 ring-ink/6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{block.title}</p>
                      <p className="mt-1 text-xs font-semibold text-ink/42">{block.type}</p>
                    </div>
                    <span className="rounded-full bg-lime/30 px-2.5 py-1 text-[11px] font-semibold text-ink">{block.phase}</span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-ink/58">
                    Inputs: {block.inputs.map((input) => input.id).join(", ") || "none"} · Outputs: {block.outputs.map((output) => output.id).join(", ") || "none"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {block.fields.slice(0, 5).map((field) => (
                      <span key={field.key} className="rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold text-ink/58">
                        {field.required ? "*" : ""}{field.key}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeView === "health" ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Credential & Config Health</p>
                  <h2 className="mt-2 text-2xl font-bold">Local readiness checklist</h2>
                </div>
                <button type="button" onClick={() => void refreshProductSurfaces()} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">Recheck</button>
              </div>
              <div className="mt-4 space-y-2">
                {systemHealth?.checks.map((check) => (
                  <div key={check.key} className="flex flex-col gap-2 rounded-[1.25rem] bg-white px-4 py-3 ring-1 ring-ink/6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold">{check.label}</p>
                      <p className="mt-1 break-all text-xs text-ink/55">{check.detail}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${check.status === "ready" ? "bg-lime/35" : check.status === "missing" ? "bg-coral/20" : "bg-mist"}`}>
                      {check.status}
                    </span>
                  </div>
                )) || <p className="rounded-[1.25rem] bg-mist/70 p-4 text-sm text-ink/58">Health details unavailable. Start the API and refresh.</p>}
              </div>
            </div>
            <div className="rounded-[2rem] border border-white/70 bg-ink p-5 text-white shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">Environment</p>
              <h2 className="mt-2 text-2xl font-bold">Where things are configured</h2>
              <div className="mt-4 space-y-3 text-sm text-white/62">
                <p><strong className="text-white">OPENROUTER_API_KEY</strong> powers Chatbot, Summarizer, Classifier, and Extraction AI.</p>
                <p><strong className="text-white">CHROMA_DIR</strong> stores vector collections locally.</p>
                <p><strong className="text-white">STORAGE_DIR</strong> stores uploads, SQLite, and app artifacts.</p>
                <p><strong className="text-white">EMBEDDING_MODEL</strong> controls local sentence-transformers embeddings.</p>
              </div>
            </div>
          </section>
        ) : null}

        {activeView === "bundle" ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Export Bundles</p>
              <h2 className="mt-2 text-2xl font-bold">Download reviewable workflow JSON</h2>
              <div className="mt-4 space-y-2">
                {workflows.slice(0, 12).map((workflow) => (
                  <div key={workflow.id} className="flex items-center justify-between gap-3 rounded-[1.25rem] bg-white px-4 py-3 ring-1 ring-ink/6">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{workflow.name}</p>
                      <p className="text-xs text-ink/50">Includes graph, versions, run summaries, files metadata, and knowledge metadata.</p>
                    </div>
                    <button type="button" onClick={() => void downloadBundle(workflow)} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">Export</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[2rem] border border-white/70 bg-ink p-5 text-white shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">Import Bundle</p>
              <h2 className="mt-2 text-2xl font-bold">Paste an AI Studio bundle</h2>
              <textarea
                value={bundleImportText}
                onChange={(event) => setBundleImportText(event.target.value)}
                placeholder='{"format":"ai-studio-workflow-bundle","graph_json":{...}}'
                className="mt-4 min-h-64 w-full rounded-[1.25rem] border border-white/10 bg-white/8 p-4 font-mono text-xs text-white outline-none placeholder:text-white/30"
              />
              <button type="button" onClick={() => void importBundle()} className="mt-3 w-full rounded-[1.25rem] bg-lime px-4 py-3 text-sm font-bold text-ink">
                Import as New Workflow
              </button>
            </div>
          </section>
        ) : null}

        {activeView === "workflows" ? (
        <section className="mt-6 rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/42">Workflow Library</p>
              <h2 className="mt-2 text-2xl font-bold">Production desk</h2>
              <p className="mt-1 text-sm text-ink/62">Open the builder, launch an app URL, inspect health, or clean up archived work.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search workflows, status, slug..."
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm outline-none sm:w-72"
              />
              <span className="rounded-full bg-mist px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-ink/55">
                {filteredWorkflows.length}/{workflows.length} shown
              </span>
              <button
                type="button"
                onClick={() => setShowArchived((current) => !current)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${showArchived ? "bg-ink text-white" : "bg-mist text-ink/55"}`}
              >
                {showArchived ? "Hide Archived" : "Show Archived"}
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-[1.6rem] bg-mist/80 p-8 text-sm text-ink/62">
              Loading the workflow library...
            </div>
          ) : workflows.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-ink/15 bg-mist/70 p-8">
              <h3 className="text-lg font-semibold">No workflows saved yet</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/62">
                Create your first workflow to open the builder. The starter graph includes Chat
                Input, Chatbot, Conversation Memory, and Chat Output.
              </p>
              <button
                type="button"
                onClick={guardedCreateWorkflow}
                className="mt-5 rounded-full bg-lime px-5 py-3 text-sm font-semibold text-ink"
              >
                Open Starter Builder
              </button>
            </div>
          ) : filteredWorkflows.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-ink/15 bg-mist/70 p-8">
              <h3 className="text-lg font-semibold">No workflows match your search</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/62">
                Try searching by workflow name, ID, status, publish slug, or workflow type.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredWorkflows.map((workflow) => (
                <article
                  key={workflow.id}
                  className="rounded-[1.7rem] border border-ink/8 bg-[linear-gradient(180deg,_#ffffff_0%,_#fbfcf8_100%)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink/45">
                        Workflow #{workflow.id}
                      </p>
                      {editingWorkflowId === workflow.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveWorkflowName(workflow);
                          }}
                          className="mt-2 flex gap-2"
                        >
                          <input
                            value={editingWorkflowName}
                            onChange={(event) => setEditingWorkflowName(event.target.value)}
                            className="min-w-0 flex-1 rounded-2xl border border-ink/10 bg-mist/60 px-3 py-2 text-sm font-semibold outline-none"
                            autoFocus
                          />
                          <button type="submit" className="rounded-full bg-ink px-3 py-2 text-xs font-semibold text-white">
                            Save
                          </button>
                          <button type="button" onClick={() => setEditingWorkflowId(null)} className="rounded-full bg-mist px-3 py-2 text-xs font-semibold">
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRename(workflow)}
                          className="mt-2 block text-left text-xl font-semibold transition hover:text-ink/70"
                          title="Click to rename"
                        >
                          {workflow.name}
                        </button>
                      )}
                      <p className="mt-2 text-sm leading-6 text-ink/62">
                        {workflow.description || "No description yet."}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        workflow.is_published ? "bg-lime/40 text-ink" : "bg-mist text-ink/60"
                      }`}
                    >
                      {workflow.is_published ? "Published" : workflow.status}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-2 text-sm text-ink/60 sm:grid-cols-2">
                    <div className="rounded-2xl bg-mist/70 px-4 py-3">
                      Version {workflow.current_version}
                    </div>
                    <div className="rounded-2xl bg-mist/70 px-4 py-3">
                      Updated {new Date(workflow.updated_at).toLocaleString()}
                    </div>
                    <button
                      type="button"
                      onClick={() => workflow.last_run_id && onOpenWorkflow(workflow.id)}
                      className={`rounded-2xl px-4 py-3 text-left ${workflow.last_run_status === "failed" ? "bg-coral/15 text-ink" : "bg-lime/20 text-ink"}`}
                    >
                      <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-ink/45">Run Health</span>
                      <span className="mt-1 block font-semibold">
                        {workflow.run_count} runs · {workflow.last_run_status || "never run"}
                      </span>
                      {workflow.last_run_error ? (
                        <span className="mt-1 block truncate text-xs text-ink/62">{workflow.last_run_error}</span>
                      ) : null}
                    </button>
                    <div className="rounded-2xl bg-mist/70 px-4 py-3">
                      <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-ink/45">RAG Health</span>
                      <span className="mt-1 block font-semibold text-ink">
                        {workflow.rag_document_count} docs · {workflow.rag_chunk_count} chunks
                      </span>
                      <span className="mt-1 block text-xs text-ink/55">
                        {workflow.rag_last_ingested_at ? `Last ingest ${new Date(workflow.rag_last_ingested_at).toLocaleDateString()}` : "No indexed knowledge yet"}
                      </span>
                      <button
                        type="button"
                        onClick={() => void testRagHealth(workflow)}
                        disabled={workflow.rag_chunk_count === 0}
                        className="mt-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Test Retrieval
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-ink/6">
                      Avg latency: <strong>{workflow.avg_latency_ms ? `${workflow.avg_latency_ms}ms` : "n/a"}</strong>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-ink/6">
                      Failures: <strong>{workflow.failed_run_count}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openVersions(workflow.id)}
                      className="rounded-2xl bg-white px-4 py-3 text-left font-semibold ring-1 ring-ink/6"
                    >
                      Versions
                    </button>
                  </div>

                  {workflow.published_slug && workflowKinds[workflow.id] === "chat" ? (
                    <button
                      type="button"
                      onClick={() => onOpenChat(workflow.published_slug || "")}
                      className="mt-4 w-full rounded-2xl bg-lime/30 px-4 py-3 text-left text-sm font-semibold text-ink"
                    >
                      Chat URL: {getChatUrl(workflow.published_slug)}
                    </button>
                  ) : null}

                  {workflow.published_slug && workflowKinds[workflow.id] === "builder" ? (
                    <div className="mt-4 rounded-2xl bg-sand/60 px-4 py-3 text-sm font-semibold text-ink/70">
                      This workflow has a legacy chat slug, but its current graph is a builder/document run. Open Builder to run it and inspect outputs.
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenWorkflow(workflow.id)}
                      className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                    >
                      Open Builder
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenWorkflowApp(workflow.id)}
                      className="rounded-full bg-lime px-4 py-2 text-sm font-semibold text-ink"
                    >
                      App URL
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyText(getWorkflowAppUrl(workflow.id))}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
                    >
                      Copy App Link
                    </button>
                    <button
                      type="button"
                      onClick={() => publishAndOpen(workflow.id)}
                      disabled={workflowKinds[workflow.id] === "builder"}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {workflowKinds[workflow.id] === "builder" ? "Run in Builder" : "Publish Chat URL"}
                    </button>
                    {workflow.last_run_id ? (
                      <button
                        type="button"
                        onClick={() => {
                          window.history.pushState({}, "", `/runs/${workflow.id}/${workflow.last_run_id}`);
                          window.dispatchEvent(new Event("vmb:navigate"));
                        }}
                        className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
                      >
                        Latest Run
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void lifecycleAction("duplicate", workflow)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => void openPermissions(workflow)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
                    >
                      Permissions
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadBundle(workflow)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
                    >
                      Export
                    </button>
                    {workflow.archived_at ? (
                      <button
                        type="button"
                        onClick={() => void lifecycleAction("restore", workflow)}
                        className="rounded-full bg-lime/30 px-4 py-2 text-sm font-semibold text-ink"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void lifecycleAction("archive", workflow)}
                        className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
                      >
                        Archive
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void lifecycleAction("delete", workflow)}
                      className="rounded-full bg-coral/15 px-4 py-2 text-sm font-semibold text-ink"
                    >
                      Delete
                    </button>
                    <span className="rounded-full bg-mist px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink/50">
                      Shareable: /app/{workflow.id}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        ) : null}

        {activeView === "account" ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">
                Local Users
              </p>
              <h2 className="mt-2 text-2xl font-bold">Login & signup</h2>
              {currentUser ? (
                <div className="mt-4 rounded-[1.5rem] bg-lime/25 p-4">
                  <p className="text-sm font-semibold text-ink">Signed in as {currentUser.display_name}</p>
                  <p className="mt-1 text-xs text-ink/58">{currentUser.email} · {currentUser.role}</p>
                  <button
                    type="button"
                    onClick={logoutLocalUser}
                    className="mt-4 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                  >
                    Log Out
                  </button>
                </div>
              ) : (
                <form onSubmit={submitAuth} className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2 rounded-full bg-mist p-1">
                    {(["login", "signup"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAuthMode(mode)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${authMode === mode ? "bg-ink text-white" : "text-ink/62"}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  {authMode === "signup" ? (
                    <input
                      value={authForm.display_name}
                      onChange={(event) => setAuthForm((current) => ({ ...current, display_name: event.target.value }))}
                      placeholder="Display name"
                      className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
                    />
                  ) : null}
                  <input
                    value={authForm.email}
                    onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="Email"
                    type="email"
                    className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
                  />
                  <input
                    value={authForm.password}
                    onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="Password"
                    type="password"
                    className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isAuthBusy}
                    className="w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {isAuthBusy ? "Working..." : authMode === "signup" ? "Create Local User" : "Login Locally"}
                  </button>
                </form>
              )}
            </div>
            <div className="rounded-[2rem] border border-white/70 bg-ink p-5 text-white shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">Ownership</p>
              <h2 className="mt-2 text-2xl font-bold">Why login matters</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoCard title="Created By" body="New workflows and templates are stamped with the local user that created them." />
                <InfoCard title="Run Ownership" body="Workflow runs capture owner, session id, and runtime user id for admin analytics." />
                <InfoCard title="Publishing Guard" body="Publishing and running require local login, so usage stats stay meaningful." />
                <InfoCard title="Local First" body="Everything remains SQLite/local storage. This can later swap to real auth." />
              </div>
            </div>
          </section>
        ) : null}
      </div>
      </div>
      </div>
      {selectedWorkflowDetails ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/28 p-4 backdrop-blur-sm">
          <div className="max-h-[82vh] w-full max-w-2xl overflow-auto rounded-[2rem] bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Version Restore</p>
                <h2 className="mt-2 text-2xl font-bold">{selectedWorkflowDetails.name}</h2>
                <p className="mt-1 text-sm text-ink/58">
                  Restore an older saved graph snapshot. This keeps the workflow and replaces the current graph.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedWorkflowDetails(null);
                  setVersionCompare(null);
                }}
                className="rounded-full bg-mist px-4 py-2 text-sm font-semibold"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {selectedWorkflowDetails.versions.length ? selectedWorkflowDetails.versions.map((version) => (
                <div key={version.id} className="rounded-[1.4rem] bg-mist/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">Version {version.version_number}</p>
                      <p className="mt-1 text-xs text-ink/55">
                        {version.version_note || "No note"} · {new Date(version.created_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreVersion(selectedWorkflowDetails.id, version.id)}
                      className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => void compareVersion(selectedWorkflowDetails.id, version.id)}
                      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink"
                    >
                      Compare
                    </button>
                  </div>
                  {versionCompare?.version_id === version.id ? (
                    <div className="mt-3 rounded-2xl bg-white p-3 text-xs text-ink/62">
                      <p className="font-semibold text-ink">Diff against current graph</p>
                      <p className="mt-2">
                        {Object.entries(versionCompare.diff.summary)
                          .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
                          .join(" · ")}
                      </p>
                      {versionCompare.diff.changed_nodes.length ? (
                        <p className="mt-2">Changed nodes: {versionCompare.diff.changed_nodes.map((node) => `${node.node_id} (${node.changes.join(", ")})`).join("; ")}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )) : (
                <p className="rounded-[1.4rem] bg-mist/70 p-4 text-sm text-ink/58">
                  No saved versions yet. Use Save Version from the workflow API or future builder controls.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {permissionWorkflow ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/28 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[2rem] bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Workflow Permissions</p>
                <h2 className="mt-2 text-2xl font-bold">{permissionWorkflow.name}</h2>
                <p className="mt-1 text-sm text-ink/58">MVP sharing metadata for local users. Enforcement can be tightened as teams move beyond local-first testing.</p>
              </div>
              <button type="button" onClick={() => setPermissionWorkflow(null)} className="rounded-full bg-mist px-4 py-2 text-sm font-semibold">
                Close
              </button>
            </div>
            <form onSubmit={submitPermission} className="mt-4 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <input
                value={permissionForm.email}
                onChange={(event) => setPermissionForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="teammate@example.com"
                className="rounded-2xl border border-ink/10 bg-mist/60 px-4 py-3 text-sm outline-none"
              />
              <select
                value={permissionForm.role}
                onChange={(event) => setPermissionForm((current) => ({ ...current, role: event.target.value }))}
                className="rounded-2xl border border-ink/10 bg-mist/60 px-4 py-3 text-sm outline-none"
              >
                <option value="viewer">Viewer</option>
                <option value="runner">Runner</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
              <button type="submit" className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white">
                Add
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {permissions.map((permission) => (
                <div key={permission.id} className="flex items-center justify-between gap-3 rounded-[1.25rem] bg-mist/70 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">{permission.display_name}</p>
                    <p className="text-xs text-ink/55">{permission.email} · {permission.role}</p>
                  </div>
                  <button type="button" onClick={() => void removePermission(permission)} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink">
                    Remove
                  </button>
                </div>
              ))}
              {!permissions.length ? (
                <p className="rounded-[1.25rem] bg-mist/70 p-4 text-sm text-ink/58">No extra local users have access metadata yet.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function isChatWorkflow(graph: BuilderGraph) {
  return (
    graph.nodes.some((node) => node.data.blockType === "chat_input") &&
    graph.nodes.some((node) => node.data.blockType === "chat_output")
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-[1.35rem] bg-white/10 p-4 ring-1 ring-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/42">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-white/55">{detail}</p>
    </div>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.35rem] bg-white/10 p-4 ring-1 ring-white/10">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-xs leading-5 text-white/58">{body}</p>
    </div>
  );
}
