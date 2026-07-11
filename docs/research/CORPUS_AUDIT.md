# Canonical corpus audit

Audit date: 2026-07-11

## Release snapshot

- 164 unique canonical records: 156 `new_in_window` research works with a first-public date between 2025-01-12 and 2026-07-07, plus 8 pre-2025 `Context` nodes.
- The main collection contains 72 AI Infra works and 84 Agent Infra works; Context adds four nodes to each domain without changing the main count.
- The main collection has exactly 12 works in each of the 13 primary categories.
- 104 Core records, 52 Watchlist records, and 8 Context records.
- Across all records, 154 are marked `preprint` and 10 `published`; the main collection remains 148 preprints and 8 published records.
- 23 records traced to an exact bibliography page in one of the priority seed reports; 133 records discovered by official arXiv expansion.
- No duplicate work IDs, slugs, arXiv IDs, or normalized titles.
- 43 records expose 46 abstract- or comment-verified artifact links. 158 records have structured evaluation fields, and 113 include at least one metric explicitly stated in official metadata.
- Eight Context-to-window relations connect vLLM, SGLang, ZeRO/DeepSpeed, FlashAttention, AutoGen, MemGPT, WebArena, and SWE-bench to later infrastructure work.

## Evidence method

1. The candidate pool was collected from the official arXiv Atom API with category-specific infrastructure queries and the fixed release window.
2. Titles and abstracts were reviewed against the inclusion boundary: reusable systems, runtimes, protocols, environments, tooling, evaluation infrastructure, and operational mechanisms are in scope; standalone model releases and pure applications are not.
3. The final set is recorded in `corpus-selection.json`. `build_canonical_patch.py` refetches official metadata and refuses to build unless all 156 selected IDs are returned.
4. Seven bibliography-rich reports from `joe1chief/awesome-llm-tech-reports` were inspected page by page. A `seed_reports` entry is emitted only for an exact identifier or title match in the archived PDF. Author-year bibliographies use the literal marker `author-year bibliography entry` instead of inventing a numeric reference.
5. Chinese titles were machine-assisted and then terminology-corrected. The original title and English title remain unchanged alongside the Chinese translation.
6. Every bilingual research card and inclusion reason was rewritten from official abstracts into paper-specific prose. CI rejects the initial ingestion boilerplate and exact duplicate editorial text.

## Priority seed reports checked

- `2025/allenai/2025-12_olmo-3.pdf`
- `2025/deepseek/2025-12_deepseek-v3.2.pdf`
- `2025/moonshot/2025-07_kimi-k2-open-agentic-intelligence.pdf`
- `2025/stepfun/2025-12_step-deepresearch.pdf`
- `2026/alibaba_qwen/2026-02_qwen3-coder-next.pdf`
- `2026/nvidia/2026-03_nemotron-3-super.pdf`
- `2026/snowflake/2026-02_arctic-awm.pdf`

## Known evidence limits

- Authors, titles, arXiv IDs, version dates, DOI fields, and official links are verified from first-party metadata. Institutions are left empty because arXiv metadata does not reliably provide affiliations.
- Evaluation fields and artifacts are populated only when they are explicit in an official abstract or arXiv comment. Missing table-level matrices, hardware, cluster details, licenses, and unreported numbers remain empty pending full-text review.
- A DOI or journal reference is enough to mark a record as published, but `venue_publication_date` stays `null` unless that date has been separately verified.
- Public arXiv access is not treated as redistribution permission. `content/pdf-mirror-manifest.json` currently contains one explicitly CC BY 4.0-licensed PDF whose byte size and SHA-256 were verified and whose rendered first page was visually checked; every other paper remains an official external link.
- The 2026 portion reflects the repository's requested as-of date. Scheduled refreshes should rerun official-source verification and manually review newly discovered candidates before publication.

## Reproduction

```bash
python3 docs/research/collect_arxiv.py
python3 docs/research/build_canonical_patch.py
python3 scripts/validate_catalog.py
python3 scripts/sync_open_pdfs.py --check-only
```

`build_canonical_patch.py` writes an apply-patch payload to `/tmp/agent-infra-canonical.patch`; it does not mutate canonical content directly.
