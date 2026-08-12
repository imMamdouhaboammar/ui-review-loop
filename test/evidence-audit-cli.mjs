#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../scripts/evidence.mjs";

const ROUND = "20260717T120000Z-abc123";
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
function capture() { let out = "", err = ""; return { io: { stdout: { write: (v) => { out += String(v); } }, stderr: { write: (v) => { err += String(v); } } }, read: () => ({ out, err }) }; }
function buildValid(root) {
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

const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ar-evidence-cli-empty-"));
const valid = fs.mkdtempSync(path.join(os.tmpdir(), "ar-evidence-cli-valid-"));
try {
  let c = capture();
  assert.equal(main(["audit", "--project", empty, "--json"], c.io), 0);
  let report = JSON.parse(c.read().out);
  assert.equal(report.status, "warn");
  assert.equal(report.summary.rounds, 0);

  const rd = buildValid(valid);
  c = capture();
  assert.equal(main(["audit", "--project", valid, "--round", ROUND, "--json"], c.io), 0);
  report = JSON.parse(c.read().out);
  assert.equal(report.status, "pass");
  assert.deepEqual(report.rounds.map((r) => r.roundId), [ROUND]);

  fs.rmSync(path.join(rd, "video.webm"));
  c = capture();
  assert.equal(main(["audit", "--project", valid, "--json"], c.io), 1);
  report = JSON.parse(c.read().out);
  assert.equal(report.status, "fail");
  console.log("evidence audit CLI tests: 3 passed");
} finally {
  fs.rmSync(empty, { recursive: true, force: true });
  fs.rmSync(valid, { recursive: true, force: true });
}
