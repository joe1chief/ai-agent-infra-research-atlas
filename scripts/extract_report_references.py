#!/usr/bin/env python3
"""Extract bibliography records and provenance from technical-report PDFs.

The source may be a local Git checkout or a public GitHub repository URL.  For
GitHub, the Git tree and blob APIs preserve the exact path and blob SHA without
cloning the repository.  Flat PDF mirror directories are deliberately skipped,
and identical blobs are parsed once even when aliases exist.
"""

from __future__ import annotations

import argparse
import base64
import fnmatch
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

try:
    from pypdf import PdfReader
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Missing dependency 'pypdf'. Install requirements-pipeline.txt first.") from exc


DEFAULT_EXCLUDED_PARTS = {"pdf", "pdfs", "mirror", "mirrors", "mirrored"}
REFERENCE_HEADING = re.compile(r"^\s*(?:references|bibliography|参考文献)\s*$", re.IGNORECASE)
REFERENCE_START = re.compile(r"^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+(.+)$")
ARXIV_ID = re.compile(
    r"(?i)(?:arxiv\s*(?:preprint\s*)?(?:arxiv)?\s*:\s*|arxiv\.org/(?:abs|pdf)/|(?:corr\s*,\s*)?abs/)"
    r"([a-z-]+(?:\.[A-Z]{2})?/[0-9]{7}|[0-9]{4}\.[0-9]{4,5})(?:v\d+)?"
)
DOI = re.compile(r"(?i)(?:doi\s*:\s*|doi\.org/)(10\.\d{4,9}/[-._;()/:A-Z0-9]+)")


@dataclass(frozen=True)
class ReportBlob:
    path: str
    sha: str
    data: bytes
    aliases: tuple[str, ...] = ()


def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()  # noqa: S324 - Git object identity, not security


def is_excluded(path: str, excluded_parts: set[str]) -> bool:
    parts = [part.casefold() for part in PurePosixPath(path).parts[:-1]]
    return any(part in excluded_parts for part in parts)


def _matches(path: str, include_patterns: list[str]) -> bool:
    if not include_patterns:
        return True
    lower = path.casefold()
    return any(fnmatch.fnmatch(lower, pattern.casefold()) for pattern in include_patterns)


def _request_json(url: str, token: str | None = None) -> Any:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "agent-infra-atlas-reference-extractor/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"GitHub API returned HTTP {exc.code} for {url}: {detail}") from exc


def _github_coordinates(value: str) -> tuple[str, str] | None:
    match = re.fullmatch(r"https?://github\.com/([^/]+)/([^/#]+?)(?:\.git)?/?", value)
    return (match.group(1), match.group(2)) if match else None


def github_reports(
    repository_url: str,
    branch: str | None,
    include_patterns: list[str],
    excluded_parts: set[str],
    max_reports: int | None,
) -> tuple[list[ReportBlob], dict[str, Any]]:
    coordinates = _github_coordinates(repository_url)
    if not coordinates:
        raise ValueError(f"not a supported GitHub repository URL: {repository_url}")
    owner, repository = coordinates
    token = os.environ.get("GITHUB_TOKEN")
    repo_api = f"https://api.github.com/repos/{owner}/{repository}"
    info = _request_json(repo_api, token)
    branch = branch or info["default_branch"]
    tree = _request_json(f"{repo_api}/git/trees/{urllib.parse.quote(branch, safe='')}?recursive=1", token)
    if tree.get("truncated"):
        raise RuntimeError("GitHub recursive tree response was truncated; use a local checkout instead")
    entries = [
        entry
        for entry in tree.get("tree", [])
        if entry.get("type") == "blob"
        and entry.get("path", "").casefold().endswith(".pdf")
        and not is_excluded(entry["path"], excluded_parts)
        and _matches(entry["path"], include_patterns)
    ]
    by_sha: dict[str, list[str]] = {}
    for entry in entries:
        by_sha.setdefault(entry["sha"], []).append(entry["path"])
    selected = sorted(by_sha.items(), key=lambda item: min(item[1]).casefold())
    if max_reports is not None:
        selected = selected[:max_reports]

    blobs: list[ReportBlob] = []
    for sha, paths in selected:
        blob = _request_json(f"{repo_api}/git/blobs/{sha}", token)
        if blob.get("encoding") != "base64":
            raise RuntimeError(f"unsupported encoding for {paths[0]}: {blob.get('encoding')}")
        data = base64.b64decode(blob["content"], validate=False)
        blobs.append(ReportBlob(path=paths[0], sha=sha, data=data, aliases=tuple(sorted(paths[1:]))))
    return blobs, {"kind": "github", "repository_url": repository_url, "branch": branch, "tree_sha": tree.get("sha")}


