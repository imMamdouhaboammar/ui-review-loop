#!/usr/bin/env node
"use strict";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = {
  audit: path.join(ROOT, "..", "lib", "evidence-audit.mjs"),
  cli: path.join(ROOT, "..", "scripts", "evidence.mjs"),
};
const SUITE = path.join(ROOT, "evidence-audit.mjs");

const MUTATIONS = [
  { label: "evidence-severity-ignores-warnings", file: "audit", from: "const STATUS_WEIGHT = Object.freeze({ pass: 0, warn: 1, fail: 2 });", to: "const STATUS_WEIGHT = Object.freeze({ pass: 0, warn: 0, fail: 2 });", breaks: ["aggregateStatus returns highest severity"] },
  { label: "evidence-symlink-root-not-named", file: "audit", from: "  if (rootStat.isSymbolicLink()) {", to: "  if (false) {", breaks: ["symlinked evidence root is refused"], skipOnWindows: true },
  { label: "evidence-required-json-can-disappear", file: "audit", from: "    if (required) issue(checks, `required-${name}`, \"fail\", `${name} is missing`);", to: "    if (false && required) issue(checks, `required-${name}`, \"fail\", `${name} is missing`);", breaks: ["missing required JSON fails"] },
  { label: "evidence-malformed-required-json-accepted", file: "audit", from: "  catch { issue(checks, `json-${name}`, \"fail\", `${name} is not valid JSON`); return { file, value: null }; }", to: "  catch { return { file, value: null }; }", breaks: ["malformed required JSON fails"] },
  { label: "evidence-cross-file-schema-checks-disabled", file: "audit", from: "  validateSchemas(roundId, docs, checks);", to: "  // mutation: schema validation disabled", breaks: ["cross-file round id and schema mismatches fail"] },
  { label: "evidence-declared-missing-video-rejected", file: "audit", from: "  const declaredMissing = !!meta && isObject(meta.completeness) && meta.completeness.video === \"missing\";", to: "  const declaredMissing = false;", breaks: ["declared missing video permits absence"] },
  { label: "evidence-video-metadata-contradiction-hidden", file: "audit", from: "  if (declaredMissing) issue(checks, \"video-metadata-mismatch\", \"warn\", \"video.webm exists while completeness.video is missing\");", to: "  if (false) issue(checks, \"video-metadata-mismatch\", \"warn\", \"video.webm exists while completeness.video is missing\");", breaks: ["video contradicting declared missing state warns"] },
  { label: "evidence-undeclared-missing-video-accepted", file: "audit", from: "    if (!declaredMissing) issue(checks, \"video-required\", \"fail\", \"video.webm is missing while completeness.video is not missing\");", to: "    if (false) issue(checks, \"video-required\", \"fail\", \"video.webm is missing while completeness.video is not missing\");", breaks: ["undeclared missing video fails"] },
  { label: "evidence-meta-time-order-ignored", file: "audit", from: "  if (started !== null && ended !== null && ended < started) issue(checks, \"meta-time-order\", \"fail\", \"meta.json endedAt is before startedAt\");", to: "  if (false) issue(checks, \"meta-time-order\", \"fail\", \"meta.json endedAt is before startedAt\");", breaks: ["meta timestamps must be readable and ordered"] },
  { label: "evidence-meta-summary-bounds-ignored", file: "audit", from: "  if (typeof meta.summary !== \"string\" || meta.summary !== meta.summary.trim() || /[\\r\\n]/.test(meta.summary) || meta.summary.length > 160) {", to: "  if (false) {", breaks: ["meta summary must remain a bounded single line"] },
  { label: "evidence-completeness-vocabulary-ignored", file: "audit", from: "    if (!COMPLETENESS.has(meta.completeness[channel])) {", to: "    if (false) {", breaks: ["completeness channel values must be recognized"] },
  { label: "evidence-completeness-gaps-shape-ignored", file: "audit", from: "  if (!Array.isArray(meta.completeness.gaps)) issue(checks, \"completeness-gaps\", \"fail\", \"completeness.gaps must be an array\");", to: "  if (false) issue(checks, \"completeness-gaps\", \"fail\", \"completeness.gaps must be an array\");", breaks: ["completeness gaps must be an array"] },
  { label: "evidence-dom-segments-shape-ignored", file: "audit", from: "  if (!Array.isArray(dom.segments)) issue(checks, \"dom-segments\", \"fail\", \"dom.json segments must be an array\");", to: "  if (false) issue(checks, \"dom-segments\", \"fail\", \"dom.json segments must be an array\");", breaks: ["dom segments must be an array"] },
  { label: "evidence-v1-har-not-required", file: "audit", from: "  validateHar(roundDir, checks, { required });", to: "  validateHar(roundDir, checks, { required: false });", breaks: ["v1 network completeness requires HAR presence"] },
  { label: "evidence-malformed-har-accepted", file: "audit", from: "  } catch { issue(checks, \"network-har-json\", \"fail\", \"network.har is not valid JSON\"); }", to: "  } catch { }", breaks: ["present v1 HAR must be valid JSON"] },
  { label: "evidence-v2-har-accepted", file: "audit", from: "    if (!har.missing) issue(checks, \"v2-network-har\", \"fail\", har.error || \"browser-control v2 package must not contain network.har\");", to: "    if (false) issue(checks, \"v2-network-har\", \"fail\", har.error || \"browser-control v2 package must not contain network.har\");", breaks: ["v2 must not contain network HAR"] },
  { label: "evidence-v2-network-completeness-accepted", file: "audit", from: "    if (meta.completeness.network !== \"missing\") issue(checks, \"v2-network\", \"fail\", \"browser-control v2 network completeness must be missing\");", to: "    if (false) issue(checks, \"v2-network\", \"fail\", \"browser-control v2 network completeness must be missing\");", breaks: ["v2 network completeness must be missing"] },
  { label: "evidence-v2-backend-identity-ignored", file: "audit", from: "    if (!isObject(meta.versions) || meta.versions.backend !== \"browser-control\") {", to: "    if (false) {", breaks: ["v2 requires browser-control backend identity"] },
  { label: "evidence-missing-comment-image-accepted", file: "audit", from: "    if (image.missing) issue(checks, \"comment-image-required\", \"fail\", `comment ${comment.id} is missing its JPEG sidecar`);", to: "    if (false) issue(checks, \"comment-image-required\", \"fail\", `comment ${comment.id} is missing its JPEG sidecar`);", breaks: ["missing comment JPEG sidecar fails"] },
  { label: "evidence-invalid-jpeg-accepted", file: "audit", from: "      if (problem) issue(checks, \"comment-image-jpeg\", \"fail\", `${comment.id}: ${problem}`);", to: "      if (false) issue(checks, \"comment-image-jpeg\", \"fail\", `${comment.id}: ${problem}`);", breaks: ["invalid comment JPEG sidecar fails"] },
  { label: "evidence-invalid-comment-id-silenced", file: "audit", from: "      issue(checks, \"comment-id\", \"fail\", \"comment id is not canonical\");", to: "      // mutation: invalid comment id silently skipped", breaks: ["noncanonical comment id fails"] },
  { label: "evidence-resolution-key-can-be-orphaned", file: "audit", from: "    if (!COMMENT_ID_RE.test(commentId) || !commentIds.has(commentId)) issue(checks, \"resolution-comment\", \"fail\", `resolution key ${commentId} does not name a comment in this round`);", to: "    if (false) issue(checks, \"resolution-comment\", \"fail\", `resolution key ${commentId} does not name a comment in this round`);", breaks: ["resolution key must belong to a comment"] },
  { label: "evidence-resolution-target-id-ignored", file: "audit", from: "    if (typeof item.resolvedInRoundId !== \"string\" || !ROUND_ID_RE.test(item.resolvedInRoundId)) issue(checks, \"resolution-round\", \"fail\", `resolution ${commentId} has invalid resolvedInRoundId`);", to: "    if (false) issue(checks, \"resolution-round\", \"fail\", `resolution ${commentId} has invalid resolvedInRoundId`);", breaks: ["resolution target round id must be canonical"] },
  { label: "evidence-resolution-time-ignored", file: "audit", from: "    if (!validTime(item.resolvedAt)) issue(checks, \"resolution-time\", \"fail\", `resolution ${commentId} has invalid resolvedAt`);", to: "    if (false) issue(checks, \"resolution-time\", \"fail\", `resolution ${commentId} has invalid resolvedAt`);", breaks: ["resolution timestamp must be readable"] },
  { label: "evidence-transient-artifact-ignored", file: "audit", from: "    if (isTransient(entry.name)) issue(checks, \"transient-artifact\", \"fail\", `${entry.name} is a raw or transient artifact left in a finalized round`);", to: "    if (false) issue(checks, \"transient-artifact\", \"fail\", `${entry.name} is a raw or transient artifact left in a finalized round`);", breaks: ["raw and transient artifacts fail finalized packages"] },
  { label: "evidence-unknown-artifacts-silenced", file: "audit", from: "    else if (!KNOWN_TOP_LEVEL.has(entry.name)) issue(checks, \"unknown-artifact\", \"warn\", `unknown top-level artifact ${entry.name}`);", to: "    else if (false) issue(checks, \"unknown-artifact\", \"warn\", `unknown top-level artifact ${entry.name}`);", breaks: ["unknown top-level files warn"] },
  { label: "evidence-orphan-image-warning-silenced", file: "audit", from: "    if (!commentIds.has(id)) issue(checks, \"orphan-comment-image\", \"warn\", `orphan comment image ${entry.name}`);", to: "    if (false) issue(checks, \"orphan-comment-image\", \"warn\", `orphan comment image ${entry.name}`);", breaks: ["orphan JPEGs warn"] },
  { label: "evidence-round-filter-audits-everything", file: "audit", from: "  const selected = roundId ? [roundId] : available;", to: "  const selected = available;", breaks: ["round filter audits only the requested package"] },
  { label: "evidence-missing-round-filter-accepted", file: "audit", from: "  const selected = roundId ? [roundId] : available;\n  if (roundId && !available.includes(roundId)) issue(checks, \"round-filter\", \"fail\", `requested round ${roundId} does not exist`);", to: "  const selected = roundId && available.includes(roundId) ? [roundId] : available;\n  if (false) issue(checks, \"round-filter\", \"fail\", `requested round ${roundId} does not exist`);", breaks: ["missing round filter fails"] },
  { label: "evidence-human-status-not-uppercase", file: "audit", from: "    lines.push(`${round.status.toUpperCase().padEnd(5)} ${round.roundId}`);", to: "    lines.push(`${round.status.toLowerCase().padEnd(5)} ${round.roundId}`);", breaks: ["formatAudit renders summary and round status"] },
  { label: "evidence-cli-missing-project-value-accepted", file: "cli", from: "      if (!value || value.startsWith(\"--\")) return { error: \"--project requires a directory\" };", to: "      if (false) return { error: \"--project requires a directory\" };", breaks: ["evidence CLI rejects missing project value"] },
  { label: "evidence-cli-positional-error-loses-diagnosis", file: "cli", from: "    return { error: `unexpected argument ${JSON.stringify(arg)}` };", to: "    return { error: `unknown argument ${JSON.stringify(arg)}` };", breaks: ["evidence CLI rejects unexpected arguments"] },
];

