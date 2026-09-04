import { ArrowLeft, ArrowUpRight, BadgeCheck, BookOpen, Box, Calendar, Check, Clipboard, Code2, Database, ExternalLink, FileText, GitBranch, History, Link2, Network, NotebookPen, RefreshCw, Star, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../App";
import { LineageGraph } from "../components/Charts";
import { PdfReader } from "../components/PdfReader";
import { useFavorites, useLocalStorage } from "../hooks/useLocalStorage";
import { assetUrl, homePath, loadCatalog, loadPaper, paperPath } from "../lib/catalog";
import { categoryLabel, domainLabel, localized, localizedTitle, originalTitle, statusLabel } from "../lib/i18n";
import type { CatalogData, Paper } from "../types";

function authorsText(paper: Paper): string {
  return paper.authors?.map((author) => author.name).join(", ") || "Unknown authors";
}

function citationFormats(paper: Paper) {
  const authors = authorsText(paper);
  const year = paper.dates.first_public_date?.slice(0, 4) || "n.d.";
  const title = originalTitle(paper.title);
  const venue = paper.venue || "arXiv preprint";
  const firstAuthor = paper.authors?.[0]?.name.split(/\s+/).at(-1)?.replace(/[^a-zA-Z0-9]/g, "") || "infra";
  const key = `${firstAuthor.toLowerCase()}${year}${paper.slug.split("-")[0]}`;
  const arxiv = typeof paper.identifiers?.arxiv === "string" ? paper.identifiers.arxiv : undefined;
  const doi = typeof paper.identifiers?.doi === "string" ? paper.identifiers.doi : undefined;
  return {
    BibTeX: `@article{${key},\n  title={${title}},\n  author={${authors.replaceAll(", ", " and ")}},\n  year={${year}},\n  journal={${venue}}${doi ? `,\n  doi={${doi}}` : ""}${arxiv ? `,\n  eprint={${arxiv}}` : ""}\n}`,
    APA: `${authors} (${year}). ${title}. ${venue}.${doi ? ` https://doi.org/${doi}` : ""}`,
    MLA: `${authors}. “${title}.” ${venue}, ${year}.${doi ? ` doi:${doi}.` : ""}`,
  };
}

function DetailLoading() {
  const { copy } = useApp();
  return <main className="detail-loading" id="main-content"><div className="detail-loading-mark"><i /><i /><i /></div><h1>{copy("loading")}</h1><div className="detail-loading-lines"><span /><span /><span /></div></main>;
}

function DetailError({ retry }: { retry: () => void }) {
  const { copy } = useApp();
  return <main className="detail-error" id="main-content"><Network size={34} /><h1>{copy("loadError")}</h1><p>{copy("noResultsBody")}</p><a href={homePath()} data-atlas-link><ArrowLeft size={16} />{copy("back")}</a><button type="button" onClick={retry}><RefreshCw size={16} />{copy("retry")}</button></main>;
}

function BilingualSection({ id, index, title, body }: { id: string; index: string; title: string; body?: string }) {
  if (!body) return null;
  return <section className="research-section" id={id}><span className="research-index">{index}</span><div><h2>{title}</h2><p>{body}</p></div></section>;
}

export default function PaperPage({ slug }: { slug: string }) {
  const { locale, copy } = useApp();
  const [catalog, setCatalog] = useState<CatalogData>();
  const [paper, setPaper] = useState<Paper>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { favorites, toggle } = useFavorites();
  const [notes, setNotes] = useLocalStorage<Record<string, string>>("infra-atlas:notes", {});
  const [citationType, setCitationType] = useState<"BibTeX" | "APA" | "MLA">("BibTeX");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setPaper(undefined);
    void loadCatalog(controller.signal, true)
      .then(async (data) => {
        setCatalog(data);
        const entry = data.papers.find((candidate) => candidate.slug === slug);
        if (!entry) throw new Error("Paper route not found in catalog");
        const detail = await loadPaper(entry, controller.signal);
        setPaper(detail);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(true);
      });
    return () => controller.abort();
  }, [attempt, slug]);

  useEffect(() => {
    if (!paper) return;
    const pageTitle = `${localizedTitle(paper.title, locale)} · Infra Atlas`;
    document.title = pageTitle;
    const description = localized(paper.abstract, locale) || localized(paper.inclusion_reason, locale);
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    const schema = document.createElement("script");
    schema.type = "application/ld+json";
    schema.dataset.atlasSchema = "paper";
    schema.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ScholarlyArticle",
      headline: originalTitle(paper.title),
      alternativeHeadline: localizedTitle(paper.title, "zh"),
      author: paper.authors?.map((author) => ({ "@type": "Person", name: author.name })),
      datePublished: paper.dates.first_public_date,
      dateModified: paper.dates.latest_revision_date,
      isPartOf: { "@type": "CreativeWork", name: "AI & Agent Infra Research Atlas" },
    });
    document.head.querySelector('[data-atlas-schema="paper"]')?.remove();
    document.head.appendChild(schema);
    return () => {
      schema.remove();
      document.title = "Infra Atlas · AI & Agent Systems Research";
    };
  }, [locale, paper]);

  const citations = useMemo(() => (paper ? citationFormats(paper) : null), [paper]);
  if (error) return <DetailError retry={() => setAttempt((value) => value + 1)} />;
  if (!paper || !catalog) return <DetailLoading />;

  const isFavorite = favorites.includes(paper.work_id);
  const title = localizedTitle(paper.title, locale);
  const original = originalTitle(paper.title);
  const pdfUrl = assetUrl(paper.pdf?.mirror_url || paper.pdf?.official_url || paper.pdf?.fallback_url);
  const relationIds = [...(paper.relations?.extends || []), ...(paper.relations?.supersedes || []), ...(paper.relations?.related || [])];
  const relatedPapers = relationIds.map((id) => catalog.papers.find((entry) => entry.work_id === id)).filter(Boolean);

  const copyCitation = async () => {
    if (!citations) return;
    await navigator.clipboard.writeText(citations[citationType]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <main id="main-content" className={`paper-detail domain-${paper.domain}`}>
      <section className="paper-detail-hero">
        <div className="detail-hero-grid" aria-hidden="true" />
        <div className="section-shell">
          <a className="back-link" href={homePath(window.location.search)} data-atlas-link>
            <ArrowLeft size={16} />
            <span>{copy("back")}</span>
          </a>

          <div className="detail-kickers">
            <span className="kicker-badge category-badge">{paper.primary_category}</span>
            <span className="kicker-sep">/</span>
            <span className="kicker-badge domain-badge">{domainLabel(paper.domain, locale)}</span>
            <span className="kicker-sep">/</span>
            <span className={`kicker-badge tier-badge tier-${paper.curation_tier}`}>
              {paper.curation_tier.toUpperCase()} TIER
            </span>
          </div>

          <div className="detail-title-row">
            <div>
              <h1>{title}</h1>
              {title !== original && <p className="detail-original-title">{original}</p>}
            </div>
            <button
              className={`detail-save ${isFavorite ? "active" : ""}`}
              type="button"
              onClick={() => toggle(paper.work_id)}
            >
              <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
              <span>{isFavorite ? copy("saved") : copy("save")}</span>
            </button>
          </div>

          <p className="detail-abstract">{localized(paper.abstract, locale)}</p>

          <div className="detail-byline">
            <span className="byline-item">
              <Users size={15} />
              <span>{authorsText(paper)}</span>
            </span>
            <span className="byline-item">
              <Calendar size={15} />
              <span>{paper.dates.first_public_date || "—"}</span>
            </span>
            <span className="byline-item">
              <BookOpen size={15} />
              <span>{paper.venue || paper.publication_status.replaceAll("_", " ")}</span>
            </span>
          </div>

          <div className="detail-tags">
            {paper.tags.map((tag) => (
              <a key={tag} href={`${homePath(`?tag=${encodeURIComponent(tag)}`)}#catalog`} data-atlas-link className="detail-tag-pill">
                #{tag}
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="detail-layout section-shell">
        <aside className="detail-sidebar">
          <nav aria-label={copy("overview")}>
            <a href="#overview"><span>01</span>{copy("overview")}</a>
            <a href="#evaluation"><span>02</span>{copy("evaluation")}</a>
            <a href="#lineage"><span>03</span>{copy("lineage")}</a>
            <a href="#evidence"><span>04</span>{copy("provenance")}</a>
            <a href="#reader"><span>05</span>{copy("pdfReader")}</a>
          </nav>
          <div className="record-status">
            <span className="record-status-badge">{statusLabel(paper.window_status, locale)}</span>
            <strong>{paper.publication_status.replaceAll("_", " ")}</strong>
            {paper.verified_at && <small className="record-verified-date">{copy("verified")} · {paper.verified_at}</small>}
          </div>
        </aside>

        <div className="detail-content">
          <section className="detail-block research-card" id="overview">
            <header>
              <div>
                <span>01 · RESEARCH CARD</span>
                <h2>{copy("overview")}</h2>
              </div>
              <span className="layer-badge">{paper.primary_category} · {categoryLabel(paper.primary_category, locale)}</span>
            </header>
            {paper.inclusion_reason && (
              <div className="inclusion-callout">
                <BadgeCheck size={20} className="callout-icon" />
                <div>
                  <strong>{copy("inclusion")}</strong>
                  <p>{localized(paper.inclusion_reason, locale)}</p>
                </div>
              </div>
            )}
            <BilingualSection id="problem" index="01.1" title={copy("problem")} body={localized(paper.problem, locale)} />
            <BilingualSection id="approach" index="01.2" title={copy("approach")} body={localized(paper.approach, locale)} />
            <BilingualSection id="system-design" index="01.3" title={copy("systemDesign")} body={localized(paper.system_design, locale)} />
            <BilingualSection id="key-results" index="01.4" title={copy("keyResults")} body={localized(paper.key_results, locale)} />
            <BilingualSection id="limitations" index="01.5" title={copy("limitations")} body={localized(paper.limitations, locale)} />
          </section>

          <section className="detail-block evaluation-block" id="evaluation">
            <header>
              <div>
                <span>02 · MEASUREMENT</span>
                <h2>{copy("evaluation")}</h2>
              </div>
              <Database size={20} className="header-icon" />
            </header>
            <div className="evaluation-context">
              <div><span>{locale === "zh" ? "评估模型" : "Models"}</span><p>{paper.evaluation?.models?.join(" · ") || "—"}</p></div>
              <div><span>{locale === "zh" ? "工作负载" : "Workloads"}</span><p>{paper.evaluation?.workloads?.join(" · ") || "—"}</p></div>
              <div><span>{locale === "zh" ? "硬件 / 集群" : "Hardware / cluster"}</span><p>{[...(paper.evaluation?.hardware || []), paper.evaluation?.cluster_scale].filter(Boolean).join(" · ") || "—"}</p></div>
              <div><span>{locale === "zh" ? "对比基线" : "Baselines"}</span><p>{paper.evaluation?.baselines?.join(" · ") || "—"}</p></div>
            </div>
            {paper.evaluation?.metrics?.length ? (
              <div className="metric-table-shell">
                <table className="metric-table">
                  <thead>
                    <tr>
                      <th>{locale === "zh" ? "指标" : "Metric"}</th>
                      <th>{locale === "zh" ? "测量结果" : "Result"}</th>
                      <th>{locale === "zh" ? "基线" : "Baseline"}</th>
                      <th>Δ 增益</th>
                      <th>{locale === "zh" ? "测试条件" : "Context"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paper.evaluation.metrics.map((metric, index) => (
                      <tr key={`${metric.name}-${index}`}>
                        <td>{metric.name}</td>
                        <td><strong>{metric.value ?? "—"}{metric.unit ? ` ${metric.unit}` : ""}</strong></td>
                        <td>{metric.baseline || "—"}</td>
                        <td><span className="metric-delta">{metric.delta || "—"}</span></td>
                        <td>{metric.context || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="detail-empty">{locale === "zh" ? "暂无结构化实验指标。" : "No structured metrics are available yet."}</p>
            )}
          </section>

          <section className="detail-block lineage-detail" id="lineage">
            <header>
              <div>
                <span>03 · LINEAGE NETWORK</span>
                <h2>{copy("lineage")}</h2>
              </div>
              <GitBranch size={20} className="header-icon" />
            </header>
            {paper.relations?.system_family && (
              <p className="system-family">
                SYSTEM FAMILY: <strong>{paper.relations.system_family}</strong>
              </p>
            )}
            <LineageGraph graph={catalog.graph} papers={catalog.papers} selectedId={paper.work_id} />
            {relatedPapers.length > 0 && (
              <div className="related-links">
                {relatedPapers.map((entry) => entry && (
                  <a href={paperPath(entry.slug)} data-atlas-link key={entry.work_id} className="related-paper-card">
                    <span className="related-cat">{entry.primary_category}</span>
                    <strong className="related-title">{localizedTitle(entry.title, locale)}</strong>
                    <ArrowUpRight size={14} className="related-arrow" />
                  </a>
                ))}
              </div>
            )}
          </section>

          <section className="detail-block evidence-block" id="evidence">
            <header>
              <div>
                <span>04 · PROVENANCE</span>
                <h2>{copy("provenance")}</h2>
              </div>
              <Link2 size={20} className="header-icon" />
            </header>
            <div className="evidence-columns">
              <div>
                <h3><ShieldCheckIcon />{copy("sources")}</h3>
                {paper.first_party_sources?.length ? (
                  <ul className="source-list">
                    {paper.first_party_sources.map((source, index) => (
                      <li key={`${source.url}-${index}`}>
                        <a href={source.url} target="_blank" rel="noreferrer" className="source-link-card">
                          <span className="source-tag">{source.type || source.kind || source.label || "SOURCE"}</span>
                          <strong>{source.title || source.label || new URL(source.url).hostname}</strong>
                          <ExternalLink size={14} />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="detail-empty">—</p>
                )}
              </div>
              <div>
                <h3><FileText size={16} />{copy("seedReports")}</h3>
                {paper.seed_reports?.length ? (
                  <ul className="report-list">
                    {paper.seed_reports.map((report, index) => (
                      <li key={`${report.seed_report_path}-${index}`}>
                        <span className="report-badge">REF {report.reference_number || index + 1}{report.page ? ` · P.${report.page}` : ""}</span>
                        <strong>{report.report_title || report.seed_report_path}</strong>
                        {report.context && <p>{report.context}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="detail-empty">—</p>
                )}
              </div>
            </div>

            {(paper.artifacts?.length || paper.reproducibility_badges?.length) && (
              <div className="artifact-row">
                <div>
                  <h3><Box size={16} />{copy("artifacts")}</h3>
                  <div className="artifact-links">
                    {paper.artifacts?.map((artifact, index) => {
                      const kind = artifact.type || artifact.kind;
                      return (
                        <a href={artifact.url} target="_blank" rel="noreferrer" key={`${artifact.url}-${index}`} className="artifact-link-card">
                          {kind === "code" ? <Code2 size={15} /> : kind === "data" ? <Database size={15} /> : <Box size={15} />}
                          <span>
                            <strong>{artifact.title || artifact.label || kind || "Artifact"}</strong>
                            {artifact.license && <small>{artifact.license}</small>}
                          </span>
                          <ArrowUpRight size={14} />
                        </a>
                      );
                    })}
                  </div>
                </div>
                <div className="repro-badges">
                  {paper.reproducibility_badges?.map((badge) => (
                    <span key={badge} className="repro-badge-pill">
                      <BadgeCheck size={14} />
                      <span>{badge}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {paper.versions?.length ? (
              <div className="version-history">
                <h3><History size={16} />{copy("versions")}</h3>
                <ol>
                  {paper.versions.map((version, index) => (
                    <li key={`${version.label || version.version || version.source}-${index}`}>
                      <i />
                      <time>{version.date || version.latest_revision_date || version.first_public_date || "—"}</time>
                      <div>
                        <strong>{version.label || version.version || version.status || `v${index + 1}`}</strong>
                        <span>{version.venue || version.source}</span>
                      </div>
                      {version.url && (
                        <a href={version.url} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>

          <section className="detail-block citation-notes-block">
            <div className="citation-panel">
              <header>
                <div>
                  <span>CITE THIS WORK</span>
                  <h2>{copy("citation")}</h2>
                </div>
                <Clipboard size={18} className="header-icon" />
              </header>
              <div className="citation-tabs">
                {(["BibTeX", "APA", "MLA"] as const).map((type) => (
                  <button className={citationType === type ? "active" : ""} type="button" onClick={() => setCitationType(type)} key={type}>
                    {type}
                  </button>
                ))}
              </div>
              <pre>{citations?.[citationType]}</pre>
              <button className="copy-citation" type="button" onClick={copyCitation}>
                {copied ? <Check size={15} /> : <Clipboard size={15} />}
                <span>{copied ? copy("copied") : copy("copy")}</span>
              </button>
            </div>

            <div className="notes-panel">
              <header>
                <div>
                  <span>DEVICE LOCAL</span>
                  <h2>{copy("localNotes")}</h2>
                </div>
                <NotebookPen size={18} className="header-icon" />
              </header>
              <p>{copy("localNotesBody")}</p>
              <textarea
                value={notes[paper.work_id] || ""}
                onChange={(event) => setNotes((current) => ({ ...current, [paper.work_id]: event.target.value }))}
                placeholder={copy("notesPlaceholder")}
              />
              <small>{(notes[paper.work_id] || "").length} {locale === "zh" ? "字符 · 浏览器本地即时保存" : "characters · autosaved locally"}</small>
            </div>
          </section>

          <section className="detail-block reader-block" id="reader">
            <header>
              <div>
                <span>05 · FULL TEXT</span>
                <h2>{copy("pdfReader")}</h2>
              </div>
              {pdfUrl && (
                <a href={pdfUrl} target="_blank" rel="noreferrer" className="open-pdf-external">
                  <span>{copy("openPdf")}</span>
                  <ExternalLink size={14} />
                </a>
              )}
            </header>
            {paper.pdf?.license && (
              <p className="pdf-license">
                {locale === "zh" ? "官方文档许可" : "Document license"} · {paper.pdf.license}
                {paper.pdf.size_bytes ? ` · ${(paper.pdf.size_bytes / 1024 / 1024).toFixed(1)} MB` : ""}
              </p>
            )}
            <PdfReader url={pdfUrl} />
          </section>
        </div>
      </div>
    </main>
  );
}

function ShieldCheckIcon() {
  return <BadgeCheck size={16} />;
}
