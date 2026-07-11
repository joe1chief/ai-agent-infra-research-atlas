import type {
  CatalogData,
  CatalogGraph,
  CatalogManifest,
  Paper,
  PaperIndexEntry,
  PaperTitle,
} from "../types";

const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

function dataUrl(path: string): string {
  const cleanPath = path.replace(/^\/?(?:public\/)?/, "").replace(/^data\//, "");
  return `${base}data/${cleanPath}`;
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(dataUrl(path), { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${path}`);
  return (await response.json()) as T;
}

function title(value: unknown): PaperTitle {
  if (typeof value === "string") return { original: value, zh: value, en: value };
  if (value && typeof value === "object") {
    const candidate = value as Partial<PaperTitle>;
    const original = candidate.original || candidate.en || candidate.zh || "Untitled";
    return { original, zh: candidate.zh || original, en: candidate.en || original };
  }
  return { original: "Untitled", zh: "未命名研究", en: "Untitled research" };
}

function normalizePaper(raw: Partial<PaperIndexEntry> & Record<string, unknown>): PaperIndexEntry {
  const dates = raw.dates && typeof raw.dates === "object" ? raw.dates : {};
  return {
    work_id: String(raw.work_id || raw.slug || "unknown"),
    slug: String(raw.slug || raw.work_id || "unknown"),
    title: title(raw.title),
    authors: Array.isArray(raw.authors) ? raw.authors : [],
    institutions: Array.isArray(raw.institutions) ? raw.institutions : [],
    dates,
    window_status: raw.window_status || "new_in_window",
    venue: raw.venue,
    publication_status: raw.publication_status || "preprint",
    curation_tier: raw.curation_tier || "watchlist",
    domain: raw.domain || "ai_infra",
    primary_category: raw.primary_category || "AI-6",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    inclusion_reason: raw.inclusion_reason,
    abstract: raw.abstract,
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    has_pdf: Boolean(raw.has_pdf || (raw.pdf && typeof raw.pdf === "object")),
    has_local_pdf: Boolean(raw.has_local_pdf),
    source_kinds: Array.isArray(raw.source_kinds) ? raw.source_kinds : [],
    system_family: raw.system_family,
    search_text: typeof raw.search_text === "string" ? raw.search_text : "",
  };
}

function normalizeGraph(raw: unknown): CatalogGraph {
  const graphObject = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    nodes: Array.isArray(graphObject.nodes) ? (graphObject.nodes as CatalogGraph["nodes"]) : [],
    edges: Array.isArray(graphObject.edges)
      ? (graphObject.edges as CatalogGraph["edges"])
      : Array.isArray(graphObject.links)
        ? (graphObject.links as CatalogGraph["edges"])
        : [],
  };
}

export async function loadGraph(manifest: CatalogManifest, signal?: AbortSignal): Promise<CatalogGraph> {
  const graphPath = manifest.files?.graph || "graph.json";
  return normalizeGraph(await fetchJson<unknown>(graphPath, signal));
}

export async function loadCatalog(signal?: AbortSignal, includeGraph = false): Promise<CatalogData> {
  const manifest = await fetchJson<CatalogManifest>("catalog-manifest.json", signal);
  const indexPath = manifest.files?.index || "papers-index.json";
  const [indexRaw, graph] = await Promise.all([
    fetchJson<unknown>(indexPath, signal),
    includeGraph ? loadGraph(manifest, signal).catch(() => ({ nodes: [], edges: [] })) : Promise.resolve({ nodes: [], edges: [] }),
  ]);

  const indexObject = indexRaw && typeof indexRaw === "object" ? (indexRaw as Record<string, unknown>) : {};
  const rawPapers = Array.isArray(indexRaw)
    ? indexRaw
    : Array.isArray(indexObject.papers)
      ? indexObject.papers
      : Array.isArray(indexObject.items)
        ? indexObject.items
        : [];

  return {
    manifest,
    papers: (rawPapers as Array<Partial<PaperIndexEntry> & Record<string, unknown>>).map(normalizePaper),
    graph,
  };
}

export async function loadPaper(entry: Pick<PaperIndexEntry, "work_id" | "slug">, signal?: AbortSignal): Promise<Paper> {
  const candidates = [`papers/${entry.work_id}.json`, `details/${entry.slug}.json`];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const raw = await fetchJson<Paper & Record<string, unknown>>(candidate, signal);
      return {
        ...raw,
        title: title(raw.title),
        first_party_sources: (raw.first_party_sources || []).map((source) => {
          const candidateSource = source as typeof source & { type?: string; title?: string };
          return {
            ...source,
            kind: source.kind || candidateSource.type,
            label: source.label || candidateSource.title,
          };
        }),
        artifacts: (raw.artifacts || []).map((artifact) => {
          const candidateArtifact = artifact as typeof artifact & { type?: string; title?: string };
          return {
            ...artifact,
            kind: artifact.kind || candidateArtifact.type,
            label: artifact.label || candidateArtifact.title,
          };
        }),
        versions: (raw.versions || []).map((version) => {
          const candidateVersion = version as typeof version & {
            version?: string;
            first_public_date?: string;
            latest_revision_date?: string;
            source?: string;
          };
          return {
            ...version,
            label: version.label || candidateVersion.version || candidateVersion.source,
            date: version.date || candidateVersion.latest_revision_date || candidateVersion.first_public_date,
          };
        }),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Paper data not found");
}

export function assetUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//.test(url)) return url;
  return `${base}${url.replace(/^\//, "")}`;
}

export function paperPath(slug: string): string {
  return `${base}paper/${encodeURIComponent(slug)}/`;
}

export function homePath(search = ""): string {
  return `${base}${search}`;
}

export function routePath(): string {
  const pathname = window.location.pathname;
  const prefix = base === "/" ? "" : base.replace(/\/$/, "");
  return prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : pathname;
}
