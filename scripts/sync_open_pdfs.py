#!/usr/bin/env python3
"""Verify and materialize explicitly licensed PDF mirrors for static hosting."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Missing dependency 'jsonschema'. Install requirements-pipeline.txt first.") from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "content" / "pdf-mirror-manifest.json"
DEFAULT_PAPERS_DIR = REPO_ROOT / "content" / "papers"
DEFAULT_SCHEMA = REPO_ROOT / "schema" / "pdf-mirror-manifest.schema.json"
DEFAULT_CACHE = REPO_ROOT / ".cache" / "pdfs"
DEFAULT_OUTPUT = REPO_ROOT / "public" / "pdfs"
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 600 * 1024 * 1024
CHUNK_SIZE = 128 * 1024


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_SIZE):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def load_manifest(path: Path, schema_path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, [str(exc)]
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for error in sorted(validator.iter_errors(payload), key=lambda item: list(item.absolute_path)):
        field = ".".join(str(part) for part in error.absolute_path) or "$"
        errors.append(f"schema {field}: {error.message}")
    if errors:
        return None, errors

    entries = payload["pdfs"]
    total = sum(entry["size_bytes"] for entry in entries)
    if total > MAX_TOTAL_BYTES:
        errors.append(f"declared total {total} exceeds {MAX_TOTAL_BYTES} bytes")
    for field in ("work_id", "output_filename"):
        seen: set[str] = set()
        for entry in entries:
            value = entry[field].casefold()
            if value in seen:
                errors.append(f"duplicate {field}: {entry[field]}")
            seen.add(value)
    return (payload if not errors else None), errors


def validate_against_catalog(manifest: dict[str, Any], papers_dir: Path) -> list[str]:
    """Ensure mirror approvals are also represented in the canonical facts."""
    errors: list[str] = []
    papers: dict[str, dict[str, Any]] = {}
    if papers_dir.is_dir():
        for path in papers_dir.glob("*.json"):
            try:
                paper = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                errors.append(f"cannot inspect canonical paper {path}: {exc}")
                continue
            if paper.get("work_id"):
                papers[paper["work_id"]] = paper
    for entry in manifest["pdfs"]:
        paper = papers.get(entry["work_id"])
        if not paper:
            errors.append(f"manifest work_id is absent from canonical catalog: {entry['work_id']}")
            continue
        pdf = paper.get("pdf") or {}
        if pdf.get("mirror_status") not in {"approved", "cached"}:
            errors.append(f"{entry['work_id']}: canonical mirror_status is not approved/cached")
        comparisons = {
            "official_url": (pdf.get("official_url"), entry["url"]),
            "license": (pdf.get("license"), entry["license"]),
            "sha256": (pdf.get("sha256"), entry["sha256"]),
            "size_bytes": (pdf.get("size_bytes"), entry["size_bytes"]),
        }
        for field, (canonical, declared) in comparisons.items():
            if canonical != declared:
                errors.append(
                    f"{entry['work_id']}: canonical {field} {canonical!r} does not match manifest {declared!r}"
                )
    return errors


def _copy_verified(source: Path, target: Path, expected_hash: str, expected_size: int) -> None:
    digest, size = sha256_file(source)
    if digest != expected_hash:
        raise ValueError(f"SHA-256 mismatch: expected {expected_hash}, got {digest}")
    if size != expected_size:
        raise ValueError(f"size mismatch: expected {expected_size}, got {size}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        shutil.copyfile(source, temporary)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def _download(entry: dict[str, Any], target: Path) -> None:
    request = urllib.request.Request(
        entry["url"],
        headers={
            "Accept": "application/pdf",
            "User-Agent": "agent-infra-atlas-pdf-sync/1.0",
        },
    )
    digest = hashlib.sha256()
    size = 0
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("wb", dir=target.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                content_type = response.headers.get_content_type()
                declared_length = response.headers.get("Content-Length")
                if declared_length and int(declared_length) > MAX_FILE_BYTES:
                    raise ValueError(f"server Content-Length exceeds {MAX_FILE_BYTES} bytes")
                if content_type not in {"application/pdf", "application/octet-stream"}:
                    raise ValueError(f"unexpected Content-Type {content_type!r}")
                while chunk := response.read(CHUNK_SIZE):
                    size += len(chunk)
                    if size > MAX_FILE_BYTES or size > entry["size_bytes"]:
                        raise ValueError("download exceeded the declared or per-file size limit")
                    digest.update(chunk)
                    handle.write(chunk)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    if size != entry["size_bytes"]:
        temporary.unlink(missing_ok=True)
        raise ValueError(f"size mismatch: expected {entry['size_bytes']}, got {size}")
    actual_hash = digest.hexdigest()
    if actual_hash != entry["sha256"]:
        temporary.unlink(missing_ok=True)
        raise ValueError(f"SHA-256 mismatch: expected {entry['sha256']}, got {actual_hash}")
    temporary.replace(target)


def sync(args: argparse.Namespace) -> tuple[int, list[str]]:
    manifest, errors = load_manifest(args.manifest, args.schema)
    if manifest is None:
        return 0, errors
    errors.extend(validate_against_catalog(manifest, args.papers_dir))
    if errors:
        return 0, errors
    if args.check_only:
        return len(manifest["pdfs"]), []

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    synced = 0
    for entry in manifest["pdfs"]:
        cache_path = args.cache_dir / f"{entry['sha256']}.pdf"
        output_path = args.output_dir / entry["output_filename"]
        try:
            cache_valid = False
            if cache_path.is_file():
                digest, size = sha256_file(cache_path)
                cache_valid = digest == entry["sha256"] and size == entry["size_bytes"]
                if not cache_valid:
                    cache_path.unlink()
            if not cache_valid:
                if args.offline:
                    raise ValueError("verified cache entry is unavailable in offline mode")
                _download(entry, cache_path)
            _copy_verified(cache_path, output_path, entry["sha256"], entry["size_bytes"])
            synced += 1
        except (OSError, ValueError, urllib.error.URLError) as exc:
            errors.append(f"{entry['work_id']} ({entry['url']}): {exc}")
    return synced, errors


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--papers-dir", type=Path, default=DEFAULT_PAPERS_DIR)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check-only", action="store_true", help="validate manifest and budgets without downloading")
    parser.add_argument("--offline", action="store_true", help="require already verified cache entries")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    count, errors = sync(args)
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    if errors:
        return 1
    action = "Validated" if args.check_only else "Synced"
    print(f"{action} {count} licensed PDF manifest entr{'y' if count == 1 else 'ies'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
