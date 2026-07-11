#!/usr/bin/env python3
"""Offline regression tests for catalog validation and generated artifacts."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfWriter

from scripts import build_catalog, postbuild_static_routes
from scripts.discover_candidates import (
    merge_api_versions,
    parse_acl_mods,
    parse_mlsys_index,
    parse_openreview_note,
)
from scripts.extract_report_references import (
    DEFAULT_EXCLUDED_PARTS,
    _is_unnumbered_reference_start,
    local_reports,
)
from scripts.sync_open_pdfs import load_manifest
from scripts.validate_catalog import DEFAULT_SCHEMA, validate_catalog


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = REPO_ROOT / "tests" / "data"
BASE = json.loads((FIXTURES / "paper-valid.json").read_text(encoding="utf-8"))
CASES = json.loads((FIXTURES / "validation-cases.json").read_text(encoding="utf-8"))
WINDOW_START = date.fromisoformat(CASES["window"]["start"])
WINDOW_END = date.fromisoformat(CASES["window"]["end"])


def second_paper() -> dict:
    paper = copy.deepcopy(BASE)
    paper["work_id"] = "arxiv-2501-00002"
    paper["slug"] = "second-infra-system"
    paper["title"] = {
        "original": "Second Infra System",
        "zh": "第二个基础设施系统",
        "en": "Second Infra System",
    }
    paper["identifiers"]["arxiv"] = "2501.00002"
    paper["versions"][0]["identifier"] = "2501.00002"
    paper["versions"][0]["url"] = "https://arxiv.org/abs/2501.00002"
    paper["first_party_sources"][0]["url"] = "https://arxiv.org/abs/2501.00002"
    paper["first_party_sources"][0]["title"] = "Second Infra System"
    paper["seed_reports"][0]["reference_number"] = 43
    paper["seed_reports"][0]["context"] = "[43] Atlas Maintainer. Second Infra System. arXiv:2501.00002."
    paper["pdf"]["official_url"] = "https://arxiv.org/pdf/2501.00002"
    paper["pdf"]["fallback_url"] = "https://arxiv.org/abs/2501.00002"
    return paper


def write_catalog(root: Path, papers: list[dict]) -> Path:
    directory = root / "papers"
    directory.mkdir(parents=True)
    for index, paper in enumerate(papers):
        (directory / f"paper-{index}.json").write_text(
            json.dumps(paper, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return directory


def mutate_case(name: str) -> list[dict]:
    first = copy.deepcopy(BASE)
    if name == "duplicate_work_id":
        second = second_paper()
        second["work_id"] = first["work_id"]
        return [first, second]
    if name == "duplicate_slug":
        second = second_paper()
        second["slug"] = first["slug"]
        return [first, second]
    if name == "duplicate_arxiv":
        second = second_paper()
        second["identifiers"]["arxiv"] = first["identifiers"]["arxiv"]
        return [first, second]
    if name == "new_before_window":
        first["dates"]["first_public_date"] = "2024-12-31"
        return [first]
    if name == "taxonomy_domain_mismatch":
        first["primary_category"] = "AG-1"
        return [first]
    if name == "unknown_tag":
        first["tags"] = ["uncontrolled-new-tag"]
        return [first]
    if name == "missing_bilingual":
        first["abstract"]["en"] = ""
        return [first]
    if name == "editorial_placeholder":
        first["problem"]["en"] = "The work addresses a systems problem in inference serving."
        return [first]
    if name == "duplicate_editorial":
        return [first, second_paper()]
    if name == "contradictory_evaluation_note":
        first["evaluation"]["notes"] = {
            "zh": "实验数值将在全文复核后补充。",
            "en": "The experiment numbers await full-text review.",
        }
        return [first]
    if name == "source_host_mismatch":
        first["first_party_sources"][0]["url"] = "https://example.com/not-arxiv"
        return [first]
    if name == "dangling_relation":
        first["relations"]["extends"] = ["arxiv-2401-missing"]
        return [first]
    if name == "lineage_cycle":
        second = second_paper()
        first["relations"]["extends"] = [second["work_id"]]
        second["relations"]["supersedes"] = [first["work_id"]]
        return [first, second]
    if name == "withdrawn_core":
        first["publication_status"] = "withdrawn"
        return [first]
    if name == "unlicensed_pdf":
        first["pdf"].update(
            {
                "mirror_status": "approved",
                "license": "arXiv-perpetual-non-exclusive",
                "sha256": "a" * 64,
                "size_bytes": 1024,
            }
        )
        return [first]
    if name == "duplicate_seed_alias":
        first["seed_reports"].append(copy.deepcopy(first["seed_reports"][0]))
        return [first]
    raise AssertionError(f"unknown invalid fixture case {name}")


def valid_case(name: str) -> list[dict]:
    paper = copy.deepcopy(BASE)
    if name == "new_window_start_boundary":
        paper["dates"]["first_public_date"] = WINDOW_START.isoformat()
        paper["dates"]["latest_revision_date"] = WINDOW_START.isoformat()
        paper["versions"][0]["date"] = WINDOW_START.isoformat()
    elif name == "new_window_end_boundary":
        paper["dates"]["first_public_date"] = WINDOW_END.isoformat()
        paper["dates"]["latest_revision_date"] = WINDOW_END.isoformat()
        paper["versions"][0]["date"] = WINDOW_END.isoformat()
    elif name == "venue_carry_in_dual_dates":
        paper["window_status"] = "venue_carry_in"
        paper["dates"] = {
            "first_public_date": "2024-11-30",
            "venue_publication_date": "2025-05-15",
            "latest_revision_date": "2025-05-15",
        }
        paper["versions"][0]["date"] = "2024-11-30"
        paper["publication_status"] = "published"
        paper["venue"] = "Terminal Systems Conference 2025"
    elif name == "withdrawn_watchlist":
        paper["publication_status"] = "withdrawn"
        paper["curation_tier"] = "watchlist"
    else:
        raise AssertionError(f"unknown valid fixture case {name}")
    return [paper]


class CatalogValidationTests(unittest.TestCase):
    def validate(self, directory: Path):
        return validate_catalog(
            directory,
            DEFAULT_SCHEMA,
            WINDOW_START,
            WINDOW_END,
        )

    def test_base_fixture_is_valid(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            report = self.validate(write_catalog(Path(temporary), [copy.deepcopy(BASE)]))
        self.assertEqual([], report.errors)

    def test_invalid_cases_report_expected_invariant(self) -> None:
        for case in CASES["invalid_cases"]:
            with self.subTest(case=case["name"]), tempfile.TemporaryDirectory() as temporary:
                report = self.validate(write_catalog(Path(temporary), mutate_case(case["name"])))
                self.assertTrue(
                    any(case["expect"] in error for error in report.errors),
                    f"expected {case['expect']!r}; got {report.errors!r}",
                )

    def test_valid_boundary_cases(self) -> None:
        for name in CASES["valid_cases"]:
            with self.subTest(case=name), tempfile.TemporaryDirectory() as temporary:
                report = self.validate(write_catalog(Path(temporary), valid_case(name)))
                self.assertEqual([], report.errors)

    def test_live_link_check_reports_an_unreachable_first_party_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = write_catalog(Path(temporary), [copy.deepcopy(BASE)])
            with patch("scripts.validate_catalog._url_reachable", return_value="HTTP 404"):
                report = validate_catalog(
                    directory,
                    DEFAULT_SCHEMA,
                    WINDOW_START,
                    WINDOW_END,
                    check_links=True,
                )
        self.assertTrue(any("unreachable source" in error for error in report.errors))


class ConferenceDiscoveryTests(unittest.TestCase):
    def test_mlsys_official_index_rows_are_normalized(self) -> None:
        rendered = """
        <ul class="paper-list"><li class="conference" data-track="conference">
          <div class="paper-content">
            <a title="paper title" href="/paper_files/paper/2025/hash/abc123-Abstract-Conference.html">Infra System</a>
            <span class="paper-authors">Ada Lovelace, Alan Turing</span>
          </div>
        </li></ul>
        """
        candidates = parse_mlsys_index(rendered, 2025)
        self.assertEqual("mlsys:2025:abc123", candidates[0]["candidate_id"])
        self.assertEqual(["Ada Lovelace", "Alan Turing"], candidates[0]["authors"])
        self.assertIn("imprecise_first_public_date", candidates[0]["review_reasons"][0])

    def test_acl_mods_volume_records_are_normalized(self) -> None:
        root = ET.fromstring("""
        <modsCollection xmlns="http://www.loc.gov/mods/v3">
          <mods ID="paper-citekey">
            <titleInfo><title>Agent Runtime Infrastructure</title></titleInfo>
            <name type="personal"><namePart type="given">Ada</namePart><namePart type="family">Lovelace</namePart><role><roleTerm>author</roleTerm></role></name>
            <originInfo><dateIssued>2026-07</dateIssued></originInfo>
            <relatedItem type="host"><titleInfo><title>ACL 2026 System Demonstrations</title></titleInfo></relatedItem>
            <identifier type="doi">10.18653/v1/2026.acl-demo.42</identifier>
            <location><url>https://aclanthology.org/2026.acl-demo.42/</url></location>
          </mods>
        </modsCollection>
        """)
        candidates = parse_acl_mods(root)
        self.assertEqual("acl:2026.acl-demo.42", candidates[0]["candidate_id"])
        self.assertEqual("10.18653/v1/2026.acl-demo.42", candidates[0]["identifiers"]["doi"])
        self.assertEqual(["Ada Lovelace"], candidates[0]["authors"])
        self.assertEqual("2026-07-01", candidates[0]["dates"]["first_public_date"])


class BuildTests(unittest.TestCase):
    def test_readme_stats_are_generated_between_stable_markers(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            readme = Path(temporary) / "README.md"
            readme.write_text(
                "# Atlas\n\n<!-- catalog-stats:start -->\nstale\n<!-- catalog-stats:end -->\n",
                encoding="utf-8",
            )
            papers = [copy.deepcopy(BASE)]
            stats = build_catalog.make_stats(papers, "2026-07-11T00:00:00Z", WINDOW_START, WINDOW_END)
            build_catalog.update_readme_stats(
                readme,
                papers,
                stats,
                {},
                WINDOW_START,
                WINDOW_END,
            )
            rendered = readme.read_text(encoding="utf-8")
        self.assertIn("**1** main research works", rendered)
        self.assertIn("**1** works traced to exact bibliography evidence", rendered)
        self.assertNotIn("stale", rendered)

    def test_build_emits_contract_and_static_routes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            papers = write_catalog(root, [copy.deepcopy(BASE)])
            output = root / "public" / "data"
            exit_code = build_catalog.main(
                [
                    "--papers-dir", str(papers),
                    "--output-dir", str(output),
                    "--window-end", WINDOW_END.isoformat(),
                    "--site-url", "https://example.test/atlas",
                ]
            )
            self.assertEqual(0, exit_code)
            self.assertTrue((output / "catalog-manifest.json").is_file())
            self.assertTrue((output / "papers-index.json").is_file())
            self.assertTrue((output / "graph.json").is_file())
            self.assertTrue((output / "papers" / "arxiv-2501-00001.json").is_file())
            manifest = json.loads((output / "catalog-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual("data/routes.json", manifest["files"]["route_manifest"])
            index = json.loads((output / "papers-index.json").read_text(encoding="utf-8"))
            self.assertIsInstance(index["papers"][0]["authors"][0], dict)
            self.assertIn("source_kinds", index["papers"][0])
            sitemap = (output.parent / "sitemap.xml").read_text(encoding="utf-8")
            self.assertIn("https://example.test/atlas/", sitemap)
            self.assertIn(f"https://example.test/atlas/paper/{BASE['slug']}/", sitemap)

            dist = root / "dist"
            dist.mkdir()
            (dist / "index.html").write_text(
                "<!doctype html><html><head><title>Atlas</title></head><body><div id='root'></div></body></html>",
                encoding="utf-8",
            )
            count = postbuild_static_routes.materialize(dist, output / "routes.json")
            self.assertEqual(1, count)
            route = (dist / "paper" / BASE["slug"] / "index.html").read_text(encoding="utf-8")
            self.assertIn("application/ld+json", route)
            self.assertIn("rel=\"canonical\"", route)
            self.assertTrue((dist / "404.html").is_file())


class ExtractionTests(unittest.TestCase):
    def test_hanging_indent_reference_boundaries(self) -> None:
        self.assertTrue(_is_unnumbered_reference_start("Ada Author. A systems paper. CoRR, abs/2501.00001."))
        self.assertFalse(_is_unnumbered_reference_start("  continued title and venue text"))
        self.assertFalse(_is_unnumbered_reference_start("17"))

    def test_local_git_blob_dedup_and_mirror_exclusion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report_dir = root / "reports"
            mirror_dir = root / "pdf"
            report_dir.mkdir()
            mirror_dir.mkdir()
            writer = PdfWriter()
            writer.add_blank_page(width=72, height=72)
            source = report_dir / "report.pdf"
            with source.open("wb") as handle:
                writer.write(handle)
            (report_dir / "alias.pdf").write_bytes(source.read_bytes())
            (mirror_dir / "ignored.pdf").write_bytes(source.read_bytes() + b"mirror")
            reports, _ = local_reports(root, [], DEFAULT_EXCLUDED_PARTS, None)
            self.assertEqual(1, len(reports))
            self.assertEqual(1, len(reports[0].aliases))


class DiscoveryTests(unittest.TestCase):
    def test_openreview_v2_value_wrappers_and_public_date(self) -> None:
        candidate = parse_openreview_note(
            {
                "id": "note-id",
                "forum": "forum-id",
                "pdate": 1_735_689_600_000,
                "mdate": 1_735_776_000_000,
                "content": {
                    "title": {"value": "Agent Runtime Test"},
                    "authors": {"value": ["A. Author"]},
                    "abstract": {"value": "A reusable agent runtime."},
                    "venue": {"value": "Test Venue"},
                },
            }
        )
        self.assertIsNotNone(candidate)
        assert candidate is not None
        self.assertEqual("openreview:forum-id", candidate["candidate_id"])
        self.assertEqual("2025-01-01", candidate["dates"]["first_public_date"])
        self.assertEqual("Test Venue", candidate["raw"]["venue"])

        alternate = copy.deepcopy(candidate)
        alternate["candidate_id"] = "arxiv:2501.00001"
        alternate["dates"]["first_public_date"] = "2025-01-02"
        alternate["identifiers"]["arxiv"] = "2501.00001"
        alternate["versions"][0]["url"] = "https://arxiv.org/abs/2501.00001"
        merged = merge_api_versions([candidate, alternate])
        self.assertEqual(1, len(merged))
        self.assertTrue(any("conflicting_first_public_dates" in reason for reason in merged[0]["review_reasons"]))


class PdfManifestTests(unittest.TestCase):
    def test_duplicate_output_name_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = {
                "schema_version": "1.0",
                "pdfs": [
                    {
                        "work_id": f"arxiv-2501-00{number:03d}",
                        "url": f"https://example.org/{number}.pdf",
                        "license": "CC-BY-4.0",
                        "sha256": str(number) * 64,
                        "size_bytes": 1,
                        "output_filename": "duplicate.pdf",
                    }
                    for number in (1, 2)
                ],
            }
            path = root / "manifest.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            payload, errors = load_manifest(path, REPO_ROOT / "schema" / "pdf-mirror-manifest.schema.json")
            self.assertIsNone(payload)
            self.assertTrue(any("duplicate output_filename" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
