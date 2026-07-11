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
        <div className="hero-orbit orbit-ai" aria-hidden="true"><span>AI</span></div>
        <div className="hero-orbit orbit-agent" aria-hidden="true"><span>AG</span></div>
        <div className="hero-copy">
          <p className="eyebrow"><Sparkles size={14} /> {copy("heroKicker")}</p>
          <h1>{copy("heroTitle")}</h1>
          <p>{copy("heroBody")}</p>
          <div className="hero-actions">
            <a className="button primary-button" href="#catalog">{copy("explore")}<ArrowDown size={17} /></a>
            <a className="button ghost-button" href="#methodology">{copy("methodology")}<ArrowRight size={17} /></a>
          </div>
        </div>
        <div className="hero-signal" aria-hidden="true">
          <div className="signal-core"><span>INFRA</span><strong>ATLAS</strong></div>
          {Array.from({ length: 13 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
          <div className="signal-label signal-label-ai">TRAIN · SERVE · MEASURE</div>
          <div className="signal-label signal-label-ag">RUN · REMEMBER · VERIFY</div>
        </div>
        <div className="hero-stats">
          <div><Database size={17} /><strong>{primaryCount || "—"}</strong><span>{copy("indexed")}</span></div>
          <div><ShieldCheck size={17} /><strong>{coreCount || "—"}</strong><span>{copy("core")}</span></div>
          <div><Grid2X2 size={17} /><strong>13</strong><span>{copy("categories")}</span></div>
          <div><BookOpenCheck size={17} /><strong>{reportCount || "—"}</strong><span>{copy("reports")}</span></div>
          <div><CalendarDays size={17} /><strong>{generated}</strong><span>{copy("updated")}</span></div>
        </div>
      </section>

      <section ref={visualizationSection} className="atlas-overview section-shell" aria-labelledby="stack-heading">
        <div className="section-heading">
          <div><p className="section-number">01 · MAP</p><h2 id="stack-heading">{copy("stackMap")}</h2><p>{copy("stackMapBody")}</p></div>
          <span className="data-window">{copy("dataAsOf")} · {catalog?.manifest.window?.start || "2025-01-01"} → {catalog?.manifest.window?.end || generated}</span>
        </div>
        {!visualizationsReady ? (
          <div className="chart-loading" aria-label={copy("loading")}><div className="loading-bars">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div><p>{copy("loading")}</p></div>
        ) : error ? (
          <div className="data-error" role="alert"><Network size={28} /><h3>{copy("loadError")}</h3><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={15} />{copy("retry")}</button></div>
        ) : !catalog ? (
          <div className="chart-loading"><div className="loading-bars">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div><p>{copy("loading")}</p></div>
        ) : (
          <Suspense fallback={<div className="chart-loading"><div className="loading-bars">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div><p>{copy("loading")}</p></div>}>
            <div className="visualization-grid">
              <article className="viz-card stack-map-card"><div className="viz-card-label"><span>13 LAYERS</span><i /></div><StackMap papers={papers.filter((paper) => paper.window_status === "new_in_window")} onSelect={selectStackCell} /></article>
              <article className="viz-card trend-card"><header><div><span>PUBLICATION CADENCE</span><h3>{copy("trend")}</h3></div><p>{copy("trendBody")}</p></header><TrendChart papers={papers.filter((paper) => paper.window_status === "new_in_window")} /></article>
              <article className="viz-card lineage-card" id="lineage-panel"><header><div><span>DIRECT RELATIONS</span><h3>{copy("lineage")}</h3></div><p>{copy("lineageBody")}</p></header><LineageGraph graph={catalog.graph} papers={papers} selectedId={selectedId} onSelect={setSelectedId} /></article>
            </div>
          </Suspense>
        )}
      </section>

      <section className="catalog-section section-shell" id="catalog" aria-labelledby="catalog-heading">
        <div className="section-heading catalog-heading">
          <div><p className="section-number">02 · EXPLORE</p><h2 id="catalog-heading">{copy("results")}</h2><p><strong>{filtered.length}</strong> {copy("filtered")}</p></div>
          <div className="view-toggle" role="group" aria-label="Catalog view">
            <button className={filters.view === "cards" ? "active" : ""} type="button" onClick={() => setFilters({ view: "cards" })}><Grid2X2 size={16} />{copy("cards")}</button>
            <button className={filters.view === "table" ? "active" : ""} type="button" onClick={() => setFilters({ view: "table" })}><List size={16} />{copy("table")}</button>
          </div>
        </div>
        <FilterPanel filters={filters} papers={papers} onChange={setFilters} onReset={reset} />
        {!catalog && !error ? <CatalogSkeleton /> : filtered.length === 0 ? <EmptyCatalog /> : filters.view === "cards" ? (
          <PaperCards papers={filtered.slice(0, visibleCount)} favorites={favorites} onFavorite={toggle} onLineage={chooseLineage} selectedId={selectedId} />
        ) : (
          <PaperTable papers={filtered.slice(0, visibleCount)} favorites={favorites} onFavorite={toggle} onLineage={chooseLineage} selectedId={selectedId} />
        )}
        {filtered.length > visibleCount && <button className="load-more" type="button" onClick={() => setVisibleCount((count) => count + 24)}>{locale === "zh" ? `继续加载（剩余 ${filtered.length - visibleCount}）` : `Load more (${filtered.length - visibleCount} remaining)`}<ArrowDown size={16} /></button>}
      </section>

      <section className="methodology-section" id="methodology" aria-labelledby="methodology-heading">
        <div className="section-shell methodology-inner">
          <div className="methodology-code" aria-hidden="true"><span>TRACE</span><strong>→</strong><span>VERIFY</span><strong>→</strong><span>CURATE</span></div>
          <div><p className="section-number">03 · METHOD</p><h2 id="methodology-heading">{copy("methodologyTitle")}</h2><p>{copy("methodologyBody")}</p></div>
          <ol>
            <li><span>01</span><div><strong>{locale === "zh" ? "技术报告为种子" : "Reports as seeds"}</strong><p>{locale === "zh" ? "保留引用编号、页码与上下文。" : "Citation number, page, and context stay attached."}</p></div></li>
            <li><span>02</span><div><strong>{locale === "zh" ? "第一方证据核验" : "First-party verification"}</strong><p>{locale === "zh" ? "arXiv、OpenReview、会议与作者项目页。" : "arXiv, OpenReview, proceedings, and author project pages."}</p></div></li>
            <li><span>03</span><div><strong>{locale === "zh" ? "版本合并，状态分流" : "Version merging, explicit status"}</strong><p>{locale === "zh" ? "预印本、正式发表、撤稿与上下文节点不混计。" : "Preprints, venue publications, withdrawals, and context nodes stay distinct."}</p></div></li>
          </ol>
        </div>
      </section>
    </main>
  );
}
