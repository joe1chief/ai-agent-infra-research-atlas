import { ArrowUpRight, Bookmark, Boxes, Calendar, Code2, Cpu, FileText, GitBranch, Sparkles, Star, Users } from "lucide-react";
import { useApp } from "../App";
import { paperPath } from "../lib/catalog";
import { categoryLabel, domainLabel, localized, localizedTitle, originalTitle, statusLabel } from "../lib/i18n";
import type { PaperIndexEntry } from "../types";

interface CommonProps {
  papers: PaperIndexEntry[];
  favorites: string[];
  onFavorite: (workId: string) => void;
  onLineage: (workId: string) => void;
  selectedId?: string;
  onResetFilters?: () => void;
}

function StatusPill({ paper }: { paper: PaperIndexEntry }) {
  const { locale } = useApp();
  return (
    <span className={`status-pill status-${paper.window_status}`}>
      <span className="status-pill-dot" aria-hidden="true" />
      <span>{statusLabel(paper.window_status, locale)}</span>
    </span>
  );
}

export function PaperCards({ papers, favorites, onFavorite, onLineage, selectedId }: CommonProps) {
  const { locale, copy } = useApp();
  return (
    <div className="paper-grid">
      {papers.map((paper, index) => {
        const isFavorite = favorites.includes(paper.work_id);
        const displayTitle = localizedTitle(paper.title, locale);
        const original = originalTitle(paper.title);
        const hasArtifacts = Boolean(paper.artifacts?.length);
        const hasPdf = Boolean(paper.has_pdf || paper.has_local_pdf);
        const authors = paper.authors?.slice(0, 3).map((a) => a.name).join(", ");
        const institutions = paper.institutions?.slice(0, 2).join(" · ");

        return (
          <article
            className={`paper-card domain-${paper.domain} ${selectedId === paper.work_id ? "selected" : ""}`}
            key={paper.work_id}
            style={{ "--delay": `${Math.min(index, 12) * 35}ms` } as React.CSSProperties}
          >
            <div className="paper-card-accent-bar" aria-hidden="true" />

            <div className="paper-card-topline">
              <div className="topline-left">
                <span className="category-code-badge">
                  {paper.primary_category}
                </span>
                <StatusPill paper={paper} />
                {paper.curation_tier === "core" && (
                  <span className="core-tier-badge">CORE</span>
                )}
              </div>
              <button
                className={`favorite-button ${isFavorite ? "active" : ""}`}
                type="button"
                onClick={() => onFavorite(paper.work_id)}
                aria-label={isFavorite ? copy("saved") : copy("save")}
                title={isFavorite ? copy("saved") : copy("save")}
              >
                <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
              </button>
            </div>

            <div className="paper-card-body">
              <div className="paper-domain-row">
                <span className="domain-chip">
                  {paper.domain === "ai_infra" ? <Cpu size={12} /> : <Sparkles size={12} />}
                  <span>{domainLabel(paper.domain, locale)}</span>
                </span>
                <span className="category-text-label">{categoryLabel(paper.primary_category, locale)}</span>
              </div>

              <h3 className="paper-title-heading">
                <a href={paperPath(paper.slug)} data-atlas-link>
                  {displayTitle}
                </a>
              </h3>
              {displayTitle !== original && <p className="original-title">{original}</p>}

              {(authors || institutions) && (
                <div className="paper-card-authors">
                  <Users size={12} className="author-icon" />
                  <span className="author-names">{authors || institutions}</span>
                </div>
              )}

              {paper.abstract && (
                <p className="paper-abstract">
                  {localized(paper.abstract, locale)}
                </p>
              )}

              <div className="paper-tags">
                {paper.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="paper-tag-pill">#{tag}</span>
                ))}
              </div>
            </div>

            <div className="paper-card-footer-meta">
              <div className="meta-left">
                <span className="meta-date">
                  <Calendar size={12} />
                  <span>{paper.dates.first_public_date || "—"}</span>
                </span>
                <span className="meta-venue" title={paper.venue || paper.publication_status}>
                  {paper.venue || paper.publication_status.replaceAll("_", " ")}
                </span>
              </div>
              <div className="meta-right">
                {hasArtifacts && (
                  <span className="artifact-chip" title="Code / Artifact available">
                    <Code2 size={12} />
                    <span>Code</span>
                  </span>
                )}
                {hasPdf && (
                  <span className="pdf-chip" title="Full PDF available">
                    <FileText size={12} />
                    <span>PDF</span>
                  </span>
                )}
              </div>
            </div>

            <div className="paper-card-actions">
              <button
                type="button"
                className="action-btn lineage-btn"
                onClick={() => onLineage(paper.work_id)}
                title={copy("inspectLineage")}
              >
                <GitBranch size={14} />
                <span>{copy("inspectLineage")}</span>
              </button>
              <a
                href={paperPath(paper.slug)}
                data-atlas-link
                className="action-btn inspect-btn"
                title={copy("inspect")}
              >
                <span>{copy("inspect")}</span>
                <ArrowUpRight size={14} />
              </a>
            </div>

            <span className="card-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
          </article>
        );
      })}
    </div>
  );
}