def local_reports(
    root: Path,
    include_patterns: list[str],
    excluded_parts: set[str],
    max_reports: int | None,
) -> tuple[list[ReportBlob], dict[str, Any]]:
    if not root.is_dir():
        raise ValueError(f"local source is not a directory: {root}")
    by_sha: dict[str, list[tuple[str, bytes]]] = {}
    for path in sorted(root.rglob("*.pdf")):
        relative = path.relative_to(root).as_posix()
        if is_excluded(relative, excluded_parts) or not _matches(relative, include_patterns):
            continue
        data = path.read_bytes()
        by_sha.setdefault(git_blob_sha(data), []).append((relative, data))
    selected = sorted(by_sha.items(), key=lambda item: min(path for path, _ in item[1]).casefold())
    if max_reports is not None:
        selected = selected[:max_reports]
    blobs = []
    for sha, files in selected:
        files.sort(key=lambda item: item[0].casefold())
        blobs.append(ReportBlob(files[0][0], sha, files[0][1], tuple(path for path, _ in files[1:])))
    return blobs, {"kind": "local", "root": str(root.resolve())}


def _page_lines(reader: PdfReader) -> list[list[str]]:
    pages: list[list[str]] = []
    for page in reader.pages:
        text = page.extract_text(extraction_mode="layout") or ""
        pages.append([line.rstrip() for line in text.splitlines()])
    return pages


def _bibliography_lines(pages: list[list[str]]) -> tuple[list[tuple[int, str]], int | None]:
    start_page: int | None = None
    start_line = 0
    for page_index, lines in enumerate(pages):
        for line_index, line in enumerate(lines):
            if REFERENCE_HEADING.match(line):
                start_page, start_line = page_index, line_index + 1
                break
        if start_page is not None:
            break
    if start_page is None:
        return [], None
    flattened: list[tuple[int, str]] = []
    for page_index in range(start_page, len(pages)):
        offset = start_line if page_index == start_page else 0
        flattened.extend((page_index + 1, line) for line in pages[page_index][offset:])
    return flattened, start_page + 1


def _clean_reference(text: str) -> str:
    return " ".join(text.replace("\u00ad", "").split())


def _is_unnumbered_reference_start(line: str) -> bool:
    """Detect bibliography entries in author-year styles with hanging indents."""
    stripped = line.strip()
    if not stripped or line != line.lstrip():
        return False
    if re.fullmatch(r"\d{1,4}", stripped):  # printed page number
        return False
    return bool(re.search(r"[A-Za-z\u00c0-\u024f]", stripped))


