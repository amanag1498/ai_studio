import { Handle, Position, type NodeProps } from "reactflow";
import { Boxes, ChevronDown, ChevronRight } from "lucide-react";
import type { BlockPortDefinition } from "@vmb/shared";

export type ComponentBoundaryPort = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  port: BlockPortDefinition;
};

export type ComponentGroupData = {
  componentId: string;
  label: string;
  description?: string;
  collapsed: boolean;
  nodeCount: number;
  edgeCount: number;
  childOffsets: Record<string, { x: number; y: number }>;
  inputs: ComponentBoundaryPort[];
  outputs: ComponentBoundaryPort[];
  onToggle?: (componentId: string) => void;
  onSave?: (componentId: string) => void;
};

export function ComponentGroupNode({ data, selected }: NodeProps<ComponentGroupData>) {
  const maxVisiblePorts = 4;
  return (
    <div
      className={`relative h-full w-full rounded-[28px] border-2 shadow-[0_24px_80px_rgba(8,16,24,0.08)] backdrop-blur-sm transition ${
        data.collapsed
          ? selected
            ? "border-ink/35 bg-white/88 text-ink ring-4 ring-lime/35"
            : "border-white/75 bg-white/82 text-ink"
          : selected
            ? "border-ink/45 bg-white/28"
            : "border-dashed border-ink/16 bg-white/24"
      }`}
    >
      {data.inputs.slice(0, maxVisiblePorts).map((boundary, index) => (
        <Handle
          key={boundary.id}
          id={`in:${boundary.nodeId}:${boundary.port.id}`}
          type="target"
          position={Position.Left}
          style={{ top: data.collapsed ? 92 + index * 30 : 94 + index * 28, left: -8, background: "#081018" }}
          className="!h-5 !w-5 !border-[3px] !border-white !shadow-lg"
        />
      ))}
      {data.outputs.slice(0, maxVisiblePorts).map((boundary, index) => (
        <Handle
          key={boundary.id}
          id={`out:${boundary.nodeId}:${boundary.port.id}`}
          type="source"
          position={Position.Right}
          style={{ top: data.collapsed ? 92 + index * 30 : 94 + index * 28, right: -8, background: "#b6ff87" }}
          className="!h-5 !w-5 !border-[3px] !border-white !shadow-lg"
        />
      ))}

      <div className={`pointer-events-auto absolute left-4 right-4 top-4 overflow-hidden rounded-[22px] border p-3 shadow-sm ${
        data.collapsed ? "border-white/80 bg-white/88" : "border-white/70 bg-white/90"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.24em] ${
              data.collapsed ? "text-ink/42" : "text-ink/42"
            }`}>
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              Component
            </p>
            <h3 className="mt-1 truncate text-sm font-bold text-ink">{data.label}</h3>
            <p className="mt-1 text-[11px] leading-4 text-ink/55">
              {data.nodeCount} blocks · {data.edgeCount} links · {data.inputs.length} in / {data.outputs.length} out
            </p>
          </div>
          <button
            type="button"
            onClick={() => data.onToggle?.(data.componentId)}
            className={`nodrag nopan grid h-8 w-8 shrink-0 place-items-center rounded-full ${
              data.collapsed ? "bg-ink text-white" : "bg-ink text-white"
            }`}
            aria-label={data.collapsed ? "Expand component" : "Collapse component"}
          >
            {data.collapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </button>
        </div>

        {data.collapsed ? (
          <div className="mt-3">
            <div className="relative h-24">
              <div className="absolute left-8 right-0 top-7 h-14 rotate-3 rounded-2xl border border-ink/8 bg-[#f3d6bf] shadow-sm" />
              <div className="absolute left-4 right-5 top-4 h-14 -rotate-2 rounded-2xl border border-ink/8 bg-lime/60 shadow-sm" />
              <div className="absolute inset-x-0 top-0 rounded-2xl border border-ink/8 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-mist px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-ink/70">
                    Packaged flow
                  </span>
                  <span className="text-[11px] font-semibold text-ink/46">
                    Drag card to move group
                  </span>
                </div>
                <div className="mt-3 flex gap-1.5">
                  {Array.from({ length: Math.min(data.nodeCount, 5) }).map((_, index) => (
                    <span
                      key={index}
                      className="h-2.5 flex-1 rounded-full bg-ink/12"
                      style={{ opacity: 0.25 + index * 0.1 }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-mist/75 p-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink/42">Attach Into Component</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.inputs.length ? data.inputs.slice(0, maxVisiblePorts).map((boundary) => (
                    <span key={boundary.id} className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-ink/65">
                      {boundary.port.label}
                    </span>
                  )) : <span className="text-[11px] font-semibold text-ink/45">No open inputs</span>}
                  {data.inputs.length > maxVisiblePorts ? (
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-ink/55">
                      +{data.inputs.length - maxVisiblePorts}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl bg-lime/40 p-2 text-ink">
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink/45">Attach From Component</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.outputs.length ? data.outputs.slice(0, maxVisiblePorts).map((boundary) => (
                    <span key={boundary.id} className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-ink/75">
                      {boundary.port.label}
                    </span>
                  )) : <span className="text-[11px] font-semibold text-ink/45">No open outputs</span>}
                  {data.outputs.length > maxVisiblePorts ? (
                    <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-ink/55">
                      +{data.outputs.length - maxVisiblePorts}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => data.onToggle?.(data.componentId)}
              className="nodrag nopan mt-2 w-full rounded-2xl bg-ink px-3 py-2 text-[11px] font-bold text-white"
            >
              Expand internals
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => data.onSave?.(data.componentId)}
              className="nodrag nopan rounded-full bg-mist px-3 py-1.5 text-[11px] font-bold text-ink"
            >
              Save copy
            </button>
            <span className="rounded-full bg-lime/35 px-3 py-1.5 text-[11px] font-bold text-ink">
              Boundary ports exposed
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
