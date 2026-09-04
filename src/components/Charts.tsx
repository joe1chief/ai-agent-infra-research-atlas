import type { ECharts, EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";
import { useApp } from "../App";
import { categoryLabel, localizedTitle } from "../lib/i18n";
import type { CatalogGraph, PaperIndexEntry } from "../types";

function useChart(option: EChartsOption, onClick?: (params: { data?: unknown; name?: string }) => void) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;

    void import("../lib/echarts").then((echarts) => {
      if (disposed || !container.current) return;
      chart.current = echarts.init(container.current, undefined, { renderer: "canvas" });
      chart.current.setOption(option);
      if (onClick) chart.current.on("click", onClick);
      observer = new ResizeObserver(() => chart.current?.resize());
      observer.observe(container.current);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return container;
}

const allCategories = ["AI-1", "AI-2", "AI-3", "AI-4", "AI-5", "AI-6", "AG-1", "AG-2", "AG-3", "AG-4", "AG-5", "AG-6", "AG-7"];

interface StackMapProps {
  papers: PaperIndexEntry[];
  onSelect: (category: string, month: string) => void;
}

export function StackMap({ papers, onSelect }: StackMapProps) {
  const { locale, theme } = useApp();
  const months = useMemo(() => {
    const available = papers
      .map((paper) => paper.dates.first_public_date?.slice(0, 7))
      .filter((month): month is string => Boolean(month));
    return [...new Set(available)].sort();
  }, [papers]);
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    papers.forEach((paper) => {
      const month = paper.dates.first_public_date?.slice(0, 7);
      if (!month) return;
      const key = `${paper.primary_category}|${month}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return allCategories.flatMap((category, y) =>
      months.map((month, x) => ({
        value: [x, y, counts.get(`${category}|${month}`) || 0],
        category,
        month,
      })),
    );
  }, [months, papers]);
  const max = Math.max(1, ...data.map((item) => Number(item.value[2])));
  const axis = theme === "dark" ? "#94a3b8" : "#64748b";
  const gridLine = theme === "dark" ? "#1e293b" : "#e2e8f0";

  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 550,
      grid: { left: 62, right: 24, top: 16, bottom: 56 },
      tooltip: {
        trigger: "item",
        backgroundColor: theme === "dark" ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
        borderColor: theme === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
        borderRadius: 8,
        padding: [10, 14],
        textStyle: { color: theme === "dark" ? "#f1f5f9" : "#0f172a", fontSize: 12 },
        extraCssText: "box-shadow: 0 10px 30px -5px rgba(0,0,0,0.3); backdrop-filter: blur(8px);",
        formatter: (params: unknown) => {
          const item = params as { data?: { category?: string; month?: string; value?: number[] } };
          const datum = item.data;
          const cat = datum?.category || "";
          const lbl = categoryLabel(cat, locale);
          const count = datum?.value?.[2] || 0;
          return `<div style="font-family: inherit;">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 2px;">${cat} · ${lbl}</div>
            <div style="color: ${axis}; font-size: 11px; margin-bottom: 4px;">${datum?.month || ""}</div>
            <div style="font-weight: 600; color: #06b6d4;">${count} ${count === 1 ? "paper" : "papers"} indexed</div>
          </div>`;
        },
      },
      xAxis: {
        type: "category",
        data: months,
        axisLabel: { color: axis, rotate: months.length > 12 ? 45 : 0, fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
        axisLine: { lineStyle: { color: gridLine } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        data: allCategories,
        axisLabel: { color: axis, fontFamily: "JetBrains Mono, monospace", fontWeight: 700, fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      visualMap: {
        min: 0,
        max,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 4,
        itemWidth: 80,
        itemHeight: 8,
        text: [String(max), "0"],
        textStyle: { color: axis, fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
        inRange: {
          color:
            theme === "dark"
              ? ["#0f172a", "#0e7490", "#06b6d4", "#38bdf8", "#67e8f9"]
              : ["#f1f5f9", "#bae6fd", "#38bdf8", "#0284c7", "#0369a1"],
        },
      },
      series: [
        {
          type: "heatmap",
          data,
          itemStyle: {
            borderColor: theme === "dark" ? "#090a0f" : "#ffffff",
            borderWidth: 2.5,
            borderRadius: 3,
          },
          emphasis: {
            itemStyle: {
              borderColor: "#38bdf8",
              borderWidth: 2,
              shadowBlur: 12,
              shadowColor: "rgba(56, 189, 248, 0.4)",
            },
          },
        },
      ],
    }),
    [axis, data, gridLine, locale, max, months, theme],
  );

  const onChartClick = (params: { data?: unknown }) => {
    const datum = params.data as { category?: string; month?: string } | undefined;
    if (datum?.category && datum.month) onSelect(datum.category, datum.month);
  };
  const chartRef = useChart(option, onChartClick);

  return (
    <div>
      <div ref={chartRef} className="stack-chart" role="img" aria-label="Research density heatmap" />
      <div className="chart-accessible-list sr-only">
        {data
          .filter((item) => Number(item.value[2]) > 0)
          .map((item) => (
            <button key={`${item.category}-${item.month}`} onClick={() => onSelect(item.category, item.month)}>
              {item.category} {categoryLabel(item.category, locale)}, {item.month}: {item.value[2]}
            </button>
          ))}
      </div>
    </div>
  );
}

export function TrendChart({ papers }: { papers: PaperIndexEntry[] }) {
  const { theme } = useApp();
  const { months, ai, agent } = useMemo(() => {
    const monthSet = new Set<string>();
    papers.forEach((paper) => {
      const month = paper.dates.first_public_date?.slice(0, 7);
      if (month) monthSet.add(month);
    });
    const monthList = [...monthSet].sort();
    return {
      months: monthList,
      ai: monthList.map((month) => papers.filter((paper) => paper.domain === "ai_infra" && paper.dates.first_public_date?.startsWith(month)).length),
      agent: monthList.map((month) => papers.filter((paper) => paper.domain === "agent_infra" && paper.dates.first_public_date?.startsWith(month)).length),
    };
  }, [papers]);
  const axis = theme === "dark" ? "#94a3b8" : "#64748b";
  const gridLine = theme === "dark" ? "#1e293b" : "#e2e8f0";

  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 600,
      color: ["#06b6d4", "#a855f7"],
      grid: { left: 34, right: 14, top: 32, bottom: 32 },
      tooltip: {
        trigger: "axis",
        backgroundColor: theme === "dark" ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
        borderColor: theme === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
        borderRadius: 8,
        padding: [10, 14],
        textStyle: { color: theme === "dark" ? "#f1f5f9" : "#0f172a", fontSize: 12 },
        extraCssText: "box-shadow: 0 10px 30px -5px rgba(0,0,0,0.3); backdrop-filter: blur(8px);",
      },
      legend: {
        data: ["AI Infra", "Agent Infra"],
        top: 2,
        right: 0,
        textStyle: { color: axis, fontSize: 11, fontWeight: 500 },
        icon: "roundRect",
      },
      xAxis: {
        type: "category",
        data: months,
        axisLabel: { color: axis, fontSize: 9, fontFamily: "JetBrains Mono, monospace", interval: Math.max(0, Math.floor(months.length / 6) - 1) },
        axisLine: { lineStyle: { color: gridLine } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: axis, fontSize: 9, fontFamily: "JetBrains Mono, monospace" },
        splitLine: { lineStyle: { color: gridLine, type: "dashed" } },
      },
      series: [
        {
          name: "AI Infra",
          type: "line",
          data: ai,
          smooth: 0.4,
          symbol: "circle",
          symbolSize: 5,
          showSymbol: false,
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(6, 182, 212, 0.35)" },
                { offset: 1, color: "rgba(6, 182, 212, 0.01)" },
              ],
            },
          },
          lineStyle: { width: 2.5, color: "#06b6d4" },
          itemStyle: { color: "#06b6d4" },
        },
        {
          name: "Agent Infra",
          type: "line",
          data: agent,
          smooth: 0.4,
          symbol: "circle",
          symbolSize: 5,
          showSymbol: false,
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(168, 85, 247, 0.35)" },
                { offset: 1, color: "rgba(168, 85, 247, 0.01)" },
              ],
            },
          },
          lineStyle: { width: 2.5, color: "#a855f7" },
          itemStyle: { color: "#a855f7" },
        },
      ],
    }),
    [agent, ai, axis, gridLine, months, theme],
  );
  const chartRef = useChart(option);
  return <div ref={chartRef} className="trend-chart" role="img" aria-label="Monthly publication trend chart" />;
}

interface LineageProps {
  graph: CatalogGraph;
  papers: PaperIndexEntry[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function LineageGraph({ graph, papers, selectedId, onSelect }: LineageProps) {
  const { locale, theme, copy } = useApp();
  const local = useMemo(() => {
    if (!selectedId) return { nodes: [], edges: [] };
    const edges = graph.edges.filter((edge) => edge.source === selectedId || edge.target === selectedId);
    const ids = new Set([selectedId, ...edges.flatMap((edge) => [edge.source, edge.target])]);
    let nodes = graph.nodes.filter((node) => ids.has(node.id));
    if (!nodes.some((node) => node.id === selectedId)) {
      const paper = papers.find((entry) => entry.work_id === selectedId);
      if (paper) nodes = [{ id: paper.work_id, slug: paper.slug, title: paper.title, domain: paper.domain, primary_category: paper.primary_category }, ...nodes];
    }
    return { nodes, edges };
  }, [graph.edges, graph.nodes, papers, selectedId]);
  const labels = new Map(papers.map((paper) => [paper.work_id, localizedTitle(paper.title, locale)]));

  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 500,
      tooltip: {
        trigger: "item",
        backgroundColor: theme === "dark" ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
        borderColor: theme === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
        borderRadius: 8,
        padding: [8, 12],
        textStyle: { color: theme === "dark" ? "#f1f5f9" : "#0f172a", fontSize: 12 },
        extraCssText: "box-shadow: 0 10px 30px -5px rgba(0,0,0,0.3); backdrop-filter: blur(8px);",
      },
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          force: { repulsion: 240, edgeLength: [80, 140], gravity: 0.08 },
          label: {
            show: true,
            position: "bottom",
            color: theme === "dark" ? "#cbd5e1" : "#334155",
            fontSize: 10,
            width: 100,
            overflow: "truncate",
            distance: 6,
          },
          edgeLabel: {
            show: true,
            formatter: (params: unknown) => (params as { data?: { type?: string } }).data?.type || "",
            color: theme === "dark" ? "#94a3b8" : "#64748b",
            fontSize: 8,
            fontFamily: "JetBrains Mono, monospace",
          },
          lineStyle: {
            color: theme === "dark" ? "#334155" : "#cbd5e1",
            width: 1.6,
            curveness: 0.1,
          },
          emphasis: {
            focus: "adjacency",
            lineStyle: { width: 3.5, color: "#38bdf8" },
          },
          data: local.nodes.map((node) => {
            const isTarget = node.id === selectedId;
            return {
              id: node.id,
              name: labels.get(node.id) || localizedTitle(node.title, locale),
              symbolSize: isTarget ? 46 : 28,
              symbol: node.kind === "seed_report" ? "diamond" : node.kind === "system_family" ? "roundRect" : "circle",
              itemStyle: {
                color:
                  node.kind === "seed_report"
                    ? "#f59e0b"
                    : node.kind === "system_family"
                      ? theme === "dark" ? "#6366f1" : "#4f46e5"
                      : node.domain === "agent_infra"
                        ? "#a855f7"
                        : "#06b6d4",
                borderColor: isTarget ? "#fbbf24" : theme === "dark" ? "#f8fafc" : "#ffffff",
                borderWidth: isTarget ? 4 : 2,
                shadowBlur: isTarget ? 16 : 0,
                shadowColor: isTarget ? "rgba(251, 191, 36, 0.5)" : "transparent",
              },
            };
          }),
          links: local.edges,
        },
      ],
    }),
    [labels, local.edges, local.nodes, locale, selectedId, theme],
  );
  const chartRef = useChart(option, (params) => {
    const datum = params.data as { id?: string } | undefined;
    if (datum?.id) onSelect?.(datum.id);
  });

  if (!selectedId || local.nodes.length === 0) return <div className="lineage-empty">{copy("noLineage")}</div>;

  return (
    <>
      <div ref={chartRef} className="lineage-chart" role="img" aria-label={copy("lineage")} />
      <div className="lineage-list" aria-label={copy("mobileGraph")}>
        {local.edges.length ? (
          local.edges.map((edge, index) => {
            const other = edge.source === selectedId ? edge.target : edge.source;
            return (
              <button key={`${edge.source}-${edge.target}-${index}`} onClick={() => onSelect?.(other)}>
                <span>{edge.type}</span>
                <strong>{labels.get(other) || other}</strong>
              </button>
            );
          })
        ) : (
          <p>{copy("noLineage")}</p>
        )}
      </div>
    </>
  );
}
