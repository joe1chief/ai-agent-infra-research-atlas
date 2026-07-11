import { useCallback, useMemo, useState } from "react";
import type { FilterState } from "../types";

const defaults: FilterState = {
  query: "",
  domain: "all",
  category: "all",
  windowStatus: "new_in_window",
  publicationStatus: "recommended",
  tier: "all",
  venue: "all",
  tag: "all",
  artifact: "all",
  pdf: "all",
  source: "all",
  from: "",
  to: "",
  favoritesOnly: false,
  view: "cards",
};

const keyMap: Record<keyof FilterState, string> = {
  query: "q",
  domain: "domain",
  category: "category",
  windowStatus: "window",
  publicationStatus: "status",
  tier: "tier",
  venue: "venue",
  tag: "tag",
  artifact: "artifact",
  pdf: "pdf",
  source: "source",
  from: "from",
  to: "to",
  favoritesOnly: "favorites",
  view: "view",
};

export function parseFilters(search: string): FilterState {
  const params = new URLSearchParams(search);
  return {
    query: params.get("q") || "",
    domain: (params.get("domain") as FilterState["domain"]) || "all",
    category: params.get("category") || "all",
    windowStatus: params.get("window") || "new_in_window",
    publicationStatus: params.get("status") || "recommended",
    tier: params.get("tier") || "all",
    venue: params.get("venue") || "all",
    tag: params.get("tag") || "all",
    artifact: (params.get("artifact") as FilterState["artifact"]) || "all",
    pdf: (params.get("pdf") as FilterState["pdf"]) || "all",
    source: params.get("source") || "all",
    from: params.get("from") || "",
    to: params.get("to") || "",
    favoritesOnly: params.get("favorites") === "1",
    view: params.get("view") === "table" ? "table" : "cards",
  };
}

export function filtersToSearch(filters: FilterState): string {
  const params = new URLSearchParams();
  (Object.keys(filters) as Array<keyof FilterState>).forEach((key) => {
    const value = filters[key];
    if (value === defaults[key] || value === "" || value === false) return;
    params.set(keyMap[key], value === true ? "1" : String(value));
  });
  return params.toString();
}

function sync(filters: FilterState) {
  const query = filtersToSearch(filters);
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

export function useUrlFilters() {
  const initial = useMemo(() => parseFilters(window.location.search), []);
  const [filters, setFiltersState] = useState<FilterState>(initial);

  const setFilters = useCallback((update: Partial<FilterState> | ((current: FilterState) => FilterState)) => {
    setFiltersState((current) => {
      const next = typeof update === "function" ? update(current) : { ...current, ...update };
      sync(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFiltersState(defaults);
    sync(defaults);
  }, []);

  return { filters, setFilters, reset, defaults };
}
