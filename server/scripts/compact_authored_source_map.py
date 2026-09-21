"""Compact existing verified intake evidence; no DB, provider, or publication."""

import argparse
from pathlib import Path

from manuscript_intake import (
    IntakeError, assert_no_links, encode, inventory, parse_json, read_utf8,
    require, sha, source_path, write_outputs,
)


VERSION = "story-authored-source-map-v1"
MAX_BYTES = 16 * 1024 * 1024


def compact(package_dir, source_root, manifest_name):
    package_dir = Path(package_dir).absolute()
    source_root = Path(source_root).absolute()
    assert_no_links(package_dir, "artifact_link")
    assert_no_links(source_root, "source_link")
    checksums = parse_json((package_dir / "checksums.json").read_bytes())
    artifacts = {}
    for name in ("package.json", "analysis-input.json", "report.json"):
        data = source_path(package_dir, name).read_bytes()
        expected = checksums.get(name, {})
        require(len(data) == expected.get("bytes") and sha(data) == expected.get("sha256"), "artifact_identity_mismatch")
        artifacts[name] = parse_json(data)
    package = artifacts["package.json"]
    report = artifacts["report.json"]
    analysis = artifacts["analysis-input.json"]
    require(package.get("schemaVersion") == "lumina-offline-manuscript-v1", "unsupported_package")
    require(package.get("sourceManifest") is not None, "indexed_manifest_required")
    before = inventory(source_root)
    require(before == package["sourceInventory"], "source_inventory_changed")
    require(sha(encode(before)) == report["sourceInventorySha256"], "inventory_digest_mismatch")
    require(checksums["analysis-input.json"]["sha256"] == package["analysisPayloadSha256"], "analysis_identity_mismatch")
    manifest_bytes, manifest_text = read_utf8(source_path(source_root, manifest_name))
    require(parse_json(manifest_bytes) == package["sourceManifest"], "manifest_identity_mismatch")

    def raw_segments(items, original):
        text = "".join(item["text"] for item in items)
        data = text.encode("utf-8")
        require(data == source_path(source_root, original).read_bytes(), "source_reconstruction_mismatch")
        cursor = 0
        sizes = []
        for item in items:
            size = len(item["text"].encode("utf-8"))
            require(item["byteStart"] == cursor and item["byteEnd"] == cursor + size and size > 0,
                    "segment_partition_mismatch")
            require(item["sha256"] == sha(item["text"].encode("utf-8")), "segment_digest_mismatch")
            sizes.append(size)
            cursor += size
        return text, sizes

    parts = []
    for part, projected in zip(package["parts"], analysis["parts"]):
        text, sizes = raw_segments(part["segments"], part["sourcePath"])
        require(part["sourceSha256"] == sha(text.encode("utf-8")), "part_digest_mismatch")

        def ref_index(ref):
            index = ref["segment"]
            require(type(index) is int and 0 <= index < len(part["segments"]), "reference_index_invalid")
            segment = part["segments"][index]
            require(ref["fileId"] == part["sourceFileId"], "reference_file_mismatch")
            require(all(ref[key] == segment[key] for key in ("byteStart", "byteEnd", "lineStart", "lineEnd", "sha256")),
                    "reference_span_mismatch")
            return index

        require(part["partKey"] == projected["partKey"] and part["title"] == projected["title"], "analysis_part_mismatch")
        paragraph_indexes = [ref_index(ref) for ref in part["paragraphSources"]]
        require(len(paragraph_indexes) == len(projected["paragraphs"]), "analysis_paragraph_count_mismatch")
        require(all(part["segments"][index]["text"] == paragraph["text"]
                    for index, paragraph in zip(paragraph_indexes, projected["paragraphs"])), "analysis_paragraph_mismatch")
        parts.append({
            "partKey": part["partKey"], "number": part["number"], "act": part["act"], "title": part["title"],
            "sourceFileId": part["sourceFileId"], "sourcePath": part["sourcePath"],
            "sourceSha256": part["sourceSha256"], "sourceBytes": part["sourceBytes"],
            "text": text, "segmentBytes": sizes, "paragraphSegments": paragraph_indexes,
            "metadataSegments": [ref_index(ref) for ref in part["metadataSources"]],
            "scenes": [{"sceneKey": scene["sceneKey"], "segment": ref_index(scene["source"])} for scene in part["scenes"]],
            "choices": [{"choiceKey": choice["choiceKey"], "label": choice["label"],
                         "readerOrdinal": choice["readerOrdinal"], "segment": ref_index(choice["source"]),
                         "evidenceSegments": [ref_index(ref) for ref in choice["evidence"]],
                         "targetPartKey": choice["targetPartKey"], "resolution": choice["resolution"]}
                        for choice in part["choices"]],
        })
    require(len(parts) == len(package["parts"]) == len(analysis["parts"]), "part_coverage_mismatch")
    designs = []
    for design in package["imagePromptEvidence"]:
        text, sizes = raw_segments(design["designSegments"], design["designSource"])
        designs.append({"part": design["part"], "declared": design["declared"],
                        "designObserved": design["designObserved"], "inlineObserved": design["inlineObserved"],
                        "selectedObserved": design["selectedObserved"], "sourcePath": design["designSource"],
                        "sourceSha256": design["designSha256"], "text": text, "segmentBytes": sizes})
    primary_path = package["primaryPreamble"]["sourcePath"]
    primary_bytes, primary_text = read_utf8(source_path(source_root, primary_path))
    require(sha(primary_bytes) == report["primarySha256"], "primary_identity_mismatch")
    assembly = []
    cursor = 0
    for part in parts:
        normalized = part["text"].replace("\r\n", "\n").rstrip("\r\n")
        found = primary_text.find(normalized, cursor)
        require(found >= cursor, "primary_assembly_not_exact")
        assembly.append({"before": primary_text[cursor:found], "partKey": part["partKey"]})
        cursor = found + len(normalized)
    result = {"contract": VERSION, "locale": analysis["locale"],
              "packageSha256": checksums["package.json"]["sha256"],
              "analysisPayloadSha256": package["analysisPayloadSha256"],
              "sourceInventorySha256": report["sourceInventorySha256"], "sourceInventory": before,
              "sourceManifest": {"path": manifest_name, "text": manifest_text},
              "primaryPreamble": package["primaryPreamble"], "indexFieldObservations": package["indexFieldObservations"],
              "primaryAssembly": {"sourcePath": primary_path, "parts": assembly, "after": primary_text[cursor:]},
              "parts": parts, "designs": designs, "endingEvidence": package["endingEvidence"],
              "actResetCandidates": package["actResetCandidates"]}
    payload = encode(result)
    require(len(payload) <= MAX_BYTES, "source_map_file_limit")
    require(inventory(source_root) == before, "source_changed_during_compaction")
    summary = {"contract": VERSION, "bytes": len(payload), "sha256": sha(payload),
               "parts": len(parts), "sourceScenes": sum(len(part["scenes"]) for part in parts),
               "choices": sum(len(part["choices"]) for part in parts),
               "partRawBytes": sum(part["sourceBytes"] for part in parts),
               "designRawBytes": sum(len(design["text"].encode("utf-8")) for design in designs),
               "sourceFilesRehashedBeforeAndAfter": len(before), "publishReady": False}
    return payload, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-dir", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        payload, summary = compact(args.package_dir, args.source_root, args.manifest)
        if args.output:
            write_outputs({"sourceRoot": args.source_root}, Path(args.output), {
                "authored-source-map.json": payload, "authored-source-map-report.json": encode(summary),
            })
        print(encode(summary).decode("utf-8"))
    except (IntakeError, OSError, KeyError, TypeError, ValueError):
        # Filesystem/JSON exceptions can contain source paths or prose.
        print('{"code":"AUTHORED_SOURCE_MAP_PREPARATION_FAILED"}')
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
