import { useEffect, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Panel,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "reactflow";
import {
  ArchiveRestore,
  Bot,
  Boxes,
  ChevronLeft,
  ClipboardCheck,
  FolderOpen,
  Keyboard,
  LayoutDashboard,
  Maximize2,
  PanelLeftOpen,
  PanelRightOpen,
  Play,
  Rocket,
  RotateCcw,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import {
  blockDefinitions,
  getBlockDefinition,
  type BlockConfigFieldDefinition,
  type BlockDefinition,
  type BuilderEdge,
  type BuilderGraph,
  type BuilderNode,
} from "@vmb/shared";
import { BuilderBlockNode } from "./BuilderBlockNode";
import type { ComponentBoundaryPort, ComponentGroupData } from "./ComponentGroupNode";
import { RagManager } from "./RagManager";
import {
  BUILDER_GRAPH_STORAGE_KEY,
  arePortTypesCompatible,
  coerceFieldValue,
  createNodeFromDefinition,
  formatGraph,
  getFieldValue,
  getPaletteGroups,
  getPortByHandle,
  hydrateGraph,
  parseGraph,
  serializeGraph,
} from "../lib/builder";
import {
  autoBuildWorkflow,
  checkWorkflowConflicts,
  createWorkflow,
  createWorkflowComment,
  createWorkflowSubflow,
  executeWorkflowAsync,
  executeWorkflow,
  getWorkflowCollaborationState,
  getChatUrl,
  getRunEventsUrl,
  getWorkflow,
  getWorkflowRun,
  heartbeatWorkflowPresence,
  listFiles,
  listSubflows,
  publishWorkflow,
  saveWorkflowVersion,
  testWorkflowNode,
  uploadRuntimeFile,
  updateWorkflow,
  type RuntimeUploadResponse,
  type FileLibraryItem,
  type WorkflowPresence,
  type WorkflowRunRecord,
  type WorkflowSubflow,
} from "../lib/api";

const BUILDER_WORKFLOW_ID_STORAGE_KEY = "vmb-builder-workflow-id";

const starterDefinitions = ["chat_input", "chatbot", "conversation_memory", "chat_output"]
  .map((type) => getBlockDefinition(type))
  .filter((definition): definition is BlockDefinition => Boolean(definition));

const initialGraph = hydrateGraph({
  id: "starter-graph",
  name: "Starter Graph",
  version: 1,
  nodes: starterDefinitions.map((definition, index) =>
    createNodeFromDefinition(definition, { x: 80 + index * 280, y: 150 + (index % 2) * 70 }, index + 1),
  ),
  edges: [
    {
      id: "edge-chat-input-chatbot",
      source: "chat_input-1",
      sourceHandle: "out:message",
      target: "chatbot-2",
      targetHandle: "in:message",
      label: "user message",
    },
    {
      id: "edge-chatbot-memory",
      source: "chatbot-2",
      sourceHandle: "out:reply",
      target: "conversation_memory-3",
      targetHandle: "in:message",
      label: "store turn",
    },
    {
      id: "edge-chatbot-output",
      source: "chatbot-2",
      sourceHandle: "out:reply",
      target: "chat_output-4",
      targetHandle: "in:message",
      label: "assistant reply",
    },
  ],
});

const nodeTypes = {
  builderBlock: BuilderBlockNode,
};

const paletteGroups = getPaletteGroups();

type BuilderPageProps = {
  workflowId?: number;
  onBack?: () => void;
  onOpenChat?: (slug: string) => void;
  onOpenRun?: (run: WorkflowRunRecord) => void;
};

type RuntimeFileStatus = "idle" | "uploading" | "ready" | "error";

type RuntimeInputState = Record<
  string,
  {
    value: string;
    files: File[];
    uploadedFiles: RuntimeUploadResponse[];
    uploadStatus: RuntimeFileStatus;
    uploadError?: string;
  }
>;

type Diagnostic = {
  level: "error" | "warning" | "success";
  message: string;
};

type RunDisplayCard = {
  id: string;
  title: string;
  kind: string;
  summary: string;
  body: string;
  metadata?: unknown;
};

type DataFlowMapping = {
  inputPortId: string;
  inputLabel: string;
  inputTypes: string[];
  required: boolean;
  sources: Array<{
    edgeId: string;
    sourceNodeId: string;
    sourceNodeLabel: string;
    sourceBlockType: string;
    sourcePortId: string;
    sourcePortLabel: string;
    sourceTypes: string[];
    edgeLabel: string;
    lastPreview?: string;
  }>;
};

type DataFlowOutputMapping = {
  outputPortId: string;
  outputLabel: string;
  outputTypes: string[];
  targets: Array<{
    edgeId: string;
    targetNodeId: string;
    targetNodeLabel: string;
    targetBlockType: string;
    targetPortId: string;
    targetPortLabel: string;
    targetTypes: string[];
    edgeLabel: string;
    lastPreview?: string;
  }>;
};

type ComponentInstance = {
  id: string;
  name: string;
  description?: string;
  nodeIds: string[];
  edges: BuilderEdge[];
  inputs: ComponentBoundaryPort[];
  outputs: ComponentBoundaryPort[];
  bounds: { x: number; y: number; width: number; height: number };
  collapsed: boolean;
  childOffsets: Record<string, { x: number; y: number }>;
  onToggle: (componentId: string) => void;
  onSave: (componentId: string) => void;
};

function toFlowNodes(nodes: BuilderNode[]): Node[] {
  return nodes.map((node) => ({
    ...node,
    data: node.data,
  }));
}

function toFlowEdges(edges: BuilderEdge[]): Edge[] {
  return edges.map((edge) => ({
    ...edge,
    animated: true,
    style: { strokeWidth: 1.5, stroke: "#081018" },
    labelStyle: { fill: "#081018", fontWeight: 600 },
  }));
}

function handlePortId(handle: string | null | undefined, fallback = "unknown") {
  return String(handle || "").split(":", 2)[1] || fallback;
}

function getBuilderNode(nodes: BuilderNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId);
}

function getNodePort(
  node: BuilderNode | undefined,
  direction: "input" | "output",
  portId: string,
) {
  const ports = direction === "input" ? node?.data.inputs : node?.data.outputs;
  return ports?.find((port) => port.id === portId);
}

function getEdgeAutoLabel(edge: BuilderEdge, nodes: BuilderNode[]) {
  const sourceNode = getBuilderNode(nodes, edge.source);
  const targetNode = getBuilderNode(nodes, edge.target);
  const sourcePortId = handlePortId(edge.sourceHandle, "output");
  const targetPortId = handlePortId(edge.targetHandle, "input");
  const sourcePort = getNodePort(sourceNode, "output", sourcePortId);
  const targetPort = getNodePort(targetNode, "input", targetPortId);
  const sourceLabel = sourcePort?.label || sourcePortId;
  const targetLabel = targetPort?.label || targetPortId;
  return `${sourceLabel} -> ${targetLabel}`;
}

function getEdgeDataTypes(edge: BuilderEdge, nodes: BuilderNode[]) {
  const sourceNode = getBuilderNode(nodes, edge.source);
  const sourcePort = getNodePort(sourceNode, "output", handlePortId(edge.sourceHandle, "output"));
  return sourcePort?.dataTypes || [];
}

function getEdgeColor(edge: BuilderEdge, nodes: BuilderNode[]) {
  const dataTypes = getEdgeDataTypes(edge, nodes);
  if (dataTypes.includes("knowledge")) return "#41a86f";
  if (dataTypes.includes("document") || dataTypes.includes("file")) return "#d99a21";
  if (dataTypes.includes("chat")) return "#ff765d";
  if (dataTypes.includes("json")) return "#7f6dff";
  if (dataTypes.includes("boolean")) return "#e24d4d";
  return "#4f8cff";
}

function decorateFlowEdges(
  edges: Edge[],
  nodes: BuilderNode[],
  selectedEdgeId: string | null,
  selectedNodeId?: string,
) {
  return edges.map((edge) => {
    const builderEdge = edge as BuilderEdge;
    const color = getEdgeColor(builderEdge, nodes);
    const autoLabel = getEdgeAutoLabel(builderEdge, nodes);
    const savedLabel = String(builderEdge.label || "").trim();
    const label = savedLabel && savedLabel !== autoLabel ? `${autoLabel} · ${savedLabel}` : autoLabel;
    const selected = edge.id === selectedEdgeId || edge.selected;
    const relatedToSelectedNode = selectedNodeId ? edge.source === selectedNodeId || edge.target === selectedNodeId : false;
    const dimUnrelated = Boolean(selectedNodeId && !relatedToSelectedNode && !selected);
    return {
      ...edge,
      selected,
      label,
      animated: selected || relatedToSelectedNode || edge.animated,
      style: {
        ...(edge.style || {}),
        stroke: color,
        strokeOpacity: dimUnrelated ? 0.22 : 1,
        strokeWidth: selected ? 3.4 : relatedToSelectedNode ? 2.8 : 2.1,
      },
      labelBgStyle: {
        fill: selected ? "#081018" : "rgba(255,255,255,0.92)",
        fillOpacity: 0.96,
      },
      labelStyle: {
        fill: selected ? "#ffffff" : "#081018",
        fontSize: 11,
        fontWeight: 800,
      },
    };
  });
}

function toBuilderGraph(nodes: Node[], edges: Edge[]): BuilderGraph {
  const executableNodes = nodes.filter((node) => node.type === "builderBlock") as BuilderNode[];
  const executableNodeIds = new Set(executableNodes.map((node) => node.id));
  const executableEdges = edges.filter((edge) => executableNodeIds.has(edge.source) && executableNodeIds.has(edge.target));
  return formatGraph(executableNodes, executableEdges as BuilderEdge[]);
}

function isChatWorkflow(graph: BuilderGraph) {
  const requiresRuntimeFiles = graph.nodes.some((node) => node.data.blockType === "file_upload");
  return (
    !requiresRuntimeFiles &&
    graph.nodes.some((node) => node.data.blockType === "chat_input") &&
    graph.nodes.some((node) => node.data.blockType === "chat_output")
  );
}

function getBuilderWorkflowModeLabel(graph: BuilderGraph) {
  const blockTypes = new Set(graph.nodes.map((node) => node.data.blockType));
  if (blockTypes.has("file_upload") && blockTypes.has("rag_knowledge") && blockTypes.has("chatbot")) {
    return "File RAG app";
  }
  if (blockTypes.has("rag_knowledge") && blockTypes.has("chatbot")) {
    return "RAG chatbot";
  }
  if (blockTypes.has("file_upload") || blockTypes.has("dashboard_preview") || blockTypes.has("json_output")) {
    return "Document app";
  }
  if (isChatWorkflow(graph)) {
    return "Chatbot workflow";
  }
  return "Builder workflow";
}

function normalizeGraphForChangeDetection(graph: BuilderGraph) {
  return {
    id: graph.id,
    name: graph.name,
    nodes: graph.nodes
      .map((node) => ({
        id: node.id,
        type: node.type,
        position: {
          x: Math.round(Number(node.position?.x || 0)),
          y: Math.round(Number(node.position?.y || 0)),
        },
        data: {
          blockType: node.data.blockType,
          label: node.data.label,
          config: node.data.config,
        },
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: graph.edges
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle || null,
        target: edge.target,
        targetHandle: edge.targetHandle || null,
        label: edge.label || "",
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function graphsHaveMeaningfulChanges(currentGraph: BuilderGraph, savedGraph: BuilderGraph) {
  return (
    JSON.stringify(normalizeGraphForChangeDetection(currentGraph)) !==
    JSON.stringify(normalizeGraphForChangeDetection(savedGraph))
  );
}

function isInputConnected(nodeId: string, portId: string, edges: BuilderEdge[]) {
  return edges.some((edge) => edge.target === nodeId && edge.targetHandle === `in:${portId}`);
}

function isOutputConnected(nodeId: string, portId: string, edges: BuilderEdge[]) {
  return edges.some((edge) => edge.source === nodeId && edge.sourceHandle === `out:${portId}`);
}

function buildDiagnostics(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  runtimeInputs: RuntimeInputState,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const node of nodes) {
    const definition = getBlockDefinition(node.data.blockType);
    if (!definition) {
      diagnostics.push({
        level: "error",
        message: `${node.data.label} uses an unknown block type.`,
      });
      continue;
    }

    for (const input of definition.inputs.filter((port) => port.required)) {
      if (!isInputConnected(node.id, input.id, edges)) {
        diagnostics.push({
          level: "error",
          message: `${node.data.label} needs a connected ${input.label} input.`,
        });
      }
    }

    if (node.data.blockType === "file_upload") {
      const runtimeInput = getRuntimeInputState(runtimeInputs, node.id);
      const files = runtimeInput.files || [];
      const uploadedFiles = runtimeInput.uploadedFiles || [];
      if (runtimeInput.uploadStatus === "uploading") {
        diagnostics.push({
          level: "error",
          message: `${node.data.label} is still uploading. Wait for the local upload to finish before running.`,
        });
      }
      if (runtimeInput.uploadStatus === "error") {
        diagnostics.push({
          level: "error",
          message: `${node.data.label} upload failed: ${runtimeInput.uploadError || "choose the file again."}`,
        });
      }
      if (isOutputConnected(node.id, "file", edges) && files.length === 0 && uploadedFiles.length === 0) {
        diagnostics.push({
          level: "error",
          message: `${node.data.label} needs at least one runtime file before running.`,
        });
      }
    }

    if (node.data.blockType === "rag_knowledge") {
      if (!isInputConnected(node.id, "document", edges)) {
        diagnostics.push({
          level: "warning",
          message: `${node.data.label} has no document input, so it can only retrieve previously ingested knowledge.`,
        });
      }
      if (!isInputConnected(node.id, "query", edges)) {
        diagnostics.push({
          level: "warning",
          message: `${node.data.label} has no query input, so retrieval will return no chunks.`,
        });
      }
    }

    if (node.data.blockType === "text_extraction" && !isOutputConnected(node.id, "document", edges)) {
      diagnostics.push({
        level: "warning",
        message: `${node.data.label} extracts documents, but its output is not connected to RAG, preview, or another block.`,
      });
    }
  }

  if (nodes.length > 0 && !nodes.some((node) => ["chat_output", "json_output", "dashboard_preview"].includes(node.data.blockType))) {
    diagnostics.push({
      level: "warning",
      message: "Add an output block to make run results visible.",
    });
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      level: "success",
      message: "Workflow looks runnable. Provide runtime inputs and click Run Current Graph.",
    });
  }

  return diagnostics;
}

function getBlockGuide(blockType: string) {
  const guides: Record<string, string[]> = {
    file_upload: [
      "Choose files in Runtime Inputs before running.",
      "Files are copied into local storage first, then passed to downstream blocks.",
      "Connect File output to Text Extraction for PDF/DOCX/TXT/CSV/JSON parsing.",
    ],
    text_extraction: [
      "Connect a File Upload block into this block.",
      "This emits a normalized document object with text and source metadata.",
      "Connect Document output to Summarizer, Extraction AI, Classifier, RAG Knowledge, or Dashboard Preview.",
    ],
    rag_knowledge: [
      "For document Q&A, connect Text Extraction to Document and Chat Input to Query.",
      "Ingest stores chunks in SQLite metadata plus Chroma vectors.",
      "Knowledge output should feed the Chatbot context input for cited answers.",
    ],
    chatbot: [
      "Connect Chat Input to Message.",
      "Optionally connect RAG Knowledge or Memory to Context.",
      "Connect Reply to Chat Output to make published chat responses visible.",
    ],
    conversation_memory: [
      "Connect chat messages or assistant replies to persist recent history.",
      "Memory is scoped by workflow, session id, user id, and namespace.",
      "Connect Memory output to Chatbot context to inject recent conversation.",
    ],
    merge: [
      "Connect two upstream payloads into Input A and Input B.",
      "Use Dashboard/Preview or JSON Output to inspect merged payloads without an LLM.",
    ],
    condition: [
      "Connect a value, then use rules like exists, boolean, equals:approved, contains:urgent.",
      "Connect True and False outputs to separate branches.",
    ],
    summarizer: [
      "Connect Text Extraction, RAG Knowledge, or Text Input into Content.",
      "This returns a summary payload that can go to Dashboard Preview, JSON Output, or Merge.",
      "Use it when you want document processing, not a chat interface.",
    ],
    classifier: [
      "Connect extracted text or a document into Content.",
      "Define allowed labels in the config.",
      "Send the JSON result to Condition, JSON Output, Dashboard Preview, or Logger.",
    ],
    extraction_ai: [
      "Connect Text Extraction output into Content.",
      "Describe the JSON fields you want in Schema / Fields To Extract.",
      "Connect JSON output to JSON Output, Dashboard Preview, Merge, or downstream systems.",
    ],
  };

  return guides[blockType] || [
    "Configure this block, connect compatible ports, and inspect run logs after execution.",
  ];
}

function getConnectionSuggestions(
  selectedNode: BuilderNode,
  nodes: BuilderNode[],
  edges: BuilderEdge[],
) {
  const suggestions: Array<{
    sourceNode: BuilderNode;
    sourcePortId: string;
    targetNode: BuilderNode;
    targetPortId: string;
    label: string;
  }> = [];

  for (const sourcePort of selectedNode.data.outputs) {
    for (const targetNode of nodes) {
      if (targetNode.id === selectedNode.id) {
        continue;
      }

      for (const targetPort of targetNode.data.inputs) {
        if (!arePortTypesCompatible(sourcePort.dataTypes, targetPort.dataTypes)) {
          continue;
        }

        const exists = edges.some(
          (edge) =>
            edge.source === selectedNode.id &&
            edge.sourceHandle === `out:${sourcePort.id}` &&
            edge.target === targetNode.id &&
            edge.targetHandle === `in:${targetPort.id}`,
        );

        if (!exists) {
          suggestions.push({
            sourceNode: selectedNode,
            sourcePortId: sourcePort.id,
            targetNode,
            targetPortId: targetPort.id,
            label: `${sourcePort.label} -> ${targetNode.data.label} / ${targetPort.label}`,
          });
        }
      }
    }
  }

  return suggestions.slice(0, 8);
}

function getRuntimeInputState(runtimeInputs: RuntimeInputState, nodeId: string) {
  const current = runtimeInputs[nodeId];
  return {
    value: current?.value || "",
    files: current?.files || [],
    uploadedFiles: current?.uploadedFiles || [],
    uploadStatus: current?.uploadStatus || "idle",
    uploadError: current?.uploadError,
  };
}

function stringifyPreviewValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function getOutputLabel(nodes: Node[], nodeId: string) {
  const node = nodes.find((item) => item.id === nodeId) as BuilderNode | undefined;
  return node?.data.label || nodeId;
}

function getRunDisplayCards(workflowRun: WorkflowRunRecord | null, nodes: Node[]): RunDisplayCard[] {
  if (!workflowRun) {
    return [];
  }

  const cards: RunDisplayCard[] = [];
  for (const [nodeId, outputGroup] of Object.entries(workflowRun.output_payload || {})) {
    for (const [portId, payload] of Object.entries(outputGroup || {})) {
      const value = payload.value;
      const preview = payload.preview;
      const metadata = payload.metadata;
      const title = getOutputLabel(nodes, nodeId);
      const kind = String((payload as { type?: unknown }).type || portId);

      if (kind === "preview" && typeof value === "object" && value !== null) {
        const previewValue = value as { summary?: unknown; content?: unknown; mode?: unknown };
        cards.push({
          id: `${nodeId}-${portId}`,
          title,
          kind: "Dashboard Preview",
          summary: summarizeFriendly(previewValue.summary || preview),
          body: stringifyPreviewValue(previewValue.content || previewValue.summary || preview),
          metadata,
        });
        continue;
      }

      if (kind === "chat" && typeof value === "object" && value !== null && "answer" in value) {
        const chatValue = value as { answer?: unknown; citations?: unknown[]; source_chunks?: unknown[] };
        cards.push({
          id: `${nodeId}-${portId}`,
          title,
          kind: "Chat Output",
          summary: `${chatValue.citations?.length || 0} citation(s), ${chatValue.source_chunks?.length || 0} source chunk(s)`,
          body: stringifyPreviewValue(chatValue.answer),
          metadata: { citations: chatValue.citations || [], source_chunks: chatValue.source_chunks || [] },
        });
        continue;
      }

      if (kind === "json" && typeof value === "object" && value !== null) {
        const jsonValue = value as { data?: unknown; pretty_json?: unknown };
        cards.push({
          id: `${nodeId}-${portId}`,
          title,
          kind: "JSON Output",
          summary: summarizeFriendly(preview),
          body: stringifyPreviewValue(jsonValue.pretty_json || jsonValue.data || value),
          metadata,
        });
        continue;
      }

      if (kind === "log" && typeof value === "object" && value !== null) {
        const logValue = value as { level?: unknown; summary?: unknown; payload?: unknown };
        cards.push({
          id: `${nodeId}-${portId}`,
          title,
          kind: `Logger ${String(logValue.level || "").toUpperCase()}`,
          summary: summarizeFriendly(logValue.summary || preview),
          body: stringifyPreviewValue(logValue.payload || value),
          metadata,
        });
        continue;
      }

      cards.push({
        id: `${nodeId}-${portId}`,
        title,
        kind,
        summary: summarizeFriendly(preview || metadata),
        body: stringifyPreviewValue(value || preview),
        metadata,
      });
    }
  }

  return cards;
}

function explainWorkflowRun(run: WorkflowRunRecord | null) {
  if (!run) return "";
  const nodeRuns = run.node_runs || [];
  const completed = nodeRuns.filter((node) => node.status === "completed").length;
  const failed = nodeRuns.filter((node) => node.status === "failed").length;
  const blockTypes = nodeRuns.map((node) => node.block_type);
  const parts = [
    `${completed}/${nodeRuns.length || Object.keys(run.output_payload || {}).length} block(s) completed`,
  ];
  if (blockTypes.includes("file_upload")) parts.push("files were staged locally");
  if (blockTypes.includes("text_extraction")) parts.push("text was extracted");
  if (blockTypes.includes("rag_knowledge")) parts.push("knowledge was indexed/retrieved");
  if (blockTypes.includes("chatbot")) parts.push("the chatbot generated an answer");
  if (blockTypes.includes("citation_verifier")) parts.push("citations were checked");
  if (failed) parts.push(`${failed} block(s) need attention`);
  if (run.latency_ms) parts.push(`total latency ${run.latency_ms}ms`);
  return parts.join(", ") + ".";
}

function summarizeFriendly(value: unknown) {
  if (!value) {
    return "Output ready";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.preview === "string") {
      return record.preview;
    }
    if (typeof record.answer_preview === "string") {
      return record.answer_preview;
    }
    if (typeof record.type === "string") {
      const keys = Array.isArray(record.keys) ? ` with ${record.keys.length} key(s)` : "";
      const length = typeof record.length === "number" ? ` with ${record.length} item(s)` : "";
      return `${record.type}${keys}${length}`;
    }
  }

  return stringifyPreviewValue(value).slice(0, 180);
}

function getNodeRunPreview(workflowRun: WorkflowRunRecord | null, node: BuilderNode) {
  const nodeRun = workflowRun?.node_runs?.find((run) => run.node_id === node.id);
  if (!nodeRun) {
    return undefined;
  }
  const outputSummary = summarizeFriendly(nodeRun.preview_payload || nodeRun.output_payload);
  return {
    status: nodeRun.status,
    latencyMs: nodeRun.latency_ms,
    summary: outputSummary,
    error: nodeRun.error_message,
  };
}

function getNodeOutputPreview(workflowRun: WorkflowRunRecord | null, nodeId: string, portId: string) {
  const nodeRun = workflowRun?.node_runs?.find((run) => run.node_id === nodeId);
  const outputPayload = nodeRun?.output_payload as Record<string, { preview?: unknown; value?: unknown; type?: unknown }> | undefined;
  const payload = outputPayload?.[portId];
  if (!payload) {
    return undefined;
  }
  return summarizeFriendly(payload.preview ?? payload.value ?? payload);
}

function buildNodeInputMappings(
  selectedNode: BuilderNode,
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  workflowRun: WorkflowRunRecord | null,
): DataFlowMapping[] {
  return selectedNode.data.inputs.map((inputPort) => {
    const incomingEdges = edges.filter(
      (edge) => edge.target === selectedNode.id && handlePortId(edge.targetHandle, "") === inputPort.id,
    );
    return {
      inputPortId: inputPort.id,
      inputLabel: inputPort.label,
      inputTypes: inputPort.dataTypes,
      required: Boolean(inputPort.required),
      sources: incomingEdges.map((edge) => {
        const sourceNode = getBuilderNode(nodes, edge.source);
        const sourcePortId = handlePortId(edge.sourceHandle, "output");
        const sourcePort = getNodePort(sourceNode, "output", sourcePortId);
        return {
          edgeId: edge.id,
          sourceNodeId: edge.source,
          sourceNodeLabel: sourceNode?.data.label || edge.source,
          sourceBlockType: sourceNode?.data.blockType || "unknown",
          sourcePortId,
          sourcePortLabel: sourcePort?.label || sourcePortId,
          sourceTypes: sourcePort?.dataTypes || [],
          edgeLabel: getEdgeAutoLabel(edge, nodes),
          lastPreview: getNodeOutputPreview(workflowRun, edge.source, sourcePortId),
        };
      }),
    };
  });
}

function buildNodeOutputMappings(
  selectedNode: BuilderNode,
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  workflowRun: WorkflowRunRecord | null,
): DataFlowOutputMapping[] {
  return selectedNode.data.outputs.map((outputPort) => {
    const outgoingEdges = edges.filter(
      (edge) => edge.source === selectedNode.id && handlePortId(edge.sourceHandle, "") === outputPort.id,
    );
    return {
      outputPortId: outputPort.id,
      outputLabel: outputPort.label,
      outputTypes: outputPort.dataTypes,
      targets: outgoingEdges.map((edge) => {
        const targetNode = getBuilderNode(nodes, edge.target);
        const targetPortId = handlePortId(edge.targetHandle, "input");
        const targetPort = getNodePort(targetNode, "input", targetPortId);
        return {
          edgeId: edge.id,
          targetNodeId: edge.target,
          targetNodeLabel: targetNode?.data.label || edge.target,
          targetBlockType: targetNode?.data.blockType || "unknown",
          targetPortId,
          targetPortLabel: targetPort?.label || targetPortId,
          targetTypes: targetPort?.dataTypes || [],
          edgeLabel: getEdgeAutoLabel(edge, nodes),
          lastPreview: getNodeOutputPreview(workflowRun, edge.source, outputPort.id),
        };
      }),
    };
  });
}

function getConnectedNodeIds(selectedNode: BuilderNode | undefined, edges: BuilderEdge[]) {
  if (!selectedNode) {
    return new Set<string>();
  }
  const connected = new Set<string>([selectedNode.id]);
  for (const edge of edges) {
    if (edge.source === selectedNode.id) {
      connected.add(edge.target);
    }
    if (edge.target === selectedNode.id) {
      connected.add(edge.source);
    }
  }
  return connected;
}

function getNodeComponentId(node: Node) {
  const builderNode = node as BuilderNode;
  return typeof builderNode.data?.config?.componentInstanceId === "string"
    ? String(builderNode.data.config.componentInstanceId)
    : "";
}

function getNodeComponentName(node: Node) {
  const builderNode = node as BuilderNode;
  return typeof builderNode.data?.config?.componentName === "string"
    ? String(builderNode.data.config.componentName)
    : "Reusable Component";
}

function getNodeComponentDescription(node: Node) {
  const builderNode = node as BuilderNode;
  return typeof builderNode.data?.config?.componentDescription === "string"
    ? String(builderNode.data.config.componentDescription)
    : undefined;
}

function uniqueBoundaryPorts(ports: ComponentBoundaryPort[]) {
  const seen = new Set<string>();
  return ports.filter((port) => {
    if (seen.has(port.id)) return false;
    seen.add(port.id);
    return true;
  });
}

function getGraphBoundaryPorts(componentNodes: BuilderNode[], internalEdges: BuilderEdge[]) {
  const internalInputKeys = new Set(internalEdges.map((edge) => `${edge.target}:${handlePortId(edge.targetHandle, "input")}`));
  const internalOutputKeys = new Set(internalEdges.map((edge) => `${edge.source}:${handlePortId(edge.sourceHandle, "output")}`));
  return {
    inputs: uniqueBoundaryPorts(
      componentNodes.flatMap((node) =>
        node.data.inputs
          .filter((port) => !internalInputKeys.has(`${node.id}:${port.id}`))
          .map((port) => ({
            id: `${node.id}:${port.id}`,
            nodeId: node.id,
            nodeLabel: node.data.label,
            port,
          })),
      ),
    ),
    outputs: uniqueBoundaryPorts(
      componentNodes.flatMap((node) =>
        node.data.outputs
          .filter((port) => !internalOutputKeys.has(`${node.id}:${port.id}`))
          .map((port) => ({
            id: `${node.id}:${port.id}`,
            nodeId: node.id,
            nodeLabel: node.data.label,
            port,
          })),
      ),
    ),
  };
}

function buildComponentInstances(
  nodes: Node[],
  edges: BuilderEdge[],
  collapsedComponents: Set<string>,
  componentAnchors: Record<string, { x: number; y: number }>,
  onToggle: (componentId: string) => void,
  onSave: (componentId: string) => void,
): ComponentInstance[] {
  const builderNodes = nodes.filter((node) => node.type === "builderBlock") as BuilderNode[];
  const grouped = new Map<string, BuilderNode[]>();

  for (const node of builderNodes) {
    const componentId = getNodeComponentId(node);
    if (!componentId) continue;
    grouped.set(componentId, [...(grouped.get(componentId) || []), node]);
  }

  return Array.from(grouped.entries()).map(([componentId, componentNodes]) => {
    const nodeIds = componentNodes.map((node) => node.id);
    const nodeIdSet = new Set(nodeIds);
    const internalEdges = edges.filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target));
    const minX = Math.min(...componentNodes.map((node) => node.position.x));
    const minY = Math.min(...componentNodes.map((node) => node.position.y));
    const maxX = Math.max(...componentNodes.map((node) => node.position.x + 285));
    const maxY = Math.max(...componentNodes.map((node) => node.position.y + 190));
    const { inputs, outputs } = getGraphBoundaryPorts(componentNodes, internalEdges);
    const collapsed = collapsedComponents.has(componentId);
    const anchor = componentAnchors[componentId];
    const boundsX = collapsed && anchor ? anchor.x : minX - 34;
    const boundsY = collapsed && anchor ? anchor.y : minY - 82;
    return {
      id: componentId,
      name: getNodeComponentName(componentNodes[0]),
      description: getNodeComponentDescription(componentNodes[0]),
      nodeIds,
      edges: internalEdges,
      inputs,
      outputs,
      bounds: {
        x: boundsX,
        y: boundsY,
        width: Math.max(330, maxX - minX + 68),
        height: Math.max(245, maxY - minY + 118),
      },
      collapsed,
      childOffsets: Object.fromEntries(
        componentNodes.map((node) => [
          node.id,
          {
            x: node.position.x - boundsX,
            y: node.position.y - boundsY,
          },
        ]),
      ),
      onToggle,
      onSave,
    };
  });
}

