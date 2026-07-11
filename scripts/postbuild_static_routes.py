#!/usr/bin/env python3
"""Materialize paper deep-link HTML files after the Vite production build."""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIST = REPO_ROOT / "dist"
DEFAULT_ROUTES = REPO_ROOT / "public" / "data" / "routes.json"
SAFE_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _without_page_meta(document: str) -> str:
    patterns = [
        r"\s*<meta\s+name=[\"']description[\"'][^>]*>",
        r"\s*<meta\s+property=[\"']og:(?:title|description|url|type)[\"'][^>]*>",
        r"\s*<link\s+rel=[\"']canonical[\"'][^>]*>",
        r"\s*<script\s+type=[\"']application/ld\+json[\"'][^>]*data-atlas-route[^>]*>.*?</script>",
    ]
    for pattern in patterns:
        document = re.sub(pattern, "", document, flags=re.IGNORECASE | re.DOTALL)
    return document


def _render(template: str, route: dict[str, Any]) -> str:
    title_value = route["title"]["original"]
    description_value = route["description"]["en"]
    canonical = route["canonical_url"]
    escaped_title = html.escape(title_value, quote=True)
    escaped_description = html.escape(description_value, quote=True)
    escaped_canonical = html.escape(canonical, quote=True)
    document = _without_page_meta(template)
    document = re.sub(
        r"<title>.*?</title>",
        f"<title>{escaped_title} | AI &amp; Agent Infra Atlas</title>",
        document,
        count=1,
        flags=re.IGNORECASE | re.DOTALL,
    )
    json_ld = json.dumps(route["json_ld"], ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    metadata = "\n".join(
        [
            f'<meta name="description" content="{escaped_description}">',
            f'<link rel="canonical" href="{escaped_canonical}">',
            '<meta property="og:type" content="article">',
            f'<meta property="og:title" content="{escaped_title}">',
            f'<meta property="og:description" content="{escaped_description}">',
            f'<meta property="og:url" content="{escaped_canonical}">',
            f'<script type="application/ld+json" data-atlas-route>{json_ld}</script>',
        ]
    )
    if "</head>" not in document:
        raise ValueError("Vite index does not contain </head>")
    return document.replace("</head>", f"  {metadata}\n</head>", 1)


def materialize(dist: Path, routes_path: Path) -> int:
    index_path = dist / "index.html"
    if not index_path.is_file():
        raise FileNotFoundError(f"missing Vite output: {index_path}")
    if not routes_path.is_file() and (dist / "data" / "routes.json").is_file():
        routes_path = dist / "data" / "routes.json"
    routes_payload = json.loads(routes_path.read_text(encoding="utf-8"))
    routes = routes_payload.get("routes")
    if not isinstance(routes, list):
        raise ValueError(f"{routes_path} must contain a routes array")
    template = index_path.read_text(encoding="utf-8")
    shutil.copyfile(index_path, dist / "404.html")
    written = 0
    for route in routes:
        slug = route.get("slug", "")
        if not SAFE_SLUG.fullmatch(slug):
            raise ValueError(f"unsafe route slug: {slug!r}")
        output = dist / "paper" / slug / "index.html"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(_render(template, route), encoding="utf-8")
        written += 1
    return written


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=DEFAULT_DIST)
    parser.add_argument("--routes", type=Path, default=DEFAULT_ROUTES)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        count = materialize(args.dist, args.routes)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"Materialized {count} paper routes and dist/404.html.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
