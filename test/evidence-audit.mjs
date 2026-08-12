#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditLibrary, formatAudit, aggregateStatus } from "../lib/evidence-audit.mjs";
import { main as evidenceMain } from "../scripts/evidence.mjs";

const ROUND1 = "20260717T120000Z-abc123";
const ROUND2 = "20260717T130000Z-def456";
const COMMENT = "c-4b463025-4f01-4428-a513-d903b661ff12";
let passed = 0;

function check(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (error) { console.error(`  FAIL ${name}`); throw error; }
}

function tmpProject() { return fs.mkdtempSync(path.join(os.tmpdir(), "ar-evidence-audit-")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function captureIo() {
  let stdout = "", stderr = "";
  return {
    io: { stdout: { write: (v) => { stdout += String(v); } }, stderr: { write: (v) => { stderr += String(v); } } },
    read: () => ({ stdout, stderr }),
  };
}

function buildRound(root, id = ROUND1, { backend = "agent-browser", comment = false } = {}) {
  const rd = path.join(root, ".agent-review", id);
  fs.mkdirSync(path.join(rd, "comment-images"), { recursive: true });
  fs.writeFileSync(path.join(rd, "video.webm"), Buffer.alloc(16, 7));
  const browserControl = backend === "browser-control";
  writeJson(path.join(rd, "meta.json"), {
    schemaVersion: browserControl ? 2 : 1,
    roundId: id,
    startedAt: "2026-07-17T12:00:00.000Z",
    endedAt: "2026-07-17T12:01:00.000Z",
    summary: "fixture",
    startUrl: "https://example.test/",
    git: null,
    viewport: { width: 1280, height: 720, dpr: 1 },
    versions: browserControl
      ? { skill: "1.0.0", recorder: "1", node: process.versions.node, backend: "browser-control", cli: "0.4.1", relayBuild: "b1", extensionVersion: "0.4.1", recordingMode: "cdp", ffmpeg: true }
      : { skill: "1.0.0", recorder: "1", agentBrowser: "0.32.1", node: process.versions.node },
    sync: browserControl
      ? { confidence: "low", method: "unavailable", clockSkewMs: null, calibration: null, anchors: [] }
      : { confidence: "medium", method: "calibrated-wall", clockSkewMs: 0, calibration: null, anchors: [] },
    completeness: { video: "complete", dom: "complete", network: browserControl ? "missing" : "complete", gaps: [] },
  });
  writeJson(path.join(rd, "dom.json"), { schemaVersion: 1, roundId: id, segments: [] });
  writeJson(path.join(rd, "comments.json"), {
    schemaVersion: 1, roundId: id, reviewState: "open", submittedAt: null,
    comments: comment ? [{ id: COMMENT, videoTimeMs: 100, text: "fix this", createdAt: "2026-07-17T12:02:00.000Z" }] : [],
  });
  writeJson(path.join(rd, "resolutions.json"), { schemaVersion: 1, roundId: id, items: {} });
  if (!browserControl) writeJson(path.join(rd, "network.har"), { log: { version: "1.2", entries: [] } });
  if (comment) fs.writeFileSync(path.join(rd, "comment-images", `${COMMENT}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return rd;
}

function withProject(fn) {
  const root = tmpProject();
  try { return fn(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function readMeta(rd) { return JSON.parse(fs.readFileSync(path.join(rd, "meta.json"), "utf8")); }
function readComments(rd) { return JSON.parse(fs.readFileSync(path.join(rd, "comments.json"), "utf8")); }
function writeResolutions(rd, items) { writeJson(path.join(rd, "resolutions.json"), { schemaVersion: 1, roundId: ROUND1, items }); }

check("aggregateStatus returns highest severity", () => {
  assert.equal(aggregateStatus([{ status: "pass" }, { status: "warn" }]), "warn");
  assert.equal(aggregateStatus([{ status: "warn" }, { status: "fail" }]), "fail");
});

check("absent evidence library is a read-only warning", () => withProject((root) => {
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "warn");
  assert.equal(report.summary.rounds, 0);
  assert.equal(fs.existsSync(path.join(root, ".agent-review")), false);
}));

check("valid v1 package passes", () => withProject((root) => {
  buildRound(root);
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "pass");
  assert.equal(report.rounds[0].status, "pass");
}));

check("valid browser-control v2 package passes without HAR", () => withProject((root) => {
  buildRound(root, ROUND1, { backend: "browser-control" });
  assert.equal(auditLibrary({ projectRoot: root }).status, "pass");
}));

check("declared missing video permits absence", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { backend: "browser-control" });
  const meta = readMeta(rd);
  meta.completeness.video = "missing";
  writeJson(path.join(rd, "meta.json"), meta);
  fs.rmSync(path.join(rd, "video.webm"));
  assert.notEqual(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("video contradicting declared missing state warns", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { backend: "browser-control" });
  const meta = readMeta(rd);
  meta.completeness.video = "missing";
  writeJson(path.join(rd, "meta.json"), meta);
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "warn");
  assert.match(JSON.stringify(report), /video.*missing|missing.*video/i);
}));

check("undeclared missing video fails", () => withProject((root) => {
  const rd = buildRound(root);
  fs.rmSync(path.join(rd, "video.webm"));
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /video\.webm/);
}));

check("meta timestamps must be readable and ordered", () => withProject((root) => {
  const rd = buildRound(root);
  const meta = readMeta(rd);
  meta.endedAt = "2026-07-17T11:59:00.000Z";
  writeJson(path.join(rd, "meta.json"), meta);
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("meta summary must remain a bounded single line", () => withProject((root) => {
  const rd = buildRound(root);
  const meta = readMeta(rd);
  meta.summary = "line one\nline two";
  writeJson(path.join(rd, "meta.json"), meta);
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("completeness channel values must be recognized", () => withProject((root) => {
  const rd = buildRound(root);
  const meta = readMeta(rd);
  meta.completeness.dom = "unknown";
  writeJson(path.join(rd, "meta.json"), meta);
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("completeness gaps must be an array", () => withProject((root) => {
  const rd = buildRound(root);
  const meta = readMeta(rd);
  meta.completeness.gaps = {};
  writeJson(path.join(rd, "meta.json"), meta);
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /gaps/);
}));

check("dom segments must be an array", () => withProject((root) => {
  const rd = buildRound(root);
  writeJson(path.join(rd, "dom.json"), { schemaVersion: 1, roundId: ROUND1, segments: {} });
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /segments/);
}));

check("symlinked evidence root is refused", () => {
  if (process.platform === "win32") return;
  withProject((root) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ar-evidence-outside-"));
    try {
      fs.symlinkSync(outside, path.join(root, ".agent-review"), "dir");
      const report = auditLibrary({ projectRoot: root });
      assert.equal(report.status, "fail");
      assert.match(report.checks[0].message, /symlink/i);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
});

check("missing required JSON fails", () => withProject((root) => {
  const rd = buildRound(root);
  fs.rmSync(path.join(rd, "dom.json"));
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /dom\.json/);
}));

check("malformed required JSON fails", () => withProject((root) => {
  const rd = buildRound(root);
  fs.writeFileSync(path.join(rd, "comments.json"), "{broken");
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /comments\.json/);
}));

check("cross-file round id and schema mismatches fail", () => withProject((root) => {
  const rd = buildRound(root);
  writeJson(path.join(rd, "dom.json"), { schemaVersion: 2, roundId: ROUND2, segments: [] });
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /roundId|schema/i);
}));

check("v1 network completeness requires HAR presence", () => withProject((root) => {
  const rd = buildRound(root);
  fs.rmSync(path.join(rd, "network.har"));
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /network\.har/);
}));

check("present v1 HAR must be valid JSON", () => withProject((root) => {
  const rd = buildRound(root);
  fs.writeFileSync(path.join(rd, "network.har"), "not json");
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("v2 must not contain network HAR", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { backend: "browser-control" });
  writeJson(path.join(rd, "network.har"), { log: { entries: [] } });
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("v2 network completeness must be missing", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { backend: "browser-control" });
  const meta = readMeta(rd);
  meta.completeness.network = "complete";
  writeJson(path.join(rd, "meta.json"), meta);
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("v2 requires browser-control backend identity", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { backend: "browser-control" });
  const meta = readMeta(rd);
  meta.versions.backend = "agent-browser";
  writeJson(path.join(rd, "meta.json"), meta);
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /browser-control backend/);
}));

check("missing comment JPEG sidecar fails", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { comment: true });
  fs.rmSync(path.join(rd, "comment-images", `${COMMENT}.jpg`));
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("invalid comment JPEG sidecar fails", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { comment: true });
  fs.writeFileSync(path.join(rd, "comment-images", `${COMMENT}.jpg`), Buffer.from("not-jpeg"));
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("noncanonical comment id fails", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { comment: true });
  const comments = readComments(rd);
  comments.comments[0].id = "bad-id";
  writeJson(path.join(rd, "comments.json"), comments);
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("resolution key must belong to a comment", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { comment: true });
  writeResolutions(rd, { "c-00000000-0000-0000-0000-000000000000": { resolvedInRoundId: ROUND2, resolvedAt: "2026-07-17T14:00:00.000Z" } });
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("resolution target round id must be canonical", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { comment: true });
  writeResolutions(rd, { [COMMENT]: { resolvedInRoundId: "bad", resolvedAt: "2026-07-17T14:00:00.000Z" } });
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("resolution timestamp must be readable", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { comment: true });
  writeResolutions(rd, { [COMMENT]: { resolvedInRoundId: ROUND2, resolvedAt: "not-a-date" } });
  assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
}));

check("raw and transient artifacts fail finalized packages", () => withProject((root) => {
  const rd = buildRound(root);
  for (const name of ["network.raw.har", "video.webm.json", "frames-s-0001.jsonl"]) {
    fs.writeFileSync(path.join(rd, name), "leftover");
    assert.equal(auditLibrary({ projectRoot: root }).status, "fail");
    fs.rmSync(path.join(rd, name));
  }
}));

check("unknown top-level files warn", () => withProject((root) => {
  const rd = buildRound(root);
  fs.writeFileSync(path.join(rd, "future-artifact.bin"), "future");
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "warn");
  assert.match(JSON.stringify(report), /future-artifact\.bin/);
}));

check("orphan JPEGs warn", () => withProject((root) => {
  const rd = buildRound(root);
  fs.writeFileSync(path.join(rd, "comment-images", "c-00000000-0000-0000-0000-000000000000.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "warn");
  assert.match(JSON.stringify(report), /orphan comment image/);
}));

check("round filter audits only the requested package", () => withProject((root) => {
  buildRound(root, ROUND1);
  buildRound(root, ROUND2, { backend: "browser-control" });
  const report = auditLibrary({ projectRoot: root, roundId: ROUND2 });
  assert.equal(report.rounds.length, 1);
  assert.equal(report.rounds[0].roundId, ROUND2);
}));

check("missing round filter fails", () => withProject((root) => {
  buildRound(root, ROUND1);
  assert.equal(auditLibrary({ projectRoot: root, roundId: "20260717T140000Z-aaaaaa" }).status, "fail");
}));

check("formatAudit renders summary and round status", () => withProject((root) => {
  buildRound(root);
  const text = formatAudit(auditLibrary({ projectRoot: root }));
  assert.match(text, /^UI Review Loop evidence audit/m);
  assert.match(text, /PASS\s+20260717T120000Z-abc123/);
  assert.match(text, /status: pass/);
}));

check("evidence CLI rejects missing project value", () => {
  const capture = captureIo();
  assert.equal(evidenceMain(["audit", "--project"], capture.io), 2);
  assert.match(capture.read().stderr, /--project requires/);
});

check("evidence CLI rejects unexpected arguments", () => {
  const capture = captureIo();
  assert.equal(evidenceMain(["audit", "wat"], capture.io), 2);
  assert.match(capture.read().stderr, /unexpected argument/);
});

console.log(`evidence audit tests: ${passed} passed`);
