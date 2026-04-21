import {
  blockDefinitions,
  getBlockDefinition,
  type BlockConfigFieldDefinition,
  type BlockConfigValue,
  type BlockDataType,
  type BlockDefinition,
  type BlockPortDefinition,
  type BuilderBlockConfig,
  type BuilderEdge,
  type BuilderGraph,
  type BuilderNode,
} from "@vmb/shared";

export const BUILDER_GRAPH_STORAGE_KEY = "vmb-builder-graph";

export function getDefaultConfig(definition: BlockDefinition): BuilderBlockConfig {
  return definition.fields.reduce<BuilderBlockConfig>((config, field) => {
    config[field.key] = field.defaultValue;
    return config;
  }, {});
}

export function createNodeFromDefinition(
  definition: BlockDefinition,
  position: { x: number; y: number },
  index: number | string,
): BuilderNode {
  return {
    id: `${definition.type}-${index}`,
    type: "builderBlock",
    position,
    data: {
      blockType: definition.type,
      label: definition.title,
      kind: definition.kind,
      category: definition.category,
      description: definition.description,
      accentColor: definition.accentColor,
      icon: definition.icon,
      inputs: definition.inputs,
      outputs: definition.outputs,
      config: getDefaultConfig(definition),
    },
  };
}

export function formatGraph(nodes: BuilderNode[], edges: BuilderEdge[]): BuilderGraph {
  return {
    id: "local-builder-graph",
    name: "AI Studio",
    version: 1,
    nodes,
    edges,
  };
}

export function hydrateGraph(graph: BuilderGraph): BuilderGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const definition = getBlockDefinition(node.data.blockType);

      if (!definition) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          kind: definition.kind,
          category: definition.category,
          description: definition.description,
          accentColor: definition.accentColor,
          icon: definition.icon,
          inputs: definition.inputs,
          outputs: definition.outputs,
          config: {
            ...getDefaultConfig(definition),
            ...node.data.config,
          },
        },
      };
    }),
  };
}

export function serializeGraph(graph: BuilderGraph): string {
  return JSON.stringify(graph, null, 2);
}

export function parseGraph(serializedGraph: string): BuilderGraph {
  return hydrateGraph(JSON.parse(serializedGraph) as BuilderGraph);
}

export function getFieldValue(
  config: BuilderBlockConfig,
  field: BlockConfigFieldDefinition,
): BlockConfigValue {
  return config[field.key] ?? field.defaultValue;
}

export function coerceFieldValue(
  field: BlockConfigFieldDefinition,
  rawValue: string | boolean,
): BlockConfigValue {
  if (field.kind === "toggle") {
    return Boolean(rawValue);
  }

  if (field.kind === "number") {
    return rawValue === "" ? field.defaultValue : Number(rawValue);
  }

  return String(rawValue);
}

export function getPortByHandle(
  node: BuilderNode,
  handleId: string | null | undefined,
  direction: "input" | "output",
): BlockPortDefinition | undefined {
  const prefix = direction === "input" ? "in:" : "out:";

  if (!handleId?.startsWith(prefix)) {
    return undefined;
  }

  const portId = handleId.slice(prefix.length);
  const ports = direction === "input" ? node.data.inputs : node.data.outputs;
  return ports.find((port) => port.id === portId);
}

export function arePortTypesCompatible(sourceTypes: BlockDataType[], targetTypes: BlockDataType[]) {
  return (
    sourceTypes.includes("any") ||
    targetTypes.includes("any") ||
    sourceTypes.some((type) => targetTypes.includes(type))
  );
}

export function getPaletteGroups() {
  return ["Inputs", "Knowledge", "AI", "Logic", "Memory", "Outputs", "System"].map(
    (category) => ({
      category,
      blocks: blockDefinitions.filter(
        (definition) => definition.category === category && definition.visibleInPalette !== false,
      ),
    }),
  );
}
