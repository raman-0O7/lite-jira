"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useRef, useState } from "react";

import { Loading } from "@/components/loading/skeletons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type Burndown,
  fetchBurndown,
  fetchSprints,
  fetchVelocity,
  sprintKeys,
  type Velocity,
} from "@/lib/api/sprints";

/**
 * Sprint reports (docs/features/21-sprints.md §4): a burndown for one sprint
 * and velocity across completed sprints. Charts are plain SVG; series colors
 * are --viz-1 / --viz-2, validated for colorblind separation in both themes.
 */
export function SprintReports({ projectId }: { projectId: string }) {
  const sprints = useQuery({ queryKey: sprintKeys.list(projectId), queryFn: () => fetchSprints(projectId) });
  const started = (sprints.data ?? []).filter((s) => s.state !== "PLANNED");
  const [picked, setPicked] = useState<string | null>(null);
  const sprintId = picked ?? started[0]?.id ?? null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-5 md:px-6">
        <section aria-labelledby="burndown-title" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="burndown-title" className="font-heading text-sm font-semibold text-foreground">
                Burndown
              </h2>
              <p className="text-xs text-muted-foreground">Work left in the sprint at the end of each day.</p>
            </div>
            {started.length > 0 ? (
              <Select value={sprintId ?? undefined} onValueChange={setPicked}>
                <SelectTrigger size="sm" aria-label="Sprint" className="max-w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {started.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.state === "ACTIVE" ? " (active)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
          {sprints.isPending ? (
            <ChartSkeleton label="Loading sprints" />
          ) : sprintId ? (
            <BurndownPanel sprintId={sprintId} />
          ) : (
            <Empty>Start a sprint from the backlog to see its burndown.</Empty>
          )}
        </section>

        <section aria-labelledby="velocity-title" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div>
            <h2 id="velocity-title" className="font-heading text-sm font-semibold text-foreground">
              Velocity
            </h2>
            <p className="text-xs text-muted-foreground">Committed at the start vs completed, for recent sprints.</p>
          </div>
          <VelocityPanel projectId={projectId} />
        </section>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="flex h-40 items-center justify-center text-center text-sm text-muted-foreground">{children}</p>;
}

function ChartSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label}>
      <Skeleton className="h-[260px] w-full" />
    </Loading>
  );
}

/** Track an element's width so the SVG draws at real pixels (text stays 11px). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round axis ticks: 0 … ≥max in 3–5 steps of 1, 2, 5 × 10ⁿ. */
function niceTicks(max: number) {
  const top = Math.max(max, 1);
  const raw = top / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => top / s <= 5) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2 && ticks.length < 7; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks.at(-1)! < top) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

const unitLabel = (unit: "points" | "issues", n: number) =>
  unit === "points" ? `${n} ${n === 1 ? "pt" : "pts"}` : `${n} ${n === 1 ? "issue" : "issues"}`;

function LineKey({ className, dashed }: { className: string; dashed?: boolean }) {
  return (
    <svg width="16" height="8" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="4" x2="15" y2="4" strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} className={className} />
    </svg>
  );
}

