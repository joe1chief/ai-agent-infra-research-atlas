#!/usr/bin/env python3
"""Discover review candidates from first-party APIs and proceedings indexes.

This command is intentionally non-publishing: without ``--write`` it only emits
a dry-run JSON payload.  Written records live under ``content/candidates`` and
must be completed, classified, deduplicated, and moved by a human curator.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

try:
    from validate_catalog import normalize_arxiv, normalize_doi, normalize_openreview, normalize_title
except ImportError:  # pragma: no cover
    from scripts.validate_catalog import normalize_arxiv, normalize_doi, normalize_openreview, normalize_title


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANONICAL_DIR = REPO_ROOT / "content" / "papers"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "content" / "candidates"
ARXIV_API = "https://export.arxiv.org/api/query"
OPENREVIEW_API = "https://api2.openreview.net/notes/search"
MLSYS_PROCEEDINGS = "https://proceedings.mlsys.org/paper_files/paper/{year}"
ACL_ANTHOLOGY_VOLUME = "https://aclanthology.org/volumes/{volume}.xml"
ATOM = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
MODS = {"mods": "http://www.loc.gov/mods/v3"}
DEFAULT_QUERIES = [
    '(all:"LLM serving" OR all:"inference system") AND (cat:cs.DC OR cat:cs.LG)',
    '(all:"distributed training" OR all:"LLM compiler") AND (cat:cs.DC OR cat:cs.LG)',
    '(all:"agent runtime" OR all:"agent infrastructure" OR all:"tool sandbox") AND cat:cs.AI',
    '(all:"agent memory" OR all:"multi-agent communication" OR all:"agent observability") AND cat:cs.AI',
]
ARXIV_ID_PATTERN = re.compile(r"^(?:[a-z-]+(?:\.[A-Z]{2})?/[0-9]{7}|[0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?$", re.I)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _http_json(url: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "agent-infra-atlas-discovery/1.0 (curation bot)"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def _http_xml(url: str) -> ET.Element:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/atom+xml", "User-Agent": "agent-infra-atlas-discovery/1.0 (curation bot)"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return ET.fromstring(response.read())


def _http_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"Accept": "text/html", "User-Agent": "agent-infra-atlas-discovery/1.0 (curation bot)"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def _text(element: ET.Element, path: str) -> str:
    child = element.find(path, ATOM)
    return " ".join((child.text or "").split()) if child is not None else ""


def _date_only(value: str) -> str:
    return value[:10]


def _arxiv_id_from_url(value: str) -> str:
    return value.rstrip("/").split("/")[-1]


def parse_arxiv_feed(root: ET.Element, seed_by_arxiv: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for entry in root.findall("atom:entry", ATOM):
        identifier_versioned = _arxiv_id_from_url(_text(entry, "atom:id"))
        identifier = normalize_arxiv(identifier_versioned)
        if not identifier:
            continue
        links = {link.attrib.get("type", ""): link.attrib.get("href") for link in entry.findall("atom:link", ATOM)}
        authors = [
            _text(author, "atom:name")
            for author in entry.findall("atom:author", ATOM)
            if _text(author, "atom:name")
        ]
        doi_node = entry.find("arxiv:doi", ATOM)
        doi = doi_node.text.strip() if doi_node is not None and doi_node.text else None
        published = _date_only(_text(entry, "atom:published"))
        updated = _date_only(_text(entry, "atom:updated"))
        title = _text(entry, "atom:title")
        abstract = _text(entry, "atom:summary")
        primary_category_node = entry.find("arxiv:primary_category", ATOM)
        results.append(
            {
                "candidate_id": f"arxiv:{identifier}",
                "review_status": "needs_review",
                "title": title,
                "authors": authors,
                "abstract": abstract,
                "dates": {"first_public_date": published, "latest_revision_date": updated},
                "identifiers": {"arxiv": identifier, "doi": doi, "openreview": None},
                "versions": [
                    {
                        "type": "arxiv",
                        "identifier": identifier_versioned,
                        "date": updated,
                        "url": f"https://arxiv.org/abs/{identifier_versioned}",
                    }
                ],
                "first_party_sources": [
                    {"type": "arxiv", "title": title, "url": f"https://arxiv.org/abs/{identifier}"}
                ],
                "seed_evidence": seed_by_arxiv.get(identifier, []),
                "raw": {
                    "primary_category": primary_category_node.attrib.get("term") if primary_category_node is not None else None,
                    "comment": _text(entry, "arxiv:comment"),
                    "pdf_url": links.get("application/pdf"),
                },
            }
        )
    return results


def query_arxiv(
    queries: list[str],
    arxiv_ids: list[str],
    start: date,
    end: date,
    max_results: int,
) -> list[dict[str, Any]]:
    seed_map: dict[str, list[dict[str, Any]]] = {}
    feeds: list[ET.Element] = []
    if arxiv_ids:
        for offset in range(0, len(arxiv_ids), 100):
            batch = arxiv_ids[offset:offset + 100]
            url = f"{ARXIV_API}?{urllib.parse.urlencode({'id_list': ','.join(batch), 'max_results': len(batch)})}"
            feeds.append(_http_xml(url))
            if offset + 100 < len(arxiv_ids):
                time.sleep(3)
    date_clause = f"submittedDate:[{start:%Y%m%d}0000 TO {end:%Y%m%d}2359]"
    for index, query in enumerate(queries):
        parameters = {
            "search_query": f"({query}) AND {date_clause}",
            "start": 0,
            "max_results": max_results,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
        feeds.append(_http_xml(f"{ARXIV_API}?{urllib.parse.urlencode(parameters)}"))
        if index + 1 < len(queries):
            time.sleep(3)
    results: list[dict[str, Any]] = []
    for feed in feeds:
        results.extend(parse_arxiv_feed(feed, seed_map))
    return results


def _openreview_value(content: dict[str, Any], key: str, default: Any = None) -> Any:
    value = content.get(key, default)
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return value


def parse_openreview_note(note: dict[str, Any]) -> dict[str, Any] | None:
    content = note.get("content") or {}
    title = _openreview_value(content, "title", "")
    if not isinstance(title, str) or not title.strip():
        return None
    authors = _openreview_value(content, "authors", [])
    if not isinstance(authors, list):
        authors = [str(authors)]
    abstract = _openreview_value(content, "abstract", "")
    note_id = note.get("id") or note.get("forum")
    if not note_id:
        return None
    published_ms = note.get("pdate") or note.get("cdate") or note.get("tcdate")
    modified_ms = note.get("mdate") or note.get("tmdate") or published_ms
    published = datetime.fromtimestamp(published_ms / 1000, tz=timezone.utc).date().isoformat() if published_ms else date.today().isoformat()
    modified = datetime.fromtimestamp(modified_ms / 1000, tz=timezone.utc).date().isoformat() if modified_ms else published
    url = f"https://openreview.net/forum?id={note.get('forum') or note_id}"
    return {
        "candidate_id": f"openreview:{note.get('forum') or note_id}",
        "review_status": "needs_review",
        "title": " ".join(title.split()),
        "authors": [str(author) for author in authors],
        "abstract": " ".join(str(abstract).split()),
        "dates": {"first_public_date": published, "latest_revision_date": modified},
        "identifiers": {"arxiv": None, "doi": None, "openreview": note.get("forum") or note_id},
        "versions": [{"type": "openreview", "identifier": note_id, "date": modified, "url": url}],
        "first_party_sources": [{"type": "openreview", "title": title, "url": url}],
        "seed_evidence": [],
        "raw": {
            "venue": _openreview_value(content, "venue"),
            "venue_id": _openreview_value(content, "venueid") or note.get("venueid"),
            "invitations": note.get("invitations", []),
        },
    }


def query_openreview(queries: list[str], max_results: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for query in queries:
        parameters = {"term": query, "type": "terms", "content": "title", "limit": max_results}
        payload = _http_json(f"{OPENREVIEW_API}?{urllib.parse.urlencode(parameters)}")
        for note in payload.get("notes", []):
            parsed = parse_openreview_note(note)
            if parsed:
                results.append(parsed)
    return results


class _MLSysIndexParser(HTMLParser):
    """Extract the stable paper rows from the official MLSys book index."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.records: list[dict[str, str]] = []
        self.current: dict[str, str] | None = None
        self.capture: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        if tag == "li" and attributes.get("data-track"):
            self.current = {"track": attributes.get("data-track") or "conference"}
        elif self.current is not None and tag == "a" and attributes.get("title") == "paper title":
            self.current["url"] = urllib.parse.urljoin("https://proceedings.mlsys.org", attributes.get("href") or "")
            self.capture = "title"
        elif self.current is not None and tag == "span" and "paper-authors" in classes:
            self.capture = "authors"

    def handle_data(self, data: str) -> None:
        if self.current is not None and self.capture:
            self.current[self.capture] = f"{self.current.get(self.capture, '')} {data}".strip()

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.capture == "title":
            self.capture = None
        elif tag == "span" and self.capture == "authors":
            self.capture = None
        elif tag == "li" and self.current is not None:
            if self.current.get("title") and self.current.get("url"):
                self.records.append(self.current)
            self.current = None
            self.capture = None


