"""Synthetic-only fixtures; run with -B and an E-drive TEMP on Windows."""

import csv
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import manuscript_intake as intake


class IntakeTests(unittest.TestCase):
    def setUp(self):
        if os.name == "nt":
            self.assertEqual(Path(tempfile.gettempdir()).drive.lower(), "e:")
        self.temp = tempfile.TemporaryDirectory(prefix="synthetic-manuscript-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "source"
        (self.root / "parts").mkdir(parents=True)
        self.config = {"schemaVersion": intake.CONFIG_VERSION, "profile": "sectioned-parts-v1",
                       "sourceRoot": str(self.root), "primary": "full.md", "partsDirectory": "parts",
                       "locale": "ko", "pricingMode": "free", "expected": {"parts": 2, "acts": 1, "choices": 6}}
        self.texts = [self.sectioned(1), self.sectioned(2)]
        self.sync()

    def sectioned(self, n):
        nxt = f"\ub2e4\uc74c \ud30c\ud2b8: Part 002\n" if n == 1 else "Terminal source claim.\n"
        return (f"# Part {n:03d} - Synthetic {n}\n\n{intake.BODY}\n\n"
                "  Exact text.  \nSecond line, \"quoted\".\n\n"
                "## \uc120\ud0dd\uc9c0 3\uac1c\n\nA. Alpha\nB. Beta\nC. Gamma\n\n"
                f"## Metadata\n\n{nxt}")

    def sync(self):
        for index, text in enumerate(self.texts, 1):
            (self.root / "parts" / f"p{index}.md").write_bytes(text.encode("utf-8"))
        full = "# \uc81c1\uad8c - Synthetic\n\n" + "\n\n".join(t.lstrip("\ufeff") for t in self.texts)
        (self.root / "full.md").write_bytes(full.encode("utf-8"))
        self.config["pinnedHashes"] = {"full.md": intake.sha(full.encode("utf-8"))}

    def indexed(self, scene_style="bracket", inline=False):
        self.config.update(profile="indexed-parts-v1", manifest="index.json", partCsv="parts.csv")
        rows = []
        for n in (1, 2):
            scene = "[\uc7a5\uba74 1: Synthetic]" if scene_style == "bracket" else "### \uc7a5\uba74 1 - Synthetic"
            # Previous-summary section without a body heading is an observed source dialect.
            self.texts[n - 1] = (f"# Part {n:03d} - Synthetic {n}\n\n## \uc774\uc804 \uc120\ud0dd \uc694\uc57d\n\nPrivate note.\n\n{scene}\n"
                                  "[\ubc30\uacbd: private prompt]\n[\ub4f1\uc7a5: Synthetic]\n\n"
                                  "Exact body.  \nSecond line.\n\n## \uc120\ud0dd\uc9c0\n\n"
                                  "### \uc120\ud0dd A - Alpha\nA effect.\n### \uc120\ud0dd B - Beta\nB effect.\n"
                                  "### \uc120\ud0dd C - Gamma\nC effect.\n")
            if inline:
                self.texts[n - 1] += "\n## \uc7a5\uba74\ubcc4 \uc774\ubbf8\uc9c0 \uc9c0\uc2dc\n\n1. Inline private prompt.\n"
            design = "# Design\n" if inline else "# Design\n\n- \uc774\ubbf8\uc9c0 \ud504\ub86c\ud504\ud2b8: private prompt.\n"
            (self.root / f"design{n}.md").write_text(design, encoding="utf-8")
            rows.append({"part": n, "part_id": str(n).zfill(3), "act": 1, "manuscript": f"parts/p{n}.md",
                         "scene_design": f"design{n}.md", "scenes": 1, "image_prompts": 1, "choices": 3,
                         "official_a_next_part": 2 if n == 1 else None})
        self.manifest = {"schema_version": "lumina-stage-story-v1", "parts": 2, "acts": 1,
                         "scenes": 2, "image_prompts": 2, "choices": 6, "parts_index": rows}
        self.sync_index()

    def sync_index(self):
        (self.root / "index.json").write_bytes(intake.encode(self.manifest))
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=list(self.manifest["parts_index"][0]))
        writer.writeheader()
        writer.writerows(self.manifest["parts_index"])
        (self.root / "parts.csv").write_bytes(stream.getvalue().encode("utf-8"))
        self.sync()

    def result(self):
        return {name: json.loads(data) for name, data in intake.convert(self.config).items()}

    def fails(self, code):
        with self.assertRaisesRegex(intake.IntakeError, code):
            intake.convert(self.config)

    def test_lossless_paragraphs_positions_and_read_only(self):
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob("*") if p.is_file()}
        result = self.result()
        for part, normalized in zip(result["package.json"]["parts"], result["analysis-input.json"]["parts"]):
            data = self.texts[part["number"] - 1].encode("utf-8")
            self.assertEqual(data, "".join(s["text"] for s in part["segments"]).encode("utf-8"))
            for paragraph, source in zip(normalized["paragraphs"], part["paragraphSources"]):
                self.assertEqual(data[source["byteStart"]:source["byteEnd"]], paragraph["text"].encode("utf-8"))
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})
        self.assertIn("  Exact text.  \nSecond line, \"quoted\".\n", [p["text"] for p in result["analysis-input.json"]["parts"][0]["paragraphs"]])

    def test_no_blank_choice_separation_and_no_fake_targets(self):
        choices = self.result()["package.json"]["parts"][0]["choices"]
        self.assertEqual([c["label"] for c in choices], ["A", "B", "C"])
        self.assertEqual([c["readerOrdinal"] for c in choices], [1, 2, 3])
        self.assertEqual([c["targetPartKey"] for c in choices], ["part-002", None, None])
        self.assertEqual(choices[1]["resolution"], "ai_required_unresolved")

    def test_deterministic_idempotent_outputs(self):
        one = intake.convert(self.config)
        self.assertEqual(one, intake.convert(self.config))
        output = self.base / "out"
        intake.write_outputs(self.config, output, one)
        before = {p.name: p.stat().st_mtime_ns for p in output.iterdir()}
        intake.write_outputs(self.config, output, one)
        self.assertEqual(before, {p.name: p.stat().st_mtime_ns for p in output.iterdir()})
        (output / "report.json").write_text("{}")
        with self.assertRaisesRegex(intake.IntakeError, "output_conflict"):
            intake.write_outputs(self.config, output, one)

    def test_output_source_overlap_and_git_blocked(self):
        files = intake.convert(self.config)
        for output in (self.root, self.root / "out", self.base):
            with self.assertRaisesRegex(intake.IntakeError, "output_source_overlap"):
                intake.write_outputs(self.config, output, files)
        git = self.base / "repo"
        git.mkdir()
        (git / ".git").write_text("gitdir: elsewhere")
        with self.assertRaisesRegex(intake.IntakeError, "output_inside_git"):
            intake.write_outputs(self.config, git / "out", files)

    def test_malformed_duplicate_json_and_version(self):
        for data in (b"{", b'{"a":1,"a":2}', b'{"a":NaN}', b"\xff"):
            with self.assertRaises(intake.IntakeError):
                intake.parse_json(data)
        self.config["schemaVersion"] = "v999"
        self.fails("unsupported_config_version")

    def test_incomplete_and_duplicate_parts(self):
        (self.root / "parts/p2.md").unlink()
        self.fails("part_file_count_mismatch")
        self.texts[1] = self.texts[0]
        self.sync()
        self.fails("duplicate_primary_part")

    def test_duplicate_choice_and_four_choices(self):
        for replacement in ("B. Beta", "C. Gamma\nD. Delta"):
            self.texts[0] = self.sectioned(1).replace("C. Gamma", replacement)
            self.sync()
            self.fails("choice_count_or_duplicate|unsupported_choice_label")

    def test_empty_missing_body(self):
        self.texts[0] = self.texts[0].replace(intake.BODY, "## Unknown")
        self.sync()
        self.fails("body_section_missing")

    def test_invalid_utf8_and_nul(self):
        for data in (b"\xff", b"\x00"):
            (self.root / "parts/p1.md").write_bytes(data)
            self.fails("invalid_utf8|nul_in_text")

    def test_bom_crlf_nonbmp_and_trailing_spaces_preserved(self):
        self.texts = ["\ufeff" + t.replace("Exact text.", "\ud55c\uae00 \U0001f600").replace("\n", "\r\n") for t in self.texts]
        self.sync()
        result = self.result()
        self.assertEqual(result["package.json"]["parts"][0]["segments"][0]["byteStart"], 0)
        self.assertIn("\r\n", result["analysis-input.json"]["parts"][0]["paragraphs"][0]["text"])

    def test_pinned_hash_mismatch(self):
        self.config["pinnedHashes"]["full.md"] = "0" * 64
        self.fails("pinned_hash_mismatch")

    def test_primary_coverage_mismatch(self):
        (self.root / "parts/p1.md").write_text(self.texts[0].replace("Exact", "Changed"), encoding="utf-8")
        self.fails("primary_paragraph_mismatch")

    def test_dangling_target(self):
        self.texts[0] = self.texts[0].replace("Part 002", "Part 999")
        self.sync()
        self.fails("dangling_target")

    def test_structured_csv_quotes_newlines_and_malformed_rows(self):
        path = self.root / "csv.csv"
        path.write_bytes(b'key,value\r\n"a,b","line1\nline2 ""q"""\r\n')
        self.assertEqual(intake.read_csv(path), [{"key": "a,b", "value": 'line1\nline2 "q"'}])
        path.write_bytes(b'a,b\n"unclosed')
        with self.assertRaises(intake.IntakeError):
            intake.read_csv(path)

    def test_indexed_bracket_heading_and_inline_design_variants(self):
        for style, inline in (("bracket", False), ("heading", False), ("bracket", True)):
            self.indexed(style, inline)
            report = self.result()["report.json"]
            self.assertEqual(report["counts"]["explicitScenes"], 2)
            self.assertEqual(report["counts"]["observedImagePrompts"], 2)
            self.assertEqual(report["gates"]["declaredStructure"], "matched")
            body = self.result()["analysis-input.json"]["parts"][0]["paragraphs"]
            self.assertEqual(len(body), 2)
            self.assertFalse(any("private prompt" in p["text"] for p in body))
        (self.root / "design1.md").write_text("- \uc774\ubbf8\uc9c0 \uc9c0\uc2dc: alternative.\n", encoding="utf-8")
        self.assertEqual(self.result()["report.json"]["counts"]["observedImagePrompts"], 2)

    def test_mismatch_stays_visible_not_force_pass(self):
        self.indexed()
        (self.root / "design1.md").write_text("No prompt here.")
        report = self.result()["report.json"]
        self.assertEqual(report["declaredCounts"]["image_prompts"], 2)
        self.assertEqual(report["counts"]["observedImagePrompts"], 1)
        self.assertEqual(report["gates"]["declaredStructure"], "blocked")
        self.assertFalse(report["publishReady"])

    def test_source_version_duplicate_scenes_and_manifest_ids(self):
        self.indexed()
        self.manifest["schema_version"] = "v999"
        self.sync_index()
        self.fails("unsupported_source_version")
        self.manifest["schema_version"] = "lumina-stage-story-v1"
        self.texts[0] += "\n[\uc7a5\uba74 1: Duplicate]\n"
        # Put duplicate in the body rather than post-choice metadata.
        self.texts[0] = self.texts[0].replace("Exact body.", "[\uc7a5\uba74 1: Duplicate]\n\nExact body.")
        self.sync_index()
        self.fails("duplicate_scene_id")

    def test_path_escape(self):
        self.indexed()
        self.manifest["parts_index"][0]["scene_design"] = "../../outside.md"
        self.sync_index()
        self.fails("source_path_escape")

    def test_no_approval_fabrication(self):
        self.indexed()
        self.manifest["release"] = {"approved": True, "priceLumina": 3}
        self.sync_index()
        result = self.result()
        self.assertIsNone(result["package.json"]["policy"]["releaseApproval"])
        self.assertIsNone(result["package.json"]["policy"]["priceLumina"])
        self.assertEqual(result["report.json"]["gates"]["publish"], "blocked")

    def test_paragraph_and_request_limits(self):
        self.texts[0] = self.texts[0].replace("Exact text.", "x" * 110000)
        self.sync()
        report = self.result()["report.json"]
        self.assertIn("paragraph_exceeds_10000_utf16_units", report["dtoIssues"])
        self.assertEqual(report["gates"]["jsonRequestBody"], "blocked")

    def test_checksum_inventory_and_mismatch(self):
        self.config["checksumCsv"] = "hashes.csv"
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=["path", "bytes", "sha256"])
        writer.writeheader()
        writer.writerows(intake.inventory(self.root))
        (self.root / "hashes.csv").write_bytes(stream.getvalue().encode("utf-8"))
        self.assertEqual(self.result()["report.json"]["counts"]["checksumEntriesVerified"], 3)
        (self.root / "parts/p1.md").write_text("changed")
        self.fails("inventory_hash_mismatch")

    def test_reordered_parts_rejected(self):
        self.texts.reverse()
        self.sync()
        self.fails("primary_part_order_invalid")

    def test_truncated_utf8_rejected(self):
        (self.root / "parts/p1.md").write_bytes(self.texts[0].encode() + b"\xe3\x81")
        self.fails("invalid_utf8")

    def test_truncated_part_cannot_hide_primary_content(self):
        (self.root / "parts/p2.md").write_bytes(self.texts[1].replace("Terminal source claim.\n", "").encode())
        self.fails("primary_extra_or_missing_blocks")

    def test_hash_inventory_duplicate_and_unlisted_file(self):
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=["path", "bytes", "sha256"])
        writer.writeheader()
        rows = intake.inventory(self.root)
        writer.writerows(rows + rows[:1])
        self.config["checksumCsv"] = "hashes.csv"
        (self.root / "hashes.csv").write_bytes(stream.getvalue().encode())
        self.fails("duplicate_checksum_path")

    def test_full_151_parts_preserved_despite_dto_gate(self):
        self.texts = []
        for n in range(1, 152):
            text = self.sectioned(n)
            if n < 151:
                text = text.replace("Terminal source claim.", f"\ub2e4\uc74c \ud30c\ud2b8: Part {n + 1:03d}")
            self.texts.append(text)
        # Zero-padding is part of this synthetic folder's stable natural order.
        for p in (self.root / "parts").iterdir():
            p.unlink()
        self.config["expected"] = {"parts": 151, "choices": 453}
        for n, text in enumerate(self.texts, 1):
            (self.root / "parts" / f"p{n:03d}.md").write_bytes(text.encode())
        full = "# \uc81c1\uad8c - Synthetic\n\n" + "\n\n".join(self.texts)
        (self.root / "full.md").write_bytes(full.encode())
        self.config["pinnedHashes"] = {"full.md": intake.sha(full.encode())}
        result = self.result()
        self.assertEqual(len(result["analysis-input.json"]["parts"]), 151)
        self.assertIn("parts_exceed_150", result["report.json"]["dtoIssues"])

    def test_reparse_point_rejected_without_is_junction_api(self):
        linked = self.root / "linked-support"
        linked.mkdir()
        with patch.object(Path, "lstat", autospec=True, side_effect=lambda p: SimpleNamespace(
                st_mode=0o040755, st_file_attributes=0x400 if p == linked else 0)):
            self.assertTrue(intake.is_link(linked))
            with self.assertRaisesRegex(intake.IntakeError, "source_link"):
                intake.assert_no_links(linked / "child", "source_link")
            with self.assertRaisesRegex(intake.IntakeError, "output_link"):
                intake.write_outputs(self.config, linked / "output", {})

    def test_unmapped_preamble_preserved_with_blocked_coverage(self):
        preamble = "# Synthetic title\r\n\r\nUnmapped synthetic narrative.  \r\n\r\n"
        data = preamble.encode() + (self.root / "full.md").read_bytes()
        (self.root / "full.md").write_bytes(data)
        self.config["pinnedHashes"]["full.md"] = intake.sha(data)
        result = self.result()
        prefix = result["package.json"]["primaryPreamble"]
        self.assertEqual("".join(s["text"] for s in prefix["segments"]).encode(), data[:prefix["bytes"]])
        self.assertEqual(result["report.json"]["gates"]["primaryParagraphCoverage"], "blocked")
        self.assertEqual(result["report.json"]["counts"]["primaryPreambleUnmappedBlocks"], 1)

    def test_blank_labels_block_structure_without_altering_raw_choices(self):
        for indexed in (False, True):
            if indexed:
                self.indexed()
            self.texts[0] = self.texts[0].replace("B. Beta", "B.   ").replace("B - Beta", "B -   ")
            self.sync()
            result = self.result()
            self.assertEqual(result["report.json"]["gates"]["declaredStructure"], "blocked")
            self.assertEqual("".join(s["text"] for s in result["package.json"]["parts"][0]["segments"]), self.texts[0])

    def test_final_ending_conditions_unmapped_not_conflicting(self):
        condition = "\uc791\uac00 \uc5d4\ub529: C \uc120\ud0dd.\n"
        self.texts[1] += condition
        self.sync()
        result = self.result()
        codes = [i["code"] for i in result["report.json"]["issues"]]
        self.assertIn("ending_resolution_unmapped", codes)
        self.assertFalse(any("conflict" in c for c in codes))
        self.assertIn(condition, "".join(s["text"] for s in result["package.json"]["parts"][1]["segments"]))

    def test_csv_array_placeholder_is_observed_not_repaired(self):
        self.indexed()
        for row in self.manifest["parts_index"]:
            row["sources"] = ["synthetic-note.md"]
        self.sync_index()
        csv_path = self.root / "parts.csv"
        original = csv_path.read_bytes().replace(b"['synthetic-note.md']", b"System.Object[]")
        csv_path.write_bytes(original)
        result = self.result()
        self.assertEqual(csv_path.read_bytes(), original)
        self.assertEqual(result["package.json"]["sourceManifest"], self.manifest)
        self.assertEqual(result["report.json"]["counts"]["sourceIndexMismatches"], 2)
        self.assertEqual(result["report.json"]["gates"]["sourceIndexQuality"], "observed_mismatch")
        self.assertEqual(result["report.json"]["gates"]["declaredStructure"], "matched")


if __name__ == "__main__":
    unittest.main()