function BarKey({ className }: { className: string }) {
  return <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-[3px] ${className}`} />;
}

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="text-xs">
      <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">Show as a table</summary>
      <table className="mt-2 w-full border-collapse text-left tabular">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-muted-foreground">
            {head.map((h) => (
              <th key={h} scope="col" className="py-1.5 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {row.map((cell, j) => (
                <td key={j} className="py-1.5 pr-4 text-soft">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ---------------------------------------------------------------- burndown

function BurndownPanel({ sprintId }: { sprintId: string }) {
  const burndown = useQuery({ queryKey: sprintKeys.burndown(sprintId), queryFn: () => fetchBurndown(sprintId) });
  if (burndown.isPending) return <ChartSkeleton label="Loading the burndown" />;
  if (burndown.isError) return <p className="text-sm text-destructive">{burndown.error.message}</p>;
  return <BurndownChart data={burndown.data} />;
}

const M = { top: 12, right: 44, bottom: 24, left: 36 };
const HEIGHT = 260;

function BurndownChart({ data }: { data: Burndown }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const days = data.days;
  const last = days.length - 1;
  const known = days.map((d, i) => ({ ...d, i })).filter((d) => d.remaining !== null);
  const ideal = (i: number) => (last > 0 ? data.committed * (1 - i / last) : 0);
  const max = Math.max(data.committed, ...known.map((d) => d.scope ?? 0), 1);
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const plotW = Math.max(width - M.left - M.right, 10);
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (last > 0 ? (i / last) * plotW : plotW / 2);
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const path = (key: "remaining" | "scope") =>
    known.map((d, n) => `${n ? "L" : "M"}${x(d.i).toFixed(1)},${y(d[key]!).toFixed(1)}`).join(" ");
  const area =
    known.length > 1
      ? `${path("remaining")} L${x(known.at(-1)!.i).toFixed(1)},${y(0)} L${x(known[0]!.i).toFixed(1)},${y(0)} Z`
      : "";
  const lastKnown = known.at(-1);
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 64))));
  const active = hover !== null ? days[hover] : null;

  function onMove(event: React.PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setHover(Math.min(last, Math.max(0, Math.round(ratio * last))));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft">
        <span className="flex items-center gap-1.5">
          <LineKey className="stroke-viz-1" /> Remaining
        </span>
        <span className="flex items-center gap-1.5">
          <LineKey className="stroke-viz-2" /> Scope
        </span>
        <span className="flex items-center gap-1.5">
          <LineKey className="stroke-muted-foreground" dashed /> Ideal
        </span>
        <span className="ml-auto text-muted-foreground">{data.unit === "points" ? "Story points" : "Issues"}</span>
      </div>
      <div ref={ref} className="relative">
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Burndown for ${data.sprint.name}: ${lastKnown ? unitLabel(data.unit, lastKnown.remaining!) : "nothing"} remaining of ${unitLabel(data.unit, data.committed)} committed.`}
            className="block overflow-visible"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular">
                  {t}
                </text>
              </g>
            ))}
            {days.map((d, i) =>
              i % labelEvery === 0 || i === last ? (
                <text key={d.date} x={x(i)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {format(new Date(`${d.date}T00:00:00`), "MMM d")}
                </text>
              ) : null,
            )}
            <line
              x1={x(0)}
              y1={y(data.committed)}
              x2={x(last)}
              y2={y(0)}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              className="stroke-muted-foreground"
            />
            {area ? <path d={area} className="fill-viz-1" opacity={0.1} /> : null}
            {known.length > 0 ? (
              <>
                <path d={path("scope")} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-viz-2" />
                <path d={path("remaining")} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-viz-1" />
              </>
            ) : null}
            {lastKnown ? (
              <g>
                {/* Both ends get a dot, so a one-day sprint still shows scope. */}
                <circle cx={x(lastKnown.i)} cy={y(lastKnown.scope ?? 0)} r={4} strokeWidth={2} className="fill-viz-2 stroke-card" />
                <circle cx={x(lastKnown.i)} cy={y(lastKnown.remaining!)} r={4} strokeWidth={2} className="fill-viz-1 stroke-card" />
                <text x={x(lastKnown.i) + 8} y={y(lastKnown.remaining!)} dy="0.32em" className="fill-foreground text-[11px] font-medium tabular">
                  {lastKnown.remaining}
                </text>
              </g>
            ) : null}
            {active && hover !== null ? (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} strokeWidth={1} className="stroke-muted-foreground" />
                {active.remaining !== null ? (
                  <>
                    <circle cx={x(hover)} cy={y(active.scope!)} r={4} strokeWidth={2} className="fill-viz-2 stroke-card" />
                    <circle cx={x(hover)} cy={y(active.remaining)} r={4} strokeWidth={2} className="fill-viz-1 stroke-card" />
                  </>
                ) : null}
              </g>
            ) : null}
            <rect
              x={M.left}
              y={M.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}
        {active && hover !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-panel"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}
          >
            <p className="mb-1 text-muted-foreground">{format(new Date(`${active.date}T00:00:00`), "EEE, MMM d")}</p>
            {active.remaining === null ? (
              <p className="text-muted-foreground">Not reached yet</p>
            ) : (
              <>
                <TipRow className="stroke-viz-1" value={active.remaining} label="Remaining" />
                <TipRow className="stroke-viz-2" value={active.scope!} label="Scope" />
              </>
            )}
            <TipRow className="stroke-muted-foreground" dashed value={Math.round(ideal(hover) * 10) / 10} label="Ideal" />
          </div>
        ) : null}
      </div>
      <DataTable
        caption={`Burndown for ${data.sprint.name}`}
        head={["Day", "Remaining", "Scope", "Ideal"]}
        rows={days.map((d, i) => [d.date, d.remaining ?? "—", d.scope ?? "—", Math.round(ideal(i) * 10) / 10])}
      />
    </div>
  );
}

