import { CalendarRange, ChevronDown, Cpu, FileText, Filter, Flame, Layers, RotateCcw, Search, SlidersHorizontal, Sparkles, Star, X } from "lucide-react";
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
      <span className="filter-field-label">{label}</span>
      <div className="select-wrapper">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
      </div>
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

  const aiCount = papers.filter((paper) => paper.domain === "ai_infra").length;
  const agentCount = papers.filter((paper) => paper.domain === "agent_infra").length;

  const activeFilterCount = [
    filters.query,
    filters.domain !== "all" ? filters.domain : "",
    filters.category !== "all" ? filters.category : "",
    filters.windowStatus !== "all" ? filters.windowStatus : "",
    filters.tier !== "all" ? filters.tier : "",
    filters.venue !== "all" ? filters.venue : "",
    filters.tag !== "all" ? filters.tag : "",
    filters.artifact !== "all" ? filters.artifact : "",
    filters.pdf !== "all" ? filters.pdf : "",
    filters.source !== "all" ? filters.source : "",
    filters.publicationStatus !== "recommended" ? filters.publicationStatus : "",
    filters.from,
    filters.to,
    filters.favoritesOnly ? "fav" : "",
  ].filter(Boolean).length;

  return (
    <div className="filter-panel">
      {/* Top row: Domain Segmented Selector & Search Command */}
      <div className="filter-header-row">
        <div className="domain-segments" role="tablist" aria-label="Domain Filter">
          <button
            type="button"
            role="tab"
            aria-selected={filters.domain === "all"}
            className={`domain-tab ${filters.domain === "all" ? "active" : ""}`}
            onClick={() => onChange({ domain: "all", category: "all" })}
          >
            <Layers size={14} />
            <span>{copy("all")}</span>
            <span className="domain-count">{papers.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filters.domain === "ai_infra"}
            className={`domain-tab domain-tab-ai ${filters.domain === "ai_infra" ? "active" : ""}`}
            onClick={() => onChange({ domain: "ai_infra", category: "all" })}
          >
            <Cpu size={14} />
            <span>AI Infra</span>
            <span className="domain-count">{aiCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filters.domain === "agent_infra"}
            className={`domain-tab domain-tab-agent ${filters.domain === "agent_infra" ? "active" : ""}`}
            onClick={() => onChange({ domain: "agent_infra", category: "all" })}
          >
            <Sparkles size={14} />
            <span>Agent Infra</span>
            <span className="domain-count">{agentCount}</span>
          </button>
        </div>

        <div className="catalog-search">
          <Search size={17} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder={copy("search")}
            aria-label={copy("search")}
          />
          {filters.query ? (
            <button type="button" className="clear-search-btn" onClick={() => onChange({ query: "" })} aria-label={copy("clear")}>
              <X size={14} />
            </button>
          ) : (
            <kbd className="search-kbd">/</kbd>
          )}
        </div>
      </div>

      {/* Primary 4 selects */}
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

      {/* Advanced expandable drawer */}
      <details className="advanced-filters">
        <summary>
          <div className="summary-left">
            <SlidersHorizontal size={15} />
            <span>{locale === "zh" ? "高级筛选" : "Advanced Filters"}</span>
          </div>
          <span className="advanced-badge">
            {[
              filters.venue,
              filters.tag,
              filters.artifact,
              filters.pdf,
              filters.source,
              filters.publicationStatus === "recommended" ? "all" : filters.publicationStatus,
              filters.from,
              filters.to,
            ].filter((value) => value && value !== "all").length || 0}
          </span>
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
            <span className="filter-field-label"><CalendarRange size={12} /> {copy("from")}</span>
            <input type="date" value={filters.from} onChange={(event) => onChange({ from: event.target.value })} />
          </label>
          <label className="filter-field date-field">
            <span className="filter-field-label"><CalendarRange size={12} /> {copy("to")}</span>
            <input type="date" value={filters.to} onChange={(event) => onChange({ to: event.target.value })} />
          </label>
        </div>
      </details>

      {/* Quick filter action chips & status bar */}
      <div className="filter-quick-actions">
        <div className="quick-tags">
          <button
            className={`quick-pill ${filters.favoritesOnly ? "active" : ""}`}
            type="button"
            onClick={() => onChange({ favoritesOnly: !filters.favoritesOnly })}
          >
            <Star size={13} fill={filters.favoritesOnly ? "currentColor" : "none"} />
            <span>{copy("favoritesOnly")}</span>
          </button>
          <button
            className={`quick-pill ${filters.tier === "core" ? "active" : ""}`}
            type="button"
            onClick={() => onChange({ tier: filters.tier === "core" ? "all" : "core" })}
          >
            <Flame size={13} />
            <span>Core Tier</span>
          </button>
          <button
            className={`quick-pill ${filters.pdf === "yes" ? "active" : ""}`}
            type="button"
            onClick={() => onChange({ pdf: filters.pdf === "yes" ? "all" : "yes" })}
          >
            <FileText size={13} />
            <span>PDF Available</span>
          </button>
        </div>

        <div className="filter-meta-actions">
          {activeFilterCount > 0 && (
            <button className="reset-button" type="button" onClick={onReset}>
              <RotateCcw size={13} />
              <span>{copy("clear")} ({activeFilterCount})</span>
            </button>
          )}
          <span className="filter-indicator">
            <Filter size={12} />
            <span>{locale === "zh" ? "URL 即时同步" : "Live URL sync"}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
