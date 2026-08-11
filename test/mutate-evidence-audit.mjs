#!/usr/bin/env node
"use strict";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = { audit: path.join(ROOT, "..", "lib", "evidence-audit.mjs"), cli: path.join(ROOT, "..", "scripts", "evidence.mjs") };
const SUITE = path.join(ROOT, "evidence-audit.mjs");
const M = [
  ["severity", "audit", "const STATUS_WEIGHT = Object.freeze({ pass: 0, warn: 1, fail: 2 });", "const STATUS_WEIGHT = Object.freeze({ pass: 0, warn: 0, fail: 2 });", "aggregateStatus returns highest severity"],
  ["required-json", "audit", "    if (required) issue(checks, `required-${name}`, \"fail\", `${name} is missing`);", "    if (false && required) issue(checks, `required-${name}`, \"fail\", `${name} is missing`);", "missing required JSON fails"],
  ["malformed-json", "audit", "  catch { issue(checks, `json-${name}`, \"fail\", `${name} is not valid JSON`); return { file, value: null }; }", "  catch { return { file, value: null }; }", "malformed required JSON fails"],
  ["schemas", "audit", "  validateSchemas(roundId, docs, checks);", "  // mutation: schema checks disabled", "cross-file round id and schema mismatches fail"],
  ["declared-video-missing", "audit", "  const declaredMissing = !!meta && isObject(meta.completeness) && meta.completeness.video === \"missing\";", "  const declaredMissing = false;", "declared missing video permits absence"],
  ["video-metadata-warning", "audit", "  if (declaredMissing) issue(checks, \"video-metadata-mismatch\", \"warn\", \"video.webm exists while completeness.video is missing\");", "  if (false) issue(checks, \"video-metadata-mismatch\", \"warn\", \"video.webm exists while completeness.video is missing\");", "video contradicting declared missing state warns"],
  ["video-required", "audit", "    if (!declaredMissing) issue(checks, \"video-required\", \"fail\", \"video.webm is missing while completeness.video is not missing\");", "    if (false) issue(checks, \"video-required\", \"fail\", \"video.webm is missing while completeness.video is not missing\");", "undeclared missing video fails"],
  ["time-order", "audit", "  if (started !== null && ended !== null && ended < started) issue(checks, \"meta-time-order\", \"fail\", \"meta.json endedAt is before startedAt\");", "  if (false) issue(checks, \"meta-time-order\", \"fail\", \"meta.json endedAt is before startedAt\");", "meta timestamps must be readable and ordered"],
  ["summary", "audit", "  if (typeof meta.summary !== \"string\" || meta.summary !== meta.summary.trim() || /[\\r\\n]/.test(meta.summary) || meta.summary.length > 160) {", "  if (false) {", "meta summary must remain a bounded single line"],
  ["completeness-values", "audit", "    if (!COMPLETENESS.has(meta.completeness[channel])) {", "    if (false) {", "completeness channel values must be recognized"],
  ["gaps-array", "audit", "  if (!Array.isArray(meta.completeness.gaps)) issue(checks, \"completeness-gaps\", \"fail\", \"completeness.gaps must be an array\");", "  if (false) issue(checks, \"completeness-gaps\", \"fail\", \"completeness.gaps must be an array\");", "completeness gaps must be an array"],
  ["dom-segments", "audit", "  if (!Array.isArray(dom.segments)) issue(checks, \"dom-segments\", \"fail\", \"dom.json segments must be an array\");", "  if (false) issue(checks, \"dom-segments\", \"fail\", \"dom.json segments must be an array\");", "dom segments must be an array"],
  ["v1-har-required", "audit", "  validateHar(roundDir, checks, { required });", "  validateHar(roundDir, checks, { required: false });", "v1 network completeness requires HAR presence"],
  ["har-json", "audit", "  } catch { issue(checks, \"network-har-json\", \"fail\", \"network.har is not valid JSON\"); }", "  } catch { }", "present v1 HAR must be valid JSON"],
  ["v2-no-har", "audit", "    if (!har.missing) issue(checks, \"v2-network-har\", \"fail\", har.error || \"browser-control v2 package must not contain network.har\");", "    if (false) issue(checks, \"v2-network-har\", \"fail\", har.error || \"browser-control v2 package must not contain network.har\");", "v2 must not contain network HAR"],
  ["v2-network-missing", "audit", "    if (meta.completeness.network !== \"missing\") issue(checks, \"v2-network\", \"fail\", \"browser-control v2 network completeness must be missing\");", "    if (false) issue(checks, \"v2-network\", \"fail\", \"browser-control v2 network completeness must be missing\");", "v2 network completeness must be missing"],
  ["v2-backend", "audit", "    if (!isObject(meta.versions) || meta.versions.backend !== \"browser-control\") {", "    if (false) {", "v2 requires browser-control backend identity"],
  ["comment-image-required", "audit", "    if (image.missing) issue(checks, \"comment-image-required\", \"fail\", `comment ${comment.id} is missing its JPEG sidecar`);", "    if (false) issue(checks, \"comment-image-required\", \"fail\", `comment ${comment.id} is missing its JPEG sidecar`);", "missing comment JPEG sidecar fails"],
  ["jpeg-validation", "audit", "      if (problem) issue(checks, \"comment-image-jpeg\", \"fail\", `${comment.id}: ${problem}`);", "      if (false) issue(checks, \"comment-image-jpeg\", \"fail\", `${comment.id}: ${problem}`);", "invalid comment JPEG sidecar fails"],
  ["comment-id", "audit", "      issue(checks, \"comment-id\", \"fail\", \"comment id is not canonical\");", "      // mutation: invalid id silently skipped", "noncanonical comment id fails"],
  ["resolution-comment", "audit", "    if (!COMMENT_ID_RE.test(commentId) || !commentIds.has(commentId)) issue(checks, \"resolution-comment\", \"fail\", `resolution key ${commentId} does not name a comment in this round`);", "    if (false) issue(checks, \"resolution-comment\", \"fail\", `resolution key ${commentId} does not name a comment in this round`);", "resolution key must belong to a comment"],
  ["resolution-round", "audit", "    if (typeof item.resolvedInRoundId !== \"string\" || !ROUND_ID_RE.test(item.resolvedInRoundId)) issue(checks, \"resolution-round\", \"fail\", `resolution ${commentId} has invalid resolvedInRoundId`);", "    if (false) issue(checks, \"resolution-round\", \"fail\", `resolution ${commentId} has invalid resolvedInRoundId`);", "resolution target round id must be canonical"],
  ["resolution-time", "audit", "    if (!validTime(item.resolvedAt)) issue(checks, \"resolution-time\", \"fail\", `resolution ${commentId} has invalid resolvedAt`);", "    if (false) issue(checks, \"resolution-time\", \"fail\", `resolution ${commentId} has invalid resolvedAt`);", "resolution timestamp must be readable"],
  ["transient", "audit", "    if (isTransient(entry.name)) issue(checks, \"transient-artifact\", \"fail\", `${entry.name} is a raw or transient artifact left in a finalized round`);", "    if (false) issue(checks, \"transient-artifact\", \"fail\", `${entry.name} is a raw or transient artifact left in a finalized round`);", "raw and transient artifacts fail finalized packages"],
  ["unknown-warning", "audit", "    else if (!KNOWN_TOP_LEVEL.has(entry.name)) issue(checks, \"unknown-artifact\", \"warn\", `unknown top-level artifact ${entry.name}`);", "    else if (false) issue(checks, \"unknown-artifact\", \"warn\", `unknown top-level artifact ${entry.name}`);", "unknown top-level files warn"],
  ["orphan-image", "audit", "    if (!commentIds.has(id)) issue(checks, \"orphan-comment-image\", \"warn\", `orphan comment image ${entry.name}`);", "    if (false) issue(checks, \"orphan-comment-image\", \"warn\", `orphan comment image ${entry.name}`);", "orphan JPEGs warn"],
  ["round-filter", "audit", "  const selected = roundId ? [roundId] : available;", "  const selected = available;", "round filter audits only the requested package"],
  ["human-format", "audit", "    lines.push(`${round.status.toUpperCase().padEnd(5)} ${round.roundId}`);", "    lines.push(`${round.status.toLowerCase().padEnd(5)} ${round.roundId}`);", "formatAudit renders summary and round status"],
  ["cli-project-value", "cli", "      if (!value || value.startsWith(\"--\")) return { error: \"--project requires a directory\" };", "      if (false) return { error: \"--project requires a directory\" };", "evidence CLI rejects missing project value"],
  ["cli-unexpected", "cli", "    return { error: `unexpected argument ${JSON.stringify(arg)}` };", "    return { error: `unknown argument ${JSON.stringify(arg)}` };", "evidence CLI rejects unexpected arguments"],
];