function TipRow({ className, value, label, dashed }: { className: string; value: number; label: string; dashed?: boolean }) {
  return (
    <p className="flex items-center gap-2">
      <LineKey className={className} dashed={dashed} />
      <span className="font-semibold text-foreground tabular">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </p>
  );
}

// ---------------------------------------------------------------- velocity

function VelocityPanel({ projectId }: { projectId: string }) {
  const velocity = useQuery({ queryKey: sprintKeys.velocity(projectId), queryFn: () => fetchVelocity(projectId) });
  if (velocity.isPending) return <ChartSkeleton label="Loading velocity" />;
  if (velocity.isError) return <p className="text-sm text-destructive">{velocity.error.message}</p>;
  if (velocity.data.sprints.length === 0) return <Empty>Complete a sprint to see velocity.</Empty>;
  return <VelocityChart data={velocity.data} />;
}

const BAR = 24;
const GAP = 2;

function VelocityChart({ data }: { data: Velocity }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.sprints.flatMap((s) => [s.committed, s.completed]), 1);
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const plotW = Math.max(width - M.left - 16, 10);
  const plotH = HEIGHT - M.top - M.bottom;
  const band = plotW / data.sprints.length;
  const barW = Math.min(BAR, (band * 0.7 - GAP) / 2);
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const center = (i: number) => M.left + band * i + band / 2;
  /** A column with a 4px rounded top and a square base. */
  const column = (x0: number, v: number) => {
    const h = Math.max(plotH - (y(v) - M.top), 0);
    if (h === 0) return "";
    const r = Math.min(4, h, barW / 2);
    const yTop = y(v);
    const yBase = M.top + plotH;
    return `M${x0},${yBase} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + barW - r} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} V${yBase} Z`;
  };
  const active = hover !== null ? data.sprints[hover] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft">
        <span className="flex items-center gap-1.5">
          <BarKey className="bg-viz-2" /> Committed
        </span>
        <span className="flex items-center gap-1.5">
          <BarKey className="bg-viz-1" /> Completed
        </span>
        {data.average !== null ? (
          <span className="flex items-center gap-1.5">
            <LineKey className="stroke-muted-foreground" dashed /> Average completed: {unitLabel(data.unit, data.average)}
          </span>
        ) : null}
      </div>
      <div ref={ref} className="relative">
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Velocity over ${data.sprints.length} sprints, averaging ${unitLabel(data.unit, data.average ?? 0)} completed.`}
            className="block"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular">
                  {t}
                </text>
              </g>
            ))}
            {data.sprints.map((s, i) => {
              const c = center(i);
              const lifted = hover === i;
              return (
                <g key={s.id} opacity={hover === null || lifted ? 1 : 0.55}>
                  <path d={column(c - GAP / 2 - barW, s.committed)} className="fill-viz-2" />
                  <path d={column(c + GAP / 2, s.completed)} className="fill-viz-1" />
                  <text x={c + GAP / 2 + barW / 2} y={y(s.completed) - 6} textAnchor="middle" className="fill-foreground text-[11px] font-medium tabular">
                    {s.completed}
                  </text>
                  <text x={c} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                    {truncate(s.name, Math.max(4, Math.floor(band / 7)))}
                  </text>
                  <rect
                    x={M.left + band * i}
                    y={M.top}
                    width={band}
                    height={plotH + M.bottom}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${s.name}: committed ${unitLabel(data.unit, s.committed)}, completed ${unitLabel(data.unit, s.completed)}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
            {data.average !== null ? (
              <line
                x1={M.left}
                x2={M.left + plotW}
                y1={y(data.average)}
                y2={y(data.average)}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                pointerEvents="none"
                className="stroke-muted-foreground"
              />
            ) : null}
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}
        {active && hover !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-panel"
            style={center(hover) > width / 2 ? { right: width - center(hover) + band / 2 } : { left: center(hover) + band / 2 }}
          >
            <p className="mb-1 text-muted-foreground">{active.name}</p>
            <TipRow className="stroke-viz-2" value={active.committed} label="Committed" />
            <TipRow className="stroke-viz-1" value={active.completed} label="Completed" />
          </div>
        ) : null}
      </div>
      <DataTable
        caption="Velocity"
        head={["Sprint", `Committed (${data.unit})`, `Completed (${data.unit})`]}
        rows={data.sprints.map((s) => [s.name, s.committed, s.completed])}
      />
    </div>
  );
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
