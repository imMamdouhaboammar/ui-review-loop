#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditLibrary } from "../lib/evidence-audit.mjs";

if (process.platform === "win32") {
  console.log("evidence audit security: skipped symlink fixtures on Windows");
  process.exit(0);
}

const ROUND = "20260717T120000Z-abc123";
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
function buildRound(root) {
  const rd = path.join(root, ".agent-review", ROUND);
  fs.mkdirSync(path.join(rd, "comment-images"), { recursive: true });
  fs.writeFileSync(path.join(rd, "video.webm"), Buffer.alloc(8, 1));
  writeJson(path.join(rd, "meta.json"), { schemaVersion: 1, roundId: ROUND, startedAt: "2026-07-17T12:00:00.000Z", endedAt: "2026-07-17T12:01:00.000Z", summary: "fixture", versions: { skill: "1.0.0", recorder: "1", agentBrowser: "0.32.1", node: process.versions.node }, completeness: { video: "complete", dom: "complete", network: "complete", gaps: [] } });
  writeJson(path.join(rd, "dom.json"), { schemaVersion: 1, roundId: ROUND, segments: [] });
  writeJson(path.join(rd, "comments.json"), { schemaVersion: 1, roundId: ROUND, reviewState: "open", submittedAt: null, comments: [] });
  writeJson(path.join(rd, "resolutions.json"), { schemaVersion: 1, roundId: ROUND, items: {} });
  writeJson(path.join(rd, "network.har"), { log: { entries: [] } });
  return rd;
}
function withProject(fn) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "ar-evidence-symlink-")); try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); } }

withProject((root) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ar-evidence-round-outside-"));
  try {
    fs.mkdirSync(path.join(root, ".agent-review"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".agent-review", ROUND), "dir");
    const report = auditLibrary({ projectRoot: root });
    assert.equal(report.status, "fail");
    assert.match(JSON.stringify(report), /symlink/i);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});
withProject((root) => {
  const rd = buildRound(root);
  const outside = path.join(root, "outside-meta.json");
  fs.writeFileSync(outside, fs.readFileSync(path.join(rd, "meta.json")));
  fs.rmSync(path.join(rd, "meta.json"));
  fs.symlinkSync(outside, path.join(rd, "meta.json"), "file");
  const report = auditLibrary({ projectRoot: root });
  assert.equal(report.status, "fail");
  assert.match(JSON.stringify(report), /meta\.json.*symlink|symlink.*meta\.json/i);
});
console.log("evidence audit security: 2 passed");
