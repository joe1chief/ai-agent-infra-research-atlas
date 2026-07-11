import { ArrowUpRight, Bookmark, Boxes, FileText, GitBranch, Star } from "lucide-react";
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
}
function StatusPill({ paper }: { paper: PaperIndexEntry }) {
  const { locale } = useApp();
  return <span className={`status-pill status-${paper.window_status}`}>{statusLabel(paper.window_status, locale)}</span>;
}

export function PaperCards({ papers, favorites, onFavorite, onLineage, selectedId }: CommonProps) {
  const { locale, copy } = useApp();
  return (
    <div className="paper-grid">
      {papers.map((paper, index) => {
        const isFavorite = favorites.includes(paper.work_id);
        const displayTitle = localizedTitle(paper.title, locale);
        const original = originalTitle(paper.title);
        return (
          <article className={`paper-card domain-${paper.domain} ${selectedId === paper.work_id ? "selected" : ""}`} key={paper.work_id} style={{ "--delay": `${Math.min(index, 12) * 30}ms` } as React.CSSProperties}>
            <div className="paper-card-topline">
              <span className="category-code">{paper.primary_category}</span>
              <StatusPill paper={paper} />
              <button className="favorite-button" type="button" onClick={() => onFavorite(paper.work_id)} aria-label={isFavorite ? copy("saved") : copy("save")} title={isFavorite ? copy("saved") : copy("save")}>
                <Star size={17} fill={isFavorite ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="paper-card-body">
              <p className="paper-domain">{domainLabel(paper.domain, locale)} · {categoryLabel(paper.primary_category, locale)}</p>
              <h3>{displayTitle}</h3>
              {displayTitle !== original && <p className="original-title">{original}</p>}
              {paper.abstract && <p className="paper-abstract">{localized(paper.abstract, locale)}</p>}
              <div className="paper-tags">
                {paper.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </div>
            <dl className="paper-meta">
              <div><dt>{copy("columnsDate")}</dt><dd>{paper.dates.first_public_date || "—"}</dd></div>
              <div><dt>{copy("venue")}</dt><dd>{paper.venue || paper.publication_status}</dd></div>
            </dl>
            <div className="paper-card-actions">
              <button type="button" onClick={() => onLineage(paper.work_id)}><GitBranch size={15} />{copy("inspectLineage")}</button>
              <a href={paperPath(paper.slug)} data-atlas-link>{copy("inspect")}<ArrowUpRight size={15} /></a>
            </div>
            <span className="card-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
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
        <thead><tr><th className="save-column"><Bookmark size={14} /><span className="sr-only">{copy("save")}</span></th><th>{copy("columnsTitle")}</th><th>{copy("columnsLayer")}</th><th>{copy("columnsStatus")}</th><th>{copy("columnsDate")}</th><th><span className="sr-only">{copy("inspect")}</span></th></tr></thead>
        <tbody>
          {papers.map((paper) => {
            const isFavorite = favorites.includes(paper.work_id);
            return (
              <tr key={paper.work_id} className={selectedId === paper.work_id ? "selected" : ""}>
                <td><button className="favorite-button" onClick={() => onFavorite(paper.work_id)} aria-label={isFavorite ? copy("saved") : copy("save")}><Star size={16} fill={isFavorite ? "currentColor" : "none"} /></button></td>
                <td><a href={paperPath(paper.slug)} data-atlas-link><strong>{localizedTitle(paper.title, locale)}</strong><span>{paper.authors?.slice(0, 3).map((author) => author.name).join(", ") || paper.institutions?.slice(0, 2).join(", ")}</span></a></td>
                <td><button className="layer-button" type="button" onClick={() => onLineage(paper.work_id)}><span>{paper.primary_category}</span>{categoryLabel(paper.primary_category, locale)}<GitBranch size={13} /></button></td>
                <td><StatusPill paper={paper} /></td>
                <td><time>{paper.dates.first_public_date || "—"}</time></td>
                <td><a className="table-open" href={paperPath(paper.slug)} data-atlas-link aria-label={copy("inspect")}><ArrowUpRight size={16} /></a></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyCatalog() {
  const { copy } = useApp();
  return (
    <div className="empty-catalog">
      <div aria-hidden="true"><Boxes size={28} /><FileText size={22} /></div>
      <h3>{copy("noResults")}</h3>
      <p>{copy("noResultsBody")}</p>
    </div>
  );
}
