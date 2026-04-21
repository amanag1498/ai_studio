import { Handle, Position, type NodeProps } from "reactflow";
import type { BuilderBlockData } from "@vmb/shared";

export function BuilderBlockNode({ data }: NodeProps<BuilderBlockData>) {
  const hasInputs = data.inputs.length > 0;
  const hasOutputs = data.outputs.length > 0;

  return (
    <div className="relative min-w-[245px] rounded-[24px] border border-ink/10 bg-white/95 p-3 shadow-panel ring-1 ring-white/70 transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(8,16,24,0.16)]">
      {data.inputs.map((port, index) => (
        <Handle
          key={port.id}
          id={`in:${port.id}`}
          type="target"
          position={Position.Left}
          style={{ top: 70 + index * 30, left: -8, background: data.accentColor }}
          className="!h-4 !w-4 !border-[3px] !border-white !shadow-lg"
        />
      ))}
      {data.outputs.map((port, index) => (
        <Handle
          key={port.id}
          id={`out:${port.id}`}
          type="source"
          position={Position.Right}
          style={{ top: 70 + index * 30, right: -8, background: data.accentColor }}
          className="!h-4 !w-4 !border-[3px] !border-white !shadow-lg"
        />
      ))}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="grid h-9 w-9 place-items-center rounded-2xl text-[10px] font-bold tracking-[0.18em] text-white"
            style={{ backgroundColor: data.accentColor }}
          >
            {data.icon}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink/45">
              {data.category}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-ink">{data.label}</h3>
          </div>
        </div>
        <span
          className="rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-ink/55"
          style={{ backgroundColor: `${data.accentColor}20` }}
        >
          {data.kind}
        </span>
      </div>
      {data.statusBadges?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.statusBadges.slice(0, 4).map((badge) => (
            <span
              key={badge}
              className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                badge.includes("failed") || badge.includes("missing")
                  ? "bg-coral/20 text-ink"
                  : badge.includes("output") || badge.includes("ready")
                    ? "bg-lime/30 text-ink"
                    : "bg-mist text-ink/65"
              }`}
            >
              {badge}
            </span>
          ))}
        </div>
      ) : null}
      {data.runPreview ? (
        <div className={`mt-3 rounded-2xl px-3 py-2 text-xs leading-5 ${
          data.runPreview.status === "failed" ? "bg-coral/18 text-ink" : "bg-lime/25 text-ink"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{data.runPreview.status}</span>
            {data.runPreview.latencyMs !== undefined && data.runPreview.latencyMs !== null ? (
              <span className="text-ink/50">{data.runPreview.latencyMs}ms</span>
            ) : null}
          </div>
          <p className="mt-1 max-h-10 overflow-hidden text-ink/65">
            {data.runPreview.error || data.runPreview.summary || "Output produced."}
          </p>
        </div>
      ) : null}
      {data.description ? (
        <p className="mt-2 max-h-10 overflow-hidden text-xs leading-5 text-ink/62">{data.description}</p>
      ) : null}

      <div className="mt-3 grid gap-2">
        {hasInputs ? (
          <div className="rounded-2xl bg-mist/80 px-3 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-ink/45">
              Inputs
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.inputs.map((port) => (
                <span key={port.id} className="rounded-full bg-white/75 px-2 py-1 text-[10px] font-semibold text-ink/70">
                  {port.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {hasOutputs ? (
          <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-ink/5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-ink/45">
              Outputs
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.outputs.map((port) => (
                <span key={port.id} className="rounded-full px-2 py-1 text-[10px] font-semibold text-white" style={{ backgroundColor: data.accentColor }}>
                  {port.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