def parse_references(blob: ReportBlob, repository_url: str | None) -> dict[str, Any]:
    try:
        reader = PdfReader(io.BytesIO(blob.data), strict=False)
        pages = _page_lines(reader)
    except Exception as exc:  # pypdf exposes many parser-specific exceptions
        return {
            "seed_report_path": blob.path,
            "report_blob_sha": blob.sha,
            "aliases": list(blob.aliases),
            "error": f"PDF parse failed: {exc}",
            "references": [],
        }
    metadata_title = ""
    if reader.metadata:
        metadata_title = str(reader.metadata.get("/Title") or "").strip()
    report_title = metadata_title if metadata_title and metadata_title.casefold() != "untitled" else Path(blob.path).stem
    lines, bibliography_page = _bibliography_lines(pages)
    if bibliography_page is None:
        return {
            "report_title": report_title,
            "seed_report_path": blob.path,
            "report_blob_sha": blob.sha,
            "aliases": list(blob.aliases),
            "page_count": len(pages),
            "error": "References/Bibliography heading not found; queued for manual review",
            "references": [],
        }

    records: list[dict[str, Any]] = []
    current_number: str | None = None
    current_page: int | None = None
    chunks: list[str] = []
    synthetic_number = 0

    def finish() -> None:
        nonlocal chunks
        if current_number is None:
            return
        context = _clean_reference(" ".join(chunks))
        if not context:
            return
        arxiv_match = ARXIV_ID.search(context)
        doi_match = DOI.search(context)
        reasons = []
        if not arxiv_match and not doi_match:
            reasons.append("no_arxiv_or_doi_identifier")
        if len(context) < 24:
            reasons.append("suspiciously_short_reference")
        records.append(
            {
                "seed_report_path": blob.path,
                "report_title": report_title,
                "report_blob_sha": blob.sha,
                "repository_url": repository_url,
                "reference_number": int(current_number),
                "page": current_page,
                "context": context,
                "identifiers": {
                    "arxiv": arxiv_match.group(1) if arxiv_match else None,
                    "doi": doi_match.group(1).rstrip(".,;)") if doi_match else None,
                },
                "review_status": "needs_review" if reasons else "parsed",
                "review_reasons": reasons,
            }
        )
        chunks = []

    for page_number, line in lines:
        match = REFERENCE_START.match(line)
        if match:
            finish()
            current_number = match.group(1) or match.group(2)
            synthetic_number = max(synthetic_number, int(current_number))
            current_page = page_number
            chunks = [match.group(3)]
        elif _is_unnumbered_reference_start(line):
            finish()
            synthetic_number += 1
            current_number = str(synthetic_number)
            current_page = page_number
            chunks = [line.strip()]
        elif current_number is not None and line.strip():
            chunks.append(line.strip())
    finish()
    result = {
        "report_title": report_title,
        "seed_report_path": blob.path,
        "report_blob_sha": blob.sha,
        "aliases": list(blob.aliases),
        "page_count": len(pages),
        "bibliography_start_page": bibliography_page,
        "references": records,
    }
    if not records:
        result["error"] = "Bibliography heading found but no reference boundaries parsed; queued for manual review"
    return result


def extract(args: argparse.Namespace) -> dict[str, Any]:
    excluded = DEFAULT_EXCLUDED_PARTS | {part.casefold() for part in args.exclude_part}
    coordinates = _github_coordinates(args.source)
    if coordinates:
        blobs, source = github_reports(
            args.source, args.branch, args.include, excluded, args.max_reports
        )
        repository_url = args.source.rstrip("/")
    else:
        blobs, source = local_reports(
            Path(args.source).expanduser(), args.include, excluded, args.max_reports
        )
        repository_url = None
    reports = [parse_references(blob, repository_url) for blob in blobs]
    references = [reference for report in reports for reference in report["references"]]
    return {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": source,
        "filters": {"include": args.include, "excluded_directory_parts": sorted(excluded)},
        "counts": {
            "unique_report_blobs": len(reports),
            "aliases_skipped": sum(len(report.get("aliases", [])) for report in reports),
            "references": len(references),
            "needs_review": sum(reference["review_status"] == "needs_review" for reference in references),
            "report_parse_errors": sum(bool(report.get("error")) for report in reports),
        },
        "reports": reports,
        "references": references,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="local checkout path or https://github.com/OWNER/REPO")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--branch", help="GitHub branch/ref; default is the repository default branch")
    parser.add_argument("--include", action="append", default=[], help="case-insensitive PDF path glob (repeatable)")
    parser.add_argument("--exclude-part", action="append", default=[], help="additional directory name to skip")
    parser.add_argument("--max-reports", type=int)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        payload = extract(args)
    except (OSError, RuntimeError, ValueError, urllib.error.URLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    counts = payload["counts"]
    print(
        f"Parsed {counts['unique_report_blobs']} unique reports and {counts['references']} references "
        f"({counts['needs_review']} need review)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
