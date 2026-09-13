"""Offline, lossless preparation. No DB, HTTP, provider, or publishing capability."""

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import sys

VERSION = "lumina-offline-manuscript-v1"
CONFIG_VERSION = "lumina-offline-input-v1"
PART = re.compile(r"^# Part (\d+)\s*[-:]\s*(.+)$", re.M)
BODY = "## \ubcf8\ubb38 \uc6d0\uace0"
CHOICES = re.compile(r"^## (?:\ucd5c\uc885 )?\uc120\ud0dd\uc9c0(?: 3\uac1c)?$")
SCENE = re.compile(r"^(?:\[|### )\uc7a5\uba74\s*(\d+)\s*[:\].-]")
VOLUME = re.compile(r"^# \uc81c(\d+)\uad8c\s*-")
CHOICE_INDEXED = re.compile(r"^### \uc120\ud0dd ([A-Z])\s*-")
CHOICE_SECTIONED = re.compile(r"^([A-Z])\. ")
NEXT = re.compile(r"^\ub2e4\uc74c \ud30c\ud2b8:\s*Part\s*(\d+)", re.M)
ENDING_WORDS = re.compile(r"\uc791\uac00.*\uc5d4\ub529|\uc11c\ube0c \uc5d4\ub529|AI fallback \uc5d4\ub529")
VISUAL = re.compile(r"^\[(?:\ubc30\uacbd|\ubc30\uacbd \uc774\ubbf8\uc9c0|\ub4f1\uc7a5|\ub4f1\uc7a5\uc778\ubb3c|\ud1f4\uc7a5)\s*:")


class IntakeError(Exception):
    """Only non-content error codes are exposed by the CLI."""


def require(condition, code):
    if not condition:
        raise IntakeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def parse_json(data):
    try:
        return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_object,
                          parse_constant=lambda _: require(False, "invalid_json_number"))
    except (UnicodeError, ValueError):
        raise IntakeError("invalid_json_or_encoding") from None


def read_utf8(path):
    try:
        data = path.read_bytes()
        text = data.decode("utf-8")
        require("\x00" not in text, "nul_in_text")
        return data, text
    except UnicodeError:
        raise IntakeError("invalid_utf8") from None


def read_csv(path):
    _, text = read_utf8(path)
    try:
        rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff"), newline=""), strict=True))
        require(bool(rows) and len(set(rows[0])) == len(rows[0]), "invalid_csv_header")
        require(all(len(row) == len(rows[0]) for row in rows[1:]), "invalid_csv_row")
        return [dict(zip(rows[0], row)) for row in rows[1:]]
    except csv.Error:
        raise IntakeError("invalid_csv") from None


def inside(path, root):
    return path == root or root in path.parents


def is_link(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    # Python 3.10 has no Path.is_junction; all Windows reparse points fail closed.
    return (stat.S_ISLNK(info.st_mode)
            or bool(getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)))


def assert_no_links(path, code):
    for ancestor in reversed((path, *path.parents)):
        require(not is_link(ancestor), code)


def source_path(root, name):
    require(isinstance(name, str) and name and not Path(name).is_absolute(), "invalid_relative_path")
    candidate = root / name
    assert_no_links(candidate, "source_link")
    require(inside(candidate.resolve(), root), "source_path_escape")
    require(candidate.is_file(), "source_file_missing")
    return candidate


def inventory(root):
    result = []
    assert_no_links(root, "source_link")

    def visit(directory):
        for path in sorted(directory.iterdir()):
            require(not is_link(path), "source_link")
            require(inside(path.resolve(), root), "source_path_escape")
            if path.is_dir():
                visit(path)
            elif path.is_file():
                data = path.read_bytes()
                result.append({"path": path.relative_to(root).as_posix(), "bytes": len(data), "sha256": sha(data)})

    # Check each entry before descent; eager rglob would traverse a junction first.
    visit(root)
    return sorted(result, key=lambda item: Path(item["path"]))