const originals = new Map(Object.entries(TARGETS).map(([k, f]) => [k, fs.readFileSync(f, "utf8")]));
function restore() { for (const [k, f] of Object.entries(TARGETS)) fs.writeFileSync(f, originals.get(k)); }
process.on("exit", restore);
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => process.exit(130));
function runSuite() { const r = spawnSync(process.execPath, [SUITE], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }); const output = (r.stdout || "") + (r.stderr || ""); const failedNames = [...output.matchAll(/^\s*FAIL\s+(.*)$/gm)].map((m) => m[1].trim()); return { status: r.status, output, failedNames }; }

const baseline = runSuite();
if (baseline.status !== 0) { console.error("mutation baseline is not green"); process.stdout.write(baseline.output); process.exit(1); }
let caught = 0;
for (const [label, key, from, to, expected] of M) {
  const original = originals.get(key);
  const count = original.split(from).length - 1;
  if (count !== 1) { console.log(`FAIL ${label}: anchor matched ${count} times`); continue; }
  fs.writeFileSync(TARGETS[key], original.replace(from, to));
  const result = runSuite();
  restore();
  if (result.failedNames.some((name) => name.includes(expected))) { console.log(`ok ${label}`); caught++; }
  else { console.log(`FAIL ${label}: target survived`); process.stdout.write(result.output); }
}
console.log(`${caught}/${M.length} evidence audit mutations caught`);
process.exit(caught === M.length ? 0 : 1);
