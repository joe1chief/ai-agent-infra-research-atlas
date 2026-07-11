export type Locale = "zh" | "en";
export type Theme = "light" | "dark";
export type Domain = "ai_infra" | "agent_infra";
export type WindowStatus = "new_in_window" | "venue_carry_in" | "context";
export type CurationTier = "core" | "watchlist" | "context";

export interface BilingualText {
  zh: string;
  en: string;
}

export interface PaperTitle {
  original: string;
  zh: string;
  en: string;
}

export interface Author {
  name: string;
  affiliations?: string[];
}

export interface PaperDates {
  first_public_date?: string;
  venue_publication_date?: string | null;
  latest_revision_date?: string;
}

export interface Version {
  source?: string;
  version?: string;
  first_public_date?: string;
  latest_revision_date?: string;
  label?: string;
  date?: string;
  venue?: string;
  url?: string;
  status?: string;
}

export interface EvaluationMetric {
  name: string;
  value?: string | number;
  unit?: string;
  baseline?: string;
  delta?: string;
  context?: string;
}

export interface Evaluation {
  models?: string[];
  workloads?: string[];
  hardware?: string[];
  cluster_scale?: string;
  baselines?: string[];
  metrics?: EvaluationMetric[];
}

export interface SeedReport {
  report_title?: string;
  seed_report_path?: string;
  reference_number?: string | number;
  page?: number;
  context?: string;
  url?: string;
}

export interface SourceLink {
  type?: string;
  title?: string;
  kind?: string;
  label?: string;
  url: string;
  verified_at?: string;
}

export interface Artifact {
  type?: "code" | "data" | "demo" | "model" | "documentation" | "other" | string;
  title?: string;
  kind?: "code" | "data" | "demo" | "model" | string;
  label?: string;
  url: string;
  license?: string;
}

export interface Relations {
  system_family?: string;
  extends?: string[];
  supersedes?: string[];
  related?: string[];
}

export interface PaperPdf {
  official_url?: string;
  mirror_url?: string;
  mirror_status?: string;
  license?: string;
  sha256?: string;
  size_bytes?: number;
  fallback_url?: string;
}

export interface PaperIndexEntry {
  work_id: string;
  slug: string;
  title: PaperTitle;
  authors?: Author[];
  institutions?: string[];
  dates: PaperDates;
  window_status: WindowStatus;
  venue?: string;
  publication_status: string;
  curation_tier: CurationTier;
  domain: Domain;
  primary_category: string;
  tags: string[];
  inclusion_reason?: BilingualText;
  abstract?: BilingualText;
  artifacts?: Artifact[];
  has_pdf?: boolean;
  has_local_pdf?: boolean;
  source_kinds?: string[];
  system_family?: string;
  search_text?: string;
}

export interface Paper extends PaperIndexEntry {
  identifiers?: Record<string, string | string[]>;
  versions?: Version[];
  category_confidence?: number;
  problem: BilingualText;
  approach: BilingualText;
  system_design: BilingualText;
  key_results: BilingualText;
  limitations: BilingualText;
  evaluation?: Evaluation;
  seed_reports?: SeedReport[];
  first_party_sources?: SourceLink[];
  verified_at?: string;
  discovery_method?: string;
  reproducibility_badges?: string[];
  relations?: Relations;
  pdf?: PaperPdf;
}

export interface CatalogManifest {
  schema_version?: string;
  generated_at?: string;
  window?: { start: string; end: string };
  counts?: Record<string, number>;
  files?: {
    index?: string;
    graph?: string;
    stats?: string;
    route_manifest?: string;
    routes?: string;
    paper_detail_pattern?: string;
    sitemap?: string;
  };
}

export interface GraphNode {
  id: string;
  kind?: "paper" | "system_family" | "seed_report" | string;
  slug?: string;
  label?: string;
  title?: PaperTitle | string;
  domain?: Domain;
  primary_category?: string;
  curation_tier?: CurationTier;
  system_family?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "extends" | "supersedes" | "related" | string;
}

export interface CatalogGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CatalogData {
  manifest: CatalogManifest;
  papers: PaperIndexEntry[];
  graph: CatalogGraph;
}

export interface FilterState {
  query: string;
  domain: "all" | Domain;
  category: string;
  windowStatus: string;
  publicationStatus: string;
  tier: string;
  venue: string;
  tag: string;
  artifact: "all" | "yes" | "no";
  pdf: "all" | "yes" | "no" | "local" | "external";
  source: string;
  from: string;
  to: string;
  favoritesOnly: boolean;
  view: "cards" | "table";
}