export function PaperTable({ papers, favorites, onFavorite, onLineage, selectedId }: CommonProps) {
  const { locale, copy } = useApp();
  return (
    <div className="table-shell">
      <table className="paper-table">
        <thead>
          <tr>
            <th className="save-column">
              <Bookmark size={13} />
              <span className="sr-only">{copy("save")}</span>
            </th>
            <th>{copy("columnsTitle")}</th>
            <th>{copy("columnsLayer")}</th>
            <th>{copy("columnsStatus")}</th>
            <th>{copy("columnsDate")}</th>
            <th>{copy("venue")}</th>
            <th><span className="sr-only">{copy("inspect")}</span></th>
          </tr>
        </thead>
        <tbody>
          {papers.map((paper) => {
            const isFavorite = favorites.includes(paper.work_id);
            return (
              <tr key={paper.work_id} className={`table-row domain-${paper.domain} ${selectedId === paper.work_id ? "selected" : ""}`}>
                <td className="save-cell">
                  <button
                    className={`favorite-button ${isFavorite ? "active" : ""}`}
                    onClick={() => onFavorite(paper.work_id)}
                    aria-label={isFavorite ? copy("saved") : copy("save")}
                  >
                    <Star size={15} fill={isFavorite ? "currentColor" : "none"} />
                  </button>
                </td>
                <td className="title-cell">
                  <a href={paperPath(paper.slug)} data-atlas-link className="table-title-link">
                    <strong>{localizedTitle(paper.title, locale)}</strong>
                    <span className="table-authors">
                      {paper.authors?.slice(0, 3).map((author) => author.name).join(", ") || paper.institutions?.slice(0, 2).join(", ")}
                    </span>
                  </a>
                </td>
                <td>
                  <button className="layer-button" type="button" onClick={() => onLineage(paper.work_id)}>
                    <span className="layer-pill">{paper.primary_category}</span>
                    <span className="layer-label">{categoryLabel(paper.primary_category, locale)}</span>
                    <GitBranch size={12} className="layer-branch-icon" />
                  </button>
                </td>
                <td>
                  <StatusPill paper={paper} />
                </td>
                <td>
                  <time className="table-date">{paper.dates.first_public_date || "—"}</time>
                </td>
                <td>
                  <span className="table-venue">{paper.venue || paper.publication_status.replaceAll("_", " ")}</span>
                </td>
                <td className="action-cell">
                  <a className="table-open" href={paperPath(paper.slug)} data-atlas-link aria-label={copy("inspect")}>
                    <ArrowUpRight size={15} />
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyCatalog({ onReset }: { onReset?: () => void }) {
  const { copy } = useApp();
  return (
    <div className="empty-catalog">
      <div className="empty-catalog-icon" aria-hidden="true">
        <Boxes size={32} />
        <FileText size={22} className="empty-floating-file" />
      </div>
      <h3>{copy("noResults")}</h3>
      <p>{copy("noResultsBody")}</p>
      {onReset && (
        <button type="button" className="empty-reset-btn" onClick={onReset}>
          {copy("clear")}
        </button>
      )}
    </div>
  );
}