def parse_mlsys_index(rendered: str, year: int) -> list[dict[str, Any]]:
    parser = _MLSysIndexParser()
    parser.feed(rendered)
    published = f"{year:04d}-01-01"
    results: list[dict[str, Any]] = []
    for record in parser.records:
        match = re.search(r"/hash/([0-9a-f]+)-Abstract-", record["url"], flags=re.I)
        identity = match.group(1).lower() if match else hashlib.sha256(record["url"].encode()).hexdigest()[:32]
        title = " ".join(record["title"].split())
        authors = [name.strip() for name in record.get("authors", "").split(",") if name.strip()]
        results.append(
            {
                "candidate_id": f"mlsys:{year}:{identity}",
                "review_status": "needs_review",
                "title": title,
                "authors": authors,
                "abstract": "",
                "dates": {"first_public_date": published, "latest_revision_date": published},
                "identifiers": {"arxiv": None, "doi": None, "openreview": None},
                "versions": [{"type": "mlsys", "identifier": identity, "date": published, "url": record["url"]}],
                "first_party_sources": [{"type": "mlsys", "title": title, "url": record["url"]}],
                "seed_evidence": [],
                "review_reasons": [f"imprecise_first_public_date:official_index_provides_year_only:{year}"],
                "raw": {"venue": f"MLSys {year}", "track": record.get("track")},
            }
        )
    return results