def segments(text):
    """Lossless blank/nonblank blocks; offsets are UTF-8 bytes, end exclusive."""
    result = []
    offset = 0
    line = 1
    for chunk in re.findall(r"(?:[^\r\n]*(?:\r\n|\n|\r|$))", text):
        if not chunk:
            continue
        blank = not chunk.strip()
        marker = (chunk.startswith("#") or CHOICE_SECTIONED.match(chunk)
                  or SCENE.match(chunk) or VISUAL.match(chunk))
        previous_marker = result and (result[-1]["text"].startswith("#")
                                     or SCENE.match(result[-1]["text"])
                                     or VISUAL.match(result[-1]["text"]))
        if result and result[-1]["blank"] == blank and not marker and not previous_marker:
            result[-1]["text"] += chunk
            result[-1]["byteEnd"] += len(chunk.encode("utf-8"))
            result[-1]["lineEnd"] = line
        else:
            result.append({"blank": blank, "text": chunk, "byteStart": offset,
                           "byteEnd": offset + len(chunk.encode("utf-8")), "lineStart": line, "lineEnd": line})
        offset += len(chunk.encode("utf-8"))
        line += bool(re.search(r"[\r\n]$", chunk))
    for item in result:
        item["sha256"] = sha(item["text"].encode("utf-8"))
    require("".join(s["text"] for s in result) == text, "lossless_coverage_failed")
    return result


def ref(file_id, segment, index):
    return {"fileId": file_id, "segment": index,
            **{k: segment[k] for k in ("byteStart", "byteEnd", "lineStart", "lineEnd", "sha256")}}


def js_length(text):
    return len(text.encode("utf-16-le")) // 2


def primary_preamble(text, part_count):
    prefix = text[:PART.search(text).start()]
    blocks = segments(prefix)
    classifications = []
    title_seen = False
    description = (f"\uacf5\uc2dd \uc120\ud0dd A \uba54\uc778 \ub8e8\ud2b8 {part_count}\ud30c\ud2b8, "
                   "\ud30c\ud2b8\ubcc4 \uc120\ud0dd\uc9c0\u00b7\uacb0\uacfc \uba54\ubaa8\u00b7AI \uc5f0\uacb0 \uc694\uc57d \ud3ec\ud568 \ud1b5\ud569\ubcf8.")
    for index, block in enumerate(blocks):
        content = block["text"].lstrip("\ufeff").rstrip("\r\n")
        if block["blank"]:
            kind = "blank"
        elif re.fullmatch(VOLUME.pattern + r"[^\r\n]+", content):
            kind = "volume_heading"
        elif not title_seen and re.fullmatch(r"# [^\r\n]+", content):
            kind = "document_title"
            title_seen = True
        elif content == "---":
            kind = "assembly_rule"
        elif content == description:
            kind = "assembly_description"
        else:
            kind = "unmapped"
        classifications.append({"kind": kind, "source": ref("primary-source", block, index)})
    return {"bytes": len(prefix.encode("utf-8")), "segments": blocks, "classifications": classifications}


