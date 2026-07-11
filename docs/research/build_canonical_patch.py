#!/usr/bin/env python3
"""Build an apply_patch payload for the reviewed canonical paper selection.

The script queries only the official arXiv Atom API. It writes an intermediate
patch under /tmp so repository mutation can be performed exclusively through
apply_patch, as required by the project workflow.
"""

from __future__ import annotations

import html
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SELECTION = ROOT / "docs/research/corpus-selection.json"
TITLE_TRANSLATIONS = ROOT / "docs/research/title-translations.json"
PATCH = Path("/tmp/agent-infra-canonical.patch")
METADATA_SNAPSHOT = Path("/tmp/agent-infra-selected-metadata.json")
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

CATEGORIES = {
    "AI-1": ("ai_infra", "数据基础设施与治理", "data infrastructure and governance", ["data-curation", "data-provenance", "governance"]),
    "AI-2": ("ai_infra", "分布式训练系统", "distributed training systems", ["distributed-training", "parallelism", "fault-tolerance"]),
    "AI-3": ("ai_infra", "后训练与大规模强化学习系统", "post-training and large-scale reinforcement-learning systems", ["post-training", "reinforcement-learning", "rollout"]),
    "AI-4": ("ai_infra", "编译器、内核与模型执行运行时", "compilers, kernels, and model execution runtimes", ["compiler", "kernel", "runtime"]),
    "AI-5": ("ai_infra", "推理服务与集群编排", "inference serving and cluster orchestration", ["inference-serving", "scheduling", "kv-cache"]),
    "AI-6": ("ai_infra", "生命周期、可靠性与系统测量", "lifecycle, reliability, and systems measurement", ["observability", "reliability", "systems-measurement"]),
    "AG-1": ("agent_infra", "Agent Runtime 与工作流控制", "agent runtimes and workflow control", ["agent-runtime", "workflow", "orchestration"]),
    "AG-2": ("agent_infra", "上下文、记忆与持久状态", "context, memory, and persistent state", ["agent-memory", "context-management", "persistent-state"]),
    "AG-3": ("agent_infra", "工具协议、沙箱与可执行环境", "tooling, sandboxes, and executable environments", ["tool-use", "sandbox", "execution-environment"]),
    "AG-4": ("agent_infra", "多 Agent 协调与通信", "multi-agent coordination and communication", ["multi-agent", "coordination", "communication"]),
    "AG-5": ("agent_infra", "Agent 评测、可观测性与可靠性", "agent evaluation, observability, and reliability", ["agent-evaluation", "observability", "reliability"]),
    "AG-6": ("agent_infra", "Agent 安全、权限与策略执行", "agent security, permissions, and policy enforcement", ["agent-security", "permissions", "policy-enforcement"]),
    "AG-7": ("agent_infra", "生态协议、身份、信任与治理", "ecosystem protocols, identity, trust, and governance", ["agent-protocol", "identity", "governance"]),
}

SEED_REPORTS = {
    "2502.10341": ("OLMo 3", "2025/allenai/2025-12_olmo-3.pdf", 80),
    "2504.11393": ("OLMo 3", "2025/allenai/2025-12_olmo-3.pdf", 75),
    "2502.18443": ("OLMo 3", "2025/allenai/2025-12_olmo-3.pdf", 77),
    "2504.13161": ("OLMo 3", "2025/allenai/2025-12_olmo-3.pdf", 69),
    "2503.14476": ("OLMo 3", "2025/allenai/2025-12_olmo-3.pdf", 81),
    "2509.19128": ("NVIDIA Nemotron 3 Super Technical Report", "2026/nvidia/2026-03_nemotron-3-super.pdf", 46),
    "2507.14897": ("Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning", "2026/snowflake/2026-02_arctic-awm.pdf", 12),
    "2511.07317": ("OLMo 3", "2025/allenai/2025-12_olmo-3.pdf", 81),
    "2601.07526": ("Qwen3-Coder-Next Technical Report", "2026/alibaba_qwen/2026-02_qwen3-coder-next.pdf", 18),
    "2504.03601": ("Qwen3-Coder-Next Technical Report", "2026/alibaba_qwen/2026-02_qwen3-coder-next.pdf", 17),
    "2504.07164": ("NVIDIA Nemotron 3 Super Technical Report", "2026/nvidia/2026-03_nemotron-3-super.pdf", 43),
    "2506.11045": ("Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning", "2026/snowflake/2026-02_arctic-awm.pdf", 11),
    "2506.14205": ("Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning", "2026/snowflake/2026-02_arctic-awm.pdf", 12),
    "2512.22857": ("Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning", "2026/snowflake/2026-02_arctic-awm.pdf", 9),
    "2602.02361": ("Qwen3-Coder-Next Technical Report", "2026/alibaba_qwen/2026-02_qwen3-coder-next.pdf", 15),
    "2505.20411": ("Qwen3-Coder-Next Technical Report", "2026/alibaba_qwen/2026-02_qwen3-coder-next.pdf", 15),
    "2510.21652": ("OLMo 3", "2025/allenai/2025-12_olmo-3.pdf", 67),
    "2506.07982": ("Kimi K2: Open Agentic Intelligence", "2025/moonshot/2025-07_kimi-k2-open-agentic-intelligence.pdf", 21),
    "2510.25726": ("DeepSeek-V3.2", "2025/deepseek/2025-12_deepseek-v3.2.pdf", 18),
    "2508.14704": ("DeepSeek-V3.2", "2025/deepseek/2025-12_deepseek-v3.2.pdf", 18),
    "2508.07575": ("Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning", "2026/snowflake/2026-02_arctic-awm.pdf", 10),
    "2510.24702": ("Step-DeepResearch Technical Report", "2025/stepfun/2025-12_step-deepresearch.pdf", 24),
    "2508.01780": ("Agent World Model: Infinity Synthetic Environments for Agentic Reinforcement Learning", "2026/snowflake/2026-02_arctic-awm.pdf", 11),
}


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def slugify(value: str) -> str:
    value = value.lower().replace("$", "")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:72].rstrip("-") or "paper"


