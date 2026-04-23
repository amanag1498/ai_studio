import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  Blocks,
  Boxes,
  ChartNoAxesColumnIncreasing,
  Database,
  FileStack,
  FolderOpen,
  Layers3,
  Settings2,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  API_BASE_URL,
  addWorkflowPermission,
  archiveWorkflow,
  autoBuildWorkflow,
  compareWorkflowVersion,
  addWorkspaceMember,
  createWorkspace,
  createWorkflowFromTemplate,
  deleteWorkspaceMember,
  createWorkflowComment,
  createWorkflowSubflow,
  deleteWorkflow,
  deleteWorkflowPermission,
  duplicateWorkflow,
  exportWorkflowBundle,
  getChatUrl,
  getObservabilityDashboard,
  getSystemHealthDetails,
  getUsageDashboard,
  getWorkflow,
  importWorkflowBundle,
  listAuditLogs,
  listAllKnowledgeCollections,
  listBlockMarketplace,
  listFiles,
  listPublishedChatbots,
  listAdminUsers,
  listSubflows,
  listWorkflowComments,
  listWorkflowHistory,
  listWorkflowPermissions,
  listWorkflowRuns,
  listWorkflowTemplates,
  listWorkflows,
  listWorkspaces,
  listWorkspaceAuditLogs,
  publishWorkflow,
  regeneratePublishToken,
  restoreWorkflow,
  restoreWorkflowVersion,
  setDefaultWorkspace,
  testKnowledgeRetrieval,
  unpublishWorkflow,
  updateWorkflowMetadata,
  updateAdminUser,
  uploadLibraryFile,
  type AppUser,
  type AuditLogRecord,
  type BlockMarketplaceItem,
  type GlobalKnowledgeCollection,
  type ObservabilityDashboard,
  type SystemHealthDetails,
  type UsageDashboard,
  type VersionCompare,
  type WorkflowPermission,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type WorkflowSummary,
  type WorkflowChangeEvent,
  type WorkflowComment,
  type FileLibraryItem,
  type WorkflowSubflow,
  type WorkspaceRecord,
  type WorkspaceAuditLogRecord,
} from "../lib/api";
import type { BuilderGraph } from "@vmb/shared";

type WorkflowsPageProps = {
  authenticatedUser: AppUser | null;
  onLogout: () => void;
  onCreateWorkflow: () => void;
  onOpenWorkflow: (workflowId: number) => void;
  onOpenWorkflowApp: (workflowId: number) => void;
  onOpenChat: (slug: string) => void;
  onOpenFiles: () => void;
};

type HomeView = "workflows" | "create" | "templates" | "usage" | "runs" | "publish" | "files" | "knowledge" | "components" | "marketplace" | "health" | "bundle" | "workspaces" | "adminUsers" | "account";
type WorkflowLaunchKind = "pure_chat" | "rag_chat" | "file_rag_app" | "document_app" | "builder_app";
type WorkflowAppProfile = {
  kind: WorkflowLaunchKind;
  label: string;
  launchSurface: "/chat" | "/app" | "/builder";
  publishMode: "Chatbot URL" | "Workflow App URL" | "Builder Only";
  description: string;
  capabilities: string[];
  allowedOutputs: string[];
  improvements: string[];
};
type NavIconName =
  | "workflow"
  | "spark"
  | "template"
  | "activity"
  | "chart"
  | "rocket"
  | "folder"
  | "database"
  | "component"
  | "blocks"
  | "shield"
  | "bundle"
  | "workspace"
  | "user";

function NavIcon({ name, className = "h-4 w-4" }: { name: NavIconName; className?: string }) {
  const icons: Record<NavIconName, LucideIcon> = {
    workflow: Workflow,
    spark: Sparkles,
    template: Layers3,
    activity: Activity,
    chart: ChartNoAxesColumnIncreasing,
    rocket: Rocket,
    folder: FolderOpen,
    database: Database,
    component: Boxes,
    blocks: Blocks,
    shield: ShieldCheck,
    bundle: FileStack,
    workspace: Settings2,
    user: UserRound,
  };
  const Icon = icons[name];

  return <Icon className={className} aria-hidden strokeWidth={1.9} />;
}

