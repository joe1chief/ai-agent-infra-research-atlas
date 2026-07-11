#!/usr/bin/env python3
"""Collect an auditable arXiv candidate pool for the research atlas.

This helper only reads the official arXiv Atom API and writes its intermediate
pool outside the repository. Canonical records are still reviewed/generated
separately under content/papers.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


WINDOW = "submittedDate:[202501010000 TO 202607112359]"
OUTPUT = Path("/tmp/agent-infra-arxiv-candidates.json")
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

QUERIES = {
    "AI-1": '(all:"data curation" OR all:"data governance" OR all:"training data" OR all:"data pipeline" OR all:"data provenance")',
    "AI-2": '(all:"distributed training" OR all:"parallel training" OR all:"fault tolerant training" OR all:"training system" OR all:"large model training")',
    "AI-3": '(all:"RLHF system" OR all:"reinforcement learning infrastructure" OR all:"large scale reinforcement learning" OR all:"post-training system" OR all:"RL training framework")',
    "AI-4": '(all:"LLM compiler" OR all:"LLM kernel" OR all:"attention kernel" OR all:"model runtime" OR all:"inference runtime")',
    "AI-5": '(all:"LLM serving" OR all:"inference serving" OR all:"KV cache" OR all:"request scheduling" OR all:"inference cluster")',
    "AI-6": '(all:"LLM reliability" OR all:"ML system observability" OR all:"LLM monitoring" OR all:"AI system measurement" OR all:"LLM lifecycle")',
    "AG-1": '(all:"agent runtime" OR all:"agent workflow" OR all:"agent orchestration" OR all:"agent framework" OR all:"agentic system")',
    "AG-2": '(all:"agent memory" OR all:"memory for agents" OR all:"long-term memory" OR all:"context management" OR all:"persistent memory")',
    "AG-3": '(all:"agent sandbox" OR all:"tool-use environment" OR all:"tool use agents" OR all:"computer use agent" OR all:"agent tools")',
    "AG-4": '(all:"multi-agent coordination" OR all:"multi-agent communication" OR all:"multi-agent framework" OR all:"LLM multi-agent" OR all:"agent collaboration")',
    "AG-5": '(all:"agent evaluation" OR all:"agent benchmark" OR all:"agent observability" OR all:"agent reliability" OR all:"agent trajectory")',
    "AG-6": '(all:"agent security" OR all:"agent safety" OR all:"prompt injection agent" OR all:"tool-use security" OR all:"agent permissions")',
    "AG-7": '(all:"agent protocol" OR all:"model context protocol" OR all:"agent identity" OR all:"agent governance" OR all:"agent trust")',
}


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def fetch(category: str, query: str) -> list[dict]:
    params = {
        "search_query": f"{query} AND {WINDOW}",
        "start": 0,
        "max_results": 100,
        "sortBy": "relevance",
        "sortOrder": "descending",
    }
    url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "ai-infra-research-atlas/0.1 (curation research)"})
    with urllib.request.urlopen(request, timeout=90) as response:
        root = ET.fromstring(response.read())
    records = []
    for entry in root.findall("atom:entry", NS):
        raw_id = clean(entry.findtext("atom:id", namespaces=NS))
        arxiv_id = raw_id.rsplit("/", 1)[-1].split("v", 1)[0]
        doi = clean(entry.findtext("arxiv:doi", namespaces=NS)) or None
        journal_ref = clean(entry.findtext("arxiv:journal_ref", namespaces=NS)) or None
        records.append(
            {
                "query_category": category,
                "arxiv_id": arxiv_id,
                "title": clean(entry.findtext("atom:title", namespaces=NS)),
                "summary": clean(entry.findtext("atom:summary", namespaces=NS)),
                "authors": [clean(a.findtext("atom:name", namespaces=NS)) for a in entry.findall("atom:author", NS)],
                "published": clean(entry.findtext("atom:published", namespaces=NS)),
                "updated": clean(entry.findtext("atom:updated", namespaces=NS)),
                "comment": clean(entry.findtext("arxiv:comment", namespaces=NS)) or None,
                "doi": doi,
                "journal_ref": journal_ref,
                "categories": [node.attrib.get("term", "") for node in entry.findall("atom:category", NS)],
                "abs_url": f"https://arxiv.org/abs/{arxiv_id}",
                "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
            }
        )
    return records


def main() -> None:
    pool = []
    for index, (category, query) in enumerate(QUERIES.items(), 1):
        print(f"[{index:02d}/{len(QUERIES)}] {category}", file=sys.stderr)
        pool.extend(fetch(category, query))
        time.sleep(3.1)
    OUTPUT.write_text(json.dumps(pool, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {len(pool)} query hits to {OUTPUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
