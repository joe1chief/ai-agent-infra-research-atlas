#!/usr/bin/env python3
"""Build deterministic, browser-friendly artifacts from canonical paper JSON."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

try:
    from validate_catalog import (
        CATEGORIES,
        DEFAULT_PAPERS_DIR,
        DEFAULT_SCHEMA,
        WINDOW_START,
        validate_catalog,
    )
except ImportError:  # pragma: no cover - supports `python -m scripts.build_catalog`
    from scripts.validate_catalog import (
        CATEGORIES,
        DEFAULT_PAPERS_DIR,
        DEFAULT_SCHEMA,
        WINDOW_START,
        validate_catalog,
    )


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "public" / "data"
DEFAULT_PDF_MANIFEST = REPO_ROOT / "content" / "pdf-mirror-manifest.json"
DEFAULT_README = REPO_ROOT / "README.md"
SCHEMA_VERSION = "1.0"
README_STATS_START = "<!-- catalog-stats:start -->"
README_STATS_END = "<!-- catalog-stats:end -->"


def generated_at() -> str:
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    moment = datetime.fromtimestamp(int(epoch), tz=timezone.utc) if epoch else datetime.now(timezone.utc)
    return moment.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json(path: Path, payload: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    kwargs: dict[str, Any] = {"ensure_ascii": False, "sort_keys": True}
    kwargs["separators"] = (",", ":") if compact else None
    if not compact:
        kwargs["indent"] = 2
    rendered = json.dumps(payload, **kwargs) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(rendered)
        temporary = Path(handle.name)
    temporary.replace(path)


def _clean_paper(paper: dict[str, Any]) -> dict[str, Any]:
    detail = copy.deepcopy({key: value for key, value in paper.items() if not key.startswith("__")})
    # Derived UI aliases keep the canonical files readable while avoiding a
    # second hand-maintained data source.
    detail["first_party_sources"] = [
        {**source, "kind": source["type"], "label": source["title"]}
        for source in detail["first_party_sources"]
    ]
    detail["artifacts"] = [
        {**artifact, "kind": artifact["type"], "label": artifact["title"]}
        for artifact in detail["artifacts"]
    ]
    detail["versions"] = [
        {
            **version,
            "label": version.get("label") or version.get("version") or version.get("identifier"),
            "date": version.get("date") or version.get("latest_revision_date"),
            "venue": version.get("venue") or version.get("source") or version.get("type"),
        }
        for version in detail["versions"]
    ]
    return detail


def _venue_name(venue: Any) -> str | None:
    if isinstance(venue, str):
        return venue
    if isinstance(venue, dict):
        return venue.get("acronym") or venue.get("name")
    return None


def _search_text(paper: dict[str, Any]) -> str:
    fields: list[str] = [
        *paper["title"].values(),
        *(author["name"] for author in paper["authors"]),
        *paper["institutions"],
        *paper["tags"],
        *paper["inclusion_reason"].values(),
        *paper["abstract"].values(),
        *paper["problem"].values(),
        *paper["approach"].values(),
        *paper["system_design"].values(),
        *paper["key_results"].values(),
        *paper["limitations"].values(),
        _venue_name(paper["venue"]) or "",
    ]
    return " ".join(" ".join(fields).split())


def make_index_item(paper: dict[str, Any], mirror: dict[str, Any] | None = None) -> dict[str, Any]:
    pdf = paper["pdf"]
    return {
        "work_id": paper["work_id"],
        "slug": paper["slug"],
        "title": paper["title"],
        "authors": paper["authors"],
        "author_names": [author["name"] for author in paper["authors"]],
        "institutions": paper["institutions"],
        "identifiers": paper["identifiers"],
        "dates": paper["dates"],
        "window_status": paper["window_status"],
        "venue": paper["venue"],
        "publication_status": paper["publication_status"],
        "curation_tier": paper["curation_tier"],
        "domain": paper["domain"],
        "primary_category": paper["primary_category"],
        "tags": paper["tags"],
        "category_confidence": paper["category_confidence"],
        "inclusion_reason": paper["inclusion_reason"],
        "abstract": paper["abstract"],
        "source_types": sorted({source["type"] for source in paper["first_party_sources"]}),
        "source_kinds": sorted({source["type"] for source in paper["first_party_sources"]}),
        "seed_report_count": len(paper["seed_reports"]),
        "artifact_types": sorted({artifact["type"] for artifact in paper["artifacts"]}),
        "artifacts": [
            {**artifact, "kind": artifact["type"], "label": artifact["title"]}
            for artifact in paper["artifacts"]
        ],
        "has_artifact": bool(paper["artifacts"]),
        "has_pdf": bool(pdf["official_url"]),
        "has_local_pdf": mirror is not None,
        "system_family": paper["relations"]["system_family"],
        "search_text": _search_text(paper),
    }


def _stable_node_id(prefix: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}:{digest}"


def make_graph(papers: list[dict[str, Any]], stamp: str) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []
    report_nodes: dict[str, dict[str, Any]] = {}
    family_nodes: dict[str, dict[str, Any]] = {}
    relation_edges: set[tuple[str, str, str]] = set()

    for paper in papers:
        work_id = paper["work_id"]
        nodes.append(
            {
                "id": work_id,
                "kind": "paper",
                "slug": paper["slug"],
                "title": paper["title"],
                "domain": paper["domain"],
                "primary_category": paper["primary_category"],
                "curation_tier": paper["curation_tier"],
                "system_family": paper["relations"]["system_family"],
            }
        )
        for relation_type in ("extends", "supersedes", "related"):
            for target in paper["relations"][relation_type]:
                edge = (work_id, target, relation_type)
                if relation_type == "related":
                    edge = (min(work_id, target), max(work_id, target), relation_type)
                relation_edges.add(edge)

        family = paper["relations"]["system_family"]
        if family:
            family_id = _stable_node_id("family", family.casefold())
            family_nodes[family_id] = {
                "id": family_id,
                "kind": "system_family",
                "label": family,
                "title": family,
            }
            relation_edges.add((work_id, family_id, "belongs_to"))

        for seed in paper["seed_reports"]:
            identity = seed.get("report_blob_sha") or seed["seed_report_path"]
            report_id = _stable_node_id("report", identity)
            report_nodes[report_id] = {
                "id": report_id,
                "kind": "seed_report",
                "label": seed["report_title"],
                "title": seed["report_title"],
                "path": seed["seed_report_path"],
            }
            relation_edges.add((report_id, work_id, "cites"))

    nodes.extend(family_nodes[key] for key in sorted(family_nodes))
    nodes.extend(report_nodes[key] for key in sorted(report_nodes))
    for source, target, relation_type in sorted(relation_edges):
        edges.append({"source": source, "target": target, "type": relation_type})
    return {"schema_version": SCHEMA_VERSION, "generated_at": stamp, "nodes": nodes, "edges": edges}


def _month_range(start: date, end: date) -> list[str]:
    result: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        result.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return result


def make_stats(papers: list[dict[str, Any]], stamp: str, start: date, end: date) -> dict[str, Any]:
    main = [
        paper
        for paper in papers
        if paper["window_status"] == "new_in_window"
        and paper["curation_tier"] in {"core", "watchlist"}
        and paper["publication_status"] not in {"withdrawn", "retracted"}
    ]
    category_counts = Counter(paper["primary_category"] for paper in main)
    all_category_counts = Counter(paper["primary_category"] for paper in papers)
    month_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for paper in papers:
        month = paper["dates"]["first_public_date"][:7]
        month_counts[month][paper["primary_category"]] += 1
    by_month = [
        {
            "month": month,
            "total": sum(month_counts[month].values()),
            "categories": {category: month_counts[month][category] for category in CATEGORIES},
        }
        for month in _month_range(start, end)
    ]
    seed_report_keys = {
        seed.get("report_blob_sha") or seed["seed_report_path"]
        for paper in papers
        for seed in paper["seed_reports"]
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": stamp,
        "totals": {
            "all": len(papers),
            "main": len(main),
            "new_in_window": sum(paper["window_status"] == "new_in_window" for paper in papers),
            "venue_carry_in": sum(paper["window_status"] == "venue_carry_in" for paper in papers),
            "context": sum(paper["window_status"] == "context" for paper in papers),
            "withdrawn_or_retracted": sum(paper["publication_status"] in {"withdrawn", "retracted"} for paper in papers),
            "seed_reports": len(seed_report_keys),
            "reports": len(seed_report_keys),
        },
        "by_domain": dict(sorted(Counter(paper["domain"] for paper in main).items())),
        "by_domain_all": dict(sorted(Counter(paper["domain"] for paper in papers).items())),
        "by_category": {category: category_counts[category] for category in CATEGORIES},
        "by_category_all": {category: all_category_counts[category] for category in CATEGORIES},
        "by_status": dict(sorted(Counter(paper["publication_status"] for paper in papers).items())),
        "by_tier": dict(sorted(Counter(paper["curation_tier"] for paper in papers).items())),
        "by_month": by_month,
    }


def _citation_author_names(paper: dict[str, Any]) -> list[str]:
    return [author["name"] for author in paper["authors"]]


def make_route(paper: dict[str, Any], site_url: str) -> dict[str, Any]:
    slug = paper["slug"]
    canonical = f"{site_url.rstrip('/')}/paper/{slug}/"
    description = paper["abstract"]["en"][:300]
    json_ld = {
        "@context": "https://schema.org",
        "@type": "ScholarlyArticle",
        "@id": canonical,
        "url": canonical,
        "headline": paper["title"]["original"],
        "alternativeHeadline": [paper["title"]["zh"], paper["title"]["en"]],
        "author": [{"@type": "Person", "name": name} for name in _citation_author_names(paper)],
        "datePublished": paper["dates"]["first_public_date"],
        "dateModified": paper["dates"]["latest_revision_date"],
        "description": description,
        "sameAs": [source["url"] for source in paper["first_party_sources"]],
    }
    return {
        "slug": slug,
        "work_id": paper["work_id"],
        "path": f"/paper/{slug}/",
        "canonical_url": canonical,
        "data_path": f"data/papers/{paper['work_id']}.json",
        "title": paper["title"],
        "description": {"zh": paper["abstract"]["zh"][:300], "en": description},
        "date_modified": paper["dates"]["latest_revision_date"],
        "json_ld": json_ld,
    }


def _write_sitemap(path: Path, routes: list[dict[str, Any]], site_url: str) -> None:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    homepage_modified = max((route["date_modified"] for route in routes), default=date.today().isoformat())
    lines.extend(
        [
            "  <url>",
            f"    <loc>{escape(site_url.rstrip('/') + '/')}</loc>",
            f"    <lastmod>{escape(homepage_modified)}</lastmod>",
            "  </url>",
        ]
    )
    for route in routes:
        lines.extend(
            [
                "  <url>",
                f"    <loc>{escape(route['canonical_url'])}</loc>",
                f"    <lastmod>{escape(route['date_modified'])}</lastmod>",
                "  </url>",
            ]
        )
    lines.append("</urlset>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def derive_site_url(explicit: str | None) -> str:
    if explicit:
        return explicit.rstrip("/")
    configured = os.environ.get("SITE_URL")
    if configured:
        return configured.rstrip("/")
    repository = os.environ.get("GITHUB_REPOSITORY", "joe1chief/agent-infra-atlas")
    owner, _, name = repository.partition("/")
    return f"https://{owner}.github.io/{name}" if owner and name else "https://localhost"


def load_pdf_mirrors(path: Path) -> dict[str, dict[str, Any]]:
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload.get("pdfs", [])
    if not isinstance(entries, list):
        raise ValueError(f"{path} must contain a pdfs array")
    return {entry["work_id"]: entry for entry in entries}


def update_readme_stats(
    path: Path,
    papers: list[dict[str, Any]],
    stats: dict[str, Any],
    mirrors: dict[str, dict[str, Any]],
    window_start: date,
    window_end: date,
) -> None:
    """Refresh the human-facing release snapshot between stable markers."""
    if not path.is_file():
        raise FileNotFoundError(f"README stats target does not exist: {path}")
    rendered = path.read_text(encoding="utf-8")
    if README_STATS_START not in rendered or README_STATS_END not in rendered:
        raise ValueError(f"{path} is missing catalog stats markers")
    seeded_works = sum(bool(paper["seed_reports"]) for paper in papers)
    by_domain = stats["by_domain"]
    block = "\n".join(
        (
            README_STATS_START,
            f"- **{stats['totals']['main']}** main research works from `{window_start}` through `{window_end}`.",
            f"- **{by_domain.get('ai_infra', 0)}** AI Infra and **{by_domain.get('agent_infra', 0)}** Agent Infra records across **{len(CATEGORIES)}** primary categories.",
            f"- **{seeded_works}** works traced to exact bibliography evidence across **{stats['totals']['seed_reports']}** priority technical reports.",
            f"- **{len(mirrors)}** redistribution-approved PDF mirror; all other full texts use official-source fallbacks.",
            README_STATS_END,
        )
    )
    pattern = re.compile(
        rf"{re.escape(README_STATS_START)}.*?{re.escape(README_STATS_END)}",
        flags=re.DOTALL,
    )
    updated = pattern.sub(block, rendered)
    if updated != rendered:
        path.write_text(updated, encoding="utf-8")


def build(args: argparse.Namespace) -> int:
    report = validate_catalog(
        papers_dir=args.papers_dir,
        schema_path=args.schema,
        window_start=args.window_start,
        window_end=args.window_end,
        require_min_main=args.require_min_main,
        require_max_main=args.require_max_main,
        require_all_categories=args.require_all_categories,
    )
    if not report.ok:
        for error in report.errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    papers = sorted(report.papers, key=lambda paper: (paper["dates"]["first_public_date"], paper["work_id"]), reverse=True)
    mirrors = load_pdf_mirrors(args.pdf_manifest)
    stamp = generated_at()
    site_url = derive_site_url(args.site_url)
    output = args.output_dir
    details_dir = output / "papers"
    if details_dir.exists():
        shutil.rmtree(details_dir)
    details_dir.mkdir(parents=True, exist_ok=True)

    for paper in papers:
        detail = _clean_paper(paper)
        mirror = mirrors.get(paper["work_id"])
        if mirror:
            detail["pdf"] = {
                **detail["pdf"],
                "mirror_status": "cached",
                "mirror_url": f"pdfs/{mirror['output_filename']}",
            }
        write_json(details_dir / f"{paper['work_id']}.json", detail, compact=args.compact)
    index = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": stamp,
        "papers": [make_index_item(paper, mirrors.get(paper["work_id"])) for paper in papers],
    }
    graph = make_graph(papers, stamp)
    stats = make_stats(papers, stamp, args.window_start, args.window_end)
    routes = [make_route(paper, site_url) for paper in papers]
    route_manifest = {"schema_version": SCHEMA_VERSION, "generated_at": stamp, "routes": routes}
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": stamp,
        "window": {"start": args.window_start.isoformat(), "end": args.window_end.isoformat()},
        "counts": stats["totals"],
        "files": {
            "index": "data/papers-index.json",
            "graph": "data/graph.json",
            "stats": "data/stats.json",
            "routes": "data/routes.json",
            "route_manifest": "data/routes.json",
            "paper_detail_pattern": "data/papers/{work_id}.json",
            "sitemap": "sitemap.xml",
        },
    }
    write_json(output / "papers-index.json", index, compact=args.compact)
    write_json(output / "graph.json", graph, compact=args.compact)
    write_json(output / "stats.json", stats, compact=args.compact)
    write_json(output / "routes.json", route_manifest, compact=args.compact)
    write_json(output / "catalog-manifest.json", manifest, compact=args.compact)
    _write_sitemap(output.parent / "sitemap.xml", routes, site_url)
    if args.update_readme:
        update_readme_stats(
            args.readme,
            papers,
            stats,
            mirrors,
            args.window_start,
            args.window_end,
        )
    print(f"Built {len(papers)} paper records in {output}")
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--papers-dir", type=Path, default=DEFAULT_PAPERS_DIR)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--pdf-manifest", type=Path, default=DEFAULT_PDF_MANIFEST)
    parser.add_argument("--readme", type=Path, default=DEFAULT_README)
    parser.add_argument("--update-readme", action="store_true")
    parser.add_argument("--window-start", type=date.fromisoformat, default=WINDOW_START)
    parser.add_argument("--window-end", type=date.fromisoformat, default=date.today())
    parser.add_argument("--site-url")
    parser.add_argument("--require-min-main", type=int, default=0)
    parser.add_argument("--require-max-main", type=int)
    parser.add_argument("--require-all-categories", action="store_true")
    parser.add_argument("--compact", action="store_true", help="emit compact JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    return build(_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