function toComponentGroupNode(component: ComponentInstance): Node<ComponentGroupData> {
  return {
    id: `component-group-${component.id}`,
    type: "componentGroup",
    position: { x: component.bounds.x, y: component.bounds.y },
    draggable: true,
    selectable: true,
    data: {
      componentId: component.id,
      label: component.name,
      description: component.description,
      collapsed: component.collapsed,
      nodeCount: component.nodeIds.length,
      edgeCount: component.edges.length,
      childOffsets: component.childOffsets,
      inputs: component.inputs,
      outputs: component.outputs,
      onToggle: component.onToggle,
      onSave: component.onSave,
    },
    style: {
      width: component.collapsed ? 360 : component.bounds.width,
      height: component.collapsed ? 255 : component.bounds.height,
      zIndex: component.collapsed ? 3 : 0,
    },
  };
}

  function parseComponentHandle(handle: string | null | undefined, direction: "input" | "output") {
    const prefix = direction === "input" ? "in:" : "out:";
    if (!handle?.startsWith(prefix)) return null;
    const raw = handle.slice(prefix.length);
    const [nodeId, portId] = raw.split(":");
    if (!nodeId || !portId) return null;
    return { nodeId, portId };
  }

function findComponentForNode(components: ComponentInstance[], nodeId: string) {
  return components.find((component) => component.nodeIds.includes(nodeId));
}

function remapComponentDisplayEdge(edge: BuilderEdge, components: ComponentInstance[]) {
  const sourceComponent = findComponentForNode(components, edge.source);
  const targetComponent = findComponentForNode(components, edge.target);
  if (sourceComponent?.collapsed && targetComponent?.collapsed && sourceComponent.id === targetComponent.id) {
    return null;
  }
  if (sourceComponent?.collapsed && targetComponent?.collapsed && sourceComponent.id !== targetComponent.id) {
    return {
      ...edge,
      source: `component-group-${sourceComponent.id}`,
      sourceHandle: `out:${edge.source}:${handlePortId(edge.sourceHandle, "output")}`,
      target: `component-group-${targetComponent.id}`,
      targetHandle: `in:${edge.target}:${handlePortId(edge.targetHandle, "input")}`,
    };
  }
  if (sourceComponent?.collapsed) {
    return {
      ...edge,
      source: `component-group-${sourceComponent.id}`,
      sourceHandle: `out:${edge.source}:${handlePortId(edge.sourceHandle, "output")}`,
    };
  }
  if (targetComponent?.collapsed) {
    return {
      ...edge,
      target: `component-group-${targetComponent.id}`,
      targetHandle: `in:${edge.target}:${handlePortId(edge.targetHandle, "input")}`,
    };
  }
  return edge;
}

function getEdgeInspection(edge: BuilderEdge, nodes: BuilderNode[], workflowRun: WorkflowRunRecord | null) {
  const sourceNode = getBuilderNode(nodes, edge.source);
  const targetNode = getBuilderNode(nodes, edge.target);
  const sourcePortId = handlePortId(edge.sourceHandle, "output");
  const targetPortId = handlePortId(edge.targetHandle, "input");
  const sourcePort = getNodePort(sourceNode, "output", sourcePortId);
  const targetPort = getNodePort(targetNode, "input", targetPortId);
  return {
    sourceNode,
    targetNode,
    sourcePortId,
    targetPortId,
    sourcePort,
    targetPort,
    label: getEdgeAutoLabel(edge, nodes),
    dataTypes: sourcePort?.dataTypes || [],
    compatible: sourcePort && targetPort ? arePortTypesCompatible(sourcePort.dataTypes, targetPort.dataTypes) : false,
    lastPreview: getNodeOutputPreview(workflowRun, edge.source, sourcePortId),
  };
}

function getNodeStatusBadges(
  node: BuilderNode,
  edges: BuilderEdge[],
  runtimeInputs: RuntimeInputState,
  lastRun: WorkflowRunRecord | null,
): string[] {
  const badges: string[] = [];
  const definition = getBlockDefinition(node.data.blockType);
  const nodeRun = lastRun?.node_runs?.find((run) => run.node_id === node.id);

  if (definition?.inputs.some((port) => port.required && !isInputConnected(node.id, port.id, edges))) {
    badges.push("missing input");
  }

  if (node.data.blockType === "file_upload") {
    const runtimeInput = getRuntimeInputState(runtimeInputs, node.id);
    if (runtimeInput.uploadedFiles.length) {
      badges.push("has runtime file");
    }
  }

  if (Object.values(node.data.config || {}).some((value) => value !== "" && value !== null && value !== undefined)) {
    badges.push("configured");
  }

  if (nodeRun?.status === "failed") {
    badges.push("failed last run");
  } else if (nodeRun?.output_payload && Object.keys(nodeRun.output_payload).length > 0) {
    badges.push("produced output");
  } else if (!badges.includes("missing input")) {
    badges.push("ready");
  }

  return badges;
}