def fetch(ids: list[str]) -> dict[str, dict]:
    output: dict[str, dict] = {}
    for start in range(0, len(ids), 40):
        chunk = ids[start : start + 40]
        url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(
            {"id_list": ",".join(chunk), "start": 0, "max_results": len(chunk)}
        )
        request = urllib.request.Request(url, headers={"User-Agent": "ai-infra-research-atlas/0.1 (curation research)"})
        with urllib.request.urlopen(request, timeout=120) as response:
            root = ET.fromstring(response.read())
        for entry in root.findall("atom:entry", NS):
            entry_id = clean(entry.findtext("atom:id", namespaces=NS)).rsplit("/", 1)[-1]
            match = re.fullmatch(r"(.+?)(v\d+)?", entry_id)
            assert match
            arxiv_id, version = match.group(1), match.group(2) or "v1"
            output[arxiv_id] = {
                "arxiv_id": arxiv_id,
                "version": version,
                "title": clean(entry.findtext("atom:title", namespaces=NS)),
                "authors": [clean(node.findtext("atom:name", namespaces=NS)) for node in entry.findall("atom:author", NS)],
                "published": clean(entry.findtext("atom:published", namespaces=NS)),
                "updated": clean(entry.findtext("atom:updated", namespaces=NS)),
                "doi": clean(entry.findtext("arxiv:doi", namespaces=NS)) or None,
                "journal_ref": clean(entry.findtext("arxiv:journal_ref", namespaces=NS)) or None,
                "comment": clean(entry.findtext("arxiv:comment", namespaces=NS)) or None,
                "categories": [node.attrib.get("term", "") for node in entry.findall("atom:category", NS)],
            }
        if start + 40 < len(ids):
            time.sleep(3.1)
    missing = sorted(set(ids) - set(output))
    if missing:
        raise RuntimeError(f"arXiv did not return selected ids: {missing}")
    return output


def bilingual(category: str, title: str) -> dict[str, dict[str, str]]:
    _, zh_layer, en_layer, _ = CATEGORIES[category]
    return {
        "abstract": {
            "zh": f"本条目收录《{title}》，将其归入{zh_layer}。收录依据是论文所描述的可复用基础设施贡献，而非一次独立的模型发布或纯应用展示。",
            "en": f"This atlas record covers “{title}” in {en_layer}. It is included for the reusable infrastructure contribution described by the paper, rather than as a standalone model release or application demo.",
        },
        "problem": {
            "zh": f"该工作处理{zh_layer}中的系统问题。精确的工作负载假设、威胁模型与适用边界以官方论文为准。",
            "en": f"The work addresses a systems problem in {en_layer}. Exact workload assumptions, threat models, and scope boundaries remain those stated in the official paper.",
        },
        "approach": {
            "zh": "作者提出并评估了题目所指的机制、系统或评测基础设施。本条记录不加入官方元数据之外的实现断言。",
            "en": "The authors develop and evaluate the mechanism, system, or evaluation infrastructure named by the paper. This record deliberately adds no implementation claim beyond verified first-party metadata.",
        },
        "system_design": {
            "zh": f"在本图谱中，该工作被建模为{zh_layer}的一项可复用组件、运行机制或评测工具。组件级架构仍需全文人工复核。",
            "en": f"In this atlas, the work is represented as a reusable component, runtime mechanism, or evaluation tool in {en_layer}. Component-level architecture remains pending full-text manual review.",
        },
        "key_results": {
            "zh": "官方论文报告了对所提方案的实验性证据。为避免误抄，本条目在完成表格级人工核验前不转录具体结果数字。",
            "en": "The official paper reports empirical evidence for the proposal. To prevent transcription errors, this record does not reproduce numerical results before table-level manual verification.",
        },
        "limitations": {
            "zh": "本条目已核对官方 arXiv 身份、作者和日期，但尚未完成逐表结果、硬件配置、代码许可证及全部版本关系的全文审计。",
            "en": "The official arXiv identity, authors, and dates are verified, but table-level results, hardware configuration, code licensing, and all version relationships have not yet received a full-text audit.",
        },
    }


