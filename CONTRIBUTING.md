# Contributing to the Research Atlas

This repository separates automated discovery from publishable research cards. A
record under `content/candidates/` is evidence for review, not accepted catalog
content. Only a human-reviewed record under `content/papers/` is published.

## Add or update a paper

1. Copy the structure in `tests/data/paper-valid.json` into one
   `content/papers/<work_id>.json` file. Keep `work_id` and `slug` stable across
   revisions.
2. Merge arXiv, OpenReview, conference, and journal versions into that one work.
   Do not create one record per URL.
3. Verify dates, publication status, identifiers, results, and artifact claims
   against first-party sources. Search-engine result pages are not evidence.
4. Write all required Chinese and English fields. The English title may equal the
   original title; interpretive fields may not be blank or machine placeholders.
5. Choose exactly one primary category. Cross-layer contributions belong in
   controlled tags and relations.
6. Record every originating report reference with its blob SHA, path, reference
   number, page, and exact extracted context. Leave uncertain extraction in the
   candidate queue rather than guessing.

Run the same checks as CI:

```bash
python -m pip install -r requirements-pipeline.txt
python scripts/validate_catalog.py
python -m unittest scripts.test_pipeline
python scripts/build_catalog.py
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## Reproduce candidate discovery

Discovery reads only first-party metadata and never publishes directly. For
example, a dry run can combine arXiv/OpenReview with official MLSys and ACL
Anthology proceedings:

```bash
python scripts/discover_candidates.py \
  --sources arxiv,openreview,mlsys,acl_anthology \
  --openreview-title "agent runtime" \
  --mlsys-year 2026 \
  --acl-volume 2026.acl-demo \
  --max-results 25
```

Conference indexes sometimes expose only a month or year. The candidate retains
an `imprecise_first_public_date` review reason; a curator must verify the exact
date before promotion instead of treating the placeholder day as canonical.

## PDF policy

Do not commit third-party PDFs. An entry may be mirrored only through
`content/pdf-mirror-manifest.json`, with an explicit redistribution license,
declared size (at most 20 MB), and verified SHA-256. The deploy pipeline enforces
a 600 MB total budget. When rights are unclear, retain the official URL and
fallback link only.

## Licensing your contribution

By contributing code, you agree to license it under MIT. By contributing original
catalog metadata, annotations, translations, and research summaries, you agree to
license those contributions under CC BY 4.0. Do not submit copied abstracts or
figures unless their source license explicitly permits redistribution.
