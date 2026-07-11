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
  const axis = theme === "dark" ? "#91a5a0" : "#64736e";
  const gridLine = theme === "dark" ? "#1e3b3c" : "#dce5df";

  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 550,
      grid: { left: 62, right: 24, top: 12, bottom: 54 },
      tooltip: {
        trigger: "item",
        backgroundColor: theme === "dark" ? "#102a2d" : "#ffffff",
        borderColor: theme === "dark" ? "#2c5252" : "#cddbd4",
        textStyle: { color: theme === "dark" ? "#eff9f5" : "#102622" },
        formatter: (params: unknown) => {
          const item = params as { data?: { category?: string; month?: string; value?: number[] } };
          const datum = item.data;
          return `<b>${datum?.category || ""}</b> · ${datum?.month || ""}<br/>${datum?.value?.[2] || 0} papers`;
        },
      },
      xAxis: {
        type: "category",
        data: months,
        axisLabel: { color: axis, rotate: months.length > 12 ? 45 : 0, fontSize: 10 },
        axisLine: { lineStyle: { color: gridLine } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        data: allCategories,
        axisLabel: { color: axis, fontFamily: "ui-monospace", fontWeight: 700 },
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
        bottom: 0,
        itemWidth: 72,
        itemHeight: 7,
        text: [String(max), "0"],
        textStyle: { color: axis, fontSize: 10 },
        inRange: { color: theme === "dark" ? ["#142d2e", "#087f79", "#72e1cf"] : ["#edf3ee", "#61bdb1", "#087b75"] },
      },
      series: [
        {
          type: "heatmap",
          data,
          itemStyle: { borderColor: theme === "dark" ? "#071a1d" : "#f7faf7", borderWidth: 3, borderRadius: 3 },
          emphasis: { itemStyle: { borderColor: "#e0a52c", borderWidth: 2, shadowBlur: 10, shadowColor: "rgba(224,165,44,.35)" } },
        },
      ],
    }),
    [axis, data, gridLine, max, months, theme],
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
  const axis = theme === "dark" ? "#91a5a0" : "#64736e";
  const gridLine = theme === "dark" ? "#1e3b3c" : "#e1e9e3";
  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 600,
      color: ["#16a89f", "#8d62d9"],
      grid: { left: 30, right: 10, top: 24, bottom: 30 },
      tooltip: { trigger: "axis", backgroundColor: theme === "dark" ? "#102a2d" : "#fff", borderColor: gridLine, textStyle: { color: theme === "dark" ? "#eff9f5" : "#102622" } },
      legend: { data: ["AI Infra", "Agent Infra"], top: 0, right: 0, textStyle: { color: axis, fontSize: 10 } },
      xAxis: { type: "category", data: months, axisLabel: { color: axis, fontSize: 9, interval: Math.max(0, Math.floor(months.length / 6) - 1) }, axisLine: { lineStyle: { color: gridLine } }, axisTick: { show: false } },
      yAxis: { type: "value", minInterval: 1, axisLabel: { color: axis, fontSize: 9 }, splitLine: { lineStyle: { color: gridLine } } },
      series: [
        { name: "AI Infra", type: "line", data: ai, smooth: 0.35, symbol: "none", areaStyle: { opacity: 0.08 }, lineStyle: { width: 2 } },
        { name: "Agent Infra", type: "line", data: agent, smooth: 0.35, symbol: "none", areaStyle: { opacity: 0.08 }, lineStyle: { width: 2 } },
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
      tooltip: { trigger: "item", backgroundColor: theme === "dark" ? "#102a2d" : "#fff", textStyle: { color: theme === "dark" ? "#eff9f5" : "#102622" } },
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          draggable: true,
          force: { repulsion: 210, edgeLength: [70, 130], gravity: 0.08 },
          label: { show: true, position: "bottom", color: theme === "dark" ? "#cfe3dc" : "#304943", fontSize: 9, width: 92, overflow: "truncate" },
          edgeLabel: { show: true, formatter: (params: unknown) => (params as { data?: { type?: string } }).data?.type || "", color: theme === "dark" ? "#839d97" : "#6b7f78", fontSize: 8 },
          lineStyle: { color: theme === "dark" ? "#46605c" : "#b1c2bb", width: 1.5, curveness: 0.08 },
          emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
          data: local.nodes.map((node) => ({
            id: node.id,
            name: labels.get(node.id) || localizedTitle(node.title, locale),
            symbolSize: node.id === selectedId ? 42 : 27,
            symbol: node.kind === "seed_report" ? "diamond" : node.kind === "system_family" ? "roundRect" : "circle",
            itemStyle: {
              color:
                node.kind === "seed_report"
                  ? "#e0a52c"
                  : node.kind === "system_family"
                    ? theme === "dark" ? "#66827c" : "#8ba19b"
                    : node.domain === "agent_infra" ? "#8d62d9" : "#16a89f",
              borderColor: node.id === selectedId ? "#f4bf4f" : theme === "dark" ? "#d9f5ec" : "#fff",
              borderWidth: node.id === selectedId ? 4 : 2,
            },
          })),
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
