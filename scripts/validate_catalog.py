#!/usr/bin/env python3
"""Validate the canonical paper catalog and its cross-record invariants.

JSON Schema catches record-shape errors.  This module additionally enforces the
catalog invariants that cannot be expressed locally: stable unique identifiers,
the publication window, taxonomy/domain agreement, relation integrity, lineage
cycles, first-party provenance, and the PDF redistribution budget.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Iterable

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError as exc:  # pragma: no cover - exercised by a clean environment
    raise SystemExit(
        "Missing dependency 'jsonschema'. Install requirements-pipeline.txt first."
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PAPERS_DIR = REPO_ROOT / "content" / "papers"
DEFAULT_SCHEMA = REPO_ROOT / "schema" / "paper.schema.json"
WINDOW_START = date(2025, 1, 1)
CATEGORIES = tuple(
    [f"AI-{index}" for index in range(1, 7)]
    + [f"AG-{index}" for index in range(1, 8)]
)
MIRROR_LICENSES = {
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "CC-BY-NC-4.0",
    "CC0-1.0",
    "PDDL-1.0",
    "PUBLIC-DOMAIN",
}
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_TOTAL_PDF_BYTES = 600 * 1024 * 1024
SOURCE_HOSTS = {
    "arxiv": ("arxiv.org", "export.arxiv.org"),
    "openreview": ("openreview.net",),
    "mlsys": ("proceedings.mlsys.org", "mlsys.org"),
    "usenix": ("usenix.org",),
    "acl_anthology": ("aclanthology.org",),
    "doi": ("doi.org",),
}
EDITORIAL_FIELDS = (
    "inclusion_reason",
    "abstract",
    "problem",
    "approach",
    "system_design",
    "key_results",
    "limitations",
)
GENERIC_EDITORIAL_FRAGMENTS = (
    "The paper advances",
    "through a reusable mechanism, system, protocol, environment, or evaluation infrastructure and therefore meets the atlas inclusion boundary",
    "This atlas record covers",
    "The work addresses a systems problem in",
    "The authors develop and evaluate the mechanism, system, or evaluation infrastructure named by the paper",
    "In this atlas, the work is represented as a reusable component, runtime mechanism, or evaluation tool in",
    "The official arXiv identity, authors, and dates are verified, but",
    "The official paper reports empirical evidence for the proposal",
    "本条目收录《",
    "该工作处理",
    "作者提出并评估了题目所指的机制、系统或评测基础设施",
    "在本图谱中，该工作被建模为",
    "本条目已核对官方 arXiv 身份、作者和日期",
    "官方论文报告了对所提方案的实验性证据",
    "该论文通过可复用机制、系统、协议、环境或评测基础设施推进",
    "符合核心收录边界",
)


@dataclass
class ValidationReport:
    papers: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def add_error(self, source: str, message: str) -> None:
        self.errors.append(f"{source}: {message}")

    def add_warning(self, source: str, message: str) -> None:
        self.warnings.append(f"{source}: {message}")


def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value)


def normalize_title(value: str) -> str:
    """Return a conservative normalized title used only for duplicate alerts."""
    value = unicodedata.normalize("NFKC", value).casefold()
    value = re.sub(r"\bv\d+\b", " ", value)
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def normalize_arxiv(value: str | None) -> str | None:
    if not value:
        return None
    value = value.casefold().strip()
    value = re.sub(r"^https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/", "", value)
    value = value.removesuffix(".pdf")
    return re.sub(r"v\d+$", "", value)


def normalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    value = value.casefold().strip()
    return re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", value)


def normalize_openreview(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    parsed = urllib.parse.urlparse(value)
    if parsed.netloc.endswith("openreview.net"):
        return urllib.parse.parse_qs(parsed.query).get("id", [parsed.path.rstrip("/").split("/")[-1]])[0]
    return value


def _load_json(path: Path, report: ValidationReport) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.add_error(path.name, f"cannot read JSON: {exc}")
        return None


def load_catalog(papers_dir: Path, schema_path: Path) -> ValidationReport:
    report = ValidationReport()
    schema = _load_json(schema_path, report)
    if schema is None:
        return report
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    if not papers_dir.is_dir():
        report.add_error(str(papers_dir), "paper directory does not exist")
        return report

    paths = sorted(path for path in papers_dir.glob("*.json") if not path.name.startswith("_"))
    if not paths:
        report.add_warning(str(papers_dir), "no canonical paper JSON files found")

    for path in paths:
        paper = _load_json(path, report)
        if paper is None:
            continue
        if not isinstance(paper, dict):
            report.add_error(path.name, "top-level JSON value must be an object")
            continue
        schema_errors = sorted(validator.iter_errors(paper), key=lambda error: list(error.absolute_path))
        for error in schema_errors:
            field = ".".join(str(part) for part in error.absolute_path) or "$"
            report.add_error(path.name, f"schema {field}: {error.message}")
        if not schema_errors:
            paper["__source_file"] = path.name
            report.papers.append(paper)
    return report


def _duplicates(
    papers: Iterable[dict[str, Any]],
    getter: Any,
) -> dict[str, list[str]]:
    found: dict[str, list[str]] = defaultdict(list)
    for paper in papers:
        value = getter(paper)
        if value:
            found[value].append(paper["__source_file"])
    return {value: files for value, files in found.items() if len(files) > 1}


def _validate_uniqueness(report: ValidationReport) -> None:
    checks = {
        "work_id": lambda p: p["work_id"].casefold(),
        "slug": lambda p: p["slug"].casefold(),
        "normalized original title": lambda p: normalize_title(p["title"]["original"]),
        "arXiv id": lambda p: normalize_arxiv(p["identifiers"]["arxiv"]),
        "DOI": lambda p: normalize_doi(p["identifiers"]["doi"]),
        "OpenReview id": lambda p: normalize_openreview(p["identifiers"]["openreview"]),
    }
    for label, getter in checks.items():
        for value, files in _duplicates(report.papers, getter).items():
            report.add_error(", ".join(files), f"duplicate {label} {value!r}")


def _validate_dates_and_taxonomy(
    report: ValidationReport,
    window_start: date,
    window_end: date,
) -> None:
    for paper in report.papers:
        source = paper["__source_file"]
        dates = paper["dates"]
        first = parse_iso_date(dates["first_public_date"])
        latest = parse_iso_date(dates["latest_revision_date"])
        venue = parse_iso_date(dates["venue_publication_date"]) if dates["venue_publication_date"] else None
        status = paper["window_status"]

        if latest < first:
            report.add_error(source, "latest_revision_date precedes first_public_date")
        if venue and venue < first:
            report.add_error(source, "venue_publication_date precedes first_public_date")
        if status == "new_in_window" and not (window_start <= first <= window_end):
            report.add_error(source, f"new_in_window first_public_date must be within {window_start}..{window_end}")
        if status == "venue_carry_in":
            if not first < window_start:
                report.add_error(source, "venue_carry_in requires a pre-window first_public_date")
            if not venue or not (window_start <= venue <= window_end):
                report.add_error(source, "venue_carry_in requires venue_publication_date inside the window")
        if status == "context" and paper["curation_tier"] != "context":
            report.add_error(source, "window_status=context requires curation_tier=context")
        if paper["curation_tier"] == "context" and status != "context":
            report.add_error(source, "curation_tier=context requires window_status=context")

        category = paper["primary_category"]
        expected_domain = "ai_infra" if category.startswith("AI-") else "agent_infra"
        if paper["domain"] != expected_domain:
            report.add_error(source, f"{category} belongs to domain {expected_domain}")
        if paper["publication_status"] in {"withdrawn", "retracted"} and paper["curation_tier"] == "core":
            report.add_error(source, "withdrawn/retracted work cannot remain in the core tier")
        if parse_iso_date(paper["verified_at"]) > date.today():
            report.add_error(source, "verified_at cannot be in the future")


def _validate_sources(report: ValidationReport) -> None:
    for paper in report.papers:
        source_file = paper["__source_file"]
        seen_seed_citations: set[tuple[str, str]] = set()
        for seed in paper["seed_reports"]:
            report_key = seed.get("report_blob_sha") or normalize_title(seed["seed_report_path"])
            citation_key = (report_key, str(seed["reference_number"]))
            if citation_key in seen_seed_citations:
                report.add_error(source_file, f"duplicate seed report citation {citation_key!r}")
            seen_seed_citations.add(citation_key)

        for source in paper["first_party_sources"]:
            host = (urllib.parse.urlparse(source["url"]).hostname or "").lower()
            expected = SOURCE_HOSTS.get(source["type"])
            if expected and not any(host == item or host.endswith(f".{item}") for item in expected):
                report.add_error(
                    source_file,
                    f"source type {source['type']} must use one of {', '.join(expected)} (got {host})",
                )


def _validate_editorial_quality(report: ValidationReport) -> None:
    """Reject the known category-level boilerplate used during initial ingestion.

    Schema validation can prove that bilingual fields are present, but not that a
    research card actually says something about its paper. Keeping this guard in
    CI prevents reviewed, paper-specific prose from regressing to ingestion
    placeholders.
    """
    seen: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for paper in report.papers:
        source = paper["__source_file"]
        for field_name in EDITORIAL_FIELDS:
            for locale in ("zh", "en"):
                value = paper[field_name][locale]
                normalized = " ".join(value.casefold().split())
                seen[(field_name, locale, normalized)].append(source)
                fragment = next(
                    (candidate for candidate in GENERIC_EDITORIAL_FRAGMENTS if candidate in value),
                    None,
                )
                if fragment:
                    report.add_error(
                        source,
                        f"editorial placeholder remains in {field_name}.{locale}: {fragment!r}",
                    )
    for (field_name, locale, _), sources in seen.items():
        if len(sources) > 1:
            report.add_error(
                ", ".join(sorted(sources)),
                f"duplicate editorial text in {field_name}.{locale}; write paper-specific content",
            )


def _validate_evaluation_consistency(report: ValidationReport) -> None:
    contradictory_fragments = (
        "numbers await",
        "numbers remain empty",
        "does not reproduce numerical results",
        "数值将在",
        "数值留空",
        "不转录具体结果数字",
    )
    for paper in report.papers:
        if not paper["evaluation"]["metrics"]:
            continue
        notes = paper["evaluation"].get("notes") or {}
        for locale in ("zh", "en"):
            value = str(notes.get(locale, ""))
            fragment = next((item for item in contradictory_fragments if item in value), None)
            if fragment:
                report.add_error(
                    paper["__source_file"],
                    f"evaluation.notes.{locale} contradicts populated metrics: {fragment!r}",
                )


def _validate_relations(report: ValidationReport) -> None:
    ids = {paper["work_id"] for paper in report.papers}
    lineage: dict[str, set[str]] = {work_id: set() for work_id in ids}
    for paper in report.papers:
        source = paper["__source_file"]
        work_id = paper["work_id"]
        for relation_type in ("extends", "supersedes", "related"):
            for target in paper["relations"][relation_type]:
                if target == work_id:
                    report.add_error(source, f"{relation_type} cannot reference the paper itself")
                elif target not in ids:
                    report.add_error(source, f"{relation_type} references missing work_id {target}")
                if relation_type in {"extends", "supersedes"} and target in ids:
                    lineage[work_id].add(target)

    state: dict[str, int] = {work_id: 0 for work_id in ids}
    stack: list[str] = []

    def visit(work_id: str) -> None:
        state[work_id] = 1
        stack.append(work_id)
        for target in sorted(lineage[work_id]):
            if state[target] == 0:
                visit(target)
            elif state[target] == 1:
                cycle = stack[stack.index(target):] + [target]
                report.add_error("relations", f"lineage cycle detected: {' -> '.join(cycle)}")
        stack.pop()
        state[work_id] = 2

    for work_id in sorted(ids):
        if state[work_id] == 0:
            visit(work_id)


def _validate_pdfs(report: ValidationReport) -> None:
    total = 0
    for paper in report.papers:
        source = paper["__source_file"]
        pdf = paper["pdf"]
        if pdf["mirror_status"] not in {"approved", "cached"}:
            continue
        if pdf["license"] not in MIRROR_LICENSES:
            report.add_error(source, f"PDF mirror license {pdf['license']!r} is not on the redistribution whitelist")
        if not pdf["official_url"] or not pdf["fallback_url"]:
            report.add_error(source, "approved/cached PDF requires official_url and fallback_url")
        if not pdf["sha256"] or pdf["size_bytes"] is None:
            report.add_error(source, "approved/cached PDF requires sha256 and size_bytes")
            continue
        if pdf["size_bytes"] > MAX_PDF_BYTES:
            report.add_error(source, f"PDF exceeds the {MAX_PDF_BYTES}-byte per-file budget")
        total += pdf["size_bytes"]
    if total > MAX_TOTAL_PDF_BYTES:
        report.add_error("PDF catalog", f"mirrored PDFs total {total} bytes; budget is {MAX_TOTAL_PDF_BYTES}")


def _url_reachable(url: str, timeout: float) -> str | None:
    headers = {"User-Agent": "agent-infra-atlas-validator/1.0"}
    for method in ("HEAD", "GET"):
        request = urllib.request.Request(url, method=method, headers=headers)
        if method == "GET":
            request.add_header("Range", "bytes=0-0")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status < 400:
                    return None
        except urllib.error.HTTPError as exc:
            if method == "HEAD" and exc.code in {403, 405, 501}:
                continue
            return f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError) as exc:
            return str(exc)
    return "no successful response"


def _check_links(report: ValidationReport, timeout: float) -> None:
    owners: dict[str, set[str]] = defaultdict(set)
    for paper in report.papers:
        for source in paper["first_party_sources"]:
            owners[source["url"]].add(paper["__source_file"])
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(_url_reachable, url, timeout): url for url in owners}
        for future in as_completed(futures):
            url = futures[future]
            failure = future.result()
            if failure:
                report.add_error(", ".join(sorted(owners[url])), f"unreachable source {url}: {failure}")


def validate_catalog(
    papers_dir: Path = DEFAULT_PAPERS_DIR,
    schema_path: Path = DEFAULT_SCHEMA,
    window_start: date = WINDOW_START,
    window_end: date | None = None,
    *,
    check_links: bool = False,
    link_timeout: float = 10,
    require_min_main: int = 0,
    require_max_main: int | None = None,
    require_all_categories: bool = False,
) -> ValidationReport:
    window_end = window_end or date.today()
    report = load_catalog(papers_dir, schema_path)
    if not report.papers:
        if require_min_main:
            report.add_error(str(papers_dir), f"requires at least {require_min_main} main papers")
        return report
    _validate_uniqueness(report)
    _validate_dates_and_taxonomy(report, window_start, window_end)
    _validate_editorial_quality(report)
    _validate_evaluation_consistency(report)
    _validate_sources(report)
    _validate_relations(report)
    _validate_pdfs(report)
    if check_links:
        _check_links(report, link_timeout)

    main = [
        paper
        for paper in report.papers
        if paper["window_status"] == "new_in_window"
        and paper["curation_tier"] in {"core", "watchlist"}
        and paper["publication_status"] not in {"withdrawn", "retracted"}
    ]
    if len(main) < require_min_main:
        report.add_error("catalog", f"main collection has {len(main)} papers; minimum is {require_min_main}")
    if require_max_main is not None and len(main) > require_max_main:
        report.add_error("catalog", f"main collection has {len(main)} papers; maximum is {require_max_main}")
    if require_all_categories:
        counts = Counter(paper["primary_category"] for paper in main)
        missing = [category for category in CATEGORIES if not counts[category]]
        if missing:
            report.add_error("catalog", f"main collection has no coverage for: {', '.join(missing)}")
    return report


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--papers-dir", type=Path, default=DEFAULT_PAPERS_DIR)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--window-start", type=parse_iso_date, default=WINDOW_START)
    parser.add_argument("--window-end", type=parse_iso_date, default=date.today())
    parser.add_argument("--check-links", action="store_true", help="make live requests to every first-party URL")
    parser.add_argument("--link-timeout", type=float, default=10)
    parser.add_argument("--require-min-main", type=int, default=0)
    parser.add_argument("--require-max-main", type=int)
    parser.add_argument("--require-all-categories", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    report = validate_catalog(
        papers_dir=args.papers_dir,
        schema_path=args.schema,
        window_start=args.window_start,
        window_end=args.window_end,
        check_links=args.check_links,
        link_timeout=args.link_timeout,
        require_min_main=args.require_min_main,
        require_max_main=args.require_max_main,
        require_all_categories=args.require_all_categories,
    )
    for warning in report.warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    for error in report.errors:
        print(f"ERROR: {error}", file=sys.stderr)
    if not report.ok:
        print(f"Catalog validation failed with {len(report.errors)} error(s).", file=sys.stderr)
        return 1
    main_count = sum(
        paper["window_status"] == "new_in_window"
        and paper["curation_tier"] in {"core", "watchlist"}
        and paper["publication_status"] not in {"withdrawn", "retracted"}
        for paper in report.papers
    )
    print(f"Validated {len(report.papers)} papers ({main_count} in the main collection).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