export function WorkflowsPage({ authenticatedUser, onLogout, onCreateWorkflow, onOpenWorkflow, onOpenWorkflowApp, onOpenChat, onOpenFiles }: WorkflowsPageProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowKinds, setWorkflowKinds] = useState<Record<number, WorkflowLaunchKind>>({});
  const [workflowProfiles, setWorkflowProfiles] = useState<Record<number, WorkflowAppProfile>>({});
  const [usage, setUsage] = useState<UsageDashboard | null>(null);
  const [observability, setObservability] = useState<ObservabilityDashboard | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(authenticatedUser);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem("ai-studio-active-workspace-id");
      return saved ? Number(saved) || null : null;
    } catch {
      return null;
    }
  });
  const [workspaceAuditLogs, setWorkspaceAuditLogs] = useState<WorkspaceAuditLogRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AppUser[]>([]);
  const [adminUserSearch, setAdminUserSearch] = useState("");
  const [workspaceForm, setWorkspaceForm] = useState({ name: "", description: "", workflow_limit: 100, monthly_run_limit: 1000, storage_limit_mb: 2048 });
  const [workspaceMemberForm, setWorkspaceMemberForm] = useState({ workspace_id: 0, email: "", role: "viewer" });
  const [publishVisibility, setPublishVisibility] = useState<Record<number, string>>({});
  const [templates, setTemplates] = useState<WorkflowSummary[]>([]);
  const [publishedChatbots, setPublishedChatbots] = useState<WorkflowSummary[]>([]);
  const [selectedWorkflowDetails, setSelectedWorkflowDetails] = useState<WorkflowRecord | null>(null);
  const [versionCompare, setVersionCompare] = useState<VersionCompare | null>(null);
  const [permissionWorkflow, setPermissionWorkflow] = useState<WorkflowSummary | null>(null);
  const [permissions, setPermissions] = useState<WorkflowPermission[]>([]);
  const [permissionForm, setPermissionForm] = useState({ email: "", role: "viewer" });
  const [collaborationWorkflow, setCollaborationWorkflow] = useState<WorkflowRecord | null>(null);
  const [workflowComments, setWorkflowComments] = useState<WorkflowComment[]>([]);
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowChangeEvent[]>([]);
  const [subflows, setSubflows] = useState<WorkflowSubflow[]>([]);
  const [allSubflows, setAllSubflows] = useState<WorkflowSubflow[]>([]);
  const [recentRuns, setRecentRuns] = useState<WorkflowRunRecord[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [subflowName, setSubflowName] = useState("");
  const [systemHealth, setSystemHealth] = useState<SystemHealthDetails | null>(null);
  const [globalKnowledge, setGlobalKnowledge] = useState<GlobalKnowledgeCollection[]>([]);
  const [marketplaceBlocks, setMarketplaceBlocks] = useState<BlockMarketplaceItem[]>([]);
  const [fileLibrary, setFileLibrary] = useState<FileLibraryItem[]>([]);
  const [bundleImportText, setBundleImportText] = useState("");
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [appTypeFilter, setAppTypeFilter] = useState<"all" | WorkflowLaunchKind>("all");
  const [complexityFilter, setComplexityFilter] = useState<"all" | "basic" | "advanced" | "custom">("all");
  const [workflowDensity, setWorkflowDensity] = useState<"compact" | "rich">("compact");
  const [editingWorkflowId, setEditingWorkflowId] = useState<number | null>(null);
  const [editingWorkflowName, setEditingWorkflowName] = useState("");
  const [activeView, setActiveView] = useState<HomeView>("workflows");
  const [isLoading, setIsLoading] = useState(true);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Loading workflows from the local API.");

  useEffect(() => {
    setCurrentUser(authenticatedUser);
  }, [authenticatedUser]);

  const isAdmin = currentUser?.role === "admin";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null;

  function selectActiveWorkspace(workspaceId: number | null) {
    setActiveWorkspaceId(workspaceId);
    try {
      if (workspaceId) {
        localStorage.setItem("ai-studio-active-workspace-id", String(workspaceId));
      } else {
        localStorage.removeItem("ai-studio-active-workspace-id");
      }
    } catch {
      // Local storage is an enhancement; the backend still receives explicit workspace IDs from the UI.
    }
  }

  function canCreateInWorkspace(workspace: WorkspaceRecord | null) {
    if (!currentUser || !workspace) return false;
    if (isAdmin) return true;
    return ["owner", "editor"].includes(workspace.current_user_role || "");
  }

  useEffect(() => {
    void refreshWorkflows();
    void refreshUsage();
    void refreshTemplates();
    void refreshPublishedChatbots();
    void refreshProductSurfaces();
  }, [showArchived]);

  useEffect(() => {
    if (!isAdmin && ["usage", "health", "bundle", "adminUsers"].includes(activeView)) {
      setActiveView("workflows");
    }
  }, [activeView, isAdmin]);

  useEffect(() => {
    if (!workspaces.length) return;
    const selectedExists = activeWorkspaceId ? workspaces.some((workspace) => workspace.id === activeWorkspaceId) : false;
    if (!selectedExists) {
      const defaultWorkspace = workspaces.find((workspace) => workspace.id === currentUser?.default_workspace_id) || workspaces[0];
      selectActiveWorkspace(defaultWorkspace.id);
    }
  }, [activeWorkspaceId, currentUser?.default_workspace_id, workspaces]);

  useEffect(() => {
    if (!activeWorkspaceId || !currentUser) {
      setWorkspaceAuditLogs([]);
      return;
    }
    void refreshWorkspaceAudit(activeWorkspaceId);
  }, [activeWorkspaceId, currentUser]);

  useEffect(() => {
    if (activeView === "adminUsers" && isAdmin) {
      void refreshAdminUsers();
    }
  }, [activeView, isAdmin]);

  const filteredWorkflows = workflows.filter((workflow) => {
    if (appTypeFilter !== "all" && workflowKinds[workflow.id] !== appTypeFilter) {
      return false;
    }
    if (complexityFilter !== "all" && getWorkflowComplexity(workflow) !== complexityFilter) {
      return false;
    }
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    const profile = workflowProfiles[workflow.id];
    return [
      workflow.name,
      workflow.description || "",
      workflow.status,
      workflow.published_slug || "",
      `#${workflow.id}`,
      getWorkflowKindLabel(workflowKinds[workflow.id]),
      profile?.capabilities.join(" ") || "",
      profile?.allowedOutputs.join(" ") || "",
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
            return [record.id, analyzeWorkflowApp(workflow.graph_json)] as const;
          } catch {
            return [record.id, defaultWorkflowAppProfile("builder_app")] as const;
          }
        }),
      );
      setWorkflowProfiles(Object.fromEntries(classifiedEntries));
      setWorkflowKinds(Object.fromEntries(classifiedEntries.map(([id, profile]) => [id, profile.kind])));
      void refreshRunHistory(records);
      setStatusMessage(records.length ? `${records.length} workflow(s) found.` : "No workflows yet.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load workflows.";
      setStatusMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshUsage() {
    if (!isAdmin) {
      setUsage(null);
      setObservability(null);
      setAuditLogs([]);
      return;
    }
    try {
      const [usageDashboard, observable, audits] = await Promise.all([
        getUsageDashboard(),
        getObservabilityDashboard(),
        listAuditLogs({ limit: 8 }),
      ]);
      setUsage(usageDashboard);
      setObservability(observable);
      setAuditLogs(audits);
    } catch {
      setUsage(null);
      setObservability(null);
      setAuditLogs([]);
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
    const [health, knowledge, blocks, files, savedSubflows, workspaceList] = await Promise.allSettled([
      getSystemHealthDetails(),
      listAllKnowledgeCollections(),
      listBlockMarketplace(),
      listFiles(),
      listSubflows(),
      listWorkspaces(),
    ]);
    if (health.status === "fulfilled") setSystemHealth(health.value);
    if (knowledge.status === "fulfilled") setGlobalKnowledge(knowledge.value);
    if (blocks.status === "fulfilled") setMarketplaceBlocks(blocks.value);
    if (files.status === "fulfilled") setFileLibrary(files.value);
    if (savedSubflows.status === "fulfilled") setAllSubflows(savedSubflows.value);
    if (workspaceList.status === "fulfilled") {
      setWorkspaces(workspaceList.value);
      if (!workspaceMemberForm.workspace_id && workspaceList.value[0]) {
        setWorkspaceMemberForm((current) => ({ ...current, workspace_id: workspaceList.value[0].id }));
      }
    }
  }

  async function refreshWorkspaceAudit(workspaceId = activeWorkspaceId) {
    if (!workspaceId) return;
    try {
      setWorkspaceAuditLogs(await listWorkspaceAuditLogs(workspaceId, 60));
    } catch {
      setWorkspaceAuditLogs([]);
    }
  }

  async function refreshAdminUsers(search = adminUserSearch) {
    if (!isAdmin) {
      setAdminUsers([]);
      return;
    }
    try {
      setAdminUsers(await listAdminUsers(search));
    } catch {
      setAdminUsers([]);
    }
  }

  async function refreshRunHistory(sourceWorkflows = workflows) {
    const workflowsToLoad = sourceWorkflows.slice(0, 25);
    if (!workflowsToLoad.length) {
      setRecentRuns([]);
      return;
    }
    const runResults = await Promise.allSettled(workflowsToLoad.map((workflow) => listWorkflowRuns(workflow.id)));
    const runs = runResults
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((left, right) => {
        const leftTime = new Date(left.started_at || "").getTime() || left.id;
        const rightTime = new Date(right.started_at || "").getTime() || right.id;
        return rightTime - leftTime;
      })
      .slice(0, 80);
    setRecentRuns(runs);
  }

  async function uploadMainPageFiles(fileList: FileList | null) {
    const selectedFiles = fileList ? Array.from(fileList) : [];
    if (!selectedFiles.length) return;
    setIsFileUploading(true);
    setStatusMessage(`Uploading ${selectedFiles.length} file(s) to File Library.`);
    try {
      await Promise.all(selectedFiles.map((file) => uploadLibraryFile(file)));
      setFileLibrary(await listFiles());
      setStatusMessage(`${selectedFiles.length} file(s) uploaded. They are now selectable from File Upload blocks in Builder and App Run pages.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not upload file(s).");
    } finally {
      setIsFileUploading(false);
    }
  }

  async function publishAndOpen(workflowId: number) {
    if (!currentUser) {
      setStatusMessage("Login locally before publishing so ownership is tracked.");
      return;
    }
    try {
      setStatusMessage(`Publishing workflow ${workflowId}.`);
      const workflow = await getWorkflow(workflowId);
      const launchKind = getWorkflowLaunchKind(workflow.graph_json);
      if (!canPublishAsChat(launchKind)) {
        setStatusMessage(
          "This workflow needs the app runner because it requires files, forms, dashboards, or document outputs. Opening the app page instead.",
        );
        onOpenWorkflowApp(workflowId);
        return;
      }
      const published = await publishWorkflow(workflowId, publishVisibility[workflowId] || "public");
      if (published.access_token) {
        void copyText(`${getChatUrl(published.slug)}?token=${published.access_token}`);
      }
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
    if (!canCreateInWorkspace(activeWorkspace)) {
      setStatusMessage("Choose a workspace where you are an owner or editor before creating a workflow.");
      return;
    }
    if (activeWorkspace) {
      selectActiveWorkspace(activeWorkspace.id);
    }
    onCreateWorkflow();
  }

  async function createFromTemplate(workflowId: number) {
    if (!currentUser) {
      setStatusMessage("Login locally before creating from a template.");
      return;
    }
    try {
      if (!canCreateInWorkspace(activeWorkspace)) {
        setStatusMessage("Choose a workspace where you can create workflows before cloning this template.");
        return;
      }
      const workflow = await createWorkflowFromTemplate(workflowId, activeWorkspace?.id || undefined);
      setStatusMessage(`Created ${workflow.name} from template.`);
      await refreshAll();
      onOpenWorkflow(workflow.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not create from template.");
    }
  }

  async function createGuidedWorkflow(recipe: { name: string; prompt: string }) {
    if (!currentUser) {
      setStatusMessage("Login locally before creating guided workflows.");
      return;
    }
    try {
      setStatusMessage(`Building ${recipe.name}.`);
      if (!canCreateInWorkspace(activeWorkspace)) {
        setStatusMessage("Choose a workspace where you can create workflows before using guided creation.");
        return;
      }
      const workflow = await autoBuildWorkflow({ name: recipe.name, prompt: recipe.prompt, workspace_id: activeWorkspace?.id || undefined });
      await refreshAll();
      onOpenWorkflow(workflow.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not auto-build workflow.");
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

  async function compareVersion(workflowId: number, versionId: number, base: "previous" | "current" = "previous") {
    try {
      setVersionCompare(await compareWorkflowVersion(workflowId, versionId, base));
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

  async function openCollaboration(workflow: WorkflowSummary) {
    try {
      const [details, comments, history, savedSubflows] = await Promise.all([
        getWorkflow(workflow.id),
        listWorkflowComments(workflow.id),
        listWorkflowHistory(workflow.id),
        listSubflows(),
      ]);
      setCollaborationWorkflow(details);
      setWorkflowComments(comments);
      setWorkflowHistory(history);
      setSubflows(savedSubflows.filter((subflow) => subflow.workflow_id === workflow.id));
      setSubflowName(`${workflow.name} Component`);
      setCommentBody("");
      setStatusMessage(`Loaded collaboration activity for ${workflow.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not load collaboration details.");
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!collaborationWorkflow || !commentBody.trim()) return;
    try {
      await createWorkflowComment(collaborationWorkflow.id, { body: commentBody.trim() });
      const comments = await listWorkflowComments(collaborationWorkflow.id);
      setWorkflowComments(comments);
      setCommentBody("");
      setStatusMessage("Comment added to workflow activity.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not add comment.");
    }
  }

  async function saveWorkflowAsSubflow() {
    if (!collaborationWorkflow) return;
    try {
      const subflow = await createWorkflowSubflow(collaborationWorkflow.id, {
        name: subflowName.trim() || `${collaborationWorkflow.name} Component`,
        description: "Reusable component saved from the workflow collaboration panel.",
        graph_json: collaborationWorkflow.graph_json,
      });
      setSubflows((current) => [subflow, ...current]);
      setStatusMessage(`Saved reusable component "${subflow.name}".`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save reusable component.");
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
      if (!canCreateInWorkspace(activeWorkspace)) {
        setStatusMessage("Choose a workspace where you can import workflows first.");
        return;
      }
      const bundle = JSON.parse(bundleImportText) as Record<string, unknown>;
      const workflow = await importWorkflowBundle(bundle, activeWorkspace?.id || undefined);
      setBundleImportText("");
      setIsImportDialogOpen(false);
      setStatusMessage(`Imported ${workflow.name}.`);
      await refreshAll();
      onOpenWorkflow(workflow.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not import workflow bundle JSON.");
    }
  }

  async function regenerateToken(workflowId: number) {
    try {
      const response = await regeneratePublishToken(workflowId);
      const link = `${getChatUrl(response.slug)}?token=${response.access_token || ""}`;
      await copyText(link);
      setStatusMessage("Token-protected link regenerated and copied.");
      await refreshAll();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not regenerate publish token.");
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

  function getPrimaryLaunchLabel(workflow: WorkflowSummary) {
    const kind = workflowKinds[workflow.id] || "builder_app";
    if (canPublishAsChat(kind) && workflow.published_slug) return "Open Chat";
    if (canPublishAsChat(kind)) return "Publish Chat";
    if (kind === "file_rag_app") return "Run RAG App";
    if (kind === "document_app") return "Run Document App";
    return "Run App";
  }

  function launchWorkflow(workflow: WorkflowSummary) {
    const kind = workflowKinds[workflow.id] || "builder_app";
    if (canPublishAsChat(kind) && workflow.published_slug) {
      onOpenChat(workflow.published_slug);
      return;
    }
    if (canPublishAsChat(kind)) {
      void publishAndOpen(workflow.id);
      return;
    }
    onOpenWorkflowApp(workflow.id);
  }

  function quotaClass(used: number, limit: number) {
    const ratio = limit > 0 ? used / limit : 0;
    if (ratio >= 1) return "bg-coral/20 text-ink ring-coral/30";
    if (ratio >= 0.9) return "bg-sand text-ink ring-sand";
    if (ratio >= 0.8) return "bg-lime/25 text-ink ring-lime/30";
    return "bg-white text-ink/62 ring-ink/6";
  }

  function workflowCanEdit(workflow: WorkflowSummary) {
    const role = (workflow.effective_role || "").toLowerCase();
    return isAdmin || role.includes("owner") || role.includes("editor") || role.includes("admin");
  }

  async function updateUserAsAdmin(user: AppUser, updates: { role?: "admin" | "user"; is_active?: boolean; default_workspace_id?: number }) {
    try {
      await updateAdminUser(user.id, updates);
      setStatusMessage(`Updated ${user.display_name}.`);
      await Promise.all([refreshAdminUsers(), refreshProductSurfaces()]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not update user.");
    }
  }

  const navItems: Array<{ id: HomeView; label: string; short: string; detail: string; group: string; tone: string; icon: NavIconName }> = [
    { id: "workflows", label: "Workflows", short: "WF", detail: `${workflows.length} saved`, group: "Operate", tone: "from-lime/90 to-lime/45", icon: "workflow" },
    { id: "create", label: "Create", short: "CR", detail: "wizard", group: "Operate", tone: "from-sand to-lime/50", icon: "spark" },
    { id: "templates", label: "Templates", short: "TP", detail: `${templates.length} recipes`, group: "Operate", tone: "from-coral/60 to-sand", icon: "template" },
    { id: "runs", label: "Runs", short: "RN", detail: `${recentRuns.length} recent`, group: "Observe", tone: "from-mist to-lime/50", icon: "activity" },
    { id: "usage", label: "Usage", short: "US", detail: `${usage?.totals.runs || 0} runs`, group: "Observe", tone: "from-lime/70 to-white/70", icon: "chart" },
    { id: "publish", label: "Publish", short: "PB", detail: `${publishedChatbots.length} live`, group: "Ship", tone: "from-coral/50 to-lime/60", icon: "rocket" },
    { id: "files", label: "Files", short: "FL", detail: `${fileLibrary.length} uploads`, group: "Data", tone: "from-sand to-white/70", icon: "folder" },
    { id: "knowledge", label: "Knowledge", short: "KG", detail: `${globalKnowledge.length} collections`, group: "Data", tone: "from-lime/75 to-mist", icon: "database" },
    { id: "components", label: "Components", short: "CP", detail: `${allSubflows.length} saved`, group: "Build", tone: "from-white/80 to-mist", icon: "component" },
    { id: "marketplace", label: "Blocks", short: "BX", detail: `${marketplaceBlocks.length} blocks`, group: "Build", tone: "from-lime/60 to-sand", icon: "blocks" },
    { id: "bundle", label: "Bundles", short: "BD", detail: "import/export", group: "Build", tone: "from-sand to-coral/30", icon: "bundle" },
    { id: "workspaces", label: "Workspaces", short: "WS", detail: activeWorkspace?.name || `${workspaces.length} teams`, group: "System", tone: "from-lime/60 to-white/80", icon: "workspace" },
    { id: "adminUsers", label: "Users", short: "UR", detail: `${adminUsers.length || usage?.totals.users || 0} users`, group: "System", tone: "from-mist to-lime/40", icon: "user" },
    { id: "health", label: "Health", short: "HL", detail: systemHealth ? "checked" : "setup", group: "System", tone: "from-mist to-white/80", icon: "shield" },
    { id: "account", label: "Account", short: "AC", detail: currentUser ? currentUser.role : "login", group: "System", tone: "from-white/80 to-lime/50", icon: "user" },
  ];
  const navGroups = ["Operate", "Observe", "Ship", "Data", "Build", "System"];
  const adminOnlyViews = new Set<HomeView>(["usage", "health", "bundle", "adminUsers"]);
  const visibleNavItems = navItems.filter((item) => isAdmin || !adminOnlyViews.has(item.id));
  const visibleNavGroups = navGroups.filter((group) => visibleNavItems.some((item) => item.group === group));
  const activeNavItem = visibleNavItems.find((item) => item.id === activeView) || visibleNavItems[0] || navItems[0];
  const activeTitle: Record<HomeView, string> = {
    workflows: "Operate your AI workflows",
    create: "Create a workflow workspace",
    templates: "Launch from proven blueprints",
    usage: "Read the studio pulse",
    runs: "Inspect execution history",
    publish: "Ship local chatbot endpoints",
    files: "Prepare documents for workflows",
    knowledge: "Manage local RAG collections",
    components: "Reuse saved workflow parts",
    marketplace: "Browse block capabilities",
    health: "Check studio readiness",
    bundle: "Move workflows safely",
    workspaces: "Manage teams and workspace access",
    adminUsers: "Manage local studio users",
    account: "Control identity and ownership",
  };
  const activeSubtitle: Record<HomeView, string> = {
    workflows: "Search, run, rename, publish, archive, and inspect every workflow from one focused library.",
    create: "Start blank or clone an advanced template with ownership, app URLs, and future publishing already wired.",
    templates: "Turn advanced sample workflows into editable workspaces without rebuilding the graph by hand.",
    usage: "Monitor users, runs, failures, latency, files, and RAG activity from the local SQLite app database.",
    runs: "Review recent workflow executions, statuses, errors, timings, owners, and open clean run detail pages.",
    publish: "Manage live chatbot links, API snippets, unpublish actions, and quick test launches.",
    files: "Upload documents once, then reuse them from File Upload blocks while building or running workflows.",
    knowledge: "Inspect all RAG collections, chunk counts, ingest freshness, and jump to the owning workflow.",
    components: "Browse reusable subflows/components saved from workflow activity panels.",
    marketplace: "See implemented and upcoming blocks, their ports, config fields, and extension phase.",
    health: "Validate SQLite, local storage, Chroma, OpenRouter, embedding, and environment configuration.",
    bundle: "Export project bundles or import a workflow JSON bundle into a fresh editable workspace.",
    workspaces: "Switch workspace context, review members, quotas, workflows, and workspace-level audit activity.",
    adminUsers: "Admin-only user management for roles, activation state, and default workspace assignment.",
    account: "Use local-first login so created workflows, runs, and publish actions have clear ownership.",
  };
  const guidedRecipes = [
    {
      name: "Document Q&A Assistant",
      prompt: "Build a document upload workflow with file upload, text extraction, RAG ingestion and retrieval, reranker, chatbot with citations, chat output, JSON output, dashboard preview, and logger.",
      badge: "File + RAG + Chat",
    },
    {
      name: "AI Field Extractor",
      prompt: "Build a workflow that uploads documents, extracts text, uses Extraction AI to return structured JSON fields, validates schema, shows dashboard preview, exports JSON, and logs errors.",
      badge: "Files to JSON",
    },
    {
      name: "Persistent Support Chatbot",
      prompt: "Build a persistent chatbot with chat input, conversation memory, query rewriting, optional RAG context, OpenRouter chatbot, citation verifier, chat output, and logger.",
      badge: "Memory chatbot",
    },
    {
      name: "Approval + Routing Flow",
      prompt: "Build an automation workflow with form input, condition/router, human approval step, chatbot summary, notification, JSON output, and logger.",
      badge: "Automation",
    },
  ];
  const templateProducts = [
    { match: "document", title: "Document Ops Copilot", tag: "Upload -> RAG -> Answer", tone: "bg-lime/30" },
    { match: "extractor", title: "AI Field Extractor", tag: "Upload -> JSON", tone: "bg-sand/60" },
    { match: "chat", title: "Persistent Chatbot", tag: "Memory + citations", tone: "bg-mist" },
    { match: "rag", title: "Multi-RAG Assistant", tag: "Knowledge retrieval", tone: "bg-lime/20" },
    { match: "approval", title: "Approval Automation", tag: "Route + human step", tone: "bg-coral/15" },
  ];

  function getTemplateProduct(template: WorkflowSummary) {
    const name = template.name.toLowerCase();
    return templateProducts.find((product) => name.includes(product.match)) || {
      title: template.name.replace("Advanced: ", ""),
      tag: template.workflow_type || "Workflow template",
      tone: "bg-white",
    };
  }

  const appTypeFilters: Array<{ id: "all" | WorkflowLaunchKind; label: string; detail: string }> = [
    { id: "all", label: "All Apps", detail: `${workflows.length}` },
    { id: "pure_chat", label: "Pure Chat", detail: String(workflows.filter((workflow) => workflowKinds[workflow.id] === "pure_chat").length) },
    { id: "rag_chat", label: "RAG Chat", detail: String(workflows.filter((workflow) => workflowKinds[workflow.id] === "rag_chat").length) },
    { id: "file_rag_app", label: "File RAG", detail: String(workflows.filter((workflow) => workflowKinds[workflow.id] === "file_rag_app").length) },
    { id: "document_app", label: "Documents", detail: String(workflows.filter((workflow) => workflowKinds[workflow.id] === "document_app").length) },
    { id: "builder_app", label: "Builder", detail: String(workflows.filter((workflow) => workflowKinds[workflow.id] === "builder_app").length) },
  ];
  const complexityFilters: Array<{ id: "all" | "basic" | "advanced" | "custom"; label: string; detail: string }> = [
    { id: "all", label: "All Levels", detail: String(workflows.length) },
    { id: "basic", label: "Basic", detail: String(workflows.filter((workflow) => getWorkflowComplexity(workflow) === "basic").length) },
    { id: "advanced", label: "Advanced", detail: String(workflows.filter((workflow) => getWorkflowComplexity(workflow) === "advanced").length) },
    { id: "custom", label: "Custom", detail: String(workflows.filter((workflow) => getWorkflowComplexity(workflow) === "custom").length) },
  ];

  function logoutLocalUser() {
    onLogout();
    setStatusMessage("Logged out locally.");
  }

  async function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceForm.name.trim()) return;
    try {
      const workspace = await createWorkspace({
        name: workspaceForm.name.trim(),
        description: workspaceForm.description.trim() || undefined,
        workflow_limit: workspaceForm.workflow_limit,
        monthly_run_limit: workspaceForm.monthly_run_limit,
        storage_limit_mb: workspaceForm.storage_limit_mb,
      });
      setWorkspaceForm({ name: "", description: "", workflow_limit: 100, monthly_run_limit: 1000, storage_limit_mb: 2048 });
      setWorkspaceMemberForm((current) => ({ ...current, workspace_id: workspace.id }));
      await refreshProductSurfaces();
      setStatusMessage(`Workspace "${workspace.name}" created.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not create workspace.");
    }
  }

  async function submitWorkspaceMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceMemberForm.workspace_id || !workspaceMemberForm.email.trim()) return;
    try {
      await addWorkspaceMember(workspaceMemberForm.workspace_id, {
        email: workspaceMemberForm.email.trim(),
        role: workspaceMemberForm.role,
      });
      setWorkspaceMemberForm((current) => ({ ...current, email: "" }));
      await refreshProductSurfaces();
      setStatusMessage("Workspace member saved.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save workspace member.");
    }
  }

  async function makeDefaultWorkspace(workspaceId: number) {
    try {
      const user = await setDefaultWorkspace(workspaceId);
      localStorage.setItem("vmb-local-user", JSON.stringify(user));
      setCurrentUser(user);
      await refreshProductSurfaces();
      setStatusMessage("Default workspace updated.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not set default workspace.");
    }
  }

  async function removeWorkspaceMember(workspaceId: number, membershipId: number) {
    try {
      await deleteWorkspaceMember(workspaceId, membershipId);
      await refreshProductSurfaces();
      setStatusMessage("Workspace member removed.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not remove workspace member.");
    }
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
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-3 lg:grid-cols-[292px_minmax(0,1fr)]">
        <aside className="relative overflow-hidden rounded-[2.4rem] border border-white/55 bg-white/18 p-2.5 text-white shadow-[0_30px_90px_rgba(7,16,15,0.24)] backdrop-blur-2xl">
          <div className="absolute inset-0 bg-[linear-gradient(155deg,_rgba(5,14,13,0.94)_0%,_rgba(14,35,32,0.90)_46%,_rgba(48,65,58,0.82)_100%)]" />
          <div className="absolute -left-20 top-10 h-44 w-44 rounded-full bg-lime/24 blur-3xl" />
          <div className="absolute -right-24 top-1/3 h-52 w-52 rounded-full bg-coral/16 blur-3xl" />
          <div className="absolute bottom-0 left-0 right-0 h-52 bg-[radial-gradient(circle_at_50%_100%,_rgba(255,255,255,0.14),_transparent_64%)]" />
          <div className="relative flex h-full gap-3 overflow-x-auto lg:flex-col lg:overflow-hidden">
            <div className="relative hidden overflow-hidden rounded-[2rem] border border-white/14 bg-white/[0.075] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-xl lg:block">
              <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-lime/24 blur-2xl" />
              <div className="absolute -bottom-14 left-8 h-28 w-28 rounded-full bg-coral/18 blur-2xl" />
              <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
              <div className="relative flex items-center gap-3">
                <div className="relative grid h-12 w-12 place-items-center rounded-[1.35rem] bg-lime text-sm font-black text-ink shadow-[0_18px_40px_rgba(182,255,135,0.24)]">
                  <span className="absolute inset-1 rounded-[1.05rem] border border-ink/10" />
                  <NavIcon name="spark" className="relative h-5 w-5" />
                </div>
                <div>
                  <p className="text-xl font-black tracking-tight">AI Studio</p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/42">Local command</p>
                </div>
              </div>
              <div className="relative mt-4 rounded-[1.35rem] border border-white/10 bg-black/10 px-3 py-2 text-[11px] font-semibold text-white/52">
                Local-first automation cockpit with workflows, files, RAG, publish, and audit in one place.
              </div>
              <div className="relative mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-[1.15rem] border border-white/10 bg-white/[0.075] px-3 py-2 backdrop-blur">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Flows</p>
                  <p className="mt-1 text-lg font-black">{workflows.length}</p>
                </div>
                <div className="rounded-[1.15rem] border border-white/10 bg-white/[0.075] px-3 py-2 backdrop-blur">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Runs</p>
                  <p className="mt-1 text-lg font-black">{usage?.totals.runs || 0}</p>
                </div>
                <div className="rounded-[1.15rem] bg-lime/90 px-3 py-2 text-ink shadow-[0_14px_34px_rgba(182,255,135,0.18)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-ink/45">Live</p>
                  <p className="mt-1 text-lg font-black">{publishedChatbots.length}</p>
                </div>
              </div>
            </div>

            <div className="flex min-w-max flex-1 gap-2 lg:min-w-0 lg:flex-col lg:overflow-y-auto lg:pr-1.5">
              {visibleNavGroups.map((group) => {
                const groupItems = visibleNavItems.filter((item) => item.group === group);
                if (!groupItems.length) return null;
                return (
                  <div key={group} className="flex gap-2 lg:block">
                    <p className="hidden px-3 pb-2 pt-3 text-[10px] font-black uppercase tracking-[0.28em] text-white/34 lg:flex lg:items-center lg:gap-2">
                      <span className="h-px flex-1 bg-white/10" />
                      <span>{group}</span>
                    </p>
                    <div className="flex gap-2 lg:grid lg:gap-1.5">
                      {groupItems.map((item) => {
                        const isActive = activeView === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setActiveView(item.id)}
                            className={`group relative min-w-44 overflow-hidden rounded-[1.45rem] p-2.5 text-left transition duration-200 lg:min-w-0 ${
                              isActive
                                ? "bg-white/92 text-ink shadow-[0_18px_45px_rgba(0,0,0,0.18)]"
                                : "bg-white/[0.065] text-white ring-1 ring-white/[0.075] backdrop-blur hover:bg-white/[0.12] hover:ring-white/20"
                            }`}
                          >
                            <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${isActive ? "bg-lime shadow-[0_0_18px_rgba(182,255,135,0.85)]" : "bg-white/10"}`} />
                            <span className={`absolute inset-0 bg-gradient-to-r ${isActive ? "from-lime/12 via-transparent to-coral/8" : "from-white/[0.035] via-transparent to-transparent"} opacity-90`} />
                            <span className="flex items-center gap-3 pl-1.5">
                              <span
                                className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-[1.1rem] bg-gradient-to-br ring-1 transition ${
                                  isActive ? `${item.tone} text-ink ring-ink/5 shadow-[0_12px_28px_rgba(7,16,15,0.12)]` : "from-white/14 to-white/5 text-white/66 ring-white/10 group-hover:text-white"
                                }`}
                              >
                                <NavIcon name={item.icon} className="h-4.5 w-4.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-black">{item.label}</span>
                                  {isActive ? <span className="h-2 w-2 rounded-full bg-lime shadow-[0_0_14px_rgba(182,255,135,0.85)]" /> : null}
                                </span>
                                <span className={`mt-0.5 block truncate text-[11px] font-semibold ${isActive ? "text-ink/52" : "text-white/36"}`}>
                                  {item.detail}
                                </span>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden rounded-[1.75rem] border border-white/12 bg-white/[0.075] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl lg:block">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/10 text-white ring-1 ring-white/10">
                    <NavIcon name="user" className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                  <p className="truncate text-sm font-black">{currentUser ? currentUser.display_name : "Local operator"}</p>
                  <p className="mt-0.5 text-xs font-semibold text-white/38">{currentUser ? currentUser.role : "Sign in to track ownership"}</p>
                  </div>
                </div>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${systemHealth ? "bg-lime shadow-[0_0_16px_rgba(182,255,135,0.8)]" : "bg-sand"}`} />
              </div>
              <button
                type="button"
                onClick={() => {
                  void refreshAll();
                }}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-[1.2rem] bg-lime px-3 py-3 text-xs font-black uppercase tracking-[0.18em] text-ink shadow-[0_16px_34px_rgba(182,255,135,0.18)] transition hover:brightness-95"
              >
                <NavIcon name="activity" className="h-4 w-4" />
                Sync Studio
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 overflow-hidden rounded-[2.2rem] border border-white/70 bg-white/52 shadow-[0_30px_90px_rgba(47,60,50,0.14)] backdrop-blur-2xl">
          <div className="mx-auto max-w-7xl p-4 lg:p-6">
            <header className="relative overflow-hidden rounded-[2.15rem] border border-white/72 bg-[linear-gradient(135deg,_rgba(8,16,24,0.96)_0%,_rgba(23,48,46,0.94)_58%,_rgba(49,65,59,0.88)_100%)] p-5 text-white shadow-[0_28px_80px_rgba(7,16,15,0.22)] backdrop-blur-2xl lg:flex lg:items-end lg:justify-between">
              <div className="absolute -left-16 -top-20 h-44 w-44 rounded-full bg-lime/24 blur-3xl" />
              <div className="absolute right-12 top-4 h-32 w-32 rounded-full bg-mist/20 blur-3xl" />
              <div className="absolute -bottom-16 right-1/3 h-36 w-36 rounded-full bg-coral/12 blur-3xl" />
              <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
              <div className="relative">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.24em] text-white/62 backdrop-blur">
                  <span className={`grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br ${activeNavItem.tone} text-ink`}>
                    <NavIcon name={activeNavItem.icon} className="h-3.5 w-3.5" />
                  </span>
                  AI Studio / {activeNavItem.label}
                </div>
                <h1 className="relative max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
                  {activeTitle[activeView]}
                </h1>
                <p className="relative mt-3 max-w-2xl text-sm leading-6 text-white/66">
                  {activeSubtitle[activeView]}
                </p>
                <div className="relative mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/72 backdrop-blur">
                    {statusMessage}
                  </span>
                  <span className="rounded-full border border-lime/20 bg-lime/18 px-3 py-1.5 text-xs font-bold text-lime backdrop-blur">
                    {currentUser ? `Owner: ${currentUser.display_name}` : "Login recommended"}
                  </span>
                  <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/78 backdrop-blur">
                    <span className="text-white/45">Workspace</span>
                    <select
                      value={activeWorkspaceId || ""}
                      onChange={(event) => selectActiveWorkspace(Number(event.target.value) || null)}
                      className="max-w-[190px] bg-transparent text-xs font-black text-white outline-none"
                      title="Current workspace"
                    >
                      {!workspaces.length ? <option value="">No workspace</option> : null}
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id} className="text-ink">
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="relative mt-5 flex flex-wrap gap-2 lg:mt-0 lg:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    void refreshAll();
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/12 backdrop-blur transition hover:bg-white/18"
                >
                  <NavIcon name="activity" className="h-4 w-4" />
                  Sync
                </button>
                <button
                  type="button"
                  onClick={onOpenFiles}
                  className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/12 backdrop-blur transition hover:bg-white/18"
                >
                  <NavIcon name="folder" className="h-4 w-4" />
                  Files
                </button>
              <button
                type="button"
                onClick={() => setActiveView("create")}
                className="inline-flex items-center gap-2 rounded-full bg-lime px-4 py-2 text-sm font-black text-ink shadow-[0_16px_34px_rgba(182,255,135,0.18)] transition hover:brightness-95"
              >
                <NavIcon name="spark" className="h-4 w-4" />
                Create
              </button>
              <button
                type="button"
                onClick={() => setIsImportDialogOpen(true)}
                className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/12 backdrop-blur transition hover:bg-white/18"
              >
                <NavIcon name="bundle" className="h-4 w-4" />
                Import
              </button>
              </div>
            </header>

        {activeView === "create" ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[0.8fr_1.2fr_0.9fr]">
            <div className="rounded-[2rem] border border-white/70 bg-ink p-5 text-white shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">Creation Wizard</p>
              <h2 className="mt-2 text-3xl font-bold">Start with intent</h2>
              <p className="mt-3 text-sm leading-6 text-white/62">
                Choose a blank builder canvas when you are designing from scratch, or clone a template when you want a tested file/RAG/chat pipeline immediately.
              </p>
              <label className="mt-5 block rounded-[1.35rem] bg-white/10 p-3 text-xs font-bold uppercase tracking-[0.18em] text-white/48 ring-1 ring-white/10">
                Create inside workspace
                <select
                  value={activeWorkspaceId || ""}
                  onChange={(event) => selectActiveWorkspace(Number(event.target.value) || null)}
                  className="mt-2 w-full rounded-2xl bg-white px-3 py-3 text-sm font-black normal-case tracking-normal text-ink outline-none"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.current_user_role || "viewer"}</option>
                  ))}
                </select>
                {!canCreateInWorkspace(activeWorkspace) ? (
                  <span className="mt-2 block text-[11px] normal-case leading-5 tracking-normal text-coral">
                    You need owner or editor access in this workspace to create workflows.
                  </span>
                ) : null}
              </label>
              <button
                type="button"
                onClick={guardedCreateWorkflow}
                disabled={!canCreateInWorkspace(activeWorkspace)}
                className="mt-5 w-full rounded-[1.4rem] bg-lime px-5 py-4 text-left text-sm font-bold text-ink transition hover:brightness-95"
              >
                Blank AI workflow
                <span className="mt-1 block text-xs font-semibold text-ink/55">Chat input, memory, chatbot, and output starter graph.</span>
              </button>
              <button
                type="button"
                onClick={() => setIsImportDialogOpen(true)}
                disabled={!canCreateInWorkspace(activeWorkspace)}
                className="mt-3 w-full rounded-[1.4rem] bg-white/12 px-5 py-4 text-left text-sm font-bold text-white ring-1 ring-white/10 transition hover:bg-white/16 disabled:opacity-45"
              >
                Import workflow bundle
                <span className="mt-1 block text-xs font-semibold text-white/50">Paste exported AI Studio JSON into {activeWorkspace?.name || "the active workspace"}.</span>
              </button>
              <div className="mt-4 grid gap-2">
                {guidedRecipes.map((recipe) => (
                  <button
                    key={recipe.name}
                    type="button"
                    onClick={() => void createGuidedWorkflow(recipe)}
                    className="rounded-[1.25rem] bg-white/10 px-4 py-3 text-left text-sm font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/15"
                  >
                    {recipe.name}
                    <span className="ml-2 rounded-full bg-lime/25 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-lime">
                      {recipe.badge}
                    </span>
                  </button>
                ))}
              </div>
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

          <div className="space-y-4">
            <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Observability</p>
              <h3 className="mt-2 text-xl font-bold text-ink">Health signals</h3>
              {observability ? (
                <div className="mt-4 grid gap-2">
                  {Object.entries(observability.metrics).slice(0, 8).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between rounded-2xl bg-mist/70 px-3 py-2 text-sm">
                      <span className="text-ink/58">{key.replace(/_/g, " ")}</span>
                      <span className="font-semibold text-ink">{String(value)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-2xl bg-mist/70 p-3 text-sm text-ink/55">No observability metrics yet.</p>
              )}
            </div>

            <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Audit Trail</p>
              <h3 className="mt-2 text-xl font-bold text-ink">Recent access and changes</h3>
              <div className="mt-4 space-y-2">
                {auditLogs.length ? auditLogs.map((event) => (
                  <div key={event.id} className="rounded-2xl bg-mist/70 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-ink">{event.action.replace(/_/g, " ")}</span>
                      <span className="text-[11px] text-ink/45">{new Date(event.created_at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink/55">
                      user {event.user_id ?? "local"} · {event.resource_type}{event.resource_id ? ` #${event.resource_id}` : ""}
                    </p>
                  </div>
                )) : (
                  <p className="rounded-2xl bg-mist/70 p-3 text-sm text-ink/55">No audit events recorded yet.</p>
                )}
              </div>
            </div>
          </div>

        </section>
        ) : null}

        {activeView === "runs" ? (
          <section className="mt-6 rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Run History</p>
                <h2 className="mt-2 text-2xl font-bold">Recent executions</h2>
                <p className="mt-1 text-sm text-ink/58">A cross-workflow view powered by each workflow's run history endpoint.</p>
              </div>
              <button
                type="button"
                onClick={() => void refreshRunHistory()}
                className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
              >
                Refresh Runs
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              {recentRuns.map((run) => {
                const workflow = workflows.find((item) => item.id === run.workflow_id);
                return (
                  <article key={`${run.workflow_id}-${run.id}`} className="rounded-[1.45rem] bg-white p-4 ring-1 ring-ink/6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ink/42">
                          Run #{run.id} · workflow #{run.workflow_id}
                        </p>
                        <h3 className="mt-1 truncate text-lg font-semibold text-ink">{workflow?.name || "Workflow"}</h3>
                        <p className="mt-1 text-sm text-ink/55">
                          {run.trigger_mode || "manual"} · {run.node_runs?.length || 0} node(s) · owner {run.owner_user_id ?? "local"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${run.status === "completed" ? "bg-lime/35 text-ink" : run.status === "failed" ? "bg-coral/20 text-ink" : "bg-sand/70 text-ink"}`}>
                          {run.status}
                        </span>
                        <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-ink/55">
                          {run.latency_ms ? `${run.latency_ms}ms` : "pending"}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            window.history.pushState({}, "", `/runs/${run.workflow_id}/${run.id}`);
                            window.dispatchEvent(new Event("vmb:navigate"));
                          }}
                          className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                        >
                          Open Run
                        </button>
                      </div>
                    </div>
                    {run.error_message ? (
                      <p className="mt-3 rounded-2xl bg-coral/12 px-4 py-3 text-sm leading-6 text-ink">{run.error_message}</p>
                    ) : null}
                    <p className="mt-3 text-xs text-ink/48">
                      Started {run.started_at ? new Date(run.started_at).toLocaleString() : "unknown"} · session {run.session_id || "n/a"}
                    </p>
                  </article>
                );
              })}
              {!recentRuns.length ? (
                <p className="rounded-[1.5rem] border border-dashed border-ink/15 bg-mist/70 p-5 text-sm leading-6 text-ink/58">
                  No runs found yet. Run a workflow from Builder or App Preview and this tab will show the execution history.
                </p>
              ) : null}
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
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {templates.slice(0, 9).map((template) => {
                const product = getTemplateProduct(template);
                return (
                  <article
                    key={template.id}
                    className="rounded-[1.6rem] border border-ink/8 bg-[linear-gradient(180deg,_#ffffff,_#fbfcf8)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className={`rounded-[1.25rem] ${product.tone} p-4`}>
                      <p className="text-xs font-semibold uppercase tracking-[0.26em] text-ink/45">Template</p>
                      <h3 className="mt-2 text-xl font-bold text-ink">{product.title}</h3>
                      <p className="mt-2 text-sm font-semibold text-ink/62">{product.tag}</p>
                    </div>
                    <p className="mt-4 text-sm font-semibold text-ink">{template.name.replace("Advanced: ", "")}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <span className="rounded-xl bg-mist/70 px-3 py-2">{template.run_count} runs</span>
                      <span className="rounded-xl bg-mist/70 px-3 py-2">{template.rag_chunk_count} chunks</span>
                      <span className="rounded-xl bg-mist/70 px-3 py-2">{template.quality_score}% quality</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void createFromTemplate(template.id)}
                      className="mt-4 w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white"
                    >
                      Create Workspace
                    </button>
                  </article>
                );
              })}
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
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {publishedChatbots.map((workflow) => (
                <div key={workflow.id} className="rounded-[1.5rem] bg-white p-4 ring-1 ring-ink/6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ink/42">Published Chatbot</p>
                      <p className="truncate text-sm font-semibold">{workflow.name}</p>
                      <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-ink/42">
                        {workflow.published_visibility || "public"} · {workflow.effective_role || "Access"}
                      </p>
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
                  <pre className="mt-3 overflow-auto rounded-2xl bg-ink p-3 text-[11px] text-white/75">
                    {`<iframe src="${workflow.published_slug ? getChatUrl(workflow.published_slug) : ""}" style="width:100%;height:640px;border:0;border-radius:24px;"></iframe>`}
                  </pre>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <span className="rounded-xl bg-mist/70 px-3 py-2">{workflow.current_version ? `v${workflow.current_version}` : "draft"}</span>
                    <span className="rounded-xl bg-mist/70 px-3 py-2">{workflow.run_count} runs</span>
                    <span className="rounded-xl bg-mist/70 px-3 py-2">{workflow.quality_score}% quality</span>
                  </div>
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
                    <button
                      type="button"
                      onClick={() => workflow.published_slug && void copyText(`<iframe src="${getChatUrl(workflow.published_slug)}" style="width:100%;height:640px;border:0;border-radius:24px;"></iframe>`)}
                      className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Copy Embed
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenWorkflowApp(workflow.id)}
                      className="rounded-full bg-lime/35 px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      App Preview
                    </button>
                    <select
                      value={publishVisibility[workflow.id] || workflow.published_visibility || "public"}
                      onChange={(event) => setPublishVisibility((current) => ({ ...current, [workflow.id]: event.target.value }))}
                      className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-ink/10"
                      title="Publish visibility"
                    >
                      <option value="public">Public local link</option>
                      <option value="workspace_only">Workspace-only</option>
                      <option value="token_protected">Token protected</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void publishAndOpen(workflow.id)}
                      className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Update Visibility
                    </button>
                    <button
                      type="button"
                      onClick={() => void regenerateToken(workflow.id)}
                      className="rounded-full bg-sand/70 px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Regenerate Token
                    </button>
                  </div>
                </div>
              ))}
              {workflows.filter((workflow) => !workflow.is_published && canPublishAsChat(workflowKinds[workflow.id])).slice(0, 4).map((workflow) => (
                <div key={`candidate-${workflow.id}`} className="rounded-[1.5rem] border border-dashed border-ink/15 bg-mist/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ink/42">Ready To Publish</p>
                  <h3 className="mt-2 text-lg font-semibold">{workflow.name}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink/58">This chat workflow has the right output shape. Publish it to create a chatbot link, API endpoint, and embed snippet.</p>
                  <button type="button" onClick={() => void publishAndOpen(workflow.id)} className="mt-4 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
                    Publish Chatbot
                  </button>
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

        {activeView === "files" ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="rounded-[2rem] border border-white/70 bg-ink p-5 text-white shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">File Library</p>
              <h2 className="mt-2 text-3xl font-bold">Upload once, reuse anywhere</h2>
              <p className="mt-3 text-sm leading-6 text-white/62">
                Add local documents here before building. Builder and workflow run file inputs can select these records directly without asking again.
              </p>
              <label className="mt-5 block rounded-[1.5rem] border border-dashed border-white/20 bg-white/8 p-4 text-sm font-semibold">
                Upload Documents
                <span className="mt-1 block text-xs font-normal leading-5 text-white/50">
                  PDF, DOCX, TXT, CSV, JSON. Stored locally under your configured storage folder.
                </span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.csv,.json"
                  disabled={isFileUploading}
                  onChange={(event) => {
                    void uploadMainPageFiles(event.target.files);
                    event.target.value = "";
                  }}
                  className="mt-3 w-full text-xs text-white/70 file:mr-3 file:rounded-full file:border-0 file:bg-lime file:px-3 file:py-2 file:text-xs file:font-bold file:text-ink disabled:opacity-50"
                />
              </label>
              <button type="button" onClick={onOpenFiles} className="mt-3 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white">
                Open Detailed File Library
              </button>
            </aside>

            <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Reusable Documents</p>
                  <h2 className="mt-2 text-2xl font-bold">Files available to workflows</h2>
                  <p className="mt-1 text-sm text-ink/58">Use the Builder inspector's Inputs tab or an App Run file input to pick these files.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void listFiles().then(setFileLibrary)}
                  className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                >
                  Refresh Files
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {fileLibrary.map((file) => (
                  <article key={file.id} className="rounded-[1.45rem] bg-white p-4 ring-1 ring-ink/6">
                    <p className="truncate text-sm font-semibold text-ink">{file.original_name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ink/45">
                      {file.extension} · {(file.size_bytes / 1024).toFixed(1)} KB
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink/60">
                      <span className="rounded-xl bg-mist/70 px-3 py-2">{file.workflow_id ? `workflow #${file.workflow_id}` : "global file"}</span>
                      <span className="rounded-xl bg-mist/70 px-3 py-2">{file.knowledge_document_count} docs</span>
                    </div>
                    <p className="mt-3 break-all rounded-2xl bg-mist/55 px-3 py-2 text-[11px] leading-5 text-ink/50">
                      {file.storage_path}
                    </p>
                  </article>
                ))}
                {!fileLibrary.length ? (
                  <p className="rounded-[1.5rem] border border-dashed border-ink/15 bg-mist/70 p-5 text-sm leading-6 text-ink/58">
                    No files yet. Upload documents here, then open a workflow with a File Upload block and choose them from the File Library picker.
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {activeView === "components" ? (
          <section className="mt-6 rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Reusable Components</p>
                <h2 className="mt-2 text-2xl font-bold">Saved subflows</h2>
                <p className="mt-1 text-sm text-ink/58">Components are saved from a workflow's Activity panel and can become reusable block groups.</p>
              </div>
              <button
                type="button"
                onClick={() => void listSubflows().then(setAllSubflows)}
                className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
              >
                Refresh Components
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {allSubflows.map((subflow) => {
                const workflow = workflows.find((item) => item.id === subflow.workflow_id);
                const nodeCount = subflow.graph_json?.nodes?.length || 0;
                const edgeCount = subflow.graph_json?.edges?.length || 0;
                return (
                  <article key={subflow.id} className="rounded-[1.55rem] bg-white p-4 ring-1 ring-ink/6">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ink/42">Component #{subflow.id}</p>
                    <h3 className="mt-2 text-lg font-semibold text-ink">{subflow.name}</h3>
                    <p className="mt-2 text-sm leading-6 text-ink/58">
                      {subflow.description || "Reusable graph component saved from workflow activity."}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-ink/60">
                      <span className="rounded-xl bg-mist/70 px-3 py-2">{nodeCount} nodes</span>
                      <span className="rounded-xl bg-mist/70 px-3 py-2">{edgeCount} edges</span>
                      <span className="rounded-xl bg-mist/70 px-3 py-2">{workflow?.name ? "linked" : "global"}</span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {subflow.workflow_id ? (
                        <button type="button" onClick={() => onOpenWorkflow(subflow.workflow_id)} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
                          Open Source Workflow
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void copyText(JSON.stringify(subflow.graph_json || {}, null, 2))}
                        className="rounded-full bg-mist px-4 py-2 text-sm font-semibold text-ink"
                      >
                        Copy Graph JSON
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-ink/45">{new Date(subflow.created_at).toLocaleString()}</p>
                  </article>
                );
              })}
              {!allSubflows.length ? (
                <p className="rounded-[1.5rem] border border-dashed border-ink/15 bg-mist/70 p-5 text-sm leading-6 text-ink/58">
                  No components saved yet. Open a workflow card, choose Activity, and save the workflow as a reusable component.
                </p>
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
            <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Workspaces</p>
                  <h2 className="mt-2 text-2xl font-bold">Tenant control</h2>
                  <p className="mt-1 text-sm text-ink/58">Group workflows, members, and quotas before this grows into teams or SaaS billing.</p>
                </div>
                <span className="rounded-full bg-lime/30 px-3 py-1 text-xs font-bold text-ink">{workspaces.length} active</span>
              </div>
              <div className="mt-4 grid gap-3">
                {workspaces.map((workspace) => {
                  const storageMb = Math.round((workspace.usage.storage_bytes / 1024 / 1024) * 10) / 10;
                  return (
                    <article key={workspace.id} className="rounded-[1.4rem] bg-mist/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-ink">{workspace.name}</p>
                          <p className="mt-1 text-xs text-ink/55">
                            {workspace.slug} · your role: {workspace.current_user_role || "viewer"}
                            {currentUser?.default_workspace_id === workspace.id ? " · default" : ""}
                          </p>
                      </div>
                        <div className="flex flex-wrap gap-2">
                          {currentUser?.default_workspace_id !== workspace.id ? (
                            <button type="button" onClick={() => void makeDefaultWorkspace(workspace.id)} className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-ink">
                              Set default
                            </button>
                          ) : null}
                          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-ink">{workspace.usage.member_count} member(s)</span>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <InfoCard title="Workflows" body={`${workspace.usage.workflow_count}/${workspace.workflow_limit}`} />
                        <InfoCard title="Runs 30d" body={`${workspace.usage.runs_last_30d}/${workspace.monthly_run_limit}`} />
                        <InfoCard title="Storage" body={`${storageMb}MB/${workspace.storage_limit_mb}MB`} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {workspace.members.slice(0, 8).map((member) => (
                          <span key={member.id} className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-ink/68">
                            {member.display_name} · {member.role}
                            {isAdmin || workspace.current_user_role === "owner" ? (
                              <button
                                type="button"
                                onClick={() => void removeWorkspaceMember(workspace.id, member.id)}
                                className="rounded-full bg-ink/8 px-1.5 text-[10px] font-black text-ink/55 hover:bg-coral/20"
                                aria-label={`Remove ${member.display_name}`}
                              >
                                x
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
                {!workspaces.length ? (
                  <p className="rounded-[1.4rem] bg-mist/70 p-4 text-sm text-ink/58">No workspace membership found yet.</p>
                ) : null}
              </div>
              {isAdmin ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <form onSubmit={submitWorkspace} className="rounded-[1.4rem] bg-ink p-4 text-white">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-white/42">Admin</p>
                    <h3 className="mt-1 font-black">Create workspace</h3>
                    <input value={workspaceForm.name} onChange={(event) => setWorkspaceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Workspace name" className="mt-3 w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                    <input value={workspaceForm.description} onChange={(event) => setWorkspaceForm((current) => ({ ...current, description: event.target.value }))} placeholder="Description" className="mt-2 w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <input value={workspaceForm.workflow_limit} onChange={(event) => setWorkspaceForm((current) => ({ ...current, workflow_limit: Number(event.target.value) || 1 }))} type="number" min={1} title="Workflow limit" className="w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                      <input value={workspaceForm.monthly_run_limit} onChange={(event) => setWorkspaceForm((current) => ({ ...current, monthly_run_limit: Number(event.target.value) || 1 }))} type="number" min={1} title="Monthly run limit" className="w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                      <input value={workspaceForm.storage_limit_mb} onChange={(event) => setWorkspaceForm((current) => ({ ...current, storage_limit_mb: Number(event.target.value) || 1 }))} type="number" min={1} title="Storage limit MB" className="w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                    </div>
                    <p className="mt-1 text-[10px] font-semibold text-white/45">workflows · monthly runs · storage MB</p>
                    <button type="submit" className="mt-3 rounded-full bg-lime px-4 py-2 text-sm font-black text-ink">Create</button>
                  </form>
                  <form onSubmit={submitWorkspaceMember} className="rounded-[1.4rem] bg-mist/70 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-ink/42">Members</p>
                    <h3 className="mt-1 font-black text-ink">Invite local user</h3>
                    <select value={workspaceMemberForm.workspace_id} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, workspace_id: Number(event.target.value) }))} className="mt-3 w-full rounded-2xl bg-white px-3 py-2 text-sm outline-none">
                      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                    </select>
                    <input value={workspaceMemberForm.email} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, email: event.target.value }))} placeholder="user@email.com" className="mt-2 w-full rounded-2xl bg-white px-3 py-2 text-sm outline-none" />
                    <select value={workspaceMemberForm.role} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, role: event.target.value }))} className="mt-2 w-full rounded-2xl bg-white px-3 py-2 text-sm outline-none">
                      {["member", "runner", "editor", "owner"].map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                    <button type="submit" className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-black text-white">Save member</button>
                  </form>
                </div>
              ) : null}
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
        <section className="mt-6 rounded-[2.2rem] border border-white/70 bg-white/76 p-4 shadow-[0_28px_80px_rgba(47,60,50,0.14)] backdrop-blur-2xl lg:p-5">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-ink/42">Workflow Catalog</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight">Apps from basic to advanced</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/62">Browse ready-to-run workflows by app type and complexity. Chat-safe workflows launch as chatbots; file and dashboard workflows launch as app URLs.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search workflows, status, slug..."
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-3 text-sm outline-none sm:w-80"
              />
              <span className="rounded-full bg-mist px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-ink/55">
                {filteredWorkflows.length}/{workflows.length} shown
              </span>
              <div className="flex rounded-full bg-mist p-1">
                {(["compact", "rich"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setWorkflowDensity(mode)}
                    className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] ${
                      workflowDensity === mode ? "bg-ink text-white" : "text-ink/52"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowArchived((current) => !current)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${showArchived ? "bg-ink text-white" : "bg-mist text-ink/55"}`}
              >
                {showArchived ? "Hide Archived" : "Show Archived"}
              </button>
            </div>
          </div>

          <div className="mb-3 flex gap-2 overflow-x-auto rounded-[1.45rem] border border-white/70 bg-white/72 p-2 shadow-sm backdrop-blur">
            {complexityFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setComplexityFilter(item.id)}
                className={`min-w-max rounded-[1.1rem] px-4 py-2.5 text-left transition ${
                  complexityFilter === item.id ? "bg-lime text-ink shadow-lg shadow-lime/10" : "bg-white/70 text-ink ring-1 ring-ink/6 hover:bg-lime/20"
                }`}
              >
                <span className="block text-sm font-black">{item.label}</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-ink/45">{item.detail} workflow(s)</span>
              </button>
            ))}
          </div>

          <div className="mb-5 flex gap-2 overflow-x-auto rounded-[1.45rem] border border-white/70 bg-white/72 p-2 shadow-sm backdrop-blur">
            {appTypeFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAppTypeFilter(item.id)}
                className={`min-w-max rounded-[1.1rem] px-4 py-3 text-left transition ${
                  appTypeFilter === item.id ? "bg-ink text-white shadow-lg shadow-ink/10" : "bg-white/70 text-ink ring-1 ring-ink/6 hover:bg-lime/20"
                }`}
              >
                <span className="block text-sm font-black">{item.label}</span>
                <span className={`mt-0.5 block text-[11px] font-semibold ${appTypeFilter === item.id ? "text-white/52" : "text-ink/45"}`}>
                  {item.detail} workflow(s)
                </span>
              </button>
            ))}
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <WorkflowStatCard label="Total Workflows" value={workflows.length} detail={`${filteredWorkflows.length} visible`} />
            <WorkflowStatCard label="Runs" value={usage?.totals.runs || 0} detail={`${usage?.totals.failed_runs || 0} failed`} />
            <WorkflowStatCard label="RAG Chunks" value={globalKnowledge.reduce((total, item) => total + item.chunk_count, 0)} detail={`${globalKnowledge.length} collections`} />
            <WorkflowStatCard label="Audit Events" value={auditLogs.length} detail="recent activity" />
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="rounded-[1.5rem] bg-white p-4 ring-1 ring-ink/6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-ink/42">Studio Overview</p>
                  <h3 className="mt-1 text-lg font-semibold text-ink">What needs attention</h3>
                </div>
                <button type="button" onClick={() => setActiveView("usage")} className="rounded-full bg-mist px-3 py-2 text-xs font-semibold text-ink">
                  Full Dashboard
                </button>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <AttentionCard
                  title="Quality"
                  body={`${workflows.filter((workflow) => workflow.quality_score < 70).length} workflow(s) below 70% quality`}
                  tone="bg-sand/45"
                />
                <AttentionCard
                  title="RAG"
                  body={`${workflows.filter((workflow) => workflow.workflow_type === "rag" && workflow.rag_chunk_count === 0).length} RAG workflow(s) need ingest`}
                  tone="bg-lime/20"
                />
                <AttentionCard
                  title="Publishing"
                  body={`${workflows.filter((workflow) => canPublishAsChat(workflowKinds[workflow.id]) && !workflow.is_published).length} chat workflow(s) ready to publish`}
                  tone="bg-mist/80"
                />
              </div>
            </div>

            <div className="rounded-[1.5rem] bg-ink p-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/42">Audit</p>
                  <h3 className="mt-1 text-lg font-semibold">Recent activity</h3>
                </div>
                <button type="button" onClick={() => void refreshUsage()} className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white">
                  Refresh
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {auditLogs.slice(0, 5).map((event) => (
                  <AuditEventCard key={event.id} event={event} />
                ))}
                {!auditLogs.length ? (
                  <p className="rounded-2xl bg-white/8 px-3 py-3 text-sm leading-6 text-white/58">
                    No audit events yet. Create, run, update, preview files, or test RAG to populate activity here.
                  </p>
                ) : null}
              </div>
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
            <div className={`grid gap-4 ${workflowDensity === "compact" ? "xl:grid-cols-2" : "xl:grid-cols-3"}`}>
              {filteredWorkflows.map((workflow) => (
                <article
                  key={workflow.id}
                  className={`group overflow-hidden border border-ink/8 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel ${workflowDensity === "compact" ? "rounded-[1.45rem]" : "rounded-[1.8rem]"}`}
                >
                  <div className={`bg-[radial-gradient(circle_at_top_left,_rgba(182,255,135,0.34),_transparent_36%),linear-gradient(135deg,_#ffffff,_#f8f4e8)] ${workflowDensity === "compact" ? "p-3" : "p-4"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-mist px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-ink/45">#{workflow.id}</span>
                        <span className="rounded-full bg-white/86 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-ink/50 ring-1 ring-ink/6">
                          {(workflowProfiles[workflow.id] || defaultWorkflowAppProfile(workflowKinds[workflow.id] || "builder_app")).label}
                        </span>
                        <span
                          title={workflow.effective_role_source ? `Access from ${workflow.effective_role_source.replace("_", " ")}` : "Access role"}
                          className="rounded-full bg-ink px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white"
                        >
                          {workflow.effective_role || "No role"}
                        </span>
                        {workflow.workspace_name ? (
                          <span className="rounded-full bg-lime/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-ink/55">
                            {workflow.workspace_name}
                          </span>
                        ) : null}
                      </div>
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
                          className="mt-3 line-clamp-2 block text-left text-lg font-black leading-6 transition hover:text-ink/70"
                          title="Click to rename"
                        >
                          {workflow.name}
                        </button>
                      )}
                      <p className="mt-2 line-clamp-2 text-sm leading-5 text-ink/58">
                        {workflow.description || "No description yet."}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                        workflow.is_published ? "bg-lime/40 text-ink" : "bg-mist text-ink/60"
                      }`}
                    >
                      {workflow.is_published ? `Live · ${workflow.published_visibility || "public"}` : workflow.status}
                    </span>
                  </div>

                  <div className={`mt-4 flex flex-wrap items-center gap-3 text-xs font-semibold text-ink/58 ${workflowDensity === "compact" ? "hidden sm:flex" : ""}`}>
                    <span>v{workflow.current_version || 1}</span>
                    <span>{workflow.run_count} run{workflow.run_count === 1 ? "" : "s"}</span>
                    <span>{workflow.quality_score}% quality</span>
                    {workflow.rag_chunk_count ? <span>{workflow.rag_chunk_count} chunks</span> : null}
                  </div>
                  </div>

                  <div className={workflowDensity === "compact" ? "p-3" : "p-4"}>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => launchWorkflow(workflow)}
                      className="rounded-full bg-lime px-4 py-2 text-sm font-bold text-ink"
                    >
                      {getPrimaryLaunchLabel(workflow)}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenWorkflow(workflow.id)}
                      disabled={!workflowCanEdit(workflow)}
                      title={workflowCanEdit(workflow) ? "Open builder" : "You can view/run this workflow, but editing requires editor or owner access."}
                      className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Open Builder
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
                      onClick={() => void openVersions(workflow.id)}
                      className="rounded-full border border-ink/10 bg-sand/65 px-4 py-2 text-sm font-bold text-ink"
                    >
                      Versions
                    </button>
                  </div>

                  {workflowDensity === "rich" ? (
                  <details className="mt-3 rounded-[1.25rem] bg-mist/45 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.2em] text-ink/48">
                      More actions
                    </summary>
                    <div className="mt-3 space-y-2">
                      {workflow.last_run_preview ? (
                        <p className="rounded-2xl bg-white px-3 py-2 text-xs leading-5 text-ink/58 ring-1 ring-ink/6">{workflow.last_run_preview}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => onOpenWorkflowApp(workflow.id)} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink">App URL</button>
                        <button type="button" onClick={() => publishAndOpen(workflow.id)} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink">{canPublishAsChat(workflowKinds[workflow.id]) ? "Publish Chat" : "Open App"}</button>
                        <button type="button" onClick={() => void testRagHealth(workflow)} disabled={workflow.rag_chunk_count === 0} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-45">Test RAG</button>
                        <button type="button" onClick={() => void lifecycleAction("duplicate", workflow)} disabled={!canCreateInWorkspace(activeWorkspace)} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-45">Duplicate</button>
                    {workflow.last_run_id ? (
                      <button
                        type="button"
                        onClick={() => {
                          window.history.pushState({}, "", `/runs/${workflow.id}/${workflow.last_run_id}`);
                          window.dispatchEvent(new Event("vmb:navigate"));
                        }}
                            className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink"
                      >
                        Latest Run
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void openPermissions(workflow)}
                            className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Permissions
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCollaboration(workflow)}
                            className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Activity
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadBundle(workflow)}
                            className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Export
                    </button>
                    {workflow.archived_at ? (
                      <button
                        type="button"
                        onClick={() => void lifecycleAction("restore", workflow)}
                              className="rounded-full bg-lime/30 px-3 py-1.5 text-xs font-semibold text-ink"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void lifecycleAction("archive", workflow)}
                              className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink"
                      >
                        Archive
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void lifecycleAction("delete", workflow)}
                          className="rounded-full bg-coral/15 px-3 py-1.5 text-xs font-semibold text-ink"
                    >
                      Delete
                    </button>
                      </div>
                    </div>
                  </details>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-ink/6 pt-3">
                      {workflow.last_run_id ? (
                        <button
                          type="button"
                          onClick={() => {
                            window.history.pushState({}, "", `/runs/${workflow.id}/${workflow.last_run_id}`);
                            window.dispatchEvent(new Event("vmb:navigate"));
                          }}
                          className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink"
                        >
                          Latest Run
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void openPermissions(workflow)} className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink">Permissions</button>
                      <button type="button" onClick={() => void openCollaboration(workflow)} className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink">Activity</button>
                      <button type="button" onClick={() => void lifecycleAction("duplicate", workflow)} disabled={!canCreateInWorkspace(activeWorkspace)} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-ink/8 disabled:opacity-45">Duplicate</button>
                    </div>
                  )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        ) : null}

        {activeView === "workspaces" ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Workspace Control</p>
                  <h2 className="mt-2 text-2xl font-bold">Teams, quotas, and access</h2>
                  <p className="mt-1 text-sm text-ink/58">Choose your active workspace and manage members without digging through account settings.</p>
                </div>
                <span className="rounded-full bg-lime/30 px-3 py-1 text-xs font-bold text-ink">
                  Active: {activeWorkspace?.name || "None"}
                </span>
              </div>

              <div className="mt-5 grid gap-4">
                {workspaces.map((workspace) => {
                  const storageMb = Math.round((workspace.usage.storage_bytes / 1024 / 1024) * 10) / 10;
                  const canManageWorkspace = isAdmin || workspace.current_user_role === "owner";
                  const workspaceWorkflows = workflows.filter((workflow) => workflow.workspace_id === workspace.id);
                  return (
                    <article key={workspace.id} className={`rounded-[1.6rem] p-4 ring-1 ${activeWorkspaceId === workspace.id ? "bg-lime/18 ring-lime/35" : "bg-mist/65 ring-ink/5"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-black text-ink">{workspace.name}</p>
                          <p className="mt-1 text-xs font-semibold text-ink/52">
                            {workspace.slug} · role: {workspace.current_user_role || "viewer"}
                            {currentUser?.default_workspace_id === workspace.id ? " · default" : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => selectActiveWorkspace(workspace.id)} className="rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-white">
                            Use workspace
                          </button>
                          {currentUser?.default_workspace_id !== workspace.id ? (
                            <button type="button" onClick={() => void makeDefaultWorkspace(workspace.id)} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-ink ring-1 ring-ink/6">
                              Set default
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-4">
                        <span className={`rounded-2xl px-3 py-2 text-xs font-bold ring-1 ${quotaClass(workspace.usage.workflow_count, workspace.workflow_limit)}`}>
                          Workflows {workspace.usage.workflow_count}/{workspace.workflow_limit}
                        </span>
                        <span className={`rounded-2xl px-3 py-2 text-xs font-bold ring-1 ${quotaClass(workspace.usage.runs_last_30d, workspace.monthly_run_limit)}`}>
                          Runs 30d {workspace.usage.runs_last_30d}/{workspace.monthly_run_limit}
                        </span>
                        <span className={`rounded-2xl px-3 py-2 text-xs font-bold ring-1 ${quotaClass(storageMb, workspace.storage_limit_mb)}`}>
                          Storage {storageMb}MB/{workspace.storage_limit_mb}MB
                        </span>
                        <span className="rounded-2xl bg-white px-3 py-2 text-xs font-bold text-ink/62 ring-1 ring-ink/6">
                          {workspace.usage.member_count} member(s)
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-[1.3rem] bg-white p-3 ring-1 ring-ink/6">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-ink/42">Members</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {workspace.members.map((member) => (
                              <span key={member.id} className="inline-flex items-center gap-2 rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink">
                                {member.display_name}
                                <span className="text-ink/45">{member.role}</span>
                                {canManageWorkspace ? (
                                  <button type="button" onClick={() => void removeWorkspaceMember(workspace.id, member.id)} className="text-coral">Remove</button>
                                ) : null}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-[1.3rem] bg-white p-3 ring-1 ring-ink/6">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-ink/42">Workflow access</p>
                          <div className="mt-2 space-y-2">
                            {workspaceWorkflows.slice(0, 5).map((workflow) => (
                              <button key={workflow.id} type="button" onClick={() => onOpenWorkflow(workflow.id)} className="flex w-full items-center justify-between gap-2 rounded-2xl bg-mist/70 px-3 py-2 text-left text-xs font-semibold text-ink">
                                <span className="truncate">{workflow.name}</span>
                                <span className="shrink-0 text-ink/45">{workflow.effective_role || "viewer"}</span>
                              </button>
                            ))}
                            {!workspaceWorkflows.length ? <p className="text-xs text-ink/50">No workflows in this workspace yet.</p> : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <aside className="space-y-4">
              {(isAdmin || activeWorkspace?.current_user_role === "owner") ? (
                <div className="rounded-[2rem] bg-ink p-5 text-white shadow-panel">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/45">Member Controls</p>
                  {isAdmin ? (
                    <form onSubmit={submitWorkspace} className="mt-4 rounded-[1.4rem] bg-white/8 p-3">
                      <h3 className="font-black">Create workspace</h3>
                      <input value={workspaceForm.name} onChange={(event) => setWorkspaceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Claims Team" className="mt-3 w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                      <input value={workspaceForm.description} onChange={(event) => setWorkspaceForm((current) => ({ ...current, description: event.target.value }))} placeholder="Description" className="mt-2 w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                      <button type="submit" className="mt-3 w-full rounded-full bg-lime px-4 py-2 text-sm font-black text-ink">Create Workspace</button>
                    </form>
                  ) : null}
                  <form onSubmit={submitWorkspaceMember} className="mt-4 rounded-[1.4rem] bg-white/8 p-3">
                    <h3 className="font-black">Add / update member</h3>
                    <select value={workspaceMemberForm.workspace_id || activeWorkspaceId || ""} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, workspace_id: Number(event.target.value) }))} className="mt-3 w-full rounded-2xl bg-white px-3 py-2 text-sm text-ink outline-none">
                      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                    </select>
                    <input value={workspaceMemberForm.email} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, email: event.target.value }))} placeholder="user@email.com" className="mt-2 w-full rounded-2xl bg-white px-3 py-2 text-sm text-ink outline-none" />
                    <select value={workspaceMemberForm.role} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, role: event.target.value }))} className="mt-2 w-full rounded-2xl bg-white px-3 py-2 text-sm text-ink outline-none">
                      <option value="viewer">viewer</option>
                      <option value="runner">runner</option>
                      <option value="editor">editor</option>
                      <option value="owner">owner</option>
                    </select>
                    <button type="submit" className="mt-3 w-full rounded-full bg-white px-4 py-2 text-sm font-black text-ink">Save Member</button>
                  </form>
                </div>
              ) : null}

              <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Audit Log</p>
                    <h3 className="mt-1 font-black">Workspace activity</h3>
                  </div>
                  <button type="button" onClick={() => void refreshWorkspaceAudit()} className="rounded-full bg-mist px-3 py-1.5 text-xs font-bold text-ink">Refresh</button>
                </div>
                <div className="mt-3 space-y-2">
                  {workspaceAuditLogs.slice(0, 12).map((event) => (
                    <div key={event.id} className="rounded-2xl bg-mist/70 px-3 py-2 text-xs text-ink/62">
                      <p className="font-black text-ink">{event.action}</p>
                      <p className="mt-1">{new Date(event.created_at).toLocaleString()} · actor #{event.actor_user_id || "system"}</p>
                    </div>
                  ))}
                  {!workspaceAuditLogs.length ? <p className="rounded-2xl bg-mist/70 px-3 py-3 text-sm text-ink/55">No workspace audit events yet.</p> : null}
                </div>
              </div>
            </aside>
          </section>
        ) : null}

        {activeView === "adminUsers" && isAdmin ? (
          <section className="mt-6 rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Admin Users</p>
                <h2 className="mt-2 text-2xl font-bold">Local user management</h2>
                <p className="mt-1 text-sm text-ink/58">Promote admins, deactivate users, and assign default workspaces with audit trails.</p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void refreshAdminUsers(adminUserSearch);
                }}
                className="flex rounded-full bg-mist p-1"
              >
                <input value={adminUserSearch} onChange={(event) => setAdminUserSearch(event.target.value)} placeholder="Search users" className="w-44 bg-transparent px-3 text-sm outline-none" />
                <button type="submit" className="rounded-full bg-ink px-4 py-2 text-xs font-bold text-white">Search</button>
              </form>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {adminUsers.map((user) => (
                <article key={user.id} className="rounded-[1.45rem] bg-mist/70 p-4 ring-1 ring-ink/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-ink">{user.display_name}</p>
                      <p className="mt-1 truncate text-xs text-ink/52">{user.email}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${user.is_active ? "bg-lime/35 text-ink" : "bg-coral/15 text-ink"}`}>
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <select value={user.role} onChange={(event) => void updateUserAsAdmin(user, { role: event.target.value as "admin" | "user" })} className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold outline-none">
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                    <select value={user.default_workspace_id || ""} onChange={(event) => void updateUserAsAdmin(user, { default_workspace_id: Number(event.target.value) })} className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold outline-none">
                      <option value="">No default workspace</option>
                      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`${user.is_active ? "Deactivate" : "Reactivate"} ${user.display_name}?`)) {
                        void updateUserAsAdmin(user, { is_active: !user.is_active });
                      }
                    }}
                    className="mt-3 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-ink ring-1 ring-ink/6"
                  >
                    {user.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </article>
              ))}
              {!adminUsers.length ? <p className="rounded-[1.45rem] bg-mist/70 p-4 text-sm text-ink/58">No users loaded. Try refresh or adjust search.</p> : null}
            </div>
          </section>
        ) : null}

        {activeView === "account" ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[0.8fr_1.25fr_0.85fr]">
            <div className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">
                Local Users
              </p>
              <h2 className="mt-2 text-2xl font-bold">Profile & access</h2>
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
                <div className="mt-4 rounded-[1.5rem] bg-mist/70 p-4">
                  <p className="text-sm font-semibold text-ink">You are not signed in.</p>
                  <p className="mt-1 text-xs leading-5 text-ink/58">
                    Return to the AI Studio access screen to login, sign up, or create an admin profile.
                  </p>
                  <button
                    type="button"
                    onClick={logoutLocalUser}
                    className="mt-4 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                  >
                    Open Access Screen
                  </button>
                </div>
              )}
            </div>
            <div className="rounded-[2rem] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Account Workspaces</p>
                  <h2 className="mt-2 text-2xl font-bold">Teams, roles, and quotas</h2>
                  <p className="mt-1 text-sm text-ink/58">
                    Choose your default workspace, review members, and manage admin-created team boundaries.
                  </p>
                </div>
                <button type="button" onClick={() => void refreshProductSurfaces()} className="rounded-full bg-mist px-3 py-2 text-xs font-bold text-ink">
                  Refresh
                </button>
              </div>

              <div className="mt-4 grid gap-3">
                {workspaces.map((workspace) => {
                  const storageMb = Math.round((workspace.usage.storage_bytes / 1024 / 1024) * 10) / 10;
                  const canManageWorkspace = isAdmin || workspace.current_user_role === "owner";
                  return (
                    <article key={workspace.id} className="rounded-[1.45rem] bg-mist/70 p-4 ring-1 ring-ink/5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-black text-ink">{workspace.name}</p>
                          <p className="mt-1 text-xs text-ink/55">
                            {workspace.slug} · role: {workspace.current_user_role || "viewer"}
                            {currentUser?.default_workspace_id === workspace.id ? " · default workspace" : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {currentUser?.default_workspace_id !== workspace.id ? (
                            <button type="button" onClick={() => void makeDefaultWorkspace(workspace.id)} className="rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-white">
                              Set default
                            </button>
                          ) : (
                            <span className="rounded-full bg-lime/35 px-3 py-1.5 text-xs font-bold text-ink">Default</span>
                          )}
                          <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-ink">{workspace.usage.member_count} member(s)</span>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <InfoCard title="Workflows" body={`${workspace.usage.workflow_count}/${workspace.workflow_limit}`} />
                        <InfoCard title="Runs 30d" body={`${workspace.usage.runs_last_30d}/${workspace.monthly_run_limit}`} />
                        <InfoCard title="Storage" body={`${storageMb}MB/${workspace.storage_limit_mb}MB`} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {workspace.members.map((member) => (
                          <span key={member.id} className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-[11px] font-semibold text-ink/68">
                            {member.display_name} · {member.role}
                            {canManageWorkspace ? (
                              <button
                                type="button"
                                onClick={() => void removeWorkspaceMember(workspace.id, member.id)}
                                className="rounded-full bg-ink/8 px-1.5 text-[10px] font-black text-ink/55 hover:bg-coral/20"
                                aria-label={`Remove ${member.display_name}`}
                              >
                                x
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
                {!workspaces.length ? (
                  <p className="rounded-[1.4rem] bg-mist/70 p-4 text-sm text-ink/58">
                    No workspace membership found yet. Admins can create workspaces here after the backend migration runs.
                  </p>
                ) : null}
              </div>

              {isAdmin ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <form onSubmit={submitWorkspace} className="rounded-[1.4rem] bg-ink p-4 text-white">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-white/42">Admin</p>
                    <h3 className="mt-1 font-black">Create workspace</h3>
                    <input value={workspaceForm.name} onChange={(event) => setWorkspaceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Claims Team" className="mt-3 w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                    <input value={workspaceForm.description} onChange={(event) => setWorkspaceForm((current) => ({ ...current, description: event.target.value }))} placeholder="Workspace description" className="mt-2 w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <input value={workspaceForm.workflow_limit} onChange={(event) => setWorkspaceForm((current) => ({ ...current, workflow_limit: Number(event.target.value) || 1 }))} type="number" min={1} title="Workflow limit" className="w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                      <input value={workspaceForm.monthly_run_limit} onChange={(event) => setWorkspaceForm((current) => ({ ...current, monthly_run_limit: Number(event.target.value) || 1 }))} type="number" min={1} title="Monthly run limit" className="w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                      <input value={workspaceForm.storage_limit_mb} onChange={(event) => setWorkspaceForm((current) => ({ ...current, storage_limit_mb: Number(event.target.value) || 1 }))} type="number" min={1} title="Storage limit MB" className="w-full rounded-2xl bg-white/10 px-3 py-2 text-sm outline-none ring-1 ring-white/10" />
                    </div>
                    <p className="mt-1 text-[10px] font-semibold text-white/45">workflows · monthly runs · storage MB</p>
                    <button type="submit" className="mt-3 rounded-full bg-lime px-4 py-2 text-sm font-black text-ink">Create Workspace</button>
                  </form>

                  <form onSubmit={submitWorkspaceMember} className="rounded-[1.4rem] bg-mist/70 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-ink/42">Members</p>
                    <h3 className="mt-1 font-black text-ink">Add user to workspace</h3>
                    <select value={workspaceMemberForm.workspace_id} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, workspace_id: Number(event.target.value) }))} className="mt-3 w-full rounded-2xl bg-white px-3 py-2 text-sm outline-none">
                      {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                    </select>
                    <input value={workspaceMemberForm.email} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, email: event.target.value }))} placeholder="user@email.com" className="mt-2 w-full rounded-2xl bg-white px-3 py-2 text-sm outline-none" />
                    <select value={workspaceMemberForm.role} onChange={(event) => setWorkspaceMemberForm((current) => ({ ...current, role: event.target.value }))} className="mt-2 w-full rounded-2xl bg-white px-3 py-2 text-sm outline-none">
                      {["member", "runner", "editor", "owner"].map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                    <button type="submit" className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-black text-white">Save Member</button>
                  </form>
                </div>
              ) : (
                <p className="mt-4 rounded-[1.2rem] bg-mist/70 p-3 text-xs leading-5 text-ink/58">
                  Workspace creation and member assignment are admin-only. Users can still set their default workspace and use workflows in workspaces where they are members.
                </p>
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
          <div className="max-h-[86vh] w-full max-w-5xl overflow-auto rounded-[2rem] bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Version Restore</p>
                <h2 className="mt-2 text-2xl font-bold">{selectedWorkflowDetails.name}</h2>
                <p className="mt-1 text-sm text-ink/58">
                  Compare saved graph snapshots, inspect what changed, and restore an older version when needed.
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
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-mist/70 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-ink/40">Current</p>
                <p className="mt-1 text-xl font-black text-ink">v{selectedWorkflowDetails.current_version}</p>
              </div>
              <div className="rounded-2xl bg-mist/70 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-ink/40">Saved</p>
                <p className="mt-1 text-xl font-black text-ink">{selectedWorkflowDetails.versions.length}</p>
              </div>
              <div className="rounded-2xl bg-mist/70 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-ink/40">Latest Save</p>
                <p className="mt-1 text-sm font-bold text-ink">
                  {selectedWorkflowDetails.versions[0]?.created_at ? new Date(selectedWorkflowDetails.versions[0].created_at).toLocaleString() : "No saved version"}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {selectedWorkflowDetails.versions.length ? selectedWorkflowDetails.versions.map((version) => (
                <div key={version.id} className="rounded-[1.4rem] bg-mist/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">Version {version.version_number}</p>
                      <p className="mt-1 text-xs text-ink/55">
                        {version.version_note || "No note"} · {new Date(version.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void restoreVersion(selectedWorkflowDetails.id, version.id)}
                        className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void compareVersion(selectedWorkflowDetails.id, version.id, "previous")}
                        className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink"
                      >
                        Compare Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => void compareVersion(selectedWorkflowDetails.id, version.id, "current")}
                        className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink"
                      >
                        Compare Current
                      </button>
                    </div>
                  </div>
                  {versionCompare?.version_id === version.id ? (
                    <div className="mt-3 rounded-2xl bg-white p-3 text-xs text-ink/62">
                      <p className="font-semibold text-ink">
                        Changes in version {versionCompare.version_number} vs {versionCompare.comparison_label}
                      </p>
                      <p className="mt-1 text-ink/50">
                        Use Compare Previous to see what this save introduced. Use Compare Current to see restore impact.
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <DiffMetric label="Added Nodes" value={versionCompare.diff.added_nodes.length} tone="bg-lime/25" />
                        <DiffMetric label="Removed Nodes" value={versionCompare.diff.removed_nodes.length} tone="bg-coral/15" />
                        <DiffMetric label="Changed Nodes" value={versionCompare.diff.changed_nodes.length} tone="bg-sand/55" />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <DiffList title="Added" items={versionCompare.diff.added_nodes} />
                        <DiffList title="Removed" items={versionCompare.diff.removed_nodes} />
                        <DiffList title="Changed" items={versionCompare.diff.changed_nodes.map((node) => `${node.node_id}: ${node.changes.join(", ")}`)} />
                      </div>
                      <div className="mt-3 rounded-xl bg-mist/70 p-3">
                        {Object.entries(versionCompare.diff.summary)
                          .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
                          .join(" · ")}
                      </div>
                    </div>
                  ) : null}
                </div>
              )) : (
                <p className="rounded-[1.4rem] bg-mist/70 p-4 text-sm text-ink/58">
                  No saved versions yet. Open Builder, click Save, add a version note, and AI Studio will create the first saved version.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {collaborationWorkflow ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/28 p-4 backdrop-blur-sm">
          <div className="max-h-[86vh] w-full max-w-5xl overflow-auto rounded-[2rem] bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Workflow Activity</p>
                <h2 className="mt-2 text-2xl font-bold">{collaborationWorkflow.name}</h2>
                <p className="mt-1 text-sm text-ink/58">
                  Comments, change history, and reusable components are powered by the backend collaboration APIs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCollaborationWorkflow(null)}
                className="rounded-full bg-mist px-4 py-2 text-sm font-semibold"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1fr]">
              <section className="rounded-[1.6rem] bg-mist/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">Comments</p>
                    <p className="mt-1 text-xs text-ink/55">Leave review notes for the workflow or future node-specific comments.</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink/55">
                    {workflowComments.length}
                  </span>
                </div>
                <form onSubmit={submitComment} className="mt-3">
                  <textarea
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    placeholder="Add a note for reviewers, collaborators, or future you..."
                    className="min-h-24 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none"
                  />
                  <button type="submit" className="mt-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
                    Add Comment
                  </button>
                </form>
                <div className="mt-4 max-h-72 space-y-2 overflow-auto">
                  {workflowComments.map((comment) => (
                    <article key={comment.id} className="rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-ink/6">
                      <p className="leading-6 text-ink">{comment.body}</p>
                      <p className="mt-2 text-xs text-ink/45">
                        user {comment.user_id ?? "local"} · {new Date(comment.created_at).toLocaleString()}
                      </p>
                    </article>
                  ))}
                  {!workflowComments.length ? (
                    <p className="rounded-2xl bg-white px-4 py-3 text-sm text-ink/55">No comments yet.</p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-[1.6rem] bg-ink p-4 text-white">
                <p className="text-sm font-semibold">Reusable Components</p>
                <p className="mt-1 text-xs leading-5 text-white/55">
                  Save the current workflow graph as a subflow/component so later UI can insert it as a reusable block group.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={subflowName}
                    onChange={(event) => setSubflowName(event.target.value)}
                    className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none"
                  />
                  <button type="button" onClick={() => void saveWorkflowAsSubflow()} className="rounded-2xl bg-lime px-4 py-3 text-sm font-bold text-ink">
                    Save
                  </button>
                </div>
                <div className="mt-4 max-h-72 space-y-2 overflow-auto">
                  {subflows.map((subflow) => (
                    <div key={subflow.id} className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
                      <p className="font-semibold">{subflow.name}</p>
                      <p className="mt-1 text-xs text-white/45">{new Date(subflow.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                  {!subflows.length ? (
                    <p className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/55">
                      No reusable components saved for this workflow yet.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Change History</p>
                  <p className="mt-1 text-xs text-ink/55">Audit-friendly timeline of workflow creates, updates, versions, comments, and subflows.</p>
                </div>
                <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-ink/55">
                  {workflowHistory.length} events
                </span>
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                {workflowHistory.map((event) => (
                  <article key={event.id} className="rounded-2xl bg-mist/70 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{event.change_type.replace(/_/g, " ")}</p>
                      <p className="text-xs text-ink/45">{new Date(event.created_at).toLocaleString()}</p>
                    </div>
                    <p className="mt-1 leading-5 text-ink/62">{event.summary}</p>
                  </article>
                ))}
                {!workflowHistory.length ? (
                  <p className="rounded-2xl bg-mist/70 px-4 py-3 text-sm text-ink/55">No change events recorded yet.</p>
                ) : null}
              </div>
            </section>
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
                <p className="mt-1 text-sm text-ink/58">Local access control is enforced by the API when a local user is signed in. Add viewer, runner, editor, or owner access for teammates.</p>
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
      {isImportDialogOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/28 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[2rem] bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Import Workflow</p>
                <h2 className="mt-2 text-2xl font-bold">Paste an AI Studio bundle</h2>
                <p className="mt-1 text-sm text-ink/58">
                  This imports into <strong>{activeWorkspace?.name || "the active workspace"}</strong>. You need owner/editor access.
                </p>
              </div>
              <button type="button" onClick={() => setIsImportDialogOpen(false)} className="rounded-full bg-mist px-4 py-2 text-sm font-semibold">
                Close
              </button>
            </div>
            <textarea
              value={bundleImportText}
              onChange={(event) => setBundleImportText(event.target.value)}
              placeholder='{"format":"ai-studio-workflow-bundle","graph_json":{...}}'
              className="mt-4 min-h-72 w-full rounded-[1.35rem] border border-ink/10 bg-mist/55 p-4 font-mono text-xs text-ink outline-none placeholder:text-ink/35"
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-5 text-ink/52">
                Tip: export any workflow from its card, then paste that JSON here to clone it into another workspace or VPS.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setIsImportDialogOpen(false)} className="rounded-full bg-mist px-4 py-2 text-sm font-semibold text-ink">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void importBundle()}
                  disabled={!bundleImportText.trim() || !canCreateInWorkspace(activeWorkspace)}
                  className="rounded-full bg-ink px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Import Workflow
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function getWorkflowLaunchKind(graph: BuilderGraph): WorkflowLaunchKind {
  return analyzeWorkflowApp(graph).kind;
}

function analyzeWorkflowApp(graph: BuilderGraph): WorkflowAppProfile {
  const blockTypes = new Set(graph.nodes.map((node) => node.data.blockType));
  const hasChatSurface = blockTypes.has("chat_input") && blockTypes.has("chat_output");
  const hasFileInput = blockTypes.has("file_upload");
  const hasDocumentOutput =
    blockTypes.has("text_extraction") ||
    blockTypes.has("dashboard_preview") ||
    blockTypes.has("json_output") ||
    blockTypes.has("form_input") ||
    blockTypes.has("approval_step");
  const hasRag = blockTypes.has("rag_knowledge");

  let kind: WorkflowLaunchKind = "builder_app";
  if (hasFileInput && hasRag && hasChatSurface) kind = "file_rag_app";
  else if (hasFileInput || hasDocumentOutput) kind = "document_app";
  else if (hasRag && hasChatSurface) kind = "rag_chat";
  else if (hasChatSurface) kind = "pure_chat";

  const profile = defaultWorkflowAppProfile(kind);
  const capabilities = new Set(profile.capabilities);
  const outputs = new Set(profile.allowedOutputs);
  const improvements = new Set(profile.improvements);

  if (hasChatSurface) capabilities.add("Conversational UI");
  if (hasFileInput) capabilities.add("Runtime file upload");
  if (blockTypes.has("text_extraction")) capabilities.add("Text extraction");
  if (hasRag) capabilities.add("RAG retrieval");
  if (blockTypes.has("conversation_memory")) capabilities.add("Session memory");
  if (blockTypes.has("long_term_memory")) capabilities.add("Long-term memory");
  if (blockTypes.has("query_rewriter")) capabilities.add("Query rewriting");
  if (blockTypes.has("re_ranker")) capabilities.add("Re-ranking");
  if (blockTypes.has("citation_verifier")) capabilities.add("Citation verification");
  if (blockTypes.has("guardrail")) capabilities.add("Guardrails");
  if (blockTypes.has("approval_step")) capabilities.add("Human approval");
  if (blockTypes.has("web_search")) capabilities.add("Web research placeholder");
  if (blockTypes.has("database_writer")) capabilities.add("Database write payload");
  if (blockTypes.has("csv_excel_export")) capabilities.add("CSV export");
  if (blockTypes.has("dashboard_preview")) outputs.add("Dashboard preview");
  if (blockTypes.has("json_output")) outputs.add("Structured JSON");
  if (blockTypes.has("chat_output")) outputs.add("Chat answer");
  if (blockTypes.has("logger")) outputs.add("Debug trace");

  if (hasRag && !blockTypes.has("re_ranker")) improvements.add("Add a Re-ranker block to improve source relevance before the chatbot.");
  if (hasRag && !blockTypes.has("citation_verifier")) improvements.add("Add Citation Verifier so answers clearly show supported and unsupported claims.");
  if (hasFileInput && !blockTypes.has("text_extraction")) improvements.add("Connect File Upload to Text Extraction so uploaded documents become usable text.");
  if (hasChatSurface && !blockTypes.has("conversation_memory")) improvements.add("Add Conversation Memory if the app should remember previous turns.");
  if (!blockTypes.has("logger")) improvements.add("Add Logger for user-friendly debugging and node-by-node traces.");
  if ((hasFileInput || hasRag) && !blockTypes.has("dashboard_preview")) improvements.add("Add Dashboard/Preview to show sources, file metadata, and intermediate results.");
  if (kind === "pure_chat" && !blockTypes.has("guardrail")) improvements.add("Add Guardrail for safer public chatbot behavior.");

  return {
    ...profile,
    capabilities: Array.from(capabilities),
    allowedOutputs: Array.from(outputs),
    improvements: Array.from(improvements).slice(0, 4),
  };
}

function defaultWorkflowAppProfile(kind: WorkflowLaunchKind): WorkflowAppProfile {
  const profiles: Record<WorkflowLaunchKind, WorkflowAppProfile> = {
    pure_chat: {
      kind: "pure_chat",
      label: "Pure Chatbot",
      launchSurface: "/chat",
      publishMode: "Chatbot URL",
      description: "Best for direct assistants that only need a message, memory, model, and chat response.",
      capabilities: ["Chat input", "LLM response"],
      allowedOutputs: ["Chat answer"],
      improvements: ["Add Conversation Memory for multi-turn support if this chatbot should remember context."],
    },
    rag_chat: {
      kind: "rag_chat",
      label: "Pre-Ingested RAG Chatbot",
      launchSurface: "/chat",
      publishMode: "Chatbot URL",
      description: "Best when knowledge has already been indexed and users only need to ask questions.",
      capabilities: ["Knowledge retrieval", "Chat input", "Citations"],
      allowedOutputs: ["Chat answer", "Citations"],
      improvements: ["Add a RAG health check panel and test questions before sharing the chatbot."],
    },
    file_rag_app: {
      kind: "file_rag_app",
      label: "Runtime File RAG App",
      launchSurface: "/app",
      publishMode: "Workflow App URL",
      description: "Best when every run may upload or select a new document before asking questions.",
      capabilities: ["Runtime file upload", "Text extraction", "RAG ingestion", "Chat answer"],
      allowedOutputs: ["Chat answer", "Citations", "Dashboard preview"],
      improvements: ["Use refresh collection mode for one-file-at-a-time apps, or separate collection names for reusable knowledge bases."],
    },
    document_app: {
      kind: "document_app",
      label: "Document Processing App",
      launchSurface: "/app",
      publishMode: "Workflow App URL",
      description: "Best for extraction, summarization, approvals, dashboards, JSON output, and file-based workflows.",
      capabilities: ["Runtime inputs", "Document processing"],
      allowedOutputs: ["Dashboard preview", "Structured JSON"],
      improvements: ["Add JSON Output and Dashboard/Preview so non-technical users can inspect final results clearly."],
    },
    builder_app: {
      kind: "builder_app",
      label: "Builder Automation",
      launchSurface: "/builder",
      publishMode: "Builder Only",
      description: "Best for internal automations, experiments, and workflows that need more configuration before sharing.",
      capabilities: ["Composable workflow"],
      allowedOutputs: ["Run logs"],
      improvements: ["Add a clear input block and output block before publishing or sharing this workflow."],
    },
  };
  return profiles[kind];
}

function canPublishAsChat(kind?: WorkflowLaunchKind) {
  return kind === "pure_chat" || kind === "rag_chat";
}

function getWorkflowKindLabel(kind?: WorkflowLaunchKind) {
  const labels: Record<WorkflowLaunchKind, string> = {
    pure_chat: "pure chatbot",
    rag_chat: "RAG chatbot",
    file_rag_app: "file RAG app",
    document_app: "document app",
    builder_app: "builder app",
  };
  return kind ? labels[kind] : "";
}

function getWorkflowComplexity(workflow: WorkflowSummary): "basic" | "advanced" | "custom" {
  const name = workflow.name.toLowerCase();
  if (name.startsWith("basic:")) return "basic";
  if (name.startsWith("advanced:")) return "advanced";
  return "custom";
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

function DiffMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${tone}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/45">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl bg-mist/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/45">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length ? items.slice(0, 8).map((item) => (
          <span key={item} className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-ink/65">
            {item}
          </span>
        )) : (
          <span className="text-xs text-ink/45">None</span>
        )}
      </div>
    </div>
  );
}

function WorkflowStatCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-[1.35rem] bg-white px-4 py-3 ring-1 ring-ink/6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ink/42">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink/52">{detail}</p>
    </div>
  );
}

function AttentionCard({ title, body, tone }: { title: string; body: string; tone: string }) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${tone}`}>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-5 text-ink/60">{body}</p>
    </div>
  );
}

function AuditEventCard({ event }: { event: AuditLogRecord }) {
  return (
    <div className="rounded-2xl bg-white/8 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-semibold text-white">{event.action.replace(/_/g, " ")}</p>
        <span className="shrink-0 text-[10px] text-white/38">{new Date(event.created_at).toLocaleTimeString()}</span>
      </div>
      <p className="mt-1 truncate text-xs text-white/52">
        {event.event_type} · {event.resource_type}{event.workflow_id ? ` · workflow #${event.workflow_id}` : ""}
      </p>
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
