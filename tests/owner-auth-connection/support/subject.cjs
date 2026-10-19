"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const { TextDecoder } = require("node:util");

const UNIT_ROOT = path.resolve(__dirname, "../../..");
const OPEN = '(function () {\n  "use strict";\n';
const CLOSE = "  window.LuminaCreatorApprovedAuthConnection = Object.freeze({ create });\n})();\n";

function admitSource(raw, profile) {
  assert.ok(Buffer.isBuffer(raw), "physical source bytes required");
  const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  assert.notEqual(decoded.charCodeAt(0), 0xfeff, "source BOM forbidden");
  assert.ok(Buffer.from(decoded, "utf8").equals(raw), "fatal UTF-8 roundtrip");
  if (decoded.includes("\r")) {
    assert.ok(!decoded.replace(/\r\n/g, "").includes("\n"), "mixed LF/CRLF forbidden");
  }
  const canonical = decoded.replace(/\r\n/g, "\n");
  assert.ok(!canonical.includes("\r"), "bare CR forbidden");
  assert.ok(canonical.startsWith(OPEN), "whole-IIFE opening");
  assert.ok(canonical.endsWith(CLOSE), "whole-IIFE closing");
  const bytes = Buffer.from(canonical, "utf8");
  assert.equal(bytes.length, profile.bytes, "canonical whole-source bytes");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), profile.sha256, "whole-source SHA256");
  assert.equal(createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex"),
    profile.blob, "canonical framed blob");
  return canonical;
}

function loadSubject(profile) {
  assert.ok(Object.isFrozen(profile), "profile metadata must be frozen");
  assert.equal(path.isAbsolute(profile.relativeSource), false);
  const filename = path.resolve(UNIT_ROOT, profile.relativeSource);
  assert.ok(filename.startsWith(UNIT_ROOT + path.sep), "source must remain under the owned unit");
  const canonical = admitSource(fs.readFileSync(filename), profile);
  // Compile the unchanged entire IIFE outside every expected-throw assertion.
  // No parsingContext: native streams, async functions and Promise share this realm.
  const install = vm.compileFunction(canonical, ["window"], { filename });
  return Object.freeze({ profile, canonical, filename, install });
}

module.exports = Object.freeze({ admitSource, loadSubject });
