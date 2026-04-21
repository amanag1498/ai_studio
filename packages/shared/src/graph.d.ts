export type BlockKind = "input" | "knowledge" | "agent" | "logic" | "memory" | "output" | "system";
export type BlockCategory = "Inputs" | "Knowledge" | "AI" | "Logic" | "Memory" | "Outputs" | "System";
export type BlockDataType = "text" | "chat" | "file" | "document" | "knowledge" | "memory" | "boolean" | "json" | "preview" | "log" | "any";
export type BlockConfigValue = string | number | boolean;
export type BlockConfigFieldKind = "text" | "textarea" | "number" | "select" | "toggle";
export interface BlockConfigOption {
    label: string;
    value: string;
}
export interface BlockConfigFieldDefinition {
    key: string;
    label: string;
    kind: BlockConfigFieldKind;
    description?: string;
    placeholder?: string;
    defaultValue: BlockConfigValue;
    min?: number;
    max?: number;
    step?: number;
    options?: BlockConfigOption[];
}
export interface BlockPortDefinition {
    id: string;
    label: string;
    direction: "input" | "output";
    dataTypes: BlockDataType[];
    description?: string;
    required?: boolean;
}
export interface BlockDefinition {
    type: string;
    title: string;
    category: BlockCategory;
    kind: BlockKind;
    description: string;
    accentColor: string;
    icon: string;
    visibleInPalette?: boolean;
    implementationStatus?: "implemented" | "stub";
    releasePhase?: "mvp" | "phase2" | "phase3";
    integrationNotes?: string;
    inputs: BlockPortDefinition[];
    outputs: BlockPortDefinition[];
    fields: BlockConfigFieldDefinition[];
}
export interface Position2D {
    x: number;
    y: number;
}
export type BuilderBlockConfig = Record<string, BlockConfigValue>;
export interface BuilderBlockData {
    blockType: string;
    label: string;
    kind: BlockKind;
    category: BlockCategory;
    description?: string;
    accentColor: string;
    icon: string;
    inputs: BlockPortDefinition[];
    outputs: BlockPortDefinition[];
    config: BuilderBlockConfig;
    statusBadges?: string[];
}
export interface BuilderNode {
    id: string;
    type: "builderBlock";
    position: Position2D;
    data: BuilderBlockData;
}
export interface BuilderEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
}
export interface BuilderGraph {
    id: string;
    name: string;
    version: number;
    nodes: BuilderNode[];
    edges: BuilderEdge[];
}
