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
    sync: { confidence: browserControl ? "low" : "medium", method: browserControl ? "unavailable" : "calibrated-wall", anchors: [] },
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
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "pass");
}));

check("declared missing video permits absence but warns on contradictory artifact", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { backend: "browser-control" });
  const meta = JSON.parse(fs.readFileSync(path.join(rd, "meta.json"), "utf8"));
  meta.completeness.video = "missing";
  writeJson(path.join(rd, "meta.json"), meta);
  fs.rmSync(path.join(rd, "video.webm"));
  let report = auditLibrary({ projectRoot: root });
  assert.notEqual(report.status, "fail");
  fs.writeFileSync(path.join(rd, "video.webm"), Buffer.alloc(16, 7));
  report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "warn");
  assert.match(JSON.stringify(report), /video.*missing|missing.*video/i);
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

check("missing or malformed required JSON fails", () => withProject((root) => {
  const rd = buildRound(root);
  fs.rmSync(path.join(rd, "dom.json"));
  let report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /dom\.json/);
  writeJson(path.join(rd, "dom.json"), { schemaVersion: 1, roundId: ROUND1, segments: [] });
  fs.writeFileSync(path.join(rd, "comments.json"), "{broken");
  report = auditLibrary({ projectRoot: root });
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

check("v1 network completeness requires a valid HAR", () => withProject((root) => {
  const rd = buildRound(root);
  fs.rmSync(path.join(rd, "network.har"));
  let report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /network\.har/);
  fs.writeFileSync(path.join(rd, "network.har"), "not json");
  report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
}));

check("v2 enforces browser-control network contract", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { backend: "browser-control" });
  writeJson(path.join(rd, "network.har"), { log: { entries: [] } });
  let report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  fs.rmSync(path.join(rd, "network.har"));
  const meta = JSON.parse(fs.readFileSync(path.join(rd, "meta.json"), "utf8"));
  meta.completeness.network = "complete";
  writeJson(path.join(rd, "meta.json"), meta);
  report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
}));

check("comments require canonical ids and JPEG sidecars", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { comment: true });
  fs.rmSync(path.join(rd, "comment-images", `${COMMENT}.jpg`));
  let report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  fs.writeFileSync(path.join(rd, "comment-images", `${COMMENT}.jpg`), Buffer.from("not-jpeg"));
  report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  const comments = JSON.parse(fs.readFileSync(path.join(rd, "comments.json"), "utf8"));
  comments.comments[0].id = "bad-id";
  writeJson(path.join(rd, "comments.json"), comments);
  report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
}));

check("resolution keys must belong to comments and carry valid fields", () => withProject((root) => {
  const rd = buildRound(root, ROUND1, { comment: true });
  writeJson(path.join(rd, "resolutions.json"), {
    schemaVersion: 1, roundId: ROUND1,
    items: { "c-00000000-0000-0000-0000-000000000000": { resolvedInRoundId: ROUND2, resolvedAt: "2026-07-17T14:00:00.000Z" } },
  });
  let report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  writeJson(path.join(rd, "resolutions.json"), {
    schemaVersion: 1, roundId: ROUND1,
    items: { [COMMENT]: { resolvedInRoundId: "bad", resolvedAt: "not-a-date" } },
  });
  report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
}));

check("raw and transient artifacts fail finalized packages", () => withProject((root) => {
  const rd = buildRound(root);
  for (const name of ["network.raw.har", "video.webm.json", "frames-s-0001.jsonl"]) {
    fs.writeFileSync(path.join(rd, name), "leftover");
    const report = auditLibrary({ projectRoot: root });
    assert.equal(report.status, "fail");
    fs.rmSync(path.join(rd, name));
  }
}));

check("unknown files and orphan JPEGs warn without hiding valid evidence", () => withProject((root) => {
  const rd = buildRound(root);
  fs.writeFileSync(path.join(rd, "future-artifact.bin"), "future");
  fs.writeFileSync(path.join(rd, "comment-images", "c-00000000-0000-0000-0000-000000000000.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "warn");
  assert.equal(report.rounds[0].status, "warn");
}));

check("round filter audits only the requested package", () => withProject((root) => {
  buildRound(root, ROUND1);
  buildRound(root, ROUND2, { backend: "browser-control" });
  const report = auditLibrary({ projectRoot: root, roundId: ROUND2 });
  assert.equal(report.rounds.length, 1);
  assert.equal(report.rounds[0].roundId, ROUND2);
  const missing = auditLibrary({ projectRoot: root, roundId: "20260717T140000Z-aaaaaa" });
  assert.equal(missing.status, "fail");
}));

check("formatAudit renders summary and round status", () => withProject((root) => {
  buildRound(root);
  const text = formatAudit(auditLibrary({ projectRoot: root }));
  assert.match(text, /^UI Review Loop evidence audit/m);
  assert.match(text, /PASS\s+20260717T120000Z-abc123/);
  assert.match(text, /status: pass/);
}));

check("evidence CLI rejects missing flag values and unexpected arguments", () => {
  let capture = captureIo();
  assert.equal(evidenceMain(["audit", "--project"], capture.io), 2);
  assert.match(capture.read().stderr, /--project requires/);
  capture = captureIo();
  assert.equal(evidenceMain(["audit", "wat"], capture.io), 2);
  assert.match(capture.read().stderr, /unexpected argument/);
});

console.log(`evidence audit tests: ${passed} passed`);
