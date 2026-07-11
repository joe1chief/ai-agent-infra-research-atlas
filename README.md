# AI Infra & Agent Infra Research Atlas

A bilingual, evidence-first research atlas for AI infrastructure and agent infrastructure work published from January 2025 onward.

The project connects two views of the same research landscape:

- a stack map organized by infrastructure layer and publication month;
- a local relationship graph showing system families, extensions, and related work.

Every published record is generated from one canonical file under `content/papers/`. The browser receives a compact index first and loads bilingual paper details only when needed.

## Release snapshot

<!-- catalog-stats:start -->
- **156** main research works from `2025-01-01` through `2026-07-11`.
- **72** AI Infra and **84** Agent Infra records across **13** primary categories.
- **23** works traced to exact bibliography evidence across **7** priority technical reports.
- **1** redistribution-approved PDF mirror; all other full texts use official-source fallbacks.
<!-- catalog-stats:end -->

## Research scope

The catalog uses one domain and one primary category per work:

- **AI Infra:** data and governance, distributed training, post-training/RL systems, compilers and kernels, inference serving, lifecycle and reliability.
- **Agent Infra:** runtimes, memory and state, tools and executable environments, multi-agent coordination, evaluation and observability, security and permissions, identity and governance.

Technical reports in [`joe1chief/awesome-llm-tech-reports`](https://github.com/joe1chief/awesome-llm-tech-reports) are provenance-bearing seed sources. The catalog then expands through first-party paper sources such as arXiv, OpenReview, conference proceedings, and official project pages.

## Repository layout

```text
content/papers/       canonical reviewed paper records
content/candidates/   machine-discovered records awaiting review
schema/               public data contract
scripts/              extraction, discovery, validation, and build pipeline
src/                  React research atlas
public/data/           generated index, details, graph, and statistics
.github/workflows/     CI, weekly discovery, and GitHub Pages deployment
```

Generated files under `public/data/` and mirrored PDFs under `public/pdfs/` are build artifacts and are not committed.

## Local development

```bash
python3 -m pip install -r requirements-pipeline.txt
python3 scripts/validate_catalog.py
python3 scripts/build_catalog.py
pnpm install
pnpm dev
```

Before a production build:

```bash
pnpm check
pnpm test
pnpm build
```

`pnpm build` validates and regenerates the catalog before compiling the site,
refreshes the release snapshot above, then materializes every `/paper/:slug/`
page and the GitHub Pages fallback.

## Curation contract

- `first_public_date` determines whether a paper belongs to the 2025+ window.
- Earlier preprints published at a venue in the window are marked `venue_carry_in` and do not inflate the main count.
- arXiv, OpenReview, and venue versions of the same research work are merged into one record.
- Search engines may discover candidates, but publication requires a first-party source.
- Withdrawn and retracted work remains visible with warnings and is excluded from featured views.
- Only PDFs with an explicit redistribution-compatible license may be mirrored. The deployment verifies license, size, and SHA-256 before publishing an asset.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the review workflow once the generated candidate queue is available.

## Licenses

Source code is released under the MIT License. Original catalog metadata and bilingual editorial summaries are released under CC BY 4.0. Third-party papers and PDFs retain their original copyright and license terms; see the PDF manifest and per-paper source records.
