import { describe, expect, it } from "vitest";
import type { FilterState } from "../types";
import { filtersToSearch, parseFilters } from "./useUrlFilters";

describe("URL filter contract", () => {
  it("restores combined filters from a shared URL", () => {
    const filters = parseFilters("?q=runtime&domain=agent_infra&category=AG-3&artifact=yes&favorites=1&view=table");
    expect(filters).toMatchObject({
      query: "runtime",
      domain: "agent_infra",
      category: "AG-3",
      artifact: "yes",
      favoritesOnly: true,
      view: "table",
    });
  });

  it("omits defaults while preserving meaningful values", () => {
    const filters: FilterState = {
      ...parseFilters(""),
      category: "AI-5",
      from: "2025-01-01",
      to: "2025-03-31",
      pdf: "yes",
    };
    const params = new URLSearchParams(filtersToSearch(filters));
    expect(Object.fromEntries(params)).toEqual({
      category: "AI-5",
      pdf: "yes",
      from: "2025-01-01",
      to: "2025-03-31",
    });
  });
});
