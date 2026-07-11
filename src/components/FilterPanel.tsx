import { CalendarRange, Filter, RotateCcw, Search, SlidersHorizontal, Star } from "lucide-react";
import { useApp } from "../App";
import { categoryLabel } from "../lib/i18n";
import type { FilterState, PaperIndexEntry } from "../types";

interface FilterPanelProps {
  filters: FilterState;
  papers: PaperIndexEntry[];
  onChange: (update: Partial<FilterState>) => void;
  onReset: () => void;
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterPanel({ filters, papers, onChange, onReset }: FilterPanelProps) {
  const { locale, copy } = useApp();
  const unique = (values: Array<string | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
  const categories = unique(papers.map((paper) => paper.primary_category));
  const venues = unique(papers.map((paper) => paper.venue));
  const tags = unique(papers.flatMap((paper) => paper.tags));
  const sources = unique(papers.flatMap((paper) => paper.source_kinds || []));
  const publicationStatuses = unique(papers.map((paper) => paper.publication_status));
  const all = { value: "all", label: copy("all") };

  return (
    <div className="filter-panel">
      <div className="catalog-search">
        <Search size={19} aria-hidden="true" />
        <input
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder={copy("search")}
          aria-label={copy("search")}
        />
        {filters.query && (
          <button type="button" onClick={() => onChange({ query: "" })} aria-label={copy("clear")}>
            ×
          </button>
        )}
      </div>

      <div className="primary-filters">
        <SelectField
          label={copy("domain")}
          value={filters.domain}
          options={[
            all,
            { value: "ai_infra", label: "AI Infra" },
            { value: "agent_infra", label: "Agent Infra" },
          ]}
          onChange={(domain) => onChange({ domain: domain as FilterState["domain"], category: "all" })}
        />
        <SelectField
          label={copy("category")}
          value={filters.category}
          options={[all, ...categories.map((id) => ({ value: id, label: `${id} · ${categoryLabel(id, locale)}` }))]}
          onChange={(category) => onChange({ category })}
        />
        <SelectField
          label={copy("window")}
          value={filters.windowStatus}
          options={[
            all,
            { value: "new_in_window", label: locale === "zh" ? "窗口内新作" : "New in window" },
            { value: "venue_carry_in", label: locale === "zh" ? "正式发表补录" : "Venue carry-in" },
            { value: "context", label: locale === "zh" ? "上下文节点" : "Context" },
          ]}
          onChange={(windowStatus) => onChange({ windowStatus })}
        />
        <SelectField
          label={copy("tier")}
          value={filters.tier}
          options={[all, { value: "core", label: "Core" }, { value: "watchlist", label: "Watchlist" }, { value: "context", label: "Context" }]}
          onChange={(tier) => onChange({ tier })}
        />
      </div>

      <details className="advanced-filters">
        <summary>
          <SlidersHorizontal size={16} />
          {locale === "zh" ? "更多筛选" : "More filters"}
          <span>{[
            filters.venue,
            filters.tag,
            filters.artifact,
            filters.pdf,
            filters.source,
            filters.publicationStatus === "recommended" ? "all" : filters.publicationStatus,
            filters.from,
            filters.to,
          ].filter((value) => value && value !== "all").length || ""}</span>
        </summary>
        <div className="advanced-grid">
          <SelectField label={copy("venue")} value={filters.venue} options={[all, ...venues.map((value) => ({ value, label: value }))]} onChange={(venue) => onChange({ venue })} />
          <SelectField label={copy("tag")} value={filters.tag} options={[all, ...tags.map((value) => ({ value, label: value }))]} onChange={(tag) => onChange({ tag })} />
          <SelectField label={copy("artifact")} value={filters.artifact} options={[all, { value: "yes", label: locale === "zh" ? "有" : "Available" }, { value: "no", label: locale === "zh" ? "无" : "None" }]} onChange={(artifact) => onChange({ artifact: artifact as FilterState["artifact"] })} />
          <SelectField
            label={copy("pdf")}
            value={filters.pdf}
            options={[
              all,
              { value: "yes", label: locale === "zh" ? "有官方全文" : "Official full text" },
              { value: "local", label: locale === "zh" ? "站内镜像" : "Local mirror" },
              { value: "external", label: locale === "zh" ? "仅官方外链" : "Official link only" },
              { value: "no", label: locale === "zh" ? "无" : "None" },
            ]}
            onChange={(pdf) => onChange({ pdf: pdf as FilterState["pdf"] })}
          />
          <SelectField label={copy("source")} value={filters.source} options={[all, ...sources.map((value) => ({ value, label: value }))]} onChange={(source) => onChange({ source })} />
          <SelectField
            label={copy("columnsStatus")}
            value={filters.publicationStatus}
            options={[
              { value: "recommended", label: locale === "zh" ? "默认（排除撤稿）" : "Default (excludes withdrawn)" },
              all,
              ...publicationStatuses.map((value) => ({ value, label: value.replaceAll("_", " ") })),
            ]}
            onChange={(publicationStatus) => onChange({ publicationStatus })}
          />
          <label className="filter-field date-field">
            <span><CalendarRange size={13} /> {copy("from")}</span>
            <input type="date" value={filters.from} onChange={(event) => onChange({ from: event.target.value })} />
          </label>
          <label className="filter-field date-field">
            <span><CalendarRange size={13} /> {copy("to")}</span>
            <input type="date" value={filters.to} onChange={(event) => onChange({ to: event.target.value })} />
          </label>
        </div>
      </details>

      <div className="filter-quick-actions">
        <button className={filters.favoritesOnly ? "active" : ""} type="button" onClick={() => onChange({ favoritesOnly: !filters.favoritesOnly })}>
          <Star size={15} fill={filters.favoritesOnly ? "currentColor" : "none"} />
          {copy("favoritesOnly")}
        </button>
        <button type="button" onClick={onReset}>
          <RotateCcw size={15} />
          {copy("clear")}
        </button>
        <span className="filter-indicator"><Filter size={14} /> {locale === "zh" ? "筛选同步到 URL" : "Filters sync to URL"}</span>
      </div>
    </div>
  );
}