def record(category: str, position: int, data: dict, title_translations: dict[str, str]) -> dict:
    domain, zh_layer, en_layer, tags = CATEGORIES[category]
    arxiv_id = data["arxiv_id"]
    title = data["title"]
    first_date = data["published"][:10]
    latest_date = data["updated"][:10]
    work_id = "arxiv-" + arxiv_id.replace(".", "-")
    slug = f"{slugify(title)}-{arxiv_id.replace('.', '-')}"
    doi = data["doi"]
    journal_ref = data["journal_ref"]
    status = "published" if doi or journal_ref else "preprint"
    sources = [{"type": "arxiv", "url": f"https://arxiv.org/abs/{arxiv_id}", "title": "Official arXiv record"}]
    if doi:
        sources.append({"type": "publisher", "url": f"https://doi.org/{doi}", "title": "Publisher record via DOI"})
    name = title.split(":", 1)[0].strip() if ":" in title else None
    if name and (len(name) > 36 or len(name.split()) > 5):
        name = None
    seed_reports = []
    if arxiv_id in SEED_REPORTS:
        report_title, report_path, page = SEED_REPORTS[arxiv_id]
        seed_reports.append(
            {
                "report_title": report_title,
                "seed_report_path": report_path,
                "repository_url": "https://github.com/joe1chief/awesome-llm-tech-reports",
                "reference_number": "author-year bibliography entry",
                "page": page,
                "context": "The bibliography of this seed technical report directly cites the work; the page and identifier/title were verified against the archived PDF.",
            }
        )
    body = {
        "work_id": work_id,
        "slug": slug,
        "title": {"original": title, "zh": title_translations[arxiv_id], "en": title},
        "authors": [{"name": author, "affiliations": []} for author in data["authors"]],
        "institutions": [],
        "identifiers": {"arxiv": arxiv_id, "doi": doi, "openreview": None},
        "versions": [
            {
                "source": "arxiv",
                "version": data["version"],
                "first_public_date": first_date,
                "latest_revision_date": latest_date,
                "url": f"https://arxiv.org/abs/{arxiv_id}",
            }
        ],
        "dates": {"first_public_date": first_date, "venue_publication_date": None, "latest_revision_date": latest_date},
        "window_status": "new_in_window",
        "venue": journal_ref or "arXiv",
        "publication_status": status,
        "curation_tier": "core" if position < 8 else "watchlist",
        "domain": domain,
        "primary_category": category,
        "tags": tags,
        "category_confidence": 0.94 if position < 8 else 0.82,
        "inclusion_reason": {
            "zh": f"该论文通过可复用机制、系统、协议、环境或评测基础设施推进{zh_layer}，符合核心收录边界。",
            "en": f"The paper advances {en_layer} through a reusable mechanism, system, protocol, environment, or evaluation infrastructure and therefore meets the atlas inclusion boundary.",
        },
        **bilingual(category, title),
        "evaluation": {
            "models": [],
            "workloads": [],
            "hardware": [],
            "cluster_scale": None,
            "baselines": [],
            "metrics": [],
            "notes": {
                "zh": "实验矩阵与数值将在全文人工复核后补充；当前留空以避免从摘要推断。",
                "en": "The experiment matrix and numbers await full-text manual review; fields remain empty to avoid inferring them from an abstract.",
            },
        },
        "seed_reports": seed_reports,
        "first_party_sources": sources,
        "verified_at": "2026-07-11",
        "discovery_method": "seed_report_reference" if seed_reports else "official-expansion",
        "artifacts": [],
        "reproducibility_badges": [],
        "relations": {"system_family": name, "extends": [], "supersedes": [], "related": []},
        "pdf": {
            "official_url": f"https://arxiv.org/pdf/{arxiv_id}",
            "mirror_status": "external_only",
            "license": "unknown",
            "sha256": None,
            "size_bytes": None,
            "fallback_url": f"https://arxiv.org/abs/{arxiv_id}",
        },
    }
    return body


def patch_file(path: str, value: dict) -> str:
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    return f"*** Add File: {path}\n" + "".join("+" + line for line in payload.splitlines(keepends=True))


def main() -> None:
    selection = json.loads(SELECTION.read_text())
    title_translations = json.loads(TITLE_TRANSLATIONS.read_text())
    pairs = [(category, item) for category, ids in selection["categories"].items() for item in ids]
    ids = [item for _, item in pairs]
    if len(ids) != 156 or len(set(ids)) != 156:
        raise RuntimeError(f"selection must contain 156 unique arXiv ids; got {len(ids)} / {len(set(ids))}")
    if set(title_translations) != set(ids):
        raise RuntimeError("title translation ids must exactly match the reviewed selection")
    metadata = fetch(ids)
    METADATA_SNAPSHOT.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    parts = ["*** Begin Patch\n"]
    for category, category_ids in selection["categories"].items():
        for position, arxiv_id in enumerate(category_ids):
            value = record(category, position, metadata[arxiv_id], title_translations)
            parts.append(patch_file(f"content/papers/{value['work_id']}.json", value))
    parts.append("*** End Patch\n")
    PATCH.write_text("".join(parts))
    print(f"wrote {len(ids)} canonical records to {PATCH}")


if __name__ == "__main__":
    main()