function BuilderCanvas({ workflowId, onBack, onOpenChat, onOpenRun }: BuilderPageProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes] = useState<Node[]>(toFlowNodes(initialGraph.nodes));
  const [edges, setEdges] = useState<Edge[]>(toFlowEdges(initialGraph.edges));
  const [statusMessage, setStatusMessage] = useState("Drag blocks from the left onto the canvas.");
  const [runMessage, setRunMessage] = useState("What does the company policy say about remote work?");
  const [runtimeInputs, setRuntimeInputs] = useState<RuntimeInputState>({});
  const [sessionId, setSessionId] = useState("starter-session");
  const [userId, setUserId] = useState("local-user");
  const [nodeSearch, setNodeSearch] = useState("");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isComponentsOpen, setIsComponentsOpen] = useState(false);
  const [isBlockSelectionMode, setIsBlockSelectionMode] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"flow" | "config" | "runtime" | "test" | "fixes" | "run" | "tools">("config");
  const [isPreRunOpen, setIsPreRunOpen] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const [autoBuildPrompt, setAutoBuildPrompt] = useState("Build a document upload workflow that extracts text, rewrites the question, searches RAG, reranks evidence, answers with citations, and outputs JSON.");
  const [nodeTestInput, setNodeTestInput] = useState('{"message":"What should I know?","query":"work from home","document":{"text":"Remote work is available two days per week with manager approval.","metadata":{"source":"sample"}}}');
  const [nodeTestResult, setNodeTestResult] = useState<Record<string, unknown> | null>(null);
  const [promptPlaygroundInput, setPromptPlaygroundInput] = useState("Summarize the remote work policy and return action items.");
  const [promptPlaygroundResult, setPromptPlaygroundResult] = useState<Record<string, unknown> | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<FileLibraryItem[]>([]);
  const [savedComponents, setSavedComponents] = useState<WorkflowSubflow[]>([]);
  const [collapsedComponents, setCollapsedComponents] = useState<Set<string>>(new Set());
  const [componentAnchors, setComponentAnchors] = useState<Record<string, { x: number; y: number }>>({});
  const [componentSelectionIds, setComponentSelectionIds] = useState<Set<string>>(new Set());
  const [presence, setPresence] = useState<WorkflowPresence[]>([]);
  const [loadedWorkflowMeta, setLoadedWorkflowMeta] = useState<{ version: number; updatedAt: string | null }>({ version: 1, updatedAt: null });
  const [persistedWorkflowId, setPersistedWorkflowId] = useState<number | null>(() => {
    return workflowId ?? null;
  });
  const [lastRun, setLastRun] = useState<WorkflowRunRecord | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const selectedNode = nodes.find((node) => node.type === "builderBlock" && node.selected) as BuilderNode | undefined;
  const selectedEdge = selectedEdgeId
    ? (edges.find((edge) => edge.id === selectedEdgeId) as BuilderEdge | undefined)
    : (edges.find((edge) => edge.selected) as BuilderEdge | undefined);
  const selectedDefinition = selectedNode
    ? getBlockDefinition(selectedNode.data.blockType)
    : undefined;
  const nodeInputMappings = selectedNode
    ? buildNodeInputMappings(selectedNode, nodes as BuilderNode[], edges as BuilderEdge[], lastRun)
    : [];
  const nodeOutputMappings = selectedNode
    ? buildNodeOutputMappings(selectedNode, nodes as BuilderNode[], edges as BuilderEdge[], lastRun)
    : [];
  const selectedEdgeInspection = selectedEdge
    ? getEdgeInspection(selectedEdge, nodes as BuilderNode[], lastRun)
    : null;
  const componentInstances: ComponentInstance[] = [];
  const collapsedComponentIds = new Set(componentInstances.filter((component) => component.collapsed).map((component) => component.id));
  const collapsedChildNodeIds = new Set(
    componentInstances
      .filter((component) => component.collapsed)
      .flatMap((component) => component.nodeIds),
  );

  function setGraph(graph: BuilderGraph) {
    const hydratedGraph = hydrateGraph(graph);
    setNodes(toFlowNodes(hydratedGraph.nodes));
    setEdges(toFlowEdges(hydratedGraph.edges));
    setComponentSelectionIds(new Set());
    setComponentAnchors({});
  }

  const runtimeInputNodes = nodes.filter((node) =>
    ["chat_input", "text_input", "file_upload"].includes(
      String((node as BuilderNode).data.blockType),
    ),
  ) as BuilderNode[];

  const diagnostics = buildDiagnostics(
    nodes as BuilderNode[],
    edges as BuilderEdge[],
    runtimeInputs,
  );
  const currentGraph = toBuilderGraph(nodes, edges);
  const isCurrentChatWorkflow = isChatWorkflow(currentGraph);
  const blockerCount = diagnostics.filter((item) => item.level === "error").length;
  const workflowModeLabel = getBuilderWorkflowModeLabel(currentGraph);
  const runDisplayCards = getRunDisplayCards(lastRun, nodes);
  const connectedNodeIds = getConnectedNodeIds(selectedNode, edges as BuilderEdge[]);
  const selectedBuilderNodeCount = componentSelectionIds.size;
  const builderFlowNodesWithBadges = nodes.map((node) => {
    const builderNode = node as BuilderNode;
    const isConnectedToSelection = connectedNodeIds.has(node.id);
    const dimUnrelated = selectedNode && connectedNodeIds.size > 1 && !isConnectedToSelection;
    const componentId = getNodeComponentId(node);
    const hiddenByCollapsedComponent = componentId ? collapsedChildNodeIds.has(node.id) : false;
    const selectedForComponent = componentSelectionIds.has(node.id);
    return {
      ...node,
      selected: selectedForComponent || node.selected,
      hidden: hiddenByCollapsedComponent,
      style: {
        ...(node.style || {}),
        opacity: dimUnrelated && !selectedForComponent ? 0.42 : 1,
        filter: dimUnrelated && !selectedForComponent ? "grayscale(0.35)" : undefined,
        zIndex: 2,
        boxShadow: selectedForComponent ? "0 0 0 6px rgba(182,255,135,0.42)" : undefined,
      },
      data: {
        ...builderNode.data,
        statusBadges: getNodeStatusBadges(builderNode, edges as BuilderEdge[], runtimeInputs, lastRun),
        runPreview: getNodeRunPreview(lastRun, builderNode),
      },
    };
  });
  const flowNodesWithBadges = builderFlowNodesWithBadges;
  const flowEdgesWithLabels = decorateFlowEdges(toFlowEdges(edges as BuilderEdge[]), nodes as BuilderNode[], selectedEdge?.id || null, selectedNode?.id);
  const filteredPaletteGroups = paletteGroups
    .map((group) => ({
      ...group,
      blocks: group.blocks.filter((definition) => {
        const query = paletteSearch.trim().toLowerCase();
        if (!query) return true;
        return `${definition.title} ${definition.type} ${definition.category} ${definition.description}`.toLowerCase().includes(query);
      }),
    }))
    .filter((group) => group.blocks.length > 0);
  const connectionSuggestions = selectedNode
    ? getConnectionSuggestions(selectedNode, nodes as BuilderNode[], edges as BuilderEdge[])
    : [];
  const inspectorTabs = [
    { id: "flow", label: "Flow", hint: "Data mapping" },
    { id: "config", label: "Config", hint: "Schema settings" },
    { id: "runtime", label: "Inputs", hint: "Files and values" },
    { id: "test", label: "Test", hint: "Node previews" },
    { id: "fixes", label: "Fix", hint: "Readiness and wiring" },
    { id: "run", label: "Run", hint: "Execute and publish" },
    { id: "tools", label: "Tools", hint: "RAG and auto-build" },
  ] as const;

  function getLocalUser() {
    try {
      const savedUser = localStorage.getItem("vmb-local-user");
      return savedUser ? (JSON.parse(savedUser) as { id?: number; display_name?: string; email?: string }) : null;
    } catch {
      return null;
    }
  }

  function buildPreRunChecklist() {
    const graph = toBuilderGraph(nodes, edges);
    const diagnostics = buildDiagnostics(graph.nodes, graph.edges, runtimeInputs);
    const runtimeSummary = runtimeInputNodes.map((node) => {
      const state = getRuntimeInputState(runtimeInputs, node.id);
      if (node.data.blockType === "file_upload") {
        return `${node.data.label}: ${state.uploadedFiles.length || state.files.length || 0} file(s) selected`;
      }
      return `${node.data.label}: ${state.value ? "runtime override ready" : "using default/fallback"}`;
    });
    return {
      graph,
      diagnostics,
      blockerCount: diagnostics.filter((item) => item.level === "error").length,
      warningCount: diagnostics.filter((item) => item.level === "warning").length,
      runtimeSummary,
      ragCount: graph.nodes.filter((node) => node.data.blockType === "rag_knowledge").length,
      llmCount: graph.nodes.filter((node) => ["chatbot", "summarizer", "classifier", "extraction_ai"].includes(node.data.blockType)).length,
      user: getLocalUser(),
    };
  }

  useEffect(() => {
    if (!workflowId) {
      return;
    }

    getWorkflow(workflowId)
      .then((workflow) => {
        setGraph(workflow.graph_json);
        setPersistedWorkflowId(workflow.id);
        setLoadedWorkflowMeta({ version: workflow.current_version, updatedAt: workflow.updated_at });
        localStorage.setItem(BUILDER_WORKFLOW_ID_STORAGE_KEY, String(workflow.id));
        setPublishedUrl(
          workflow.published_slug && isChatWorkflow(workflow.graph_json)
            ? getChatUrl(workflow.published_slug)
            : null,
        );
        setStatusMessage(`Loaded workflow ${workflow.id}: ${workflow.name}.`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Could not load workflow.";
        setStatusMessage(message);
      });
  }, [workflowId]);

  useEffect(() => {
    listFiles()
      .then((records) => setLibraryFiles(records.slice(0, 30)))
      .catch(() => setLibraryFiles([]));
    listSubflows()
      .then((records) => setSavedComponents(records))
      .catch(() => setSavedComponents([]));
  }, []);

  useEffect(() => {
    if (!persistedWorkflowId) return;
    const localUser = getLocalUser();
    const heartbeat = () => {
      void heartbeatWorkflowPresence(persistedWorkflowId, {
        session_id: sessionId,
        display_name: localUser?.display_name || localUser?.email || "Local collaborator",
        node_id: selectedNode?.id || null,
        cursor: { selected_node_id: selectedNode?.id || null, selected_edge_id: selectedEdge?.id || null },
        graph_version: currentGraph.version,
      }).catch(() => undefined);
      void getWorkflowCollaborationState(persistedWorkflowId, sessionId)
        .then((state) => setPresence(state.active_presence || []))
        .catch(() => setPresence([]));
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 12_000);
    return () => window.clearInterval(timer);
  }, [persistedWorkflowId, sessionId, selectedNode?.id, selectedEdge?.id, currentGraph.version]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandOpen((current) => !current);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void openSaveDialog();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        startRunWorkflow();
        return;
      }
      if (event.key === "Escape") {
        setIsCommandOpen(false);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (selectedEdge) {
          event.preventDefault();
          deleteSelectedEdge();
        } else if (selectedNode) {
          event.preventDefault();
          deleteSelectedNode();
        }
        return;
      }
      if (event.key.toLowerCase() === "d" && selectedNode) {
        event.preventDefault();
        duplicateSelectedNode();
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        zoomToFit();
        return;
      }
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        autoLayout();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEdge, selectedNode, nodes, edges]);

  async function persistWorkflow(graph: BuilderGraph) {
    if (persistedWorkflowId) {
      try {
        const updatedWorkflow = await updateWorkflow(persistedWorkflowId, graph);
        return updatedWorkflow;
      } catch {
        localStorage.removeItem(BUILDER_WORKFLOW_ID_STORAGE_KEY);
        setPersistedWorkflowId(null);
      }
    }

    const createdWorkflow = await createWorkflow(graph);
    localStorage.setItem(BUILDER_WORKFLOW_ID_STORAGE_KEY, String(createdWorkflow.id));
    setPersistedWorkflowId(createdWorkflow.id);
    return createdWorkflow;
  }

  async function buildExecuteInputs(graph: BuilderGraph) {
    const executionInputs: Record<string, { value: string; files: string[]; metadata: Record<string, string> }> = {};

    for (const node of graph.nodes) {
      if (node.data.blockType === "chat_input") {
        const runtimeInput = getRuntimeInputState(runtimeInputs, node.id);
        executionInputs[node.id] = {
          value: runtimeInput.value || runMessage,
          files: [],
          metadata: { source: "builder-ui" },
        };
      }

      if (node.data.blockType === "text_input" && getRuntimeInputState(runtimeInputs, node.id).value) {
        const runtimeInput = getRuntimeInputState(runtimeInputs, node.id);
        executionInputs[node.id] = {
          value: runtimeInput.value,
          files: [],
          metadata: { source: "builder-ui" },
        };
      }

      if (node.data.blockType === "file_upload") {
        const runtimeInput = getRuntimeInputState(runtimeInputs, node.id);
        const uploadedFiles = runtimeInput.uploadedFiles || [];
        const files = runtimeInput.files || [];

        if (uploadedFiles.length > 0) {
          executionInputs[node.id] = {
            value: "",
            files: uploadedFiles.map((file) => file.storage_path),
            metadata: {
              source: "builder-ui-runtime-upload",
              uploaded_count: String(uploadedFiles.length),
            },
          };
        } else if (files.length > 0) {
          setStatusMessage(`Uploading ${files.length} file(s) for ${node.data.label}.`);
          const uploadedFiles = await Promise.all(files.map((file) => uploadRuntimeFile(file)));
          setRuntimeInputs((current) => ({
            ...current,
            [node.id]: {
              ...getRuntimeInputState(current, node.id),
              uploadedFiles,
              uploadStatus: "ready",
              uploadError: undefined,
            },
          }));
          executionInputs[node.id] = {
            value: "",
            files: uploadedFiles.map((file) => file.storage_path),
            metadata: {
              source: "builder-ui-runtime-upload",
              uploaded_count: String(uploadedFiles.length),
            },
          };
        } else {
          executionInputs[node.id] = {
            value: "",
            files: [],
            metadata: { source: "builder-ui", uploaded_count: "0" },
          };
        }
      }
    }

    return executionInputs;
  }

  function extractRunSummary(workflowRun: WorkflowRunRecord) {
    const outputEntries = Object.values(workflowRun.output_payload || {});
    for (const outputGroup of outputEntries) {
      const resultOutput = outputGroup.result;
      if (resultOutput?.value) {
        const value = resultOutput.value;
        if (typeof value === "object" && value !== null && "answer" in value) {
          return {
            text: String((value as { answer?: unknown }).answer || ""),
            metadata: resultOutput.metadata,
          };
        }

        return {
          text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
          metadata: resultOutput.metadata,
        };
      }

      const chatOutput = outputGroup.message || outputGroup.reply;
      if (chatOutput?.value) {
        return {
          text: String(chatOutput.value),
          metadata: chatOutput.metadata,
        };
      }

      const jsonOutput = outputGroup.json;
      if (jsonOutput?.value) {
        return {
          text: JSON.stringify(jsonOutput.value, null, 2),
          metadata: jsonOutput.metadata,
        };
      }
    }

    return {
      text: "Run completed, but no output block returned a previewable result yet.",
      metadata: null,
    };
  }

  function startRunWorkflow() {
    if (!getLocalUser()) {
      setStatusMessage("Login locally from the home page before running so run ownership is tracked.");
      return;
    }
    setIsPreRunOpen(true);
  }

  async function runWorkflow() {
    setIsPreRunOpen(false);
    const graph = toBuilderGraph(nodes, edges);
    const blockingDiagnostics = buildDiagnostics(graph.nodes, graph.edges, runtimeInputs).filter(
      (diagnostic) => diagnostic.level === "error",
    );

    if (blockingDiagnostics.length > 0) {
      setStatusMessage(blockingDiagnostics[0].message);
      return;
    }

    setIsRunning(true);
    setStatusMessage("Saving the current graph to the API.");

    try {
      const workflow = await persistWorkflow(graph);
      const executionPayload = {
        trigger_mode: "manual",
        session_id: sessionId,
        user_id: userId,
        inputs: await buildExecuteInputs(graph),
      };
      setStatusMessage(`Starting live execution stream for workflow ${workflow.id}.`);

      if (typeof EventSource !== "undefined") {
        const queuedRun = await executeWorkflowAsync(workflow.id, executionPayload);
        setStatusMessage(`Workflow ${workflow.id} queued as run #${queuedRun.run_id}. Streaming node updates...`);
        const streamedRun = await waitForWorkflowRunEvents(workflow.id, queuedRun.run_id);
        setLastRun(streamedRun);
        setStatusMessage(
          streamedRun.status === "completed"
            ? `Workflow ${workflow.id} streamed successfully. Review the output preview below.`
            : `Workflow ${workflow.id} finished with status ${streamedRun.status}.`,
        );
        return;
      }

      setStatusMessage(`Executing workflow ${workflow.id} against the local API.`);
      const workflowRun = await executeWorkflow(workflow.id, executionPayload);

      setLastRun(workflowRun);
      setStatusMessage(
        workflowRun.status === "completed"
            ? `Workflow ${workflow.id} ran successfully. Review the output preview below.`
          : `Workflow ${workflow.id} finished with status ${workflowRun.status}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow execution failed.";
      setStatusMessage(message);
      setLastRun(null);
    } finally {
      setIsRunning(false);
    }
  }

  function waitForWorkflowRunEvents(workflowId: number, runId: number) {
    return new Promise<WorkflowRunRecord>((resolve, reject) => {
      const events = new EventSource(getRunEventsUrl(workflowId, runId));
      let latestRun: WorkflowRunRecord | null = null;
      let settled = false;

      const close = () => {
        settled = true;
        events.close();
      };

      events.addEventListener("run_update", (event) => {
        const run = JSON.parse((event as MessageEvent).data) as WorkflowRunRecord;
        latestRun = run;
        setLastRun(run);
        setStatusMessage(`Run #${run.id}: ${run.status} · ${(run.node_runs || []).length} node update(s) received.`);
      });

      events.addEventListener("run_done", (event) => {
        const run = JSON.parse((event as MessageEvent).data) as WorkflowRunRecord;
        latestRun = run;
        setLastRun(run);
        close();
        resolve(run);
      });

      events.onerror = () => {
        if (settled) return;
        close();
        getWorkflowRun(workflowId, runId)
          .then((run) => {
            latestRun = run;
            setLastRun(run);
            if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
              resolve(run);
            } else {
              reject(new Error("Live execution stream disconnected before the run finished."));
            }
          })
          .catch(() => reject(new Error("Live execution stream disconnected.")));
      };

      window.setTimeout(() => {
        if (settled) return;
        close();
        if (latestRun) {
          resolve(latestRun);
        } else {
          reject(new Error("Live execution stream timed out before receiving updates."));
        }
      }, 600_000);
    });
  }

  async function publishCurrentWorkflow() {
    if (!getLocalUser()) {
      setStatusMessage("Login locally from the home page before publishing so ownership is tracked.");
      return;
    }
    const graph = toBuilderGraph(nodes, edges);
    if (!isChatWorkflow(graph)) {
      setStatusMessage(
        "This workflow needs the app runner because it has file/document/dashboard inputs. Use Run Current Graph here or share its /app workflow URL.",
      );
      return;
    }
    setIsRunning(true);
    setStatusMessage("Saving graph before publishing.");

    try {
      const workflow = await persistWorkflow(graph);
      const published = await publishWorkflow(workflow.id);
      const chatUrl = getChatUrl(published.slug);
      setPublishedUrl(chatUrl);
      setStatusMessage(`Workflow published. Chat URL: ${chatUrl}`);
      onOpenChat?.(published.slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not publish workflow.";
      setStatusMessage(message);
    } finally {
      setIsRunning(false);
    }
  }

  function onNodesChange(changes: NodeChange[]) {
    const safeChanges = isBlockSelectionMode
      ? changes.filter((change) => change.type !== "select")
      : changes;
    const componentPositionChanges = safeChanges.filter(
      (change) => change.type === "position" && change.id.startsWith("component-group-") && "position" in change && change.position,
    );
    if (!componentPositionChanges.length) {
      setNodes((currentNodes) => applyNodeChanges(safeChanges, currentNodes));
      return;
    }

    setNodes((currentNodes) => {
      const currentComponents = buildComponentInstances(
        currentNodes,
        edges as BuilderEdge[],
        collapsedComponents,
        componentAnchors,
        toggleComponentCollapse,
        saveComponentById,
      );
      const componentPositionChangeMap = new Map(
        componentPositionChanges
          .filter((change): change is Extract<NodeChange, { type: "position" }> & { position: { x: number; y: number } } =>
            change.type === "position" && Boolean(change.position),
          )
          .map((change) => [change.id, change]),
      );
      const shiftedNodes = currentNodes.map((node) => {
        const positionChange = componentPositionChangeMap.get(`component-group-${getNodeComponentId(node)}`);
        if (!positionChange || !("position" in positionChange) || !positionChange.position) {
          return node;
        }
        const componentId = getNodeComponentId(node);
        const component = currentComponents.find((item) => item.id === componentId);
        const offset = component?.childOffsets[node.id];
        if (!offset) {
          return node;
        }
        return {
          ...node,
          position: {
            x: positionChange.position.x + offset.x,
            y: positionChange.position.y + offset.y,
          },
        };
      });
      const nextAnchors = { ...componentAnchors };
      for (const [groupId, positionChange] of componentPositionChangeMap.entries()) {
        const componentId = groupId.replace(/^component-group-/, "");
        nextAnchors[componentId] = { x: positionChange.position.x, y: positionChange.position.y };
      }
      setComponentAnchors(nextAnchors);
      return applyNodeChanges(
        safeChanges.filter((change) => !("id" in change) || !change.id.startsWith("component-group-")),
        shiftedNodes,
      );
    });
  }

  function onNodeClick(event: React.MouseEvent, node: Node) {
    setSelectedEdgeId(null);
    if (isBlockSelectionMode || event.shiftKey || event.metaKey || event.ctrlKey) {
      setEdges((currentEdges) => currentEdges.map((item) => ({ ...item, selected: false })));
      setNodes((currentNodes) => currentNodes.map((item) => ({ ...item, selected: false })));
      setComponentSelectionIds((current) => {
        const next = new Set(current);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      setIsInspectorOpen(false);
      setStatusMessage("Selection mode: click blocks to add/remove them, then save selected blocks as a component.");
      return;
    }
    setComponentSelectionIds(new Set());
    setNodes((currentNodes) =>
      currentNodes.map((item) => ({ ...item, selected: item.id === node.id })),
    );
    setIsInspectorOpen(true);
    setInspectorTab("flow");
  }

  function onEdgesChange(changes: EdgeChange[]) {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
  }

  function onEdgeClick(_: React.MouseEvent, edge: Edge) {
    setSelectedEdgeId(edge.id);
    setComponentSelectionIds(new Set());
    setNodes((currentNodes) => currentNodes.map((item) => ({ ...item, selected: false })));
    setEdges((currentEdges) => currentEdges.map((item) => ({ ...item, selected: item.id === edge.id })));
    setIsInspectorOpen(true);
    setInspectorTab("flow");
    setStatusMessage(`Inspecting data flow: ${getEdgeAutoLabel(edge as BuilderEdge, nodes as BuilderNode[])}.`);
  }

  function onPaneClick() {
    setSelectedEdgeId(null);
    if (isBlockSelectionMode) {
      setComponentSelectionIds(new Set());
      setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: false })));
      setStatusMessage("Selection cleared. Click blocks to build a component selection.");
    }
  }

  function resolveConnection(connection: Connection) {
    let source = connection.source || "";
    let target = connection.target || "";
    let sourceHandle = connection.sourceHandle || null;
    let targetHandle = connection.targetHandle || null;

    if (source.startsWith("component-group-")) {
      const parsed = parseComponentHandle(sourceHandle, "output");
      if (parsed) {
        source = parsed.nodeId;
        sourceHandle = `out:${parsed.portId}`;
      } else {
        setStatusMessage("Use one of the component output handles on the right edge to connect from this component.");
      }
    }

    if (target.startsWith("component-group-")) {
      const parsed = parseComponentHandle(targetHandle, "input");
      if (parsed) {
        target = parsed.nodeId;
        targetHandle = `in:${parsed.portId}`;
      } else {
        setStatusMessage("Use one of the component input handles on the left edge to connect into this component.");
      }
    }

    return { source, target, sourceHandle, targetHandle };
  }

  function isValidConnection(connection: Connection) {
    const resolvedConnection = resolveConnection(connection);
    if (!resolvedConnection.source || !resolvedConnection.target) {
      return false;
    }

    const sourceNode = nodes.find((node) => node.id === resolvedConnection.source) as BuilderNode | undefined;
    const targetNode = nodes.find((node) => node.id === resolvedConnection.target) as BuilderNode | undefined;

    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) {
      return false;
    }

    const sourcePort = getPortByHandle(sourceNode, resolvedConnection.sourceHandle, "output");
    const targetPort = getPortByHandle(targetNode, resolvedConnection.targetHandle, "input");

    if (!sourcePort || !targetPort) {
      return false;
    }

    return arePortTypesCompatible(sourcePort.dataTypes, targetPort.dataTypes);
  }

  function onConnect(connection: Connection) {
    if (!isValidConnection(connection)) {
      setStatusMessage("Those ports do not speak the same data shape yet.");
      return;
    }

    const resolvedConnection = resolveConnection(connection);
    const sourceNode = nodes.find((node) => node.id === resolvedConnection.source) as BuilderNode | undefined;
    const targetNode = nodes.find((node) => node.id === resolvedConnection.target) as BuilderNode | undefined;
    const sourcePort = sourceNode
      ? getPortByHandle(sourceNode, resolvedConnection.sourceHandle, "output")
      : undefined;
    const targetPort = targetNode
      ? getPortByHandle(targetNode, resolvedConnection.targetHandle, "input")
      : undefined;

    setEdges((currentEdges) =>
      addEdge(
        {
          ...resolvedConnection,
          id: `edge-${resolvedConnection.source}-${resolvedConnection.sourceHandle}-${resolvedConnection.target}-${resolvedConnection.targetHandle}`,
          animated: true,
          label: sourcePort && targetPort ? `${sourcePort.label} -> ${targetPort.label}` : undefined,
          style: { strokeWidth: 1.5, stroke: "#081018" },
          labelStyle: { fill: "#081018", fontWeight: 600 },
        },
        currentEdges,
      ),
    );
    setStatusMessage("Connection added.");
  }

  function connectCompatiblePorts(
    sourceNode: BuilderNode,
    sourcePortId: string,
    targetNode: BuilderNode,
    targetPortId: string,
  ) {
    const sourcePort = sourceNode.data.outputs.find((port) => port.id === sourcePortId);
    const targetPort = targetNode.data.inputs.find((port) => port.id === targetPortId);

    if (!sourcePort || !targetPort || !arePortTypesCompatible(sourcePort.dataTypes, targetPort.dataTypes)) {
      setStatusMessage("Those ports are not compatible.");
      return;
    }

    const nextEdge: Edge = {
      id: `edge-${sourceNode.id}-out:${sourcePortId}-${targetNode.id}-in:${targetPortId}`,
      source: sourceNode.id,
      sourceHandle: `out:${sourcePortId}`,
      target: targetNode.id,
      targetHandle: `in:${targetPortId}`,
      animated: true,
      label: `${sourcePort.label} -> ${targetPort.label}`,
      style: { strokeWidth: 1.5, stroke: "#081018" },
      labelStyle: { fill: "#081018", fontWeight: 600 },
    };

    setEdges((currentEdges) => {
      const alreadyConnected = currentEdges.some(
        (edge) =>
          edge.source === nextEdge.source &&
          edge.sourceHandle === nextEdge.sourceHandle &&
          edge.target === nextEdge.target &&
          edge.targetHandle === nextEdge.targetHandle,
      );

      return alreadyConnected ? currentEdges : currentEdges.concat(nextEdge);
    });
    setStatusMessage(`Connected ${sourceNode.data.label} to ${targetNode.data.label}.`);
  }

  function expandSelectedFileUploadToRag() {
    if (!selectedNode || selectedNode.data.blockType !== "file_upload") {
      return;
    }

    const extractionDefinition = getBlockDefinition("text_extraction");
    const chatInputDefinition = getBlockDefinition("chat_input");
    const ragDefinition = getBlockDefinition("rag_knowledge");
    const chatbotDefinition = getBlockDefinition("chatbot");
    const outputDefinition = getBlockDefinition("chat_output");
    if (!extractionDefinition || !chatInputDefinition || !ragDefinition || !chatbotDefinition || !outputDefinition) {
      return;
    }

    const baseX = selectedNode.position.x;
    const baseY = selectedNode.position.y;
    const suffix = Date.now();
    const extractionNode = createNodeFromDefinition(extractionDefinition, { x: baseX + 340, y: baseY }, `${suffix}-extract`);
    const chatInputNode = createNodeFromDefinition(chatInputDefinition, { x: baseX, y: baseY + 300 }, `${suffix}-chat`);
    const ragNode = createNodeFromDefinition(ragDefinition, { x: baseX + 700, y: baseY + 140 }, `${suffix}-rag`);
    const chatbotNode = createNodeFromDefinition(chatbotDefinition, { x: baseX + 1060, y: baseY + 140 }, `${suffix}-bot`);
    const outputNode = createNodeFromDefinition(outputDefinition, { x: baseX + 1420, y: baseY + 140 }, `${suffix}-out`);

    const newEdges: Edge[] = [
      {
        id: `edge-${selectedNode.id}-file-${extractionNode.id}-file`,
        source: selectedNode.id,
        sourceHandle: "out:file",
        target: extractionNode.id,
        targetHandle: "in:file",
        label: "uploaded file",
      },
      {
        id: `edge-${extractionNode.id}-document-${ragNode.id}-document`,
        source: extractionNode.id,
        sourceHandle: "out:document",
        target: ragNode.id,
        targetHandle: "in:document",
        label: "extracted document",
      },
      {
        id: `edge-${chatInputNode.id}-message-${ragNode.id}-query`,
        source: chatInputNode.id,
        sourceHandle: "out:message",
        target: ragNode.id,
        targetHandle: "in:query",
        label: "query",
      },
      {
        id: `edge-${chatInputNode.id}-message-${chatbotNode.id}-message`,
        source: chatInputNode.id,
        sourceHandle: "out:message",
        target: chatbotNode.id,
        targetHandle: "in:message",
        label: "question",
      },
      {
        id: `edge-${ragNode.id}-knowledge-${chatbotNode.id}-context`,
        source: ragNode.id,
        sourceHandle: "out:knowledge",
        target: chatbotNode.id,
        targetHandle: "in:context",
        label: "RAG context",
      },
      {
        id: `edge-${chatbotNode.id}-reply-${outputNode.id}-message`,
        source: chatbotNode.id,
        sourceHandle: "out:reply",
        target: outputNode.id,
        targetHandle: "in:message",
        label: "answer",
      },
    ].map((edge) => ({
      ...edge,
      animated: true,
      style: { strokeWidth: 1.5, stroke: "#081018" },
      labelStyle: { fill: "#081018", fontWeight: 600 },
    }));

    setNodes((currentNodes) =>
      currentNodes.concat(
        extractionNode as Node,
        chatInputNode as Node,
        ragNode as Node,
        chatbotNode as Node,
        outputNode as Node,
      ),
    );
    setEdges((currentEdges) => currentEdges.concat(newEdges));
    setStatusMessage("Expanded File Upload into a full document extraction + RAG chatbot chain.");
  }

  function expandSelectedFileUploadToDocumentAi() {
    if (!selectedNode || selectedNode.data.blockType !== "file_upload") {
      return;
    }

    const extractionDefinition = getBlockDefinition("text_extraction");
    const summarizerDefinition = getBlockDefinition("summarizer");
    const extractionAiDefinition = getBlockDefinition("extraction_ai");
    const jsonOutputDefinition = getBlockDefinition("json_output");
    const previewDefinition = getBlockDefinition("dashboard_preview");
    if (!extractionDefinition || !summarizerDefinition || !extractionAiDefinition || !jsonOutputDefinition || !previewDefinition) {
      return;
    }

    const baseX = selectedNode.position.x;
    const baseY = selectedNode.position.y;
    const suffix = Date.now();
    const extractionNode = createNodeFromDefinition(extractionDefinition, { x: baseX + 340, y: baseY }, `${suffix}-extract`);
    const summarizerNode = createNodeFromDefinition(summarizerDefinition, { x: baseX + 700, y: baseY - 140 }, `${suffix}-summary`);
    const extractionAiNode = createNodeFromDefinition(extractionAiDefinition, { x: baseX + 700, y: baseY + 160 }, `${suffix}-extract-ai`);
    const jsonOutputNode = createNodeFromDefinition(jsonOutputDefinition, { x: baseX + 1060, y: baseY + 160 }, `${suffix}-json`);
    const previewNode = createNodeFromDefinition(previewDefinition, { x: baseX + 1060, y: baseY - 140 }, `${suffix}-preview`);

    const newEdges: Edge[] = [
      {
        id: `edge-${selectedNode.id}-file-${extractionNode.id}-file`,
        source: selectedNode.id,
        sourceHandle: "out:file",
        target: extractionNode.id,
        targetHandle: "in:file",
        label: "uploaded file",
      },
      {
        id: `edge-${extractionNode.id}-document-${summarizerNode.id}-content`,
        source: extractionNode.id,
        sourceHandle: "out:document",
        target: summarizerNode.id,
        targetHandle: "in:content",
        label: "summary input",
      },
      {
        id: `edge-${extractionNode.id}-document-${extractionAiNode.id}-content`,
        source: extractionNode.id,
        sourceHandle: "out:document",
        target: extractionAiNode.id,
        targetHandle: "in:content",
        label: "JSON extraction input",
      },
      {
        id: `edge-${summarizerNode.id}-summary-${previewNode.id}-content`,
        source: summarizerNode.id,
        sourceHandle: "out:summary",
        target: previewNode.id,
        targetHandle: "in:content",
        label: "summary preview",
      },
      {
        id: `edge-${extractionAiNode.id}-json-${jsonOutputNode.id}-payload`,
        source: extractionAiNode.id,
        sourceHandle: "out:json",
        target: jsonOutputNode.id,
        targetHandle: "in:payload",
        label: "formatted JSON",
      },
    ].map((edge) => ({
      ...edge,
      animated: true,
      style: { strokeWidth: 1.5, stroke: "#081018" },
      labelStyle: { fill: "#081018", fontWeight: 600 },
    }));

    setNodes((currentNodes) =>
      currentNodes.concat(
        extractionNode as Node,
        summarizerNode as Node,
        extractionAiNode as Node,
        jsonOutputNode as Node,
        previewNode as Node,
      ),
    );
    setEdges((currentEdges) => currentEdges.concat(newEdges));
    setStatusMessage("Expanded File Upload into document summary + structured JSON formatter chain.");
  }

  function onDragStart(event: React.DragEvent<HTMLButtonElement>, blockType: string) {
    event.dataTransfer.setData("application/x-vmb-block", blockType);
    event.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();

    const blockType = event.dataTransfer.getData("application/x-vmb-block");
    const definition = getBlockDefinition(blockType);

    if (!definition || !reactFlowInstance) {
      return;
    }

    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const nextNode = createNodeFromDefinition(definition, position, `${Date.now()}`);
    setNodes((currentNodes) => currentNodes.concat(nextNode as Node));
    setStatusMessage(`${definition.title} added to the canvas.`);
  }

  function addBlockToCanvas(definition: BlockDefinition) {
    const index = `${Date.now()}`;
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
      : { x: 180 + nodes.length * 40, y: 160 + nodes.length * 30 };

    const nextNode = createNodeFromDefinition(definition, position, index);
    setNodes((currentNodes) => currentNodes.concat(nextNode as Node));
    setStatusMessage(`${definition.title} added. Connect its ports or configure runtime input.`);
  }

  function updateSelectedNodeField(field: BlockConfigFieldDefinition, value: string | boolean) {
    if (!selectedNode) {
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== selectedNode.id) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              [field.key]: coerceFieldValue(field, value),
            },
          },
        };
      }),
    );
  }

  function addExtractionSchemaField(fieldName: string) {
    if (!selectedNode) return;
    const current = String(selectedNode.data.config.schemaPrompt || "");
    const nextPrompt = current.includes(fieldName)
      ? current
      : `${current.trim()}\n- ${fieldName}: describe the ${fieldName.replace(/_/g, " ")} value`.trim();
    const rawFields = String(selectedNode.data.config.schemaFields || "");
    const fields = parseVisualSchemaFields(rawFields);
    const nextFields = fields.some((field) => field.name === fieldName)
      ? fields
      : fields.concat({ name: fieldName, type: fieldName === "confidence" ? "number" : "string", required: true, description: `Extract the ${fieldName.replace(/_/g, " ")} value.` });
    updateSelectedNodeField({ key: "schemaPrompt", label: "Schema", kind: "textarea", defaultValue: nextPrompt }, nextPrompt);
    updateSelectedNodeField({ key: "schemaFields", label: "Schema Fields", kind: "textarea", defaultValue: "" }, JSON.stringify(nextFields, null, 2));
  }

  function applyConditionRule(operator: "exists" | "boolean" | "contains" | "equals", value = "") {
    const expression = operator === "exists" || operator === "boolean" ? operator : `${operator}:${value}`;
    updateSelectedNodeField({ key: "expression", label: "Expression", kind: "text", defaultValue: expression }, expression);
    updateSelectedNodeField(
      { key: "rules", label: "Rules", kind: "textarea", defaultValue: "" },
      JSON.stringify({ logic: "and", rules: [{ field: "", operator, value }] }, null, 2),
    );
  }

  function parseVisualSchemaFields(raw: string): Array<{ name: string; type: string; required: boolean; description?: string; example?: string }> {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.filter((field) => field && typeof field.name === "string") : [];
    } catch {
      return [];
    }
  }

  function addFormInputField(fieldName: string) {
    if (!selectedNode) return;
    const current = String(selectedNode.data.config.fields || "name,email,message");
    const parts = current.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.includes(fieldName)) {
      updateSelectedNodeField({ key: "fields", label: "Fields", kind: "text", defaultValue: current }, [...parts, fieldName].join(","));
    }
  }

  function getSelectedNodeFixes() {
    if (!selectedNode) return [];
    const fixes: string[] = [];
    const incoming = edges.some((edge) => edge.target === selectedNode.id);
    const outgoing = edges.some((edge) => edge.source === selectedNode.id);
    if (selectedDefinition?.inputs.some((port) => port.required) && !incoming) {
      fixes.push("Connect a compatible upstream block or test this node with sample input.");
    }
    if (selectedDefinition?.outputs.length && !outgoing && !["chat_output", "json_output", "dashboard_preview", "logger"].includes(selectedNode.data.blockType)) {
      fixes.push("Connect this output to a downstream formatter, chatbot, logger, or preview block.");
    }
    if (selectedNode.data.blockType === "rag_knowledge") {
      fixes.push("Use a real collection from Knowledge, then run ingest before retrieval testing.");
    }
    if (selectedNode.data.blockType === "file_upload") {
      fixes.push("Attach files in Runtime Inputs or this inspector before running.");
    }
    return fixes.length ? fixes : ["This node looks configured. Use Block Test to verify its output contract."];
  }

  function applySelectedNodeFix(kind: "chat_output" | "document_preview" | "rag_chatbot" | "file_document_ai") {
    if (!selectedNode) return;
    const baseX = selectedNode.position.x + 330;
    const baseY = selectedNode.position.y;

    if (kind === "file_document_ai" && selectedNode.data.blockType === "file_upload") {
      expandSelectedFileUploadToDocumentAi();
      return;
    }

    if (kind === "chat_output") {
      const outputDefinition = getBlockDefinition("chat_output");
      if (!outputDefinition) return;
      const outputNode = createNodeFromDefinition(outputDefinition, { x: baseX, y: baseY }, `${Date.now()}`);
      setNodes((current) => current.concat(outputNode as Node));
      setEdges((current) =>
        current.concat({
          id: `edge-${selectedNode.id}-reply-${outputNode.id}-message`,
          source: selectedNode.id,
          sourceHandle: `out:${selectedNode.data.outputs.find((port) => port.id === "reply") ? "reply" : selectedNode.data.outputs[0]?.id || "result"}`,
          target: outputNode.id,
          targetHandle: "in:message",
          label: "answer",
        }),
      );
      setStatusMessage("Added Chat Output and connected the selected node.");
      return;
    }

    if (kind === "document_preview") {
      const previewDefinition = getBlockDefinition("dashboard_preview");
      const jsonDefinition = getBlockDefinition("json_output");
      if (!previewDefinition || !jsonDefinition) return;
      const previewNode = createNodeFromDefinition(previewDefinition, { x: baseX, y: baseY - 80 }, `${Date.now()}-preview`);
      const jsonNode = createNodeFromDefinition(jsonDefinition, { x: baseX, y: baseY + 120 }, `${Date.now()}-json`);
      const sourcePort = selectedNode.data.outputs.find((port) => ["document", "text", "json", "knowledge", "merged"].includes(port.id))?.id || selectedNode.data.outputs[0]?.id || "result";
      setNodes((current) => current.concat(previewNode as Node, jsonNode as Node));
      setEdges((current) =>
        current.concat(
          {
            id: `edge-${selectedNode.id}-${sourcePort}-${previewNode.id}-content`,
            source: selectedNode.id,
            sourceHandle: `out:${sourcePort}`,
            target: previewNode.id,
            targetHandle: "in:content",
            label: "preview",
          },
          {
            id: `edge-${selectedNode.id}-${sourcePort}-${jsonNode.id}-payload`,
            source: selectedNode.id,
            sourceHandle: `out:${sourcePort}`,
            target: jsonNode.id,
            targetHandle: "in:payload",
            label: "json",
          },
        ),
      );
      setStatusMessage("Added Dashboard Preview and JSON Output for the selected node.");
      return;
    }

    if (kind === "rag_chatbot") {
      const chatbotDefinition = getBlockDefinition("chatbot");
      const outputDefinition = getBlockDefinition("chat_output");
      if (!chatbotDefinition || !outputDefinition) return;
      const chatbotNode = createNodeFromDefinition(chatbotDefinition, { x: baseX, y: baseY }, `${Date.now()}-chatbot`);
      const outputNode = createNodeFromDefinition(outputDefinition, { x: baseX + 330, y: baseY }, `${Date.now()}-output`);
      setNodes((current) => current.concat(chatbotNode as Node, outputNode as Node));
      setEdges((current) =>
        current.concat(
          {
            id: `edge-${selectedNode.id}-knowledge-${chatbotNode.id}-context`,
            source: selectedNode.id,
            sourceHandle: "out:knowledge",
            target: chatbotNode.id,
            targetHandle: "in:context",
            label: "context",
          },
          {
            id: `edge-${chatbotNode.id}-reply-${outputNode.id}-message`,
            source: chatbotNode.id,
            sourceHandle: "out:reply",
            target: outputNode.id,
            targetHandle: "in:message",
            label: "answer",
          },
        ),
      );
      setStatusMessage("Added Chatbot and Chat Output after RAG Knowledge.");
    }
  }

  async function autoBuildFromPrompt() {
    if (!autoBuildPrompt.trim()) {
      setStatusMessage("Describe the workflow you want AI Studio to build.");
      return;
    }
    setIsRunning(true);
    setStatusMessage("Auto-building a graph from your prompt.");
    try {
      const workflow = await autoBuildWorkflow({ prompt: autoBuildPrompt });
      setGraph(workflow.graph_json);
      setPersistedWorkflowId(workflow.id);
      localStorage.setItem(BUILDER_WORKFLOW_ID_STORAGE_KEY, String(workflow.id));
      setIsPaletteOpen(false);
      setIsInspectorOpen(true);
      setStatusMessage(`Auto-built workflow ${workflow.id}: ${workflow.name}.`);
      setTimeout(() => zoomToFit(), 50);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Auto-build failed.");
    } finally {
      setIsRunning(false);
    }
  }

  async function testSelectedNode(inputOverride?: Record<string, unknown>) {
    if (!selectedNode) return null;
    let parsedInput: Record<string, unknown>;
    if (inputOverride) {
      parsedInput = inputOverride;
    } else {
      try {
        parsedInput = JSON.parse(nodeTestInput) as Record<string, unknown>;
      } catch {
        setStatusMessage("Block test input must be valid JSON.");
        return null;
      }
    }
    setIsRunning(true);
    setNodeTestResult(null);
    try {
      const graph = toBuilderGraph(nodes, edges);
      const workflow = await persistWorkflow(graph);
      const result = await testWorkflowNode(workflow.id, selectedNode.id, { inputs: parsedInput });
      setNodeTestResult(result as unknown as Record<string, unknown>);
      setStatusMessage(`${selectedNode.data.label} tested successfully.`);
      return result as unknown as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Block test failed.";
      setStatusMessage(message);
      setNodeTestResult({ error: message });
      return { error: message };
    } finally {
      setIsRunning(false);
    }
  }

  async function runPromptPlayground() {
    if (!selectedNode) return;
    const playgroundInputs =
      selectedNode.data.blockType === "chatbot"
        ? { message: promptPlaygroundInput, context: { matches: [{ snippet: "Remote work is allowed two days per week with manager approval.", metadata: { source: "sample policy" } }] } }
        : selectedNode.data.blockType === "summarizer"
          ? { content: promptPlaygroundInput }
          : selectedNode.data.blockType === "extraction_ai"
            ? { content: promptPlaygroundInput }
            : { content: promptPlaygroundInput, message: promptPlaygroundInput };
    const result = await testSelectedNode(playgroundInputs);
    setPromptPlaygroundResult(result);
  }

  function updateSelectedNodeLabel(label: string) {
    if (!selectedNode) {
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                label,
              },
            }
          : node,
      ),
    );
  }

  function updateRuntimeValue(nodeId: string, value: string) {
    setRuntimeInputs((current) => ({
      ...current,
      [nodeId]: {
        ...getRuntimeInputState(current, nodeId),
        value,
      },
    }));
  }

  async function updateRuntimeFiles(nodeId: string, files: FileList | null) {
    const selectedFiles = files ? Array.from(files) : [];
    setRuntimeInputs((current) => ({
      ...current,
      [nodeId]: {
        ...getRuntimeInputState(current, nodeId),
        files: selectedFiles,
        uploadedFiles: [],
        uploadStatus: selectedFiles.length ? "uploading" : "idle",
        uploadError: undefined,
      },
    }));

    if (selectedFiles.length === 0) {
      return;
    }

    setStatusMessage(`Uploading ${selectedFiles.length} file(s) to local storage.`);

    try {
      const uploadedFiles = await Promise.all(selectedFiles.map((file) => uploadRuntimeFile(file)));
      setRuntimeInputs((current) => ({
        ...current,
        [nodeId]: {
          ...getRuntimeInputState(current, nodeId),
          files: selectedFiles,
          uploadedFiles,
          uploadStatus: "ready",
          uploadError: undefined,
        },
      }));
      setStatusMessage(`${uploadedFiles.length} file(s) ready for workflow execution.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "File upload failed.";
      setRuntimeInputs((current) => ({
        ...current,
        [nodeId]: {
          ...getRuntimeInputState(current, nodeId),
          files: selectedFiles,
          uploadedFiles: [],
          uploadStatus: "error",
          uploadError: message,
        },
      }));
      setStatusMessage(message);
    }
  }

  function useLibraryFile(nodeId: string, file: FileLibraryItem) {
    const uploadedFile: RuntimeUploadResponse = {
      original_name: file.original_name,
      stored_name: file.storage_path.split("/").pop() || file.original_name,
      extension: file.extension,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      storage_path: file.storage_path,
      relative_storage_path: file.storage_path,
    };
    setRuntimeInputs((current) => ({
      ...current,
      [nodeId]: {
        ...getRuntimeInputState(current, nodeId),
        files: [],
        uploadedFiles: [uploadedFile],
        uploadStatus: "ready",
        uploadError: undefined,
      },
    }));
    setStatusMessage(`${file.original_name} selected from File Library.`);
  }

  function saveLibraryFileAsNodeDefault(file: FileLibraryItem) {
    if (!selectedNode) return;
    const currentIds = String(selectedNode.data.config.libraryFileIds || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const nextIds = currentIds.includes(String(file.id)) ? currentIds : currentIds.concat(String(file.id));
    updateSelectedNodeField({ key: "sourceMode", label: "Source Mode", kind: "select", defaultValue: "library" }, "library");
    updateSelectedNodeField({ key: "libraryFileIds", label: "Library File IDs", kind: "text", defaultValue: "" }, nextIds.join(","));
    setStatusMessage(`${file.original_name} saved as a default File Library source for this block.`);
  }

  function getNodeField(node: BuilderNode, key: string) {
    return node.data.config[key];
  }

  function deleteSelectedNode() {
    if (!selectedNode) {
      return;
    }

    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNode.id));
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id,
      ),
    );
    setStatusMessage(`${selectedNode.data.label} removed.`);
  }

  function duplicateSelectedNode() {
    if (!selectedNode) {
      setStatusMessage("Select a node before duplicating.");
      return;
    }
    const duplicatedNode: Node = {
      ...selectedNode,
      id: `${selectedNode.data.blockType}-${Date.now()}`,
      position: {
        x: selectedNode.position.x + 56,
        y: selectedNode.position.y + 56,
      },
      selected: false,
      data: {
        ...selectedNode.data,
        label: `${selectedNode.data.label} copy`,
        config: { ...selectedNode.data.config },
      },
    };
    setSelectedEdgeId(null);
    setNodes((currentNodes) =>
      [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        duplicatedNode,
      ],
    );
    setComponentSelectionIds(new Set());
    setIsInspectorOpen(true);
    setInspectorTab("flow");
    setStatusMessage(`${selectedNode.data.label} duplicated. Connect its ports when ready.`);
  }

  function deleteSelectedEdge() {
    if (!selectedEdge) {
      setStatusMessage("Select a connection before deleting.");
      return;
    }
    const edgeLabel = getEdgeAutoLabel(selectedEdge, nodes as BuilderNode[]);
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdge.id));
    setSelectedEdgeId(null);
    setComponentSelectionIds(new Set());
    setStatusMessage(`Removed connection: ${edgeLabel}.`);
  }

  function selectFlowEndpoint(nodeId: string) {
    setSelectedEdgeId(null);
    setComponentSelectionIds(new Set());
    setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: node.id === nodeId })));
    setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
    setIsInspectorOpen(true);
    setInspectorTab("flow");
  }

  function toggleComponentCollapse(componentId: string) {
    setCollapsedComponents((current) => {
      const next = new Set(current);
      if (next.has(componentId)) {
        next.delete(componentId);
      } else {
        next.add(componentId);
        const component = componentInstances.find((item) => item.id === componentId);
        if (component) {
          setComponentAnchors((anchors) => ({
            ...anchors,
            [componentId]: { x: component.bounds.x, y: component.bounds.y },
          }));
        }
      }
      return next;
    });
    const component = componentInstances.find((item) => item.id === componentId);
    setStatusMessage(component ? `Toggled component "${component.name}".` : "Toggled component group.");
  }

  function getSelectedComponentNodes(componentId?: string) {
    if (componentId) {
      return (nodes.filter((node) => node.type === "builderBlock" && getNodeComponentId(node) === componentId) as BuilderNode[]);
    }
    return nodes.filter((node) => node.type === "builderBlock" && componentSelectionIds.has(node.id)) as BuilderNode[];
  }

  async function saveSelectedNodesAsComponent(componentId?: string) {
    const selectedNodes = getSelectedComponentNodes(componentId);
    if (!selectedNodes.length) {
      setStatusMessage("Select two or more blocks, then save them as a component.");
      return;
    }
    if (!persistedWorkflowId) {
      setStatusMessage("Save the workflow once before creating reusable components.");
      return;
    }

    const defaultName = componentId
      ? componentInstances.find((component) => component.id === componentId)?.name || "Reusable Component"
      : selectedNodes.length === 1
        ? selectedNodes[0].data.label
        : `${selectedNodes[0].data.label} component`;
    const name = window.prompt("Component name", defaultName);
    if (!name?.trim()) {
      setStatusMessage("Component save cancelled.");
      return;
    }

    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const selectedEdges = (edges as BuilderEdge[]).filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target));
    const minX = Math.min(...selectedNodes.map((node) => node.position.x));
    const minY = Math.min(...selectedNodes.map((node) => node.position.y));
    const componentGraph = formatGraph(
      selectedNodes.map((node) => ({
        ...node,
        selected: false,
        position: {
          x: node.position.x - minX + 80,
          y: node.position.y - minY + 100,
        },
      })) as BuilderNode[],
      selectedEdges.map((edge) => ({ ...edge, selected: false })) as BuilderEdge[],
    );

    try {
      const component = await createWorkflowSubflow(persistedWorkflowId, {
        name: name.trim(),
        description: `Saved from builder selection with ${selectedNodes.length} block(s).`,
        graph_json: componentGraph,
      });
      setSavedComponents((current) => [component, ...current.filter((item) => item.id !== component.id)]);
      setNodes((current) =>
        current.map((node) => {
          if (!selectedNodeIds.has(node.id)) return node;
          return {
            ...node,
            data: {
              ...node.data,
              config: {
                ...node.data.config,
                componentInstanceId: componentId || `saved-${component.id}-${Date.now()}`,
                componentName: name.trim(),
                componentDescription: `Saved from builder selection with ${selectedNodes.length} block(s).`,
              },
            },
          };
        }),
      );
      setStatusMessage(`Saved "${name.trim()}" as a reusable component with ${selectedNodes.length} block(s).`);
      setIsComponentsOpen(true);
      setComponentSelectionIds(new Set());
      setIsBlockSelectionMode(false);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save component.");
    }
  }

  function saveComponentById(componentId: string) {
    void saveSelectedNodesAsComponent(componentId);
  }

  function insertComponent(component: WorkflowSubflow) {
    const componentGraph = component.graph_json;
    if (!componentGraph?.nodes?.length) {
      setStatusMessage("This component does not contain saved graph blocks yet. Re-save it from selected blocks, then insert again.");
      return;
    }
    const suffix = `component-${component.id}-${Date.now()}`;
    const componentInstanceId = suffix;
    const basePosition = reactFlowInstance?.screenToFlowPosition({ x: window.innerWidth / 2 - 180, y: window.innerHeight / 2 - 80 }) || { x: 180, y: 180 };
    const idMap = new Map(componentGraph.nodes.map((node) => [node.id, `${node.id}-${suffix}`]));
    const insertedNodes = componentGraph.nodes.map((node, index) => {
      const row = Math.floor(index / 4);
      const column = index % 4;
      const fanOffset = column * 46;
      const rowOffset = row * 92;
      const overlapOffset = index * 7;
      return {
        ...node,
        id: idMap.get(node.id) || `${node.id}-${suffix}`,
        selected: true,
        position: {
          x: basePosition.x + fanOffset + overlapOffset,
          y: basePosition.y + rowOffset + column * 16,
        },
        style: {
          ...(node as Node).style,
          zIndex: 20 + index,
          boxShadow: "0 18px 50px rgba(8,16,24,0.14)",
        },
        data: {
          ...node.data,
          label: node.data.label,
          config: {
            ...node.data.config,
            componentInstanceId,
            componentName: component.name,
            componentDescription: component.description || "Reusable workflow component.",
          },
          statusBadges: ["component", `group ${index + 1}/${componentGraph.nodes.length}`],
        },
      };
    }) as Node[];
    const insertedEdges = componentGraph.edges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({
        ...edge,
        id: `${edge.id}-${suffix}`,
        source: idMap.get(edge.source) || edge.source,
        target: idMap.get(edge.target) || edge.target,
        selected: false,
      })) as Edge[];
    const boundary = getGraphBoundaryPorts(insertedNodes as BuilderNode[], insertedEdges as BuilderEdge[]);
    setSelectedEdgeId(null);
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...insertedNodes,
    ]);
    setEdges((current) => current.concat(toFlowEdges(insertedEdges as BuilderEdge[])));
    setIsComponentsOpen(false);
    setIsInspectorOpen(false);
    setStatusMessage(
      `Inserted "${component.name}" as editable blocks with ${boundary.inputs.length} open input and ${boundary.outputs.length} open output port(s). Use normal node handles to connect them.`,
    );
    window.setTimeout(() => reactFlowInstance?.setCenter(basePosition.x + 180, basePosition.y + 120, { zoom: 0.92, duration: 350 }), 80);
  }

  function zoomToFit() {
    reactFlowInstance?.fitView({ padding: 0.18, duration: 350 });
  }

  function autoLayout() {
    setNodes((currentNodes) =>
      currentNodes.map((node, index) => ({
        ...node,
        position: {
          x: 80 + (index % 4) * 320,
          y: 80 + Math.floor(index / 4) * 220,
        },
      })),
    );
    setStatusMessage("Auto-layout applied.");
  }

  function focusSearchedNode() {
    const query = nodeSearch.trim().toLowerCase();
    if (!query) {
      return;
    }
    const match = nodes.find((node) => {
      const builderNode = node as BuilderNode;
      return (
        builderNode.data.label.toLowerCase().includes(query) ||
        builderNode.data.blockType.toLowerCase().includes(query)
      );
    });
    if (!match) {
      setStatusMessage(`No node found for "${nodeSearch}".`);
      return;
    }
    setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: node.id === match.id })));
    reactFlowInstance?.setCenter(match.position.x + 140, match.position.y + 80, { zoom: 1, duration: 350 });
  }

  async function hasUnsavedGraphChanges(graph: BuilderGraph) {
    if (!persistedWorkflowId) {
      return true;
    }

    try {
      const savedWorkflow = await getWorkflow(persistedWorkflowId);
      return graphsHaveMeaningfulChanges(graph, savedWorkflow.graph_json);
    } catch {
      return true;
    }
  }

  async function openSaveDialog() {
    const graph = toBuilderGraph(nodes, edges);
    const hasChanges = await hasUnsavedGraphChanges(graph);
    if (!hasChanges) {
      setStatusMessage("No workflow changes detected. Make a graph/config change before saving a new version.");
      return;
    }
    setVersionNote(`Saved from builder on ${new Date().toLocaleString()}`);
    setIsSaveDialogOpen(true);
  }

  async function saveGraph(noteOverride?: string) {
    const note = (noteOverride ?? versionNote).trim();
    if (!note) {
      setStatusMessage("Add a short save comment so this version is reviewable.");
      return;
    }
    const graph = toBuilderGraph(nodes, edges);
    const hasChanges = await hasUnsavedGraphChanges(graph);
    if (!hasChanges) {
      setIsSaveDialogOpen(false);
      setStatusMessage("No workflow changes detected. Version was not saved.");
      return;
    }
    localStorage.setItem(BUILDER_GRAPH_STORAGE_KEY, serializeGraph(graph));
    setStatusMessage("Saving graph and creating a workflow version.");

    try {
      if (persistedWorkflowId) {
        try {
          const conflict = await checkWorkflowConflicts(persistedWorkflowId, {
            base_version: loadedWorkflowMeta.version,
            base_updated_at: loadedWorkflowMeta.updatedAt,
          });
          if (conflict.has_conflict) {
            const shouldContinue = window.confirm(
              `Another collaborator may have changed this workflow since you loaded it.\n\nServer version: ${conflict.server_version}\nYour loaded version: ${loadedWorkflowMeta.version}\n\nSave anyway as a new version?`,
            );
            if (!shouldContinue) {
              setStatusMessage("Save paused. Reload the workflow or review Activity before overwriting.");
              return;
            }
          }
        } catch {
          // Collaboration checks are advisory; saving should still work if the API is older,
          // migrations are pending, or the presence service is temporarily unavailable.
          setStatusMessage("Collaboration conflict check unavailable. Saving graph directly.");
        }
      }
      const workflow = await persistWorkflow(graph);
      const version = await saveWorkflowVersion(
        workflow.id,
        graph,
        note,
      );
      try {
        await createWorkflowComment(workflow.id, {
          body: `Version ${version.version_number}: ${note}`,
        });
      } catch {
        // Version saving should not fail just because the activity comment could not be mirrored.
      }
      setGraph(version.graph_json);
      setPersistedWorkflowId(workflow.id);
      setLoadedWorkflowMeta({ version: version.version_number, updatedAt: null });
      localStorage.setItem(BUILDER_WORKFLOW_ID_STORAGE_KEY, String(workflow.id));
      localStorage.setItem(BUILDER_GRAPH_STORAGE_KEY, serializeGraph(version.graph_json));
      setIsSaveDialogOpen(false);
      setStatusMessage(`Workflow saved as version ${version.version_number}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save workflow version.");
    }
  }

  function loadGraph() {
    try {
      const serializedGraph = localStorage.getItem(BUILDER_GRAPH_STORAGE_KEY);

      if (!serializedGraph) {
        setStatusMessage("No saved graph found yet.");
        return;
      }

      setGraph(parseGraph(serializedGraph));
      setStatusMessage("Saved graph loaded.");
    } catch {
      setStatusMessage("Saved graph could not be parsed.");
    }
  }

  function resetGraph() {
    setGraph(initialGraph);
    setRuntimeInputs({});
    setStatusMessage("Builder reset to the starter graph.");
  }

  const preRunChecklist = isPreRunOpen ? buildPreRunChecklist() : null;
  const commandActions = [
    {
      title: "Run workflow",
      hint: "Validate inputs and execute with live updates",
      shortcut: "⌘ Enter",
      action: () => startRunWorkflow(),
    },
    {
      title: "Save version",
      hint: "Open save dialog with required comment",
      shortcut: "⌘ S",
      action: () => void openSaveDialog(),
    },
    {
      title: "Insert saved component",
      hint: "Open reusable subflows and drop one onto this canvas",
      shortcut: "Components",
      action: () => setIsComponentsOpen(true),
    },
    {
      title: "Save selection as component",
      hint: selectedBuilderNodeCount ? `Package ${selectedBuilderNodeCount} selected block(s)` : "Select multiple blocks first",
      shortcut: "Component",
      action: () => void saveSelectedNodesAsComponent(),
    },
    {
      title: "Open block palette",
      hint: "Browse and add workflow blocks",
      shortcut: "Blocks",
      action: () => setIsPaletteOpen(true),
    },
    {
      title: "Open inspector",
      hint: "Inspect selected node or connection",
      shortcut: "Inspect",
      action: () => setIsInspectorOpen(true),
    },
    {
      title: "Auto-layout graph",
      hint: "Reposition blocks into readable columns",
      shortcut: "L",
      action: () => autoLayout(),
    },
    {
      title: "Zoom to fit",
      hint: "Fit the full workflow on screen",
      shortcut: "F",
      action: () => zoomToFit(),
    },
    {
      title: "Duplicate selected node",
      hint: selectedNode ? `Duplicate ${selectedNode.data.label}` : "Select a node first",
      shortcut: "D",
      action: () => duplicateSelectedNode(),
    },
    {
      title: "Delete selected item",
      hint: selectedEdge ? "Remove selected connection" : selectedNode ? `Remove ${selectedNode.data.label}` : "Select a node or connection first",
      shortcut: "Delete",
      action: () => (selectedEdge ? deleteSelectedEdge() : deleteSelectedNode()),
    },
  ].filter((command) => {
    const query = commandSearch.trim().toLowerCase();
    if (!query) return true;
    return `${command.title} ${command.hint} ${command.shortcut}`.toLowerCase().includes(query);
  });

  return (
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(182,255,135,0.48),_transparent_24%),radial-gradient(circle_at_70%_12%,_rgba(255,143,112,0.22),_transparent_18%),radial-gradient(circle_at_bottom_right,_rgba(126,211,255,0.42),_transparent_26%),linear-gradient(135deg,_#f5fbf7_0%,_#f4eee2_46%,_#fffaf5_100%)] text-ink">
      <div className="relative h-screen p-3">
        <header className="pointer-events-none absolute left-4 right-4 top-4 z-20">
          <div className="pointer-events-auto flex max-w-4xl items-center gap-2 rounded-full border border-white/70 bg-white/82 px-2.5 py-2 shadow-panel backdrop-blur">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                Workflows
              </button>
            ) : null}
            <span className="hidden items-center gap-1.5 rounded-full bg-ink px-3 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white sm:inline-flex">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              AI Studio
            </span>
            <span className="max-w-[36vw] truncate px-2 text-sm font-semibold text-ink">
              {statusMessage}
            </span>
            <span className="hidden items-center gap-1.5 rounded-full bg-mist px-3 py-1.5 text-[11px] font-semibold text-ink/65 md:inline-flex">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              {workflowModeLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-ink/65 ring-1 ring-ink/8">
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              {nodes.length} blocks
            </span>
            <span className="hidden items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-ink/65 ring-1 ring-ink/8 sm:inline-flex">
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
              {edges.length} links
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${blockerCount ? "bg-coral/25 text-ink" : "bg-lime/35 text-ink"}`}>
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
              {blockerCount ? `${blockerCount} blockers` : "Ready"}
            </span>
            {presence.length ? (
              <span className="hidden items-center gap-1.5 rounded-full bg-sand/70 px-3 py-1.5 text-[11px] font-bold text-ink md:inline-flex">
                {presence.length} editing now
              </span>
            ) : null}
          </div>
        </header>

        <div className="absolute left-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2">
          <button type="button" onClick={() => setIsPaletteOpen(true)} className="flex min-h-28 items-center justify-center gap-2 rounded-2xl bg-ink px-2.5 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-panel [writing-mode:vertical-rl]">
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
            Blocks
          </button>
          <button type="button" onClick={() => setIsInspectorOpen(true)} className="flex min-h-28 items-center justify-center gap-2 rounded-2xl bg-white px-2.5 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-ink shadow-panel ring-1 ring-ink/8 [writing-mode:vertical-rl]">
            <PanelRightOpen className="h-4 w-4" aria-hidden />
            Inspect
          </button>
          <button type="button" onClick={() => setIsComponentsOpen(true)} className="flex min-h-28 items-center justify-center gap-2 rounded-2xl bg-lime px-2.5 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-ink shadow-panel [writing-mode:vertical-rl]">
            <Boxes className="h-4 w-4" aria-hidden />
            Components
          </button>
        </div>

        {(isPaletteOpen || isInspectorOpen || isComponentsOpen) ? (
          <button
            type="button"
            aria-label="Close open sheets"
            onClick={() => {
              setIsPaletteOpen(false);
              setIsInspectorOpen(false);
              setIsComponentsOpen(false);
            }}
            className="absolute inset-0 z-30 bg-ink/18 backdrop-blur-[1px]"
          />
        ) : null}

        {isCommandOpen ? (
          <div className="absolute inset-0 z-50 grid place-items-start bg-ink/20 px-4 pt-24 backdrop-blur-sm">
            <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95 shadow-panel">
              <div className="border-b border-ink/8 p-4">
                <div className="flex items-center gap-3">
                  <Keyboard className="h-5 w-5 text-ink/60" aria-hidden />
                  <input
                    autoFocus
                    value={commandSearch}
                    onChange={(event) => setCommandSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsCommandOpen(false);
                      }
                      if (event.key === "Enter" && commandActions[0]) {
                        commandActions[0].action();
                        setIsCommandOpen(false);
                      }
                    }}
                    placeholder="Search commands: run, save, duplicate, layout..."
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-ink/35"
                  />
                  <button
                    type="button"
                    onClick={() => setIsCommandOpen(false)}
                    className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-ink"
                  >
                    Esc
                  </button>
                </div>
              </div>
              <div className="max-h-[55vh] overflow-auto p-2">
                {commandActions.map((command) => (
                  <button
                    key={command.title}
                    type="button"
                    onClick={() => {
                      command.action();
                      setIsCommandOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-mist/80"
                  >
                    <span>
                      <span className="block text-sm font-bold text-ink">{command.title}</span>
                      <span className="mt-0.5 block text-xs text-ink/55">{command.hint}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-ink px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                      {command.shortcut}
                    </span>
                  </button>
                ))}
                {!commandActions.length ? (
                  <p className="rounded-2xl bg-mist/70 px-4 py-5 text-sm font-semibold text-ink/55">
                    No commands found.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <section className="relative h-full">
          <aside className={`absolute bottom-4 left-4 top-4 z-40 w-[min(300px,calc(100vw-2rem))] overflow-auto rounded-[1.35rem] border border-white/70 bg-white/90 p-2.5 shadow-panel backdrop-blur transition-transform duration-300 ${isPaletteOpen ? "translate-x-0" : "-translate-x-[115%]"}`}>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Boxes className="h-4 w-4" aria-hidden />
                  Blocks
                </h2>
                <p className="mt-0.5 text-[11px] leading-4 text-ink/58">
                  Drag to canvas or click to add.
                </p>
              </div>
              <button type="button" onClick={() => setIsPaletteOpen(false)} className="rounded-full bg-mist px-2.5 py-1.5 text-[11px] font-semibold">
                Close
              </button>
            </div>

            <div className="mb-3 rounded-2xl bg-mist/75 p-2">
              <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-ink/6">
                <Search className="h-3.5 w-3.5 text-ink/45" aria-hidden />
                <input
                  value={paletteSearch}
                  onChange={(event) => setPaletteSearch(event.target.value)}
                  placeholder="Search blocks by job, type, output..."
                  className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-ink outline-none placeholder:text-ink/35"
                />
              </div>
            </div>

            <div className="max-h-[78vh] space-y-3 overflow-auto pr-1">
              {filteredPaletteGroups.map((group) => (
                <section key={group.category}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-ink/45">
                      {group.category}
                    </h3>
                    <span className="text-xs text-ink/45">{group.blocks.length}</span>
                  </div>
                  <div className="grid gap-2">
                      {group.blocks.map((definition) => (
                      <button
                        key={definition.type}
                        type="button"
                        draggable
                        onClick={() => addBlockToCanvas(definition)}
                        onDragStart={(event) => onDragStart(event, definition.type)}
                        className="group rounded-[1rem] border border-ink/8 bg-white px-2.5 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-ink/15 hover:shadow-lg"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[9px] font-bold tracking-[0.16em] text-white"
                            style={{ backgroundColor: definition.accentColor }}
                          >
                            {definition.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <strong className="text-sm text-ink">{definition.title}</strong>
                              <span className="rounded-full bg-mist px-2 py-0.5 text-[9px] uppercase tracking-wide text-ink/55">
                                {definition.kind}
                              </span>
                            </div>
                            <p className="mt-1 max-h-8 overflow-hidden text-[11px] leading-4 text-ink/62">
                              {definition.description}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {definition.inputs.length ? (
                                <span className="rounded-full bg-mist px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink/55">
                                  In {definition.inputs.length}
                                </span>
                              ) : (
                                <span className="rounded-full bg-lime/30 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink/55">
                                  Runtime/source
                                </span>
                              )}
                              {definition.outputs.length ? (
                                <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white" style={{ backgroundColor: definition.accentColor }}>
                                  Out {definition.outputs.length}
                                </span>
                              ) : (
                                <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink/55">
                                  Final output
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink/38">
                              Click to add or drag to place
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {!filteredPaletteGroups.length ? (
                <p className="rounded-2xl bg-white px-3 py-5 text-center text-xs font-semibold text-ink/55">
                  No blocks match that search.
                </p>
              ) : null}
            </div>
          </aside>

          <aside className={`absolute bottom-4 left-4 top-4 z-40 w-[min(360px,calc(100vw-2rem))] overflow-auto rounded-[1.35rem] border border-white/70 bg-white/92 p-3 shadow-panel backdrop-blur transition-transform duration-300 ${isComponentsOpen ? "translate-x-0" : "-translate-x-[115%]"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Boxes className="h-4 w-4" aria-hidden />
                  Components
                </h2>
                <p className="mt-0.5 text-[11px] leading-4 text-ink/58">
                  Insert saved subflows as reusable block groups.
                </p>
              </div>
              <button type="button" onClick={() => setIsComponentsOpen(false)} className="rounded-full bg-mist px-2.5 py-1.5 text-[11px] font-semibold">
                Close
              </button>
            </div>
            <div className="mt-3 rounded-2xl bg-lime/20 p-3 text-xs leading-5 text-ink/65">
              Components now insert as real editable blocks, not a wrapper card. This keeps every block clickable, draggable, attachable, and executable with normal node handles.
            </div>
            <button
              type="button"
              onClick={() => void saveSelectedNodesAsComponent()}
              disabled={!persistedWorkflowId || selectedBuilderNodeCount === 0}
              className="mt-3 w-full rounded-2xl bg-ink px-3 py-2.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              Save Selected Blocks As Component
              <span className="mt-1 block text-[10px] font-semibold text-white/60">
                {persistedWorkflowId
                  ? `${selectedBuilderNodeCount} selected block(s)`
                  : "Save workflow first"}
              </span>
            </button>
            <div className="mt-3 max-h-[76vh] space-y-2 overflow-auto pr-1">
              {savedComponents.map((component) => {
                const nodeCount = component.graph_json?.nodes?.length || 0;
                const edgeCount = component.graph_json?.edges?.length || 0;
                const boundary = component.graph_json
                  ? getGraphBoundaryPorts(component.graph_json.nodes, component.graph_json.edges)
                  : { inputs: [], outputs: [] };
                return (
                  <article key={component.id} className="rounded-[1.15rem] border border-ink/8 bg-white p-3 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink/38">Component #{component.id}</p>
                    <h3 className="mt-1 text-sm font-bold text-ink">{component.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink/58">
                      {component.description || "Reusable workflow component."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/55">
                      <span className="rounded-full bg-mist px-2 py-1">{nodeCount} blocks</span>
                      <span className="rounded-full bg-mist px-2 py-1">{edgeCount} links</span>
                      <span className="rounded-full bg-lime/30 px-2 py-1">{boundary.inputs.length} in</span>
                      <span className="rounded-full bg-ink/8 px-2 py-1">{boundary.outputs.length} out</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => insertComponent(component)}
                      disabled={!nodeCount}
                      className="mt-3 w-full rounded-2xl bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-45"
                    >
                      Insert Editable Blocks
                    </button>
                  </article>
                );
              })}
              {!savedComponents.length ? (
                <p className="rounded-2xl bg-mist/70 px-3 py-5 text-center text-xs font-semibold text-ink/55">
                  No saved components yet. Save one from a workflow Activity panel first.
                </p>
              ) : null}
            </div>
          </aside>

          <div className="h-full overflow-hidden rounded-[1.7rem] border border-white/70 bg-white/58 shadow-panel backdrop-blur">
            <div className="pointer-events-none absolute right-6 top-5 z-10 hidden lg:block">
              <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-ink/10 bg-white/90 px-3 py-2 shadow-panel backdrop-blur">
                <button type="button" onClick={() => void openSaveDialog()} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-white"><Save className="h-3.5 w-3.5" aria-hidden />Save</button>
                <button type="button" onClick={loadGraph} className="inline-flex items-center gap-1.5 rounded-full bg-mist px-3 py-1.5 text-[11px] font-semibold"><FolderOpen className="h-3.5 w-3.5" aria-hidden />Load</button>
                <button type="button" onClick={resetGraph} className="inline-flex items-center gap-1.5 rounded-full bg-mist px-3 py-1.5 text-[11px] font-semibold"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Reset</button>
                <button type="button" onClick={startRunWorkflow} disabled={isRunning} className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-2 text-xs font-bold text-ink disabled:opacity-60">
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  {isRunning ? "Running" : "Run"}
                </button>
                <button type="button" onClick={publishCurrentWorkflow} disabled={isRunning || !isCurrentChatWorkflow} className="inline-flex items-center gap-1.5 rounded-full bg-coral/80 px-3 py-2 text-xs font-bold text-ink disabled:opacity-40">
                  <Rocket className="h-3.5 w-3.5" aria-hidden />
                  Publish
                </button>
              </div>
            </div>
            <div className="h-full min-h-0" onDragOver={onDragOver} onDrop={onDrop}>
              <ReactFlow
                fitView
                fitViewOptions={{ padding: 0.18, maxZoom: 0.92 }}
                defaultViewport={{ x: 0, y: 0, zoom: 0.78 }}
                nodes={flowNodesWithBadges}
                edges={flowEdgesWithLabels}
                onNodesChange={onNodesChange}
                onNodeClick={onNodeClick}
                onEdgesChange={onEdgesChange}
                onEdgeClick={onEdgeClick}
                onPaneClick={onPaneClick}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                onInit={setReactFlowInstance}
                nodeTypes={nodeTypes}
                snapToGrid
                snapGrid={[16, 16]}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#d5ded5" gap={18} />
                <Controls />
                <Panel position="bottom-center">
                  <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-ink/10 bg-white/95 px-2.5 py-2 shadow-panel">
                    <input
                      value={nodeSearch}
                      onChange={(event) => setNodeSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") focusSearchedNode();
                      }}
                      placeholder="Search nodes"
                      className="w-36 rounded-full bg-mist px-3 py-1.5 text-[11px] outline-none"
                    />
                    <button type="button" onClick={focusSearchedNode} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-white">
                      <Search className="h-3.5 w-3.5" aria-hidden />
                      Find
                    </button>
                    <button type="button" onClick={zoomToFit} className="inline-flex items-center gap-1.5 rounded-full bg-mist px-3 py-1.5 text-[11px] font-semibold">
                      <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                      Fit
                    </button>
                    <button type="button" onClick={autoLayout} className="inline-flex items-center gap-1.5 rounded-full bg-mist px-3 py-1.5 text-[11px] font-semibold">
                      <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
                      Layout
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBlockSelectionMode((current) => !current);
                        setComponentSelectionIds(new Set());
                        setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: false })));
                        setIsInspectorOpen(false);
                        setStatusMessage(
                          isBlockSelectionMode
                            ? "Selection mode off. Click a block to inspect it."
                            : "Selection mode on. Click blocks to select them for a reusable component.",
                        );
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${
                        isBlockSelectionMode ? "bg-lime text-ink" : "bg-mist text-ink"
                      }`}
                    >
                      <Boxes className="h-3.5 w-3.5" aria-hidden />
                      {isBlockSelectionMode ? "Selecting" : "Select Blocks"}
                    </button>
                    {selectedBuilderNodeCount ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveSelectedNodesAsComponent()}
                          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-bold text-white"
                        >
                          Save Component ({selectedBuilderNodeCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setComponentSelectionIds(new Set());
                            setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: false })));
                            setStatusMessage("Component selection cleared.");
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-ink ring-1 ring-ink/8"
                        >
                          Clear
                        </button>
                      </>
                    ) : null}
                  </div>
                </Panel>
              </ReactFlow>
            </div>
          </div>

          <aside className={`absolute bottom-4 right-4 top-4 z-40 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[1.55rem] border border-white/70 bg-white/94 shadow-panel backdrop-blur transition-transform duration-300 ${isInspectorOpen ? "translate-x-0" : "translate-x-[115%]"}`}>
            <div className="border-b border-ink/8 bg-white/95 p-3 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ink/38">
                    Builder Inspector
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    {selectedEdgeInspection && inspectorTab === "flow"
                      ? "Data Flow"
                      : selectedDefinition?.title ?? "Workflow Control"}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-ink/58">
                    {inspectorTabs.find((tab) => tab.id === inspectorTab)?.hint}
                  </p>
                </div>
                <button type="button" onClick={() => setIsInspectorOpen(false)} className="rounded-full bg-mist px-3 py-2 text-xs font-semibold">
                  Close
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1 rounded-[1.1rem] bg-mist/75 p-1">
                {inspectorTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setInspectorTab(tab.id)}
                    className={`rounded-[0.85rem] px-2.5 py-2 text-[11px] font-bold transition ${
                      inspectorTab === tab.id
                        ? "bg-ink text-white shadow-sm"
                        : "text-ink/58 hover:bg-white/75 hover:text-ink"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {selectedEdge && selectedEdgeInspection && inspectorTab === "flow" ? (
                <div className="mb-4 space-y-3 rounded-[1.6rem] border border-ink/8 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ink/38">Data Flow Inspector</p>
                      <h3 className="mt-1 text-lg font-semibold text-ink">{selectedEdgeInspection.label}</h3>
                      <p className="mt-1 text-xs leading-5 text-ink/58">
                        This edge decides which output payload is passed into which input port during DAG execution.
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${selectedEdgeInspection.compatible ? "bg-lime/35 text-ink" : "bg-coral/20 text-ink"}`}>
                      {selectedEdgeInspection.compatible ? "Compatible" : "Check ports"}
                    </span>
                  </div>

                  <div className="grid gap-2">
                    <div className="rounded-2xl bg-mist/70 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink/42">Source</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {selectedEdgeInspection.sourceNode?.data.label || selectedEdge.source}
                      </p>
                      <p className="mt-1 text-xs text-ink/58">
                        Output port: <strong>{selectedEdgeInspection.sourcePort?.label || selectedEdgeInspection.sourcePortId}</strong>
                      </p>
                    </div>
                    <div className="rounded-2xl bg-mist/70 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink/42">Target</p>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {selectedEdgeInspection.targetNode?.data.label || selectedEdge.target}
                      </p>
                      <p className="mt-1 text-xs text-ink/58">
                        Input port: <strong>{selectedEdgeInspection.targetPort?.label || selectedEdgeInspection.targetPortId}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => selectFlowEndpoint(selectedEdge.source)}
                      className="rounded-2xl bg-white px-3 py-2 text-xs font-bold text-ink ring-1 ring-ink/8"
                    >
                      Select source
                    </button>
                    <button
                      type="button"
                      onClick={() => selectFlowEndpoint(selectedEdge.target)}
                      className="rounded-2xl bg-white px-3 py-2 text-xs font-bold text-ink ring-1 ring-ink/8"
                    >
                      Select target
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelectedEdge}
                      className="rounded-2xl bg-coral/15 px-3 py-2 text-xs font-bold text-ink ring-1 ring-coral/25"
                    >
                      Remove link
                    </button>
                  </div>

                  <div className="rounded-2xl bg-ink p-3 text-white">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">Payload Shape</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(selectedEdgeInspection.dataTypes.length ? selectedEdgeInspection.dataTypes : ["unknown"]).map((type) => (
                        <span key={type} className="rounded-full bg-white/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/80">
                          {type}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-white/70">
                      Executor reads <strong>{selectedEdgeInspection.sourcePortId}</strong> from the source output and appends it to <strong>{selectedEdgeInspection.targetPortId}</strong> on the target input.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-lime/20 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink/42">Last Run Preview</p>
                    <p className="mt-1 text-xs leading-5 text-ink/70">
                      {selectedEdgeInspection.lastPreview || "Run the workflow once to see the actual payload preview that crossed this edge."}
                    </p>
                  </div>
                </div>
              ) : null}

            {selectedNode && selectedDefinition ? (
              <div className="space-y-5">
                <div
                  className="rounded-[1.6rem] p-4 text-white"
                  style={{ backgroundColor: selectedNode.data.accentColor }}
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 text-xs font-bold tracking-[0.2em]">
                      {selectedNode.data.icon}
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.3em] text-white/80">
                        {selectedNode.data.category}
                      </p>
                      <h3 className="text-lg font-semibold">{selectedDefinition.title}</h3>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/85">
                    {selectedDefinition.description}
                  </p>
                </div>

                <div className={`rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6 ${inspectorTab === "flow" ? "" : "hidden"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">Node Input Mapping</p>
                      <p className="mt-1 text-xs leading-5 text-ink/55">
                        This shows exactly which upstream outputs feed each input on this block.
                      </p>
                    </div>
                    <span className="rounded-full bg-mist px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ink/55">
                      {nodeInputMappings.reduce((total, item) => total + item.sources.length, 0)} source(s)
                    </span>
                  </div>

                  {nodeInputMappings.length ? (
                    <div className="mt-3 space-y-3">
                      {nodeInputMappings.map((mapping) => (
                        <div key={mapping.inputPortId} className="rounded-2xl border border-ink/8 bg-mist/55 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold text-ink">
                                Input: {mapping.inputLabel}
                                {mapping.required ? <span className="ml-1 text-coral">required</span> : null}
                              </p>
                              <p className="mt-1 text-[11px] text-ink/52">
                                Accepts {mapping.inputTypes.join(", ") || "any"} payloads
                              </p>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${mapping.sources.length ? "bg-lime/35 text-ink" : mapping.required ? "bg-coral/20 text-ink" : "bg-white text-ink/50"}`}>
                              {mapping.sources.length ? `${mapping.sources.length} wired` : "empty"}
                            </span>
                          </div>

                          {mapping.sources.length ? (
                            <div className="mt-3 space-y-2">
                              {mapping.sources.map((source) => (
                                <button
                                  key={source.edgeId}
                                  type="button"
                                  onClick={() => {
                                    setSelectedEdgeId(source.edgeId);
                                    setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: edge.id === source.edgeId })));
                                  }}
                                  className="w-full rounded-xl bg-white px-3 py-2 text-left text-xs transition hover:bg-lime/20"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <strong className="truncate text-ink">{source.sourceNodeLabel}</strong>
                                    <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white">
                                      {source.sourcePortLabel}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] leading-4 text-ink/55">
                                    {source.edgeLabel} · {source.sourceTypes.join(", ") || "unknown"}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink/62">
                                    {source.lastPreview || "No run preview yet."}
                                  </p>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-ink/55">
                              No upstream output is mapped here yet. Connect a compatible output port to this input.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-2xl bg-mist/70 px-3 py-3 text-xs leading-5 text-ink/62">
                      This is a source/runtime block. It starts data flow instead of receiving upstream input.
                    </p>
                  )}
                </div>

                <div className={`rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6 ${inspectorTab === "flow" ? "" : "hidden"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">Where This Block Sends Data</p>
                      <p className="mt-1 text-xs leading-5 text-ink/55">
                        Outgoing mappings show which downstream blocks consume each output.
                      </p>
                    </div>
                    <span className="rounded-full bg-mist px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ink/55">
                      {nodeOutputMappings.reduce((total, item) => total + item.targets.length, 0)} target(s)
                    </span>
                  </div>

                  {nodeOutputMappings.length ? (
                    <div className="mt-3 space-y-3">
                      {nodeOutputMappings.map((mapping) => (
                        <div key={mapping.outputPortId} className="rounded-2xl border border-ink/8 bg-white p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold text-ink">Output: {mapping.outputLabel}</p>
                              <p className="mt-1 text-[11px] text-ink/52">
                                Emits {mapping.outputTypes.join(", ") || "any"} payloads
                              </p>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${mapping.targets.length ? "bg-lime/35 text-ink" : "bg-mist text-ink/50"}`}>
                              {mapping.targets.length ? `${mapping.targets.length} used` : "unused"}
                            </span>
                          </div>

                          {mapping.targets.length ? (
                            <div className="mt-3 space-y-2">
                              {mapping.targets.map((target) => (
                                <button
                                  key={target.edgeId}
                                  type="button"
                                  onClick={() => {
                                    setSelectedEdgeId(target.edgeId);
                                    setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: edge.id === target.edgeId })));
                                  }}
                                  className="w-full rounded-xl bg-mist/65 px-3 py-2 text-left text-xs transition hover:bg-lime/20"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <strong className="truncate text-ink">{target.targetNodeLabel}</strong>
                                    <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white">
                                      {target.targetPortLabel}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] leading-4 text-ink/55">
                                    {target.edgeLabel} · {target.targetTypes.join(", ") || "unknown"}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink/62">
                                    {target.lastPreview || "No run preview yet."}
                                  </p>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 rounded-xl bg-mist/65 px-3 py-2 text-xs leading-5 text-ink/55">
                              This output is not connected yet. Add an output block or downstream processor if this result should be used.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-2xl bg-mist/70 px-3 py-3 text-xs leading-5 text-ink/62">
                      This is a terminal/output block. It consumes data and ends a visible branch.
                    </p>
                  )}
                </div>

                <div className={`rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6 ${inspectorTab === "config" ? "" : "hidden"}`}>
                  <p className="text-sm font-semibold text-ink">How This Block Becomes Useful</p>
                  <div className="mt-3 space-y-2">
                    {getBlockGuide(selectedNode.data.blockType).map((item) => (
                      <p key={item} className="rounded-2xl bg-mist/75 px-3 py-2 text-xs leading-5 text-ink/68">
                        {item}
                      </p>
                    ))}
                  </div>
                </div>

                <div className={`rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6 ${inspectorTab === "test" ? "" : "hidden"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">Block Test</p>
                      <p className="mt-1 text-xs leading-5 text-ink/55">Run only this node with sample JSON to verify outputs before wiring the full workflow.</p>
                    </div>
                    <button type="button" onClick={() => void testSelectedNode()} disabled={isRunning} className="rounded-full bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      Test
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={nodeTestInput}
                    onChange={(event) => setNodeTestInput(event.target.value)}
                    className="mt-3 w-full rounded-2xl border border-ink/10 bg-mist/60 px-3 py-2 font-mono text-[11px] outline-none"
                  />
                  {nodeTestResult ? (
                    <pre className="mt-3 max-h-44 overflow-auto rounded-2xl bg-ink p-3 text-[11px] leading-5 text-white/85">
                      {JSON.stringify(nodeTestResult, null, 2)}
                    </pre>
                  ) : null}
                </div>

                <div className={`rounded-[1.6rem] bg-sand/45 p-4 ${inspectorTab === "fixes" ? "" : "hidden"}`}>
                  <p className="text-sm font-semibold text-ink">Suggested Fixes</p>
                  <div className="mt-3 space-y-2">
                    {getSelectedNodeFixes().map((fix) => (
                      <p key={fix} className="rounded-2xl bg-white/80 px-3 py-2 text-xs leading-5 text-ink/65">
                        {fix}
                      </p>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedNode.data.blockType === "file_upload" ? (
                      <button type="button" onClick={() => applySelectedNodeFix("file_document_ai")} className="rounded-full bg-ink px-3 py-2 text-xs font-semibold text-white">
                        Add Extract + AI Chain
                      </button>
                    ) : null}
                    {selectedNode.data.blockType === "rag_knowledge" ? (
                      <button type="button" onClick={() => applySelectedNodeFix("rag_chatbot")} className="rounded-full bg-ink px-3 py-2 text-xs font-semibold text-white">
                        Add RAG Chatbot
                      </button>
                    ) : null}
                    {selectedNode.data.blockType === "chatbot" || selectedNode.data.outputs.some((port) => port.id === "reply") ? (
                      <button type="button" onClick={() => applySelectedNodeFix("chat_output")} className="rounded-full bg-lime/50 px-3 py-2 text-xs font-semibold text-ink">
                        Add Chat Output
                      </button>
                    ) : null}
                    {selectedNode.data.outputs.length ? (
                      <button type="button" onClick={() => applySelectedNodeFix("document_preview")} className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink ring-1 ring-ink/8">
                        Add Preview + JSON
                      </button>
                    ) : null}
                  </div>
                </div>

                {selectedNode.data.blockType === "file_upload" && inspectorTab === "runtime" ? (
                  <div className="rounded-[1.6rem] border border-lime/40 bg-lime/20 p-4">
                    <p className="text-sm font-semibold text-ink">Attach Documents For This File Upload</p>
                    <p className="mt-1 text-xs leading-5 text-ink/62">
                      Pick files once here. They upload immediately to local storage and the run
                      reuses those stored paths, so the backend will not ask again.
                    </p>
                    <input
                      type="file"
                      accept={String(getNodeField(selectedNode, "accept") || ".pdf,.docx,.txt,.csv,.json")}
                      multiple={Boolean(getNodeField(selectedNode, "multiple"))}
                      onChange={(event) => {
                        void updateRuntimeFiles(selectedNode.id, event.target.files);
                        event.target.value = "";
                      }}
                      className="mt-3 w-full rounded-2xl border border-dashed border-ink/20 bg-white px-4 py-4 text-sm text-ink/70 file:mr-4 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                    />
                    {getRuntimeInputState(runtimeInputs, selectedNode.id).uploadStatus === "uploading" ? (
                      <p className="mt-3 rounded-xl bg-sand/70 px-3 py-2 text-xs font-semibold text-ink">
                        Uploading to local storage...
                      </p>
                    ) : null}
                    {getRuntimeInputState(runtimeInputs, selectedNode.id).uploadStatus === "error" ? (
                      <p className="mt-3 rounded-xl bg-coral/20 px-3 py-2 text-xs font-semibold text-ink">
                        {getRuntimeInputState(runtimeInputs, selectedNode.id).uploadError}
                      </p>
                    ) : null}
                    {(getRuntimeInputState(runtimeInputs, selectedNode.id).uploadedFiles || []).length ? (
                      <div className="mt-3 space-y-1">
                        {getRuntimeInputState(runtimeInputs, selectedNode.id).uploadedFiles.map((file) => (
                          <p key={file.storage_path} className="rounded-xl bg-lime/35 px-3 py-2 text-xs font-semibold text-ink">
                            Ready: {file.original_name} · {(file.size_bytes / 1024).toFixed(1)} KB
                          </p>
                        ))}
                      </div>
                    ) : (getRuntimeInputState(runtimeInputs, selectedNode.id).files || []).length ? (
                      <div className="mt-3 space-y-1">
                        {getRuntimeInputState(runtimeInputs, selectedNode.id).files.map((file) => (
                          <p key={`${file.name}-${file.size}`} className="rounded-xl bg-white px-3 py-2 text-xs text-ink">
                            Selected: {file.name} · {(file.size / 1024).toFixed(1)} KB
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {libraryFiles.length ? (
                      <div className="mt-4 rounded-2xl bg-white/70 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink/45">Reuse From File Library</p>
                        <div className="mt-2 max-h-44 space-y-2 overflow-auto">
                          {libraryFiles.map((file) => (
                            <button
                              key={file.id}
                              type="button"
                              onClick={() => useLibraryFile(selectedNode.id, file)}
                              className="flex w-full items-center justify-between gap-3 rounded-xl bg-mist/70 px-3 py-2 text-left text-xs font-semibold text-ink transition hover:bg-lime/30"
                            >
                              <span className="truncate">{file.original_name}</span>
                              <span className="shrink-0 text-ink/45">{(file.size_bytes / 1024).toFixed(1)} KB</span>
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 max-h-32 space-y-2 overflow-auto border-t border-ink/8 pt-3">
                          {libraryFiles.map((file) => (
                            <button
                              key={`default-${file.id}`}
                              type="button"
                              onClick={() => saveLibraryFileAsNodeDefault(file)}
                              className="flex w-full items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-left text-xs font-semibold text-ink transition hover:bg-sand/70"
                            >
                              <span className="truncate">Make default: {file.original_name}</span>
                              <span className="shrink-0 text-ink/45">ID {file.id}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={expandSelectedFileUploadToDocumentAi}
                      className="mt-4 w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white"
                    >
                      Build Summary + JSON Chain
                    </button>
                    <button
                      type="button"
                      onClick={expandSelectedFileUploadToRag}
                      className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink"
                    >
                      Build RAG Q&A Chain
                    </button>
                  </div>
                ) : null}

                {connectionSuggestions.length && inspectorTab === "fixes" ? (
                  <div className="rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6">
                    <p className="text-sm font-semibold text-ink">One-Click Connections</p>
                    <p className="mt-1 text-xs leading-5 text-ink/58">
                      If dragging handles feels fiddly, use these compatible connections.
                    </p>
                    <div className="mt-3 space-y-2">
                      {connectionSuggestions.map((suggestion) => (
                        <button
                          key={`${suggestion.sourcePortId}-${suggestion.targetNode.id}-${suggestion.targetPortId}`}
                          type="button"
                          onClick={() =>
                            connectCompatiblePorts(
                              suggestion.sourceNode,
                              suggestion.sourcePortId,
                              suggestion.targetNode,
                              suggestion.targetPortId,
                            )
                          }
                          className="w-full rounded-2xl border border-ink/10 bg-mist/80 px-3 py-3 text-left text-xs font-semibold text-ink transition hover:bg-lime/30"
                        >
                          {suggestion.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className={`block ${inspectorTab === "config" ? "" : "hidden"}`}>
                  <span className="mb-2 block text-sm font-semibold text-ink">Node Label</span>
                  <input
                    type="text"
                    value={selectedNode.data.label}
                    onChange={(event) => updateSelectedNodeLabel(event.target.value)}
                    className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                  />
                </label>

                {selectedNode.data.blockType === "condition" && inspectorTab === "config" ? (
                  <div className="rounded-[1.4rem] bg-mist/70 p-4">
                    <p className="text-sm font-semibold text-ink">Condition Builder</p>
                    <p className="mt-1 text-xs leading-5 text-ink/55">Pick a safe rule preset. It writes both the visual JSON rule and the legacy expression fallback.</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        { label: "Exists", operator: "exists" as const, value: "" },
                        { label: "Boolean true", operator: "boolean" as const, value: "" },
                        { label: "Contains urgent", operator: "contains" as const, value: "urgent" },
                        { label: "Equals approved", operator: "equals" as const, value: "approved" },
                      ].map((rule) => (
                        <button
                          key={rule.label}
                          type="button"
                          onClick={() => applyConditionRule(rule.operator, rule.value)}
                          className="rounded-2xl bg-white px-3 py-2 text-xs font-semibold"
                        >
                          {rule.label}
                        </button>
                      ))}
                    </div>
                    <pre className="mt-3 max-h-28 overflow-auto rounded-2xl bg-white p-3 text-[11px] leading-5 text-ink/65">
                      {String(selectedNode.data.config.rules || "No visual rules yet.")}
                    </pre>
                  </div>
                ) : null}

                {selectedNode.data.blockType === "extraction_ai" && inspectorTab === "config" ? (
                  <div className="rounded-[1.4rem] bg-mist/70 p-4">
                    <p className="text-sm font-semibold text-ink">Visual JSON Schema Editor</p>
                    <p className="mt-1 text-xs leading-5 text-ink/55">
                      Build the Extraction AI output contract as fields. These chips update the schema prompt used by the executor.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["title", "summary", "risks", "owners", "important_dates", "action_items", "confidence", "source_notes"].map((fieldName) => (
                        <button
                          key={fieldName}
                          type="button"
                          onClick={() => addExtractionSchemaField(fieldName)}
                          className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-ink/8 transition hover:bg-lime/30"
                        >
                          + {fieldName}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 rounded-2xl bg-white p-3 text-xs leading-5 text-ink/62">
                      <p className="font-semibold text-ink">Current contract</p>
                      <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap">
                        {String(selectedNode.data.config.schemaPrompt || "No schema prompt yet. Add fields above.")}
                      </pre>
                      {selectedNode.data.config.schemaFields ? (
                        <pre className="mt-2 max-h-36 overflow-auto rounded-xl bg-mist/70 p-2 font-mono text-[11px]">
                          {String(selectedNode.data.config.schemaFields)}
                        </pre>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-2">
                      {[
                        "Extract title, summary, action_items, risks, and owners as JSON.",
                        "Extract invoice_number, vendor, due_date, total_due, line_items, and anomalies as JSON.",
                        "Extract person_name, email, phone, skills, experience_years, and recommendations as JSON.",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => updateSelectedNodeField({ key: "schemaPrompt", label: "Schema", kind: "textarea", defaultValue: prompt }, prompt)}
                          className="rounded-2xl bg-white px-3 py-2 text-left text-xs font-semibold leading-5"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedNode.data.blockType === "chatbot" && inspectorTab === "config" ? (
                  <div className="rounded-[1.4rem] bg-mist/70 p-4">
                    <p className="text-sm font-semibold text-ink">Prompt Editor Helpers</p>
                    <div className="mt-3 grid gap-2">
                      {[
                        "Answer naturally using retrieved context. Cite sources when available and say when context is missing.",
                        "You are a concise internal support assistant. Give short, actionable answers.",
                        "You are a careful document analyst. Summarize evidence, identify uncertainty, and avoid guessing.",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => updateSelectedNodeField({ key: "systemPrompt", label: "System Prompt", kind: "textarea", defaultValue: prompt }, prompt)}
                          className="rounded-2xl bg-white px-3 py-2 text-left text-xs font-semibold leading-5"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {["chatbot", "summarizer", "extraction_ai", "classifier"].includes(selectedNode.data.blockType) && inspectorTab === "test" ? (
                  <div className="rounded-[1.4rem] bg-white p-4 ring-1 ring-ink/6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-ink">Prompt Playground</p>
                        <p className="mt-1 text-xs leading-5 text-ink/55">
                          Test this AI block with sample content before running the full workflow.
                        </p>
                      </div>
                      <button type="button" onClick={() => void runPromptPlayground()} disabled={isRunning} className="rounded-full bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                        Run
                      </button>
                    </div>
                    <textarea
                      rows={4}
                      value={promptPlaygroundInput}
                      onChange={(event) => setPromptPlaygroundInput(event.target.value)}
                      className="mt-3 w-full rounded-2xl border border-ink/10 bg-mist/60 px-3 py-2 text-sm outline-none"
                    />
                    {promptPlaygroundResult ? (
                      <pre className="mt-3 max-h-56 overflow-auto rounded-2xl bg-ink p-3 text-[11px] leading-5 text-white/85">
                        {JSON.stringify(promptPlaygroundResult, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}

                {selectedNode.data.blockType === "prompt_template" && inspectorTab === "config" ? (
                  <div className="rounded-[1.4rem] bg-mist/70 p-4">
                    <p className="text-sm font-semibold text-ink">Prompt Template Studio</p>
                    <p className="mt-1 text-xs leading-5 text-ink/55">Use variables like {"{{message}}"}, {"{{context}}"}, and {"{{document}}"} so upstream blocks can fill the prompt.</p>
                    <div className="mt-3 grid gap-2">
                      {[
                        "Summarize {{document}} for {{audience}}. Return risks, actions, and sources.",
                        "Rewrite this user question for retrieval: {{message}}. Include synonyms and entities.",
                        "Convert {{text}} into a concise support answer using {{context}}.",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => updateSelectedNodeField({ key: "template", label: "Template", kind: "textarea", defaultValue: prompt }, prompt)}
                          className="rounded-2xl bg-white px-3 py-2 text-left text-xs font-semibold leading-5"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedNode.data.blockType === "form_input" && inspectorTab === "config" ? (
                  <div className="rounded-[1.4rem] bg-mist/70 p-4">
                    <p className="text-sm font-semibold text-ink">Form Builder</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["name", "email", "company", "request_type", "message", "priority", "attachment_url"].map((fieldName) => (
                        <button
                          key={fieldName}
                          type="button"
                          onClick={() => addFormInputField(fieldName)}
                          className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-ink/8"
                        >
                          + {fieldName}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className={`space-y-4 ${inspectorTab === "config" ? "" : "hidden"}`}>
                  {selectedDefinition.fields.map((field) => (
                    <label key={field.key} className="block">
                      <span className="block text-sm font-semibold text-ink">{field.label}</span>
                      {field.description ? (
                        <span className="mt-1 block text-xs text-ink/52">{field.description}</span>
                      ) : null}

                      {field.kind === "textarea" ? (
                        <textarea
                          rows={4}
                          value={String(getFieldValue(selectedNode.data.config, field))}
                          placeholder={field.placeholder}
                          onChange={(event) => updateSelectedNodeField(field, event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                        />
                      ) : null}

                      {field.kind === "text" ? (
                        <input
                          type="text"
                          value={String(getFieldValue(selectedNode.data.config, field))}
                          placeholder={field.placeholder}
                          onChange={(event) => updateSelectedNodeField(field, event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                        />
                      ) : null}

                      {field.kind === "number" ? (
                        <input
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={Number(getFieldValue(selectedNode.data.config, field))}
                          onChange={(event) => updateSelectedNodeField(field, event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                        />
                      ) : null}

                      {field.kind === "select" ? (
                        <select
                          value={String(getFieldValue(selectedNode.data.config, field))}
                          onChange={(event) => updateSelectedNodeField(field, event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                        >
                          {field.options?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : null}

                      {field.kind === "toggle" ? (
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedNodeField(
                              field,
                              !Boolean(getFieldValue(selectedNode.data.config, field)),
                            )
                          }
                          className={`mt-2 flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm transition ${
                            Boolean(getFieldValue(selectedNode.data.config, field))
                              ? "border-lime/50 bg-lime/25 text-ink"
                              : "border-ink/10 bg-white text-ink/70"
                          }`}
                        >
                          <span>
                            {Boolean(getFieldValue(selectedNode.data.config, field))
                              ? "Enabled"
                              : "Disabled"}
                          </span>
                          <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.25em]">
                            Toggle
                          </span>
                        </button>
                      ) : null}
                    </label>
                  ))}
                </div>

                <div className={`rounded-[1.6rem] bg-mist/90 p-4 ${inspectorTab === "config" ? "" : "hidden"}`}>
                  <p className="text-sm font-semibold text-ink">Ports</p>
                  <div className="mt-3 grid gap-2">
                    {selectedDefinition.inputs.map((port) => (
                      <div
                        key={port.id}
                        className="flex items-center justify-between rounded-2xl bg-white px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-ink/80">In: {port.label}</span>
                        <span className="text-ink/55">{port.dataTypes.join(", ")}</span>
                      </div>
                    ))}
                    {selectedDefinition.outputs.map((port) => (
                      <div
                        key={port.id}
                        className="flex items-center justify-between rounded-2xl bg-white px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-ink/80">Out: {port.label}</span>
                        <span className="text-ink/55">{port.dataTypes.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={deleteSelectedNode}
                  className={`w-full rounded-2xl border border-coral/40 bg-coral/15 px-4 py-3 text-sm font-semibold text-ink ${inspectorTab === "config" ? "" : "hidden"}`}
                >
                  Delete Node
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[1.75rem] border border-dashed border-ink/15 bg-mist/70 p-6 text-sm leading-6 text-ink/62">
                  Select a node on the canvas to inspect and edit its schema-driven settings. Save and
                  load actions work for the whole graph using local browser storage.
                </div>
                <div className={`rounded-[1.75rem] bg-ink p-4 text-white ${inspectorTab === "tools" ? "" : "hidden"}`}>
                  <p className="text-sm font-semibold">Smart Auto-Build</p>
                  <p className="mt-1 text-xs leading-5 text-white/65">
                    Describe the workflow and AI Studio will create a saved graph using schema-driven blocks.
                  </p>
                  <textarea
                    rows={4}
                    value={autoBuildPrompt}
                    onChange={(event) => setAutoBuildPrompt(event.target.value)}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
                  />
                  <button
                    type="button"
                    onClick={() => void autoBuildFromPrompt()}
                    disabled={isRunning}
                    className="mt-3 w-full rounded-2xl bg-lime px-4 py-3 text-sm font-semibold text-ink disabled:opacity-50"
                  >
                    Build Workflow
                  </button>
                </div>
              </div>
            )}

            <div className={`mt-5 rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6 ${inspectorTab === "fixes" ? "" : "hidden"}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">Run Readiness</p>
                <span className="rounded-full bg-mist px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/55">
                  {diagnostics.filter((item) => item.level === "error").length} blockers
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {diagnostics.map((diagnostic) => (
                  <p
                    key={diagnostic.message}
                    className={`rounded-2xl px-3 py-2 text-xs leading-5 ${
                      diagnostic.level === "error"
                        ? "bg-coral/18 text-ink"
                        : diagnostic.level === "warning"
                          ? "bg-sand/60 text-ink/75"
                          : "bg-lime/30 text-ink"
                    }`}
                  >
                    {diagnostic.message}
                  </p>
                ))}
              </div>
            </div>

            <div className={`mt-5 rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6 ${inspectorTab === "run" ? "" : "hidden"}`}>
              <p className="text-sm font-semibold text-ink">Publish Modes</p>
              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  onClick={publishCurrentWorkflow}
                  disabled={isRunning || !isCurrentChatWorkflow}
                  className="rounded-2xl bg-ink px-4 py-3 text-left text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCurrentChatWorkflow ? "Publish Chatbot" : "Chat URL unavailable"}
                  <span className="mt-1 block text-xs font-normal text-white/65">
                    {isCurrentChatWorkflow
                      ? "Creates /chat URL for chat-only or pre-ingested RAG chat workflows."
                      : "Runtime file/document workflows should be shared with the /app URL so users can upload files and view outputs."}
                  </span>
                </button>
                {[
                  { label: "Publish API Endpoint", detail: "Use the Publish tab to copy the local chat API endpoint and request snippet." },
                  { label: "Publish Form/App", detail: "Every saved workflow already has a shareable /app/:workflowId local app URL." },
                  { label: "Share Local Preview", detail: "Run the workflow and open the full run page for clean logs, timings, outputs, and errors." },
                ].map((mode) => (
                  <button
                    key={mode.label}
                    type="button"
                    onClick={() => setStatusMessage(mode.detail)}
                    className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-left text-sm font-semibold text-ink"
                  >
                    {mode.label}
                    <span className="mt-1 block text-xs font-normal text-ink/55">{mode.detail}</span>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-sm font-semibold text-ink">Published URL</p>
              {publishedUrl && isCurrentChatWorkflow ? (
                <button
                  type="button"
                  onClick={() => {
                    const slug = publishedUrl.split("/chat/")[1];
                    if (slug) {
                      onOpenChat?.(slug);
                    }
                  }}
                  className="mt-2 block w-full rounded-2xl bg-lime/30 px-4 py-3 text-left text-sm font-semibold text-ink"
                >
                  {publishedUrl}
                </button>
              ) : (
                <p className="mt-1 text-sm leading-6 text-ink/58">
                  {isCurrentChatWorkflow
                    ? "Publish the current workflow to create a local chat URL."
                    : "This is a builder/document workflow. Run it here to upload files and inspect JSON, previews, and logs."}
                </p>
              )}
            </div>

            <div className={`mt-5 rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6 ${inspectorTab === "run" || inspectorTab === "runtime" ? "" : "hidden"}`}>
              <p className="text-base font-semibold text-ink">Runtime Inputs</p>
              <p className="mt-1 text-sm leading-6 text-ink/58">
                These are the values used when you click Run. File Upload nodes now ask for
                documents here, upload them locally, and pass them into Text Extraction/RAG.
              </p>

              <label className="mt-4 block rounded-[1.35rem] bg-mist/80 p-3">
                <span className="block text-sm font-semibold text-ink">Default Chat Message</span>
                <span className="mt-1 block text-xs leading-5 text-ink/55">
                  Used by Chat Input nodes unless you override a specific node below.
                </span>
                <textarea
                  rows={3}
                  value={runMessage}
                  onChange={(event) => setRunMessage(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                />
              </label>

              <div className="mt-4 space-y-3">
                {runtimeInputNodes.length ? (
                  runtimeInputNodes.map((node) => {
                    const blockType = node.data.blockType;
                    const runtimeInput = getRuntimeInputState(runtimeInputs, node.id);
                    const runtimeValue = runtimeInput.value || "";
                    const runtimeFiles = runtimeInput.files || [];
                    const runtimeUploadedFiles = runtimeInput.uploadedFiles || [];

                    return (
                      <div key={node.id} className="rounded-[1.4rem] border border-ink/8 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-ink">{node.data.label}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-ink/45">
                              {blockType.split("_").join(" ")}
                            </p>
                          </div>
                          <span
                            className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
                            style={{ backgroundColor: node.data.accentColor }}
                          >
                            Runtime
                          </span>
                        </div>

                        {blockType === "chat_input" ? (
                          <textarea
                            rows={3}
                            value={runtimeValue}
                            placeholder={String(getNodeField(node, "placeholder") || runMessage)}
                            onChange={(event) => updateRuntimeValue(node.id, event.target.value)}
                            className="mt-3 w-full rounded-2xl border border-ink/10 bg-mist/50 px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                          />
                        ) : null}

                        {blockType === "text_input" ? (
                          <textarea
                            rows={4}
                            value={runtimeValue}
                            placeholder="Optional runtime override. Leave blank to use the node's Default Text."
                            onChange={(event) => updateRuntimeValue(node.id, event.target.value)}
                            className="mt-3 w-full rounded-2xl border border-ink/10 bg-mist/50 px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                          />
                        ) : null}

                        {blockType === "file_upload" ? (
                          <div className="mt-3">
                            <input
                              type="file"
                              accept={String(getNodeField(node, "accept") || ".pdf,.docx,.txt,.csv,.json")}
                              multiple={Boolean(getNodeField(node, "multiple"))}
                              onChange={(event) => {
                                void updateRuntimeFiles(node.id, event.target.files);
                                event.target.value = "";
                              }}
                              className="w-full rounded-2xl border border-dashed border-ink/20 bg-mist/60 px-4 py-4 text-sm text-ink/70 file:mr-4 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                            />
                            <p className="mt-2 text-xs leading-5 text-ink/55">
                              Accepted: {String(getNodeField(node, "accept") || ".pdf,.docx,.txt,.csv,.json")} · Max{" "}
                              {String(getNodeField(node, "maxSizeMb") || 10)} MB per file.
                            </p>
                            {runtimeInput.uploadStatus === "uploading" ? (
                              <p className="mt-2 rounded-xl bg-sand/70 px-3 py-2 text-xs font-semibold text-ink">
                                Uploading to local storage...
                              </p>
                            ) : null}
                            {runtimeInput.uploadStatus === "error" ? (
                              <p className="mt-2 rounded-xl bg-coral/20 px-3 py-2 text-xs font-semibold text-ink">
                                {runtimeInput.uploadError}
                              </p>
                            ) : null}
                            {runtimeUploadedFiles.length ? (
                              <div className="mt-2 space-y-1">
                                {runtimeUploadedFiles.map((file) => (
                                  <p key={file.storage_path} className="rounded-xl bg-lime/25 px-3 py-2 text-xs font-semibold text-ink">
                                    Ready: {file.original_name} · {(file.size_bytes / 1024).toFixed(1)} KB
                                  </p>
                                ))}
                              </div>
                            ) : runtimeFiles.length ? (
                              <div className="mt-2 space-y-1">
                                {runtimeFiles.map((file) => (
                                  <p key={`${file.name}-${file.size}`} className="rounded-xl bg-lime/25 px-3 py-2 text-xs text-ink">
                                    Selected: {file.name} · {(file.size / 1024).toFixed(1)} KB
                                  </p>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="rounded-[1.35rem] bg-mist/80 p-4 text-sm leading-6 text-ink/58">
                    Add a Chat Input, Text Input, or File Upload block to provide runtime values.
                  </p>
                )}
              </div>

              <label className="mt-4 block">
                <span className="block text-sm font-semibold text-ink">Session ID</span>
                <input
                  type="text"
                  value={sessionId}
                  onChange={(event) => setSessionId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                />
              </label>

              <label className="mt-4 block">
                <span className="block text-sm font-semibold text-ink">User ID</span>
                <input
                  type="text"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-ink/25"
                />
              </label>

              <button
                type="button"
                onClick={startRunWorkflow}
                disabled={isRunning}
                className="mt-4 w-full rounded-2xl bg-ink px-5 py-4 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRunning ? "Running current graph..." : "Run Current Graph"}
              </button>
              {lastRun ? (
                <button
                  type="button"
                  onClick={() => onOpenRun?.(lastRun)}
                  className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
                >
                  Open Full Run Page
                </button>
              ) : null}

              <div className="mt-4 rounded-[1.4rem] bg-mist/90 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">Latest Run</p>
                    <p className="mt-1 text-xs text-ink/55">
                      Friendly output cards from Chat, JSON, Dashboard/Preview, and Logger blocks.
                    </p>
                  </div>
                  {lastRun ? (
                    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                      lastRun.status === "completed" ? "bg-lime/35 text-ink" : "bg-coral/20 text-ink"
                    }`}>
                      {lastRun.status}
                    </span>
                  ) : null}
                </div>
                {lastRun ? (
                  <div className="mt-2 space-y-3 text-sm text-ink/75">
                    <p>
                      Run #{lastRun.id} for workflow #{lastRun.workflow_id} finished with status{" "}
                      <strong>{lastRun.status}</strong>.
                    </p>
                    <p className="rounded-2xl bg-lime/20 px-4 py-3 text-sm leading-6 text-ink">
                      {explainWorkflowRun(lastRun)}
                    </p>
                    {runDisplayCards.length ? (
                      <div className="space-y-3">
                        {runDisplayCards.map((card) => (
                          <article key={card.id} className="rounded-[1.25rem] bg-white p-4 ring-1 ring-ink/6">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ink/45">
                                  {card.kind}
                                </p>
                                <h3 className="mt-1 text-sm font-semibold text-ink">{card.title}</h3>
                              </div>
                              <span className="rounded-full bg-mist px-3 py-1 text-[10px] font-semibold text-ink/55">
                                Output
                              </span>
                            </div>
                            {card.summary ? (
                              <p className="mt-3 rounded-2xl bg-mist/70 px-3 py-2 text-xs leading-5 text-ink/65">
                                {card.summary}
                              </p>
                            ) : null}
                            <div className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl bg-[#fbfcf8] px-4 py-3 text-sm leading-6 text-ink">
                              {card.body || "No displayable output returned."}
                            </div>
                            {card.metadata ? (
                              <details className="mt-3 rounded-2xl bg-mist/60 px-3 py-2 text-xs text-ink/65">
                                <summary className="cursor-pointer font-semibold text-ink">Details</summary>
                                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-5">
                                  {JSON.stringify(card.metadata, null, 2)}
                                </pre>
                              </details>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-ink/70">
                        {extractRunSummary(lastRun).text}
                      </div>
                    )}
                    {lastRun.error_message ? (
                      <p className="rounded-2xl bg-coral/15 px-4 py-3 text-xs leading-6 text-ink">
                        {lastRun.error_message}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-ink/58">
                    No run yet. Use the starter graph, enter a message, and click Run Current
                    Graph.
                  </p>
                )}
              </div>
            </div>

            <div className={`mt-5 rounded-[1.6rem] bg-white p-4 ring-1 ring-ink/6 ${inspectorTab === "tools" ? "" : "hidden"}`}>
              <p className="text-sm font-semibold text-ink">Available Blocks</p>
              <p className="mt-1 text-sm text-ink/58">
                {blockDefinitions.length} schema-defined blocks exist. Only implemented MVP blocks
                are visible in the palette by default.
              </p>
            </div>

            <div className={`mt-5 ${inspectorTab === "tools" ? "" : "hidden"}`}>
              <RagManager workflowId={persistedWorkflowId} />
            </div>
            </div>
          </aside>
        </section>
      </div>
      {isSaveDialogOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/28 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[2rem] bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">Save Version</p>
                <h2 className="mt-2 text-2xl font-bold">What changed?</h2>
                <p className="mt-1 text-sm leading-6 text-ink/58">
                  This note is saved with the workflow version and mirrored into Activity comments for reviewers.
                </p>
              </div>
              <button type="button" onClick={() => setIsSaveDialogOpen(false)} className="rounded-full bg-mist px-4 py-2 text-sm font-semibold">
                Cancel
              </button>
            </div>
            <textarea
              rows={5}
              value={versionNote}
              onChange={(event) => setVersionNote(event.target.value)}
              placeholder="Example: Connected RAG retrieval to chatbot, adjusted chunk size, and added dashboard output."
              className="mt-4 w-full rounded-[1.35rem] border border-ink/10 bg-mist/60 px-4 py-3 text-sm leading-6 outline-none focus:border-ink/25"
              autoFocus
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-5 text-ink/50">
                Tip: mention nodes added, removed, rewired, config changes, or why this version matters.
              </p>
              <button
                type="button"
                onClick={() => void saveGraph(versionNote)}
                disabled={!versionNote.trim()}
                className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save Version
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {preRunChecklist ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/28 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[2rem] bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink/45">
                  Pre-Run Checklist
                </p>
                <h2 className="mt-2 text-2xl font-bold">Ready to execute?</h2>
                <p className="mt-1 text-sm text-ink/58">
                  {preRunChecklist.graph.nodes.length} blocks, {preRunChecklist.graph.edges.length} connections, {preRunChecklist.llmCount} AI block(s), {preRunChecklist.ragCount} RAG block(s).
                </p>
              </div>
              <button type="button" onClick={() => setIsPreRunOpen(false)} className="rounded-full bg-mist px-4 py-2 text-sm font-semibold">
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className={`rounded-2xl p-4 ${preRunChecklist.blockerCount ? "bg-coral/15" : "bg-lime/25"}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/45">Blockers</p>
                <p className="mt-1 text-2xl font-bold">{preRunChecklist.blockerCount}</p>
              </div>
              <div className="rounded-2xl bg-sand/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/45">Warnings</p>
                <p className="mt-1 text-2xl font-bold">{preRunChecklist.warningCount}</p>
              </div>
              <div className="rounded-2xl bg-mist p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/45">Owner</p>
                <p className="mt-1 truncate text-sm font-bold">{preRunChecklist.user?.display_name || preRunChecklist.user?.email || "local user"}</p>
              </div>
            </div>
            <div className="mt-4 max-h-64 overflow-auto rounded-[1.4rem] bg-mist/70 p-4">
              <p className="text-sm font-semibold">Inputs and checks</p>
              <div className="mt-3 space-y-2">
                {preRunChecklist.runtimeSummary.map((item) => (
                  <p key={item} className="rounded-2xl bg-white px-3 py-2 text-xs text-ink/70">{item}</p>
                ))}
                {preRunChecklist.diagnostics.map((item) => (
                  <p key={item.message} className={`rounded-2xl px-3 py-2 text-xs ${item.level === "error" ? "bg-coral/15" : item.level === "warning" ? "bg-sand/60" : "bg-lime/25"}`}>
                    {item.message}
                  </p>
                ))}
                <p className="rounded-2xl bg-white px-3 py-2 text-xs text-ink/60">
                  OpenRouter is configured on the backend via OPENROUTER_API_KEY. If it is missing, the run will fail with a provider error.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setIsPreRunOpen(false)} className="rounded-full bg-mist px-4 py-2 text-sm font-semibold">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runWorkflow()}
                disabled={preRunChecklist.blockerCount > 0 || isRunning}
                className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {preRunChecklist.blockerCount ? "Fix Blockers First" : "Run Workflow"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BuilderPage(props: BuilderPageProps) {
  return (
    <ReactFlowProvider>
      <BuilderCanvas {...props} />
    </ReactFlowProvider>
  );
}