const originals = new Map(Object.entries(TARGETS).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
function restore() {
  for (const [key, file] of Object.entries(TARGETS)) fs.writeFileSync(file, originals.get(key));
}
function modifiedTargets() {
  return Object.entries(TARGETS).filter(([key, file]) => fs.readFileSync(file, "utf8") !== originals.get(key)).map(([key]) => key);
}
process.on("exit", restore);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(130));

function runSuite() {
  const result = spawnSync(process.execPath, [SUITE], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const output = (result.stdout || "") + (result.stderr || "");
  const failed = [...output.matchAll(/^\s*FAIL\s+(.*)$/gm)].map((match) => match[1].trim());
  return { status: result.status, output, failed };
}

const only = process.argv[2];
const chosen = (only ? MUTATIONS.filter((mutation) => mutation.label.includes(only)) : MUTATIONS)
  .filter((mutation) => !(mutation.skipOnWindows && process.platform === "win32"));
let bad = 0;

const baseline = runSuite();
if (baseline.status !== 0 || baseline.failed.length) {
  console.error("evidence audit mutation baseline is not green");
  process.stderr.write(baseline.output);
  process.exit(1);
}
console.log("baseline: evidence audit suite green\n");

for (const mutation of chosen) {
  const file = TARGETS[mutation.file];
  const original = originals.get(mutation.file);
  const occurrences = original.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    console.log(`FAIL  ${mutation.label}: anchor matched ${occurrences} times, must match exactly once`);
    bad++;
    continue;
  }

  fs.writeFileSync(file, original.replace(mutation.from, mutation.to));
  const result = runSuite();
  const missed = mutation.breaks.filter((needle) => !result.failed.some((name) => name.includes(needle)));
  restore();

  if (modifiedTargets().length) {
    console.log(`FAIL  ${mutation.label}: restore did not reproduce the original files`);
    process.exit(1);
  }
  if (missed.length) {
    console.log(`FAIL  ${mutation.label}: survived [${missed.join(", ")}]`);
    process.stdout.write(result.output);
    bad++;
  } else {
    console.log(`ok    ${mutation.label}`);
  }
}

const leftDirty = modifiedTargets();
if (leftDirty.length) {
  console.log(`FAIL: ${leftDirty.join(", ")} left modified`);
  process.exit(1);
}
console.log(`\n${chosen.length - bad}/${chosen.length} evidence audit mutations caught`);
process.exit(bad ? 1 : 0);