def query_mlsys(years: list[int], max_results: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for year in years:
        results.extend(parse_mlsys_index(_http_text(MLSYS_PROCEEDINGS.format(year=year)), year)[:max_results])
    return results


def _mods_text(element: ET.Element, path: str) -> str:
    child = element.find(path, MODS)
    return " ".join("".join(child.itertext()).split()) if child is not None else ""


def _candidate_date(raw: str) -> tuple[str, str | None]:
    value = raw.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value, None
    if re.fullmatch(r"\d{4}-\d{2}", value):
        return f"{value}-01", f"imprecise_first_public_date:official_metadata_provides_month_only:{value}"
    if re.fullmatch(r"\d{4}", value):
        return f"{value}-01-01", f"imprecise_first_public_date:official_metadata_provides_year_only:{value}"
    raise ValueError(f"unsupported conference publication date {raw!r}")


def parse_acl_mods(root: ET.Element) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for paper in root.findall("mods:mods", MODS):
        url = _mods_text(paper, "mods:location/mods:url")
        if not url or "/volumes/" in url:
            continue
        anthology_id = urllib.parse.urlparse(url).path.strip("/")
        if not anthology_id or "." not in anthology_id or anthology_id.endswith(".0"):
            continue
        title = _mods_text(paper, "mods:titleInfo/mods:title")
        if not title:
            continue
        authors: list[str] = []
        for name in paper.findall("mods:name[@type='personal']", MODS):
            roles = {_mods_text(role, ".") for role in name.findall("mods:role/mods:roleTerm", MODS)}
            if "author" not in roles:
                continue
            given = _mods_text(name, "mods:namePart[@type='given']")
            family = _mods_text(name, "mods:namePart[@type='family']")
            rendered_name = " ".join(part for part in (given, family) if part)
            if rendered_name:
                authors.append(rendered_name)
        issued, review_reason = _candidate_date(
            _mods_text(paper, "mods:originInfo/mods:dateIssued") or _mods_text(paper, "mods:part/mods:date")
        )
        doi = None
        for identifier in paper.findall("mods:identifier", MODS):
            if identifier.attrib.get("type") == "doi" and identifier.text:
                doi = identifier.text.strip()
                break
        abstract = _mods_text(paper, "mods:abstract")
        venue = _mods_text(paper, "mods:relatedItem[@type='host']/mods:titleInfo/mods:title")
        reasons = [review_reason] if review_reason else []
        results.append(
            {
                "candidate_id": f"acl:{anthology_id}",
                "review_status": "needs_review",
                "title": title,
                "authors": authors,
                "abstract": abstract,
                "dates": {"first_public_date": issued, "latest_revision_date": issued},
                "identifiers": {"arxiv": None, "doi": doi, "openreview": None},
                "versions": [{"type": "acl_anthology", "identifier": anthology_id, "date": issued, "url": url}],
                "first_party_sources": [{"type": "acl_anthology", "title": title, "url": url}],
                "seed_evidence": [],
                "review_reasons": reasons,
                "raw": {"venue": venue, "anthology_id": anthology_id},
            }
        )
    return results


def query_acl_anthology(volumes: list[str], max_results: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for volume in volumes:
        root = _http_xml(ACL_ANTHOLOGY_VOLUME.format(volume=urllib.parse.quote(volume, safe=".-")))
        results.extend(parse_acl_mods(root)[:max_results])
    return results


def _load_seed_references(paths: list[Path]) -> tuple[list[str], dict[str, list[dict[str, Any]]]]:
    ids: list[str] = []
    evidence: dict[str, list[dict[str, Any]]] = {}
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for reference in payload.get("references", []):
            identifier = normalize_arxiv((reference.get("identifiers") or {}).get("arxiv"))
            if not identifier:
                continue
            ids.append(identifier)
            evidence.setdefault(identifier, []).append(
                {
                    key: reference.get(key)
                    for key in (
                        "seed_report_path", "report_title", "report_blob_sha",
                        "reference_number", "page", "context",
                    )
                }
            )
    return sorted(set(ids)), evidence


def _canonical_keys(directory: Path) -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    if not directory.is_dir():
        return keys
    for path in directory.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        identifiers = payload.get("identifiers", {})
        values = {
            "arxiv": normalize_arxiv(identifiers.get("arxiv")),
            "doi": normalize_doi(identifiers.get("doi")),
            "openreview": normalize_openreview(identifiers.get("openreview")),
            "title": normalize_title(
                payload.get("title", {}).get("original", "")
                if isinstance(payload.get("title"), dict)
                else payload.get("title", "")
            ),
        }
        keys.update((kind, value) for kind, value in values.items() if value)
    return keys


def candidate_keys(candidate: dict[str, Any]) -> set[tuple[str, str]]:
    identifiers = candidate["identifiers"]
    values = {
        "arxiv": normalize_arxiv(identifiers.get("arxiv")),
        "doi": normalize_doi(identifiers.get("doi")),
        "openreview": normalize_openreview(identifiers.get("openreview")),
        "title": normalize_title(candidate["title"]),
    }
    return {(kind, value) for kind, value in values.items() if value}


def merge_api_versions(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge API views of one work and retain conflicts for human review."""
    merged: list[dict[str, Any]] = []
    key_to_index: dict[tuple[str, str], int] = {}
    for candidate in candidates:
        keys = candidate_keys(candidate)
        matches = {key_to_index[key] for key in keys if key in key_to_index}
        if not matches:
            candidate["review_reasons"] = list(candidate.get("review_reasons", []))
            index = len(merged)
            merged.append(candidate)
            for key in keys:
                key_to_index[key] = index
            continue
        target_index = min(matches)
        target = merged[target_index]
        first_dates = {target["dates"]["first_public_date"], candidate["dates"]["first_public_date"]}
        if len(first_dates) > 1:
            target["review_reasons"].append(
                "conflicting_first_public_dates:" + ",".join(sorted(first_dates))
            )
        target["dates"]["first_public_date"] = min(first_dates)
        target["dates"]["latest_revision_date"] = max(
            target["dates"]["latest_revision_date"], candidate["dates"]["latest_revision_date"]
        )
        for field in ("versions", "first_party_sources", "seed_evidence"):
            identity = "url" if field != "seed_evidence" else "context"
            existing = {str(item.get(identity)) for item in target[field]}
            target[field].extend(item for item in candidate[field] if str(item.get(identity)) not in existing)
        target["authors"] = list(dict.fromkeys([*target["authors"], *candidate["authors"]]))
        for identifier_type, value in candidate["identifiers"].items():
            current = target["identifiers"].get(identifier_type)
            if current and value and current != value:
                target["review_reasons"].append(
                    f"conflicting_{identifier_type}_identifiers:{current},{value}"
                )
            elif value:
                target["identifiers"][identifier_type] = value
        for key in candidate_keys(target):
            key_to_index[key] = target_index
    return merged


def suggest_category(candidate: dict[str, Any]) -> tuple[str, list[str]]:
    text = f"{candidate['title']} {candidate.get('abstract', '')}".casefold()
    rules = [
        ("AG-6", ("agent security", "permission", "policy enforcement", "prompt injection")),
        ("AG-7", ("agent protocol", "identity", "trust", "governance")),
        ("AG-5", ("agent evaluation", "agent observability", "agent reliability", "trace")),
        ("AG-4", ("multi-agent", "multi agent", "agent communication", "coordination")),
        ("AG-3", ("sandbox", "tool protocol", "tool use", "execution environment")),
        ("AG-2", ("agent memory", "context management", "persistent state")),
        ("AG-1", ("agent runtime", "agent workflow", "agent orchestration")),
        ("AI-1", ("data governance", "data pipeline", "data infrastructure")),
        ("AI-2", ("distributed training", "parallel training", "pipeline parallelism", "collective communication")),
        ("AI-3", ("post-training", "reinforcement learning system", "rlhf system")),
        ("AI-4", ("compiler", "kernel", "model runtime", "operator fusion")),
        ("AI-5", ("inference serving", "llm serving", "cluster scheduling", "kv cache")),
        ("AI-6", ("reliability", "observability", "lifecycle", "system measurement")),
    ]
    scores = [(category, [keyword for keyword in keywords if keyword in text]) for category, keywords in rules]
    scores = [(category, matches) for category, matches in scores if matches]
    return max(scores, key=lambda item: len(item[1])) if scores else ("AI-6", [])


def _safe_filename(candidate_id: str) -> str:
    readable = re.sub(r"[^a-z0-9._-]+", "-", candidate_id.casefold()).strip("-.")
    digest = hashlib.sha256(candidate_id.encode("utf-8")).hexdigest()[:8]
    return f"{readable[:80]}-{digest}.json"


def discover(args: argparse.Namespace) -> dict[str, Any]:
    arxiv_ids, evidence = _load_seed_references(args.references)
    candidates: list[dict[str, Any]] = []
    errors: list[str] = []
    successful_sources: set[str] = set()
    sources = set(args.sources.split(","))
    if "arxiv" in sources:
        try:
            candidates.extend(query_arxiv(args.query, arxiv_ids, args.window_start, args.window_end, args.max_results))
            successful_sources.add("arxiv")
        except (urllib.error.URLError, ET.ParseError, TimeoutError) as exc:
            errors.append(f"arXiv discovery failed: {exc}")
    if "openreview" in sources and args.openreview_title:
        try:
            candidates.extend(query_openreview(args.openreview_title, args.max_results))
            successful_sources.add("openreview")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            errors.append(f"OpenReview discovery failed: {exc}")
    if "mlsys" in sources:
        if not args.mlsys_year:
            errors.append("MLSys discovery requires at least one --mlsys-year")
        else:
            for year in args.mlsys_year:
                try:
                    candidates.extend(query_mlsys([year], args.max_results))
                    successful_sources.add("mlsys")
                except (urllib.error.URLError, TimeoutError) as exc:
                    errors.append(f"MLSys {year} discovery failed: {exc}")
    if "acl_anthology" in sources:
        if not args.acl_volume:
            errors.append("ACL Anthology discovery requires at least one --acl-volume")
        else:
            for volume in args.acl_volume:
                try:
                    candidates.extend(query_acl_anthology([volume], args.max_results))
                    successful_sources.add("acl_anthology")
                except (urllib.error.URLError, ET.ParseError, TimeoutError, ValueError) as exc:
                    errors.append(f"ACL Anthology {volume} discovery failed: {exc}")

    api_record_count = len(candidates)
    candidates = merge_api_versions(candidates)
    for candidate in candidates:
        identifier = normalize_arxiv(candidate["identifiers"].get("arxiv"))
        if identifier and evidence.get(identifier):
            candidate["seed_evidence"] = evidence[identifier]
        category, matches = suggest_category(candidate)
        candidate["suggested_classification"] = {
            "primary_category": category,
            "domain": "ai_infra" if category.startswith("AI-") else "agent_infra",
            "matched_keywords": matches,
            "requires_human_confirmation": True,
        }

    existing_keys = _canonical_keys(args.canonical_dir) | _canonical_keys(args.output_dir)
    accepted: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in sorted(candidates, key=lambda value: (value["dates"]["first_public_date"], value["candidate_id"]), reverse=True):
        first = date.fromisoformat(candidate["dates"]["first_public_date"])
        keys = candidate_keys(candidate)
        if not (args.window_start <= first <= args.window_end):
            continue
        if keys & existing_keys or keys & seen:
            continue
        candidate["discovered_at"] = utc_now()
        source_types = {source["type"] for source in candidate["first_party_sources"]}
        candidate["discovery_method"] = (
            "seed_and_api"
            if candidate["seed_evidence"]
            else "first_party_proceedings"
            if source_types & {"mlsys", "acl_anthology", "usenix"}
            else "api_search"
        )
        candidate["curation_notes"] = [
            "Verify that the work contributes reusable infrastructure rather than only model quality.",
            "Complete the canonical bilingual fields and resolve version/venue identity before promotion.",
        ]
        accepted.append(candidate)
        seen.update(keys)

    return {
        "schema_version": "1.0",
        "generated_at": utc_now(),
        "dry_run": not args.write,
        "window": {"start": args.window_start.isoformat(), "end": args.window_end.isoformat()},
        "counts": {
            "seed_arxiv_ids": len(arxiv_ids),
            "api_records": api_record_count,
            "merged_works": len(candidates),
            "new_candidates": len(accepted),
        },
        "errors": errors,
        "successful_sources": sorted(successful_sources),
        "candidates": accepted,
    }


def write_candidates(payload: dict[str, Any], output_dir: Path) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for candidate in payload["candidates"]:
        path = output_dir / _safe_filename(candidate["candidate_id"])
        if path.exists():
            continue
        path.write_text(json.dumps(candidate, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written += 1
    return written


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", action="append", type=Path, default=[])
    parser.add_argument("--query", action="append", default=[])
    parser.add_argument("--openreview-title", action="append", default=[], help="exact/near-exact OpenReview title query")
    parser.add_argument("--mlsys-year", action="append", type=int, default=[], help="official MLSys proceedings year")
    parser.add_argument("--acl-volume", action="append", default=[], help="official ACL Anthology volume identifier")
    parser.add_argument(
        "--sources",
        default="arxiv,openreview",
        help="comma-separated: arxiv,openreview,mlsys,acl_anthology",
    )
    parser.add_argument("--window-start", type=date.fromisoformat, default=date(2025, 1, 1))
    parser.add_argument("--window-end", type=date.fromisoformat, default=date.today())
    parser.add_argument("--max-results", type=int, default=25, help="maximum records per API query")
    parser.add_argument("--canonical-dir", type=Path, default=DEFAULT_CANONICAL_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--write", action="store_true", help="write new review candidates; otherwise dry-run")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.query:
        args.query = list(DEFAULT_QUERIES)
    unknown_sources = set(args.sources.split(",")) - {"arxiv", "openreview", "mlsys", "acl_anthology"}
    if unknown_sources:
        print(f"ERROR: unsupported source(s): {', '.join(sorted(unknown_sources))}", file=sys.stderr)
        return 2
    try:
        payload = discover(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    if args.write:
        written = write_candidates(payload, args.output_dir)
        print(f"Wrote {written} new candidate file(s) to {args.output_dir}.")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    for error in payload["errors"]:
        print(f"WARNING: {error}", file=sys.stderr)
    return 0 if payload["successful_sources"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
