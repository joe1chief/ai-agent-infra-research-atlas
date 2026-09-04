import { ArrowDown, ArrowRight, BookOpenCheck, CalendarDays, Database, Grid2X2, List, Network, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../App";
import { FilterPanel } from "../components/FilterPanel";
import { EmptyCatalog, PaperCards, PaperTable } from "../components/PaperCatalog";
import { useFavorites } from "../hooks/useLocalStorage";
import { useUrlFilters } from "../hooks/useUrlFilters";
import { loadCatalog, loadGraph } from "../lib/catalog";
import { localized, localizedTitle, originalTitle } from "../lib/i18n";
import type { CatalogData } from "../types";

const StackMap = lazy(() => import("../components/Charts").then((module) => ({ default: module.StackMap })));
const TrendChart = lazy(() => import("../components/Charts").then((module) => ({ default: module.TrendChart })));
const LineageGraph = lazy(() => import("../components/Charts").then((module) => ({ default: module.LineageGraph })));

function monthEnd(month: string): string {
  const [year, numericMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, numericMonth, 0)).toISOString().slice(0, 10);
}

function CatalogSkeleton() {
  return (
    <div className="catalog-skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <div key={index}><span /><strong /><i /><i /></div>)}
    </div>
  );
}

export default function HomePage() {
  const { locale, copy } = useApp();
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [visibleCount, setVisibleCount] = useState(24);
  const [visualizationsReady, setVisualizationsReady] = useState(false);
  const visualizationSection = useRef<HTMLElement>(null);
  const graphRequested = useRef(false);
  const { filters, setFilters, reset } = useUrlFilters();
  const { favorites, toggle } = useFavorites();

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void loadCatalog(controller.signal)
      .then((data) => {
        graphRequested.current = false;
        setCatalog(data);
        setSelectedId((current) => current || data.papers.find((paper) => paper.curation_tier === "core")?.work_id || data.papers[0]?.work_id);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [attempt]);

  const papers = catalog?.papers || [];
  const filtered = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase();
    return papers.filter((paper) => {
      const searchable = [
        originalTitle(paper.title),
        localizedTitle(paper.title, "zh"),
        localizedTitle(paper.title, "en"),
        ...paper.tags,
        ...(paper.authors?.map((author) => author.name) || []),
        ...(paper.institutions || []),
        localized(paper.abstract, locale),
        localized(paper.inclusion_reason, locale),
        paper.search_text || "",
      ]
        .join(" ")
        .toLocaleLowerCase();
      const hasArtifact = Boolean(paper.artifacts?.length);
      const hasPdf = Boolean(paper.has_pdf);
      const hasLocalPdf = Boolean(paper.has_local_pdf);
      const date = paper.dates.first_public_date || "";
      return (
        (!query || searchable.includes(query)) &&
        (filters.domain === "all" || paper.domain === filters.domain) &&
        (filters.category === "all" || paper.primary_category === filters.category) &&
        (filters.windowStatus === "all" || paper.window_status === filters.windowStatus) &&
        (filters.publicationStatus === "all" ||
          (filters.publicationStatus === "recommended"
            ? !["withdrawn", "retracted"].includes(paper.publication_status)
            : paper.publication_status === filters.publicationStatus)) &&
        (filters.tier === "all" || paper.curation_tier === filters.tier) &&
        (filters.venue === "all" || paper.venue === filters.venue) &&
        (filters.tag === "all" || paper.tags.includes(filters.tag)) &&
        (filters.artifact === "all" || (filters.artifact === "yes" ? hasArtifact : !hasArtifact)) &&
        (filters.pdf === "all" ||
          (filters.pdf === "yes" && hasPdf) ||
          (filters.pdf === "local" && hasLocalPdf) ||
          (filters.pdf === "external" && hasPdf && !hasLocalPdf) ||
          (filters.pdf === "no" && !hasPdf)) &&
        (filters.source === "all" || paper.source_kinds?.includes(filters.source)) &&
        (!filters.from || date >= filters.from) &&
        (!filters.to || date <= filters.to) &&
        (!filters.favoritesOnly || favorites.includes(paper.work_id))
      );
    });
  }, [favorites, filters, locale, papers]);

  useEffect(() => setVisibleCount(24), [filters]);

  useEffect(() => {
    const section = visualizationSection.current;
    if (!section || visualizationsReady) return;
    if (!("IntersectionObserver" in window)) {
      setVisualizationsReady(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisualizationsReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [visualizationsReady]);

  useEffect(() => {
    if (!visualizationsReady || !catalog || catalog.graph.nodes.length || graphRequested.current) return;
    graphRequested.current = true;
    const controller = new AbortController();
    void loadGraph(catalog.manifest, controller.signal)
      .then((graph) => setCatalog((current) => current ? { ...current, graph } : current))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [catalog, visualizationsReady]);

  const primaryCount = papers.filter((paper) => paper.window_status === "new_in_window" && paper.curation_tier !== "context").length;
  const coreCount = papers.filter((paper) => paper.curation_tier === "core" && paper.window_status === "new_in_window").length;
  const reportCount = catalog?.manifest.counts?.seed_reports ?? catalog?.manifest.counts?.reports ?? 0;
  const generated = catalog?.manifest.generated_at?.slice(0, 10) || catalog?.manifest.window?.end || "—";

  const selectStackCell = (category: string, month: string) => {
    setFilters({ category, from: `${month}-01`, to: monthEnd(month) });
    requestAnimationFrame(() => document.querySelector("#catalog")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const chooseLineage = (workId: string) => {
    setSelectedId(workId);
    requestAnimationFrame(() => document.querySelector("#lineage-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return (
    <main id="main-content">
      <section className="hero-section">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-ambient-glow glow-cyan" aria-hidden="true" />
        <div className="hero-ambient-glow glow-purple" aria-hidden="true" />

        <div className="hero-copy">
          <div className="hero-badge-pill">
            <span className="badge-pulse-dot" />
            <Sparkles size={13} className="badge-icon" />
            <span>{copy("heroKicker")}</span>
          </div>
          <h1>{copy("heroTitle")}</h1>
          <p>{copy("heroBody")}</p>
          <div className="hero-actions">
            <a className="button primary-button" href="#catalog">
              <span>{copy("explore")}</span>
              <ArrowDown size={16} />
            </a>
            <a className="button ghost-button" href="#methodology">
              <span>{copy("methodology")}</span>
              <ArrowRight size={16} />
            </a>
          </div>
        </div>

        <div className="hero-radar-container" aria-hidden="true">
          <div className="hero-signal">
            <div className="radar-ring radar-ring-1" />
            <div className="radar-ring radar-ring-2" />
            <div className="radar-ring radar-ring-3" />
            <div className="radar-sweep" />
            
            <div className="signal-core">
              <span className="core-eyebrow">RESEARCH MATRIX</span>
              <strong>INFRA ATLAS</strong>
              <span className="core-sub">AI × AGENT</span>
            </div>

            {/* Orbiting Satellite Badges */}
            <div className="satellite-node satellite-ai">
              <span className="sat-dot" />
              <span>AI INFRA</span>
            </div>
            <div className="satellite-node satellite-agent">
              <span className="sat-dot" />
              <span>AGENT INFRA</span>
            </div>
            <div className="satellite-node satellite-eval">
              <span className="sat-dot" />
              <span>BENCHMARK</span>
            </div>

            {Array.from({ length: 13 }, (_, index) => (
              <i key={index} style={{ "--i": index } as React.CSSProperties} />
            ))}
          </div>
        </div>

        <div className="hero-stats">
          <div className="stat-card">
            <div className="stat-icon-wrapper ai-accent"><Database size={17} /></div>
            <div className="stat-content">
              <strong>{primaryCount || "—"}</strong>
              <span>{copy("indexed")}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper core-accent"><ShieldCheck size={17} /></div>
            <div className="stat-content">
              <strong>{coreCount || "—"}</strong>
              <span>{copy("core")}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper layer-accent"><Grid2X2 size={17} /></div>
            <div className="stat-content">
              <strong>13</strong>
              <span>{copy("categories")}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper report-accent"><BookOpenCheck size={17} /></div>
            <div className="stat-content">
              <strong>{reportCount || "—"}</strong>
              <span>{copy("reports")}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper date-accent"><CalendarDays size={17} /></div>
            <div className="stat-content">
              <strong>{generated}</strong>
              <span>{copy("updated")}</span>
            </div>
          </div>
        </div>
      </section>

      <section ref={visualizationSection} className="atlas-overview section-shell" aria-labelledby="stack-heading">
        <div className="section-heading">
          <div>
            <p className="section-number">// 01 ARCHITECTURE MAP</p>
            <h2 id="stack-heading">{copy("stackMap")}</h2>
            <p>{copy("stackMapBody")}</p>
          </div>
          <span className="data-window">
            <span className="live-dot" />
            {copy("dataAsOf")} · {catalog?.manifest.window?.start || "2025-01-01"} → {catalog?.manifest.window?.end || generated}
          </span>
        </div>
        {!visualizationsReady ? (
          <div className="chart-loading" aria-label={copy("loading")}>
            <div className="loading-bars">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div>
            <p>{copy("loading")}</p>
          </div>
        ) : error ? (
          <div className="data-error" role="alert">
            <Network size={28} />
            <h3>{copy("loadError")}</h3>
            <p>{error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              <RefreshCw size={15} />
              {copy("retry")}
            </button>
          </div>
        ) : !catalog ? (
          <div className="chart-loading">
            <div className="loading-bars">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div>
            <p>{copy("loading")}</p>
          </div>
        ) : (
          <Suspense fallback={<div className="chart-loading"><div className="loading-bars">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div><p>{copy("loading")}</p></div>}>
            <div className="visualization-grid">
              <article className="viz-card stack-map-card">
                <div className="viz-card-label">
                  <span>13 INFRA LAYERS DENSITY</span>
                  <i />
                </div>
                <StackMap papers={papers.filter((paper) => paper.window_status === "new_in_window")} onSelect={selectStackCell} />
              </article>
              <article className="viz-card trend-card">
                <header>
                  <div>
                    <span>PUBLICATION CADENCE</span>
                    <h3>{copy("trend")}</h3>
                  </div>
                  <p>{copy("trendBody")}</p>
                </header>
                <TrendChart papers={papers.filter((paper) => paper.window_status === "new_in_window")} />
              </article>
              <article className="viz-card lineage-card" id="lineage-panel">
                <header>
                  <div>
                    <span>DIRECT RELATION LINEAGE</span>
                    <h3>{copy("lineage")}</h3>
                  </div>
                  <p>{copy("lineageBody")}</p>
                </header>
                <LineageGraph graph={catalog.graph} papers={papers} selectedId={selectedId} onSelect={setSelectedId} />
              </article>
            </div>
          </Suspense>
        )}
      </section>

      <section className="catalog-section section-shell" id="catalog" aria-labelledby="catalog-heading">
        <div className="section-heading catalog-heading">
          <div>
            <p className="section-number">// 02 RESEARCH DIRECTORY</p>
            <h2 id="catalog-heading">{copy("results")}</h2>
            <p>
              <strong>{filtered.length}</strong> {copy("filtered")}
            </p>
          </div>
          <div className="view-toggle" role="group" aria-label="Catalog view">
            <button className={filters.view === "cards" ? "active" : ""} type="button" onClick={() => setFilters({ view: "cards" })}>
              <Grid2X2 size={15} />
              <span>{copy("cards")}</span>
            </button>
            <button className={filters.view === "table" ? "active" : ""} type="button" onClick={() => setFilters({ view: "table" })}>
              <List size={15} />
              <span>{copy("table")}</span>
            </button>
          </div>
        </div>
        <FilterPanel filters={filters} papers={papers} onChange={setFilters} onReset={reset} />
        {!catalog && !error ? (
          <CatalogSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyCatalog onReset={reset} />
        ) : filters.view === "cards" ? (
          <PaperCards papers={filtered.slice(0, visibleCount)} favorites={favorites} onFavorite={toggle} onLineage={chooseLineage} selectedId={selectedId} onResetFilters={reset} />
        ) : (
          <PaperTable papers={filtered.slice(0, visibleCount)} favorites={favorites} onFavorite={toggle} onLineage={chooseLineage} selectedId={selectedId} onResetFilters={reset} />
        )}
        {filtered.length > visibleCount && (
          <button className="load-more" type="button" onClick={() => setVisibleCount((count) => count + 24)}>
            <span>{locale === "zh" ? `继续加载（剩余 ${filtered.length - visibleCount} 篇）` : `Load more (${filtered.length - visibleCount} remaining)`}</span>
            <ArrowDown size={15} />
          </button>
        )}
      </section>

      <section className="methodology-section" id="methodology" aria-labelledby="methodology-heading">
        <div className="section-shell methodology-inner">
          <div className="methodology-header">
            <p className="section-number">// 03 CURATION METHODOLOGY</p>
            <h2 id="methodology-heading">{copy("methodologyTitle")}</h2>
            <p>{copy("methodologyBody")}</p>
          </div>
          <div className="methodology-pipeline">
            <div className="method-step-card">
              <span className="step-num">01</span>
              <div className="step-content">
                <strong>{locale === "zh" ? "技术报告为种子" : "Reports as seeds"}</strong>
                <p>{locale === "zh" ? "保留引用编号、论文具体页码与系统上下文。" : "Citation number, page, and context stay attached."}</p>
              </div>
            </div>
            <div className="method-step-card">
              <span className="step-num">02</span>
              <div className="step-content">
                <strong>{locale === "zh" ? "第一方证据严格核验" : "First-party verification"}</strong>
                <p>{locale === "zh" ? "逐一核对 arXiv、OpenReview、顶会论文集与开源代码仓库。" : "arXiv, OpenReview, proceedings, and author project pages."}</p>
              </div>
            </div>
            <div className="method-step-card">
              <span className="step-num">03</span>
              <div className="step-content">
                <strong>{locale === "zh" ? "版本合并与状态分流" : "Version merging, explicit status"}</strong>
                <p>{locale === "zh" ? "区分预印本、正式发表顶会、撤稿修正与历史基准节点。" : "Preprints, venue publications, withdrawals, and context nodes stay distinct."}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