def convert(config):
    require(config.get("schemaVersion") == CONFIG_VERSION, "unsupported_config_version")
    profile = config.get("profile")
    require(profile in ("sectioned-parts-v1", "indexed-parts-v1"), "unsupported_profile")
    require(config.get("pricingMode") in ("free", "paid"), "pricing_mode_required")
    require(config.get("locale") in ("ko", "en", "ja", "zh-Hans", "zh-Hant"), "invalid_locale")
    expected = config.get("expected", {})
    require(isinstance(expected.get("parts"), int) and expected["parts"] > 0, "expected_parts_required")
    root = Path(config["sourceRoot"]).absolute()
    assert_no_links(root, "source_link")
    root = root.resolve(strict=True)
    before = inventory(root)
    by_path = {f["path"]: f for f in before}
    issues = []

    def issue(code, part=None, line=None):
        item = {"code": code}
        if part is not None:
            item["part"] = part
        if line is not None:
            item["line"] = line
        issues.append(item)

    verified = 0
    require(bool(config.get("pinnedHashes")), "pinned_hashes_required")
    for name, digest in config["pinnedHashes"].items():
        path = source_path(root, name)
        require(re.fullmatch(r"[a-fA-F0-9]{64}", digest) is not None, "invalid_hash")
        require(sha(path.read_bytes()) == digest.lower(), "pinned_hash_mismatch")
        verified += 1
    external = []
    for item in config.get("externalHashes", []):
        assert_no_links(Path(item["path"]).absolute(), "external_link")
        data = Path(item["path"]).read_bytes()
        require(sha(data) == item["sha256"].lower(), "external_hash_mismatch")
        external.append({"bytes": len(data), "sha256": sha(data)})

    checksum_count = 0
    if config.get("checksumCsv"):
        seen = set()
        for row in read_csv(source_path(root, config["checksumCsv"])):
            name = row["path"].replace("\\", "/")
            require(name not in seen, "duplicate_checksum_path")
            seen.add(name)
            p = source_path(root, name)
            data = p.read_bytes()
            require(sha(data) == row["sha256"].lower() and str(len(data)) == row["bytes"], "inventory_hash_mismatch")
            checksum_count += 1
        require(seen == set(by_path) - {config["checksumCsv"]}, "checksum_inventory_incomplete")

    primary_path = source_path(root, config["primary"])
    primary_data, primary = read_utf8(primary_path)
    primary_matches = list(PART.finditer(primary.replace("\r\n", "\n")))
    require(len(primary_matches) == expected["parts"], "primary_part_count_mismatch")
    require(len({int(m[1]) for m in primary_matches}) == len(primary_matches), "duplicate_primary_part")
    require([int(m[1]) for m in primary_matches] == list(range(1, expected["parts"] + 1)), "primary_part_order_invalid")
    preamble = primary_preamble(primary, expected["parts"])
    unmapped_preamble = [p for p in preamble["classifications"] if p["kind"] == "unmapped"]
    for item in unmapped_preamble:
        issue("primary_preamble_unmapped", line=item["source"]["lineStart"])
    primary_by_part = {}
    primary_lf = primary.replace("\r\n", "\n")
    for j, match in enumerate(primary_matches):
        end = primary_matches[j + 1].start() if j + 1 < len(primary_matches) else len(primary_lf)
        primary_by_part[int(match[1])] = primary_lf[match.start():end]

    manifest = None
    index_observations = []
    if profile == "indexed-parts-v1":
        manifest = parse_json(source_path(root, config["manifest"]).read_bytes())
        require(manifest.get("schema_version") == "lumina-stage-story-v1", "unsupported_source_version")
        rows = manifest.get("parts_index")
        require(isinstance(rows, list) and manifest.get("parts") == len(rows) == expected["parts"], "manifest_part_count_mismatch")
        csv_rows = read_csv(source_path(root, config["partCsv"]))
        require(len(csv_rows) == len(rows), "part_csv_count_mismatch")
        for index, (row, csv_row) in enumerate(zip(rows, csv_rows)):
            for key in ("part", "part_id", "act", "manuscript", "scenes", "image_prompts", "choices"):
                require(str(row[key]) == csv_row[key], "part_csv_manifest_mismatch")
            if csv_row.get("sources") == "System.Object[]" and isinstance(row.get("sources"), list):
                issue("part_csv_sources_placeholder_mismatch", row["part"])
                index_observations.append({"field": "sources", "part": row["part"], "csvRecord": index + 2,
                                           "observedCsv": "System.Object[]", "selectedSource": "manifest",
                                           "manifestPointer": f"/parts_index/{index}/sources"})
    else:
        names = sorted(p.relative_to(root).as_posix() for p in (root / config["partsDirectory"]).glob("*.md"))
        rows = [{"manuscript": name} for name in names]
    require(len(rows) == expected["parts"], "part_file_count_mismatch")
    all_part_files = {p.relative_to(root).as_posix() for p in (root / config["partsDirectory"]).rglob("*") if p.is_file()}
    require(all_part_files == {r["manuscript"] for r in rows}, "unindexed_part_file")

    parts = []
    normalized_parts = []
    used_ids = set()
    coverage = 0
    paragraph_count = 0
    source_scene_count = 0
    prompt_count = 0
    prompt_sources = []
    background_markers = 0
    all_choices = []
    ending_evidence = []
    for file_index, row in enumerate(rows):
        data, text = read_utf8(source_path(root, row["manuscript"]))
        background_markers += len(re.findall(r"^\[\ubc30\uacbd(?: \uc774\ubbf8\uc9c0)?\s*:", text, re.M))
        blocks = segments(text)
        matches = list(PART.finditer(text.lstrip("\ufeff").replace("\r\n", "\n")))
        require(len(matches) == 1, "part_heading_count_invalid")
        number, title = int(matches[0][1]), matches[0][2]
        require(number not in used_ids, "duplicate_part_id")
        require(number == file_index + 1, "part_order_invalid")
        used_ids.add(number)
        require(number in primary_by_part, "part_not_in_primary")
        if manifest:
            require(row["part"] == number and int(row["part_id"]) == number, "manifest_part_id_mismatch")
        # Compare every nonblank raw block within this part of the primary, in order.
        cursor = 0
        for block in blocks:
            if block["blank"]:
                continue
            needle = block["text"].lstrip("\ufeff").replace("\r\n", "\n").rstrip("\r\n")
            pos = primary_by_part[number].find(needle, cursor)
            require(pos >= 0, "primary_paragraph_mismatch")
            cursor = pos + len(needle)
            coverage += 1
        source_blocks = [b["text"].lstrip("\ufeff").replace("\r\n", "\n").rstrip("\r\n") for b in blocks if not b["blank"]]
        primary_blocks = [b["text"].lstrip("\ufeff").rstrip("\r\n") for b in segments(primary_by_part[number])
                          if not b["blank"] and not VOLUME.match(b["text"]) and b["text"].strip() != "---"]
        require(source_blocks == primary_blocks, f"primary_extra_or_missing_blocks:part-{number}")

        key = f"part-{number:03d}"
        file_id = f"part-source-{number:03d}"
        mode = "body" if profile == "indexed-parts-v1" else "metadata"
        body = []
        body_refs = []
        scenes = []
        choices = []
        metadata_refs = []
        choice_block = None
        body_seen = False
        for j, block in enumerate(blocks):
            if block["blank"]:
                continue
            line = block["text"].lstrip("\ufeff").splitlines()[0]
            r = ref(file_id, block, j)
            if manifest and not choices and SCENE.match(line):
                mode = "body"
            if line.startswith("# Part "):
                metadata_refs.append(r)
                continue
            if line.startswith("## "):
                if line == BODY:
                    mode = "body"
                    body_seen = True
                elif CHOICES.fullmatch(line):
                    mode = "choices"
                else:
                    mode = "metadata"
                choice_block = None
                metadata_refs.append(r)
                continue
            choice_match = (CHOICE_INDEXED if manifest else CHOICE_SECTIONED).match(line) if mode == "choices" else None
            if choice_match:
                label = choice_match[1]
                require(label in ("A", "B", "C"), "unsupported_choice_label")
                if not line[choice_match.end():].strip():
                    issue("choice_text_incomplete", number, block["lineStart"])
                choice_block = {"choiceKey": f"{key}-{label}", "label": label, "source": r,
                                "sourceLabelText": block["text"], "readerOrdinal": ord(label) - ord("A") + 1,
                                "evidence": [r], "authorship": "author", "targetPartKey": None,
                                "resolution": "ai_required_unresolved"}
                choices.append(choice_block)
            elif choice_block:
                choice_block["evidence"].append(r)
            if ENDING_WORDS.search(block["text"]):
                claims = []
                if re.search(r"\uc791\uac00.*\uc5d4\ub529", block["text"]):
                    claims.append("author_default")
                if "\uc11c\ube0c \uc5d4\ub529" in block["text"]:
                    claims.append("author_sub")
                if "AI fallback \uc5d4\ub529" in block["text"]:
                    claims.append("ai_required_not_generated")
                ending_evidence.append({"part": number, "source": r, "provenanceClaims": claims,
                                        "status": "source_claim_unresolved"})
            if mode != "body" or VISUAL.match(line):
                metadata_refs.append(r)
                continue
            scene_match = SCENE.match(line)
            kind = "scene_break" if scene_match else "paragraph"
            if scene_match:
                scene_id = f"{key}-scene-{int(scene_match[1]):03d}"
                require(scene_id not in {s["sceneKey"] for s in scenes}, "duplicate_scene_id")
                scenes.append({"sceneKey": scene_id, "source": r, "visualAsset": None})
            body.append({"kind": kind, "text": block["text"]})
            body_refs.append(r)
        require(body and (body_seen or manifest), f"body_section_missing:part-{number}")
        require(len(choices) == 3 and {c["label"] for c in choices} == {"A", "B", "C"}, f"choice_count_or_duplicate:part-{number}")
        next_number = row.get("official_a_next_part") if manifest else None
        if not manifest:
            next_matches = NEXT.findall(text)
            require(len(next_matches) <= 1, "duplicate_next_target")
            next_number = int(next_matches[0]) if next_matches else None
        if next_number is not None:
            require(type(next_number) is int, "invalid_target_type")
            choices[0]["targetPartKey"] = f"part-{next_number:03d}"
            choices[0]["resolution"] = "authored_a_candidate"
        else:
            choices[0]["resolution"] = "ending_resolution_required"
        require(choices[0]["label"] == "A", "choice_order_invalid")
        if manifest:
            act = row["act"]
            require(type(act) is int and act > 0, "invalid_act")
            if len(scenes) != row["scenes"] or len(choices) != row["choices"]:
                issue("manifest_structure_mismatch", number)
            _, design = read_utf8(source_path(root, row["scene_design"]))
            count = len(re.findall(r"^- \uc774\ubbf8\uc9c0 (?:\ud504\ub86c\ud504\ud2b8|\uc9c0\uc2dc):", design, re.M))
            inline_count = 0
            inline_section_seen = False
            in_images = False
            for source_line in text.splitlines():
                if source_line.startswith("## "):
                    in_images = bool(re.match(r"^## \uc7a5\uba74\ubcc4 (?:\ubc30\uacbd )?\uc774\ubbf8\uc9c0 \uc9c0\uc2dc", source_line))
                    inline_section_seen = inline_section_seen or in_images
                elif in_images and re.match(r"^\d+\. ", source_line):
                    inline_count += 1
            # Design and inline copies are alternatives, never sum duplicate prompt editions.
            observed = count if count else inline_count
            if observed != row["image_prompts"]:
                issue("image_prompt_count_mismatch", number)
            if inline_section_seen and inline_count != row["image_prompts"]:
                issue("inline_image_prompt_count_mismatch", number)
            prompt_sources.append({"part": number, "declared": row["image_prompts"], "designObserved": count,
                                   "inlineObserved": inline_count, "selectedObserved": observed,
                                   "designSource": row["scene_design"], "designSha256": sha(design.encode("utf-8")),
                                   "designSegments": segments(design)})
            prompt_count += observed
        else:
            prefix = primary_lf[:primary_matches[file_index].start()]
            volumes = [int(m[1]) for m in re.finditer(VOLUME.pattern, prefix, re.M)]
            act = volumes[-1] if volumes else None
            if not scenes:
                issue("scene_boundaries_not_explicit", number)
        source_scene_count += len(scenes)
        if not manifest and number == expected["parts"]:
            for block in blocks:
                if ENDING_WORDS.search(block["text"]):
                    issue("ending_resolution_unmapped", number, block["lineStart"])
                    break
        parts.append({"partKey": key, "number": number, "act": act, "title": title,
                      "sourceFileId": file_id, "sourcePath": row["manuscript"], "sourceSha256": sha(data), "sourceBytes": len(data),
                      "segments": blocks, "paragraphSources": body_refs, "metadataSources": metadata_refs,
                      "scenes": scenes, "choices": choices, "sourceManifestEntry": row if manifest else None})
        normalized_parts.append({"partKey": key, "title": title, "paragraphs": body})
        paragraph_count += len(body)
        all_choices.extend(choices)

    require(used_ids == set(range(1, expected["parts"] + 1)), "incomplete_part_sequence")
    part_keys = {p["partKey"] for p in parts}
    for choice in all_choices:
        require(choice["targetPartKey"] is None or choice["targetPartKey"] in part_keys, "dangling_target")
    for index, part in enumerate(parts):
        expected_next = parts[index + 1]["partKey"] if index + 1 < len(parts) else None
        require(part["choices"][0]["targetPartKey"] == expected_next, "authored_route_sequence_mismatch")
    acts = sorted({p["act"] for p in parts if p["act"] is not None})
    for metric, actual in (("acts", len(acts)), ("scenes", source_scene_count), ("choices", len(all_choices))):
        if metric in expected:
            if expected[metric] != actual:
                issue(f"expected_{metric}_mismatch")
        if manifest:
            if manifest[metric] != actual:
                issue(f"manifest_{metric}_mismatch")
    if manifest:
        if manifest["image_prompts"] != prompt_count:
            issue("manifest_prompt_total_mismatch")
    normalized = {"locale": config["locale"], "parts": normalized_parts}
    payload = encode(normalized)
    structured_body = encode({"parts": normalized_parts})
    dto_issues = []
    if len(parts) > 150:
        dto_issues.append("parts_exceed_150")
    for p in normalized_parts:
        if js_length(p["partKey"]) > 80 or js_length(p["title"]) > 240 or len(p["paragraphs"]) > 5000:
            dto_issues.append("part_dto_limit")
        if any(js_length(x["text"]) > 10000 for x in p["paragraphs"]):
            dto_issues.append("paragraph_exceeds_10000_utf16_units")
    require(inventory(root) == before, "inputs_changed_during_conversion")
    for item in config.get("externalHashes", []):
        assert_no_links(Path(item["path"]).absolute(), "external_link")
        require(sha(Path(item["path"]).read_bytes()) == item["sha256"].lower(), "external_changed_during_conversion")
    gates = {
        "offlineConversion": "ready",
        "sourceIntegrity": "ready",
        "losslessPartCoverage": "ready",
        "primaryParagraphCoverage": "blocked" if unmapped_preamble else "ready",
        "declaredStructure": "blocked" if any(i["code"] == "choice_text_incomplete" or
            ("mismatch" in i["code"] and i["code"] != "part_csv_sources_placeholder_mismatch") for i in issues) else "matched",
        "sourceIndexQuality": "observed_mismatch" if index_observations else "no_observed_mismatch",
        "analysisDto": "blocked" if dto_issues else "shape_compatible_only",
        "jsonRequestBody": "blocked" if len(payload) > 102400 else "within_default_limit_only",
        "privateIntake": "not_run",
        "intakeToWorkImporter": "not_implemented",
        "analysisTransactionCapacity": "unverified",
        "proxyBodyLimit": "unverified",
        "branchRuntime": "ai_generation_required_not_connected",
        "endingResolution": "blocked",
        "resetRuntimeBinding": "unverified",
        "visualAssetsAndRights": "blocked",
        "manuscriptRightsApproval": "unverified",
        "priceApproval": "unverified" if config["pricingMode"] == "paid" else "free_policy_only",
        "releaseApproval": "unverified",
        "publish": "blocked",
    }
    report = {"schemaVersion": VERSION, "counts": {
        "sourceFiles": len(before), "pinnedHashesVerified": verified,
        "externalHashesVerified": len(external), "checksumEntriesVerified": checksum_count,
        "parts": len(parts), "acts": len(acts), "explicitScenes": source_scene_count,
        "choices": len(all_choices), "unresolvedAiChoices": sum(c["resolution"] == "ai_required_unresolved" for c in all_choices),
        "observedImagePrompts": prompt_count if manifest else None,
        "backgroundPromptMarkers": background_markers,
        "visualFilesDiscovered": sum(Path(f["path"]).suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") for f in before),
        "verifiedVisualAssets": 0,
        "analysisParagraphs": paragraph_count, "primaryCoveredNonblankBlocks": coverage,
        "primaryPreambleBytes": preamble["bytes"], "primaryPreambleUnmappedBlocks": len(unmapped_preamble),
        "sourceIndexMismatches": len(index_observations),
        "losslessPartBytes": sum(p["sourceBytes"] for p in parts),
        "analysisPayloadBytes": len(payload), "structuredBodyJsonBytes": len(structured_body)},
        "sourceInventorySha256": sha(encode(before)), "primarySha256": sha(primary_data),
        "analysisPayloadSha256": sha(payload), "gates": gates, "dtoIssues": sorted(set(dto_issues)),
        "declaredCounts": {k: manifest[k] for k in ("acts", "parts", "scenes", "image_prompts", "choices")} if manifest else expected,
        "issues": issues, "publishReady": False}
    package = {"schemaVersion": VERSION, "purpose": "private_offline_preparation_not_release_metadata",
               "sourceInventory": before, "externalIntegrity": external,
               "sourceManifest": manifest, "parts": parts,
               "primaryPreamble": {"sourcePath": config["primary"], **preamble},
               "indexFieldObservations": index_observations,
               "imagePromptEvidence": prompt_sources,
               "endingEvidence": ending_evidence,
               "actResetCandidates": [{"act": act, "entryPartKey": next(p["partKey"] for p in parts if p["act"] == act),
                                       "runtimeBinding": None} for act in acts],
               "policy": {"pricingMode": config["pricingMode"], "maxRecommendations": 3,
                          "customChoiceEnabled": False, "rightsApproval": None, "releaseApproval": None,
                          "priceLumina": None, "publishReady": False},
               "analysisPayloadSha256": sha(payload)}
    return {"package.json": encode(package), "analysis-input.json": payload, "report.json": encode(report)}


def write_outputs(config, output, files):
    root = Path(config["sourceRoot"]).absolute()
    assert_no_links(root, "source_link")
    root = root.resolve(strict=True)
    output = Path(output).absolute()
    assert_no_links(output, "output_link")
    output = output.resolve()
    require(not inside(output, root) and not inside(root, output), "output_source_overlap")
    require(not any((p / ".git").exists() for p in (output, *output.parents)), "output_inside_git")
    for item in config.get("externalHashes", []):
        require(not inside(Path(item["path"]).resolve(), output), "output_external_overlap")
    require(output.exists() is False or output.is_dir(), "output_not_directory")
    files = dict(files)
    files["checksums.json"] = encode({name: {"sha256": sha(data), "bytes": len(data)} for name, data in sorted(files.items())})
    if output.exists():
        require({p.name for p in output.iterdir()} == set(files), "output_conflict")
        require(all(not is_link(output / n) and (output / n).is_file() and (output / n).read_bytes() == d
                    for n, d in files.items()), "output_conflict")
        return
    output.mkdir(parents=True)
    for name, data in files.items():
        with (output / name).open("xb") as stream:
            stream.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        config = parse_json(Path(args.config).read_bytes())
        files = convert(config)
        write_outputs(config, args.output, files)
        print(files["report.json"].decode("utf-8"))
    except (IntakeError, OSError, KeyError, TypeError, ValueError) as error:
        code = str(error) if isinstance(error, IntakeError) else type(error).__name__
        print(json.dumps({"offlineConversion": "failed", "publishReady": False, "error": code}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
