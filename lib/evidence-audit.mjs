"use strict";

import fs from "node:fs";
import path from "node:path";

const ROUND_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;
const COMMENT_ID_RE = /^c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUS_WEIGHT = Object.freeze({ pass: 0, warn: 1, fail: 2 });
const COMPLETENESS = new Set(["complete", "partial", "missing"]);
const REQUIRED_JSON = ["meta.json", "dom.json", "comments.json", "resolutions.json"];
const KNOWN_TOP_LEVEL = new Set([...REQUIRED_JSON, "video.webm", "network.har", "comment-images"]);
const TRANSIENT_EXACT = new Set(["network.raw.har", "video.webm.json"]);

function aggregateStatus(checks) {
  let status = "pass";
  for (const check of checks || []) {
    const candidate = check && check.status;
    if ((STATUS_WEIGHT[candidate] ?? 2) > STATUS_WEIGHT[status]) status = candidate;
  }
  return status;
}

function issue(checks, id, status, message) { checks.push({ id, status, message }); }
function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function validTime(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isTransient(name) { return TRANSIENT_EXACT.has(name) || /^frames-.*\.jsonl$/.test(name); }

function lstatOrNull(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error && error.code === "ENOENT") return null; throw error; }
}

function resolveProject(projectRoot) {
  try {
    const real = fs.realpathSync(projectRoot);
    return fs.statSync(real).isDirectory() ? { real } : { error: "project path is not a directory" };
  } catch (error) {
    return { error: `project path is unavailable${error && error.code ? ` (${error.code})` : ""}` };
  }
}

function safeDirectory(parent, name) {
  const file = path.join(parent, name);
  const stat = lstatOrNull(file);
  if (!stat) return { missing: true };
  if (stat.isSymbolicLink()) return { error: `${name} is a symlink` };
  if (!stat.isDirectory()) return { error: `${name} is not a directory` };
  try {
    const real = fs.realpathSync(file);
    if (real !== file && !real.startsWith(parent + path.sep)) return { error: `${name} resolves outside its parent` };
    if (!real.startsWith(parent + path.sep) && real !== file) return { error: `${name} resolves outside its parent` };
    return { real };
  } catch { return { error: `${name} cannot be resolved` }; }
}

function safeFile(parent, name) {
  const file = path.join(parent, name);
  const stat = lstatOrNull(file);
  if (!stat) return { missing: true };
  if (stat.isSymbolicLink()) return { error: `${name} is a symlink` };
  if (!stat.isFile()) return { error: `${name} is not a regular file` };
  try {
    const real = fs.realpathSync(file);
    if (!real.startsWith(parent + path.sep)) return { error: `${name} resolves outside its round` };
    return { real, size: stat.size };
  } catch { return { error: `${name} cannot be resolved` }; }
}

function readJsonArtifact(roundDir, name, checks, { required = true } = {}) {
  const file = safeFile(roundDir, name);
  if (file.missing) {
    if (required) issue(checks, `required-${name}`, "fail", `${name} is missing`);
    return { file: null, value: null };
  }
  if (file.error) {
    issue(checks, `safe-${name}`, "fail", file.error);
    return { file: null, value: null };
  }
  try { return { file, value: JSON.parse(fs.readFileSync(file.real, "utf8")) }; }
  catch { issue(checks, `json-${name}`, "fail", `${name} is not valid JSON`); return { file, value: null }; }
}

function validateHar(roundDir, checks, { required }) {
  const har = safeFile(roundDir, "network.har");
  if (har.missing) {
    if (required) issue(checks, "network-har-required", "fail", "network.har is required by network completeness");
    return;
  }
  if (har.error) { issue(checks, "network-har-safe", "fail", har.error); return; }
  try {
    const value = JSON.parse(fs.readFileSync(har.real, "utf8"));
    if (!isObject(value) || !isObject(value.log) || !Array.isArray(value.log.entries)) {
      issue(checks, "network-har-shape", "fail", "network.har does not have a HAR log.entries array");
    }
  } catch { issue(checks, "network-har-json", "fail", "network.har is not valid JSON"); }
}

function validateSchemas(roundId, docs, checks) {
  const meta = docs.meta;
  if (meta) {
    if (meta.schemaVersion !== 1 && meta.schemaVersion !== 2) issue(checks, "meta-schema", "fail", "meta.json schemaVersion must be 1 or 2");
    if (meta.roundId !== roundId) issue(checks, "meta-round-id", "fail", "meta.json roundId does not match the directory name");
  }
  for (const [key, label] of [["dom", "dom.json"], ["comments", "comments.json"], ["resolutions", "resolutions.json"]]) {
    const value = docs[key];
    if (!value) continue;
    if (value.schemaVersion !== 1) issue(checks, `${key}-schema`, "fail", `${label} schemaVersion must be 1`);
    if (value.roundId !== roundId) issue(checks, `${key}-round-id`, "fail", `${label} roundId does not match the directory name`);
  }
}

function validateMetaBasics(meta, checks) {
  if (!meta) return;
  const started = validTime(meta.startedAt) ? Date.parse(meta.startedAt) : null;
  const ended = validTime(meta.endedAt) ? Date.parse(meta.endedAt) : null;
  if (started === null) issue(checks, "meta-started-at", "fail", "meta.json startedAt is not a readable timestamp");
  if (ended === null) issue(checks, "meta-ended-at", "fail", "meta.json endedAt is not a readable timestamp");
  if (started !== null && ended !== null && ended < started) issue(checks, "meta-time-order", "fail", "meta.json endedAt is before startedAt");
  if (typeof meta.summary !== "string" || meta.summary !== meta.summary.trim() || /[\r\n]/.test(meta.summary) || meta.summary.length > 160) {
    issue(checks, "meta-summary", "fail", "meta.json summary must be a trimmed single line of at most 160 characters");
  }
}

function validateCompleteness(meta, checks) {
  if (!meta) return;
  if (!isObject(meta.completeness)) { issue(checks, "completeness", "fail", "meta.json completeness object is missing"); return; }
  for (const channel of ["video", "dom", "network"]) {
    if (!COMPLETENESS.has(meta.completeness[channel])) {
      issue(checks, `completeness-${channel}`, "fail", `completeness.${channel} must be complete, partial, or missing`);
    }
  }
  if (!Array.isArray(meta.completeness.gaps)) issue(checks, "completeness-gaps", "fail", "completeness.gaps must be an array");
}

function validateDom(dom, checks) {
  if (!dom) return;
  if (!Array.isArray(dom.segments)) issue(checks, "dom-segments", "fail", "dom.json segments must be an array");
}

function validateVideo(roundDir, meta, checks) {
  const declaredMissing = !!meta && isObject(meta.completeness) && meta.completeness.video === "missing";
  const video = safeFile(roundDir, "video.webm");
  if (video.missing) {
    if (!declaredMissing) issue(checks, "video-required", "fail", "video.webm is missing while completeness.video is not missing");
    return;
  }
  if (video.error) return issue(checks, "video-safe", "fail", video.error);
  if (declaredMissing) issue(checks, "video-metadata-mismatch", "warn", "video.webm exists while completeness.video is missing");
  if (video.size <= 0) issue(checks, "video-empty", "fail", "video.webm is empty");
}

function validateNetwork(roundDir, meta, checks) {
  if (!meta || !isObject(meta.completeness)) return;
  if (meta.schemaVersion === 2) {
    if (!isObject(meta.versions) || meta.versions.backend !== "browser-control") {
      issue(checks, "v2-backend", "fail", "v2 meta.json must identify the browser-control backend");
    }
    if (meta.completeness.network !== "missing") issue(checks, "v2-network", "fail", "browser-control v2 network completeness must be missing");
    const har = safeFile(roundDir, "network.har");
    if (!har.missing) issue(checks, "v2-network-har", "fail", har.error || "browser-control v2 package must not contain network.har");
    return;
  }
  const required = meta.completeness.network !== "missing";
  validateHar(roundDir, checks, { required });
  if (!required) {
    const har = safeFile(roundDir, "network.har");
    if (!har.missing && !har.error) issue(checks, "network-metadata-mismatch", "warn", "network.har exists while completeness.network is missing");
  }
}

function jpegProblem(file) {
  if (file.size < 4) return "JPEG sidecar is empty or truncated";
  const fd = fs.openSync(file.real, "r");
  try {
    const first = Buffer.alloc(3), last = Buffer.alloc(2);
    fs.readSync(fd, first, 0, 3, 0);
    fs.readSync(fd, last, 0, 2, file.size - 2);
    if (first[0] !== 0xff || first[1] !== 0xd8 || first[2] !== 0xff || last[0] !== 0xff || last[1] !== 0xd9) return "comment image is not a JPEG";
    return null;
  } finally { fs.closeSync(fd); }
}

function validateComments(roundDir, comments, checks) {
  const images = safeDirectory(roundDir, "comment-images");
  if (images.missing) issue(checks, "comment-images-required", "fail", "comment-images directory is missing");
  else if (images.error) issue(checks, "comment-images-safe", "fail", images.error);

  if (!comments) return { ids: new Set(), imageDir: images.real || null };
  if (comments.reviewState !== "open" && comments.reviewState !== "submitted") issue(checks, "review-state", "fail", "comments.json reviewState must be open or submitted");
  if (!Array.isArray(comments.comments)) { issue(checks, "comments-array", "fail", "comments.json comments must be an array"); return { ids: new Set(), imageDir: images.real || null }; }
  if (comments.reviewState === "submitted" && !validTime(comments.submittedAt)) issue(checks, "submitted-at", "fail", "submitted review must carry a readable submittedAt timestamp");
  if (comments.reviewState === "open" && comments.submittedAt != null) issue(checks, "open-submitted-at", "fail", "open review must not carry submittedAt");

  const ids = new Set();
  for (const comment of comments.comments) {
    if (!isObject(comment) || typeof comment.id !== "string" || !COMMENT_ID_RE.test(comment.id)) {
      issue(checks, "comment-id", "fail", "comment id is not canonical");
      continue;
    }
    if (ids.has(comment.id)) issue(checks, "comment-id-duplicate", "fail", `duplicate comment id ${comment.id}`);
    ids.add(comment.id);
    if (!Number.isFinite(comment.videoTimeMs) || comment.videoTimeMs < 0) issue(checks, "comment-time", "fail", `comment ${comment.id} has invalid videoTimeMs`);
    if (typeof comment.text !== "string" || !comment.text.trim()) issue(checks, "comment-text", "fail", `comment ${comment.id} has empty text`);
    if (!validTime(comment.createdAt)) issue(checks, "comment-created-at", "fail", `comment ${comment.id} has invalid createdAt`);
    if (!images.real) continue;
    const image = safeFile(images.real, `${comment.id}.jpg`);
    if (image.missing) issue(checks, "comment-image-required", "fail", `comment ${comment.id} is missing its JPEG sidecar`);
    else if (image.error) issue(checks, "comment-image-safe", "fail", image.error);
    else {
      const problem = jpegProblem(image);
      if (problem) issue(checks, "comment-image-jpeg", "fail", `${comment.id}: ${problem}`);
    }
  }
  return { ids, imageDir: images.real || null };
}

function validateResolutions(roundId, resolutions, commentIds, checks) {
  if (!resolutions) return;
  if (!isObject(resolutions.items)) { issue(checks, "resolution-items", "fail", "resolutions.json items must be an object"); return; }
  for (const [commentId, item] of Object.entries(resolutions.items)) {
    if (!COMMENT_ID_RE.test(commentId) || !commentIds.has(commentId)) issue(checks, "resolution-comment", "fail", `resolution key ${commentId} does not name a comment in this round`);
    if (!isObject(item)) { issue(checks, "resolution-shape", "fail", `resolution ${commentId} is not an object`); continue; }
    if (typeof item.resolvedInRoundId !== "string" || !ROUND_ID_RE.test(item.resolvedInRoundId)) issue(checks, "resolution-round", "fail", `resolution ${commentId} has invalid resolvedInRoundId`);
    else if (item.resolvedInRoundId === roundId) issue(checks, "resolution-self", "fail", `resolution ${commentId} points to its own feedback round`);
    if (!validTime(item.resolvedAt)) issue(checks, "resolution-time", "fail", `resolution ${commentId} has invalid resolvedAt`);
  }
}

function validateDirectoryEntries(roundDir, commentIds, imageDir, checks) {
  let entries;
  try { entries = fs.readdirSync(roundDir, { withFileTypes: true }); }
  catch { issue(checks, "round-list", "fail", "round directory cannot be listed"); return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) issue(checks, "round-symlink", "fail", `${entry.name} is a symlink inside a finalized round`);
    if (isTransient(entry.name)) issue(checks, "transient-artifact", "fail", `${entry.name} is a raw or transient artifact left in a finalized round`);
    else if (!KNOWN_TOP_LEVEL.has(entry.name)) issue(checks, "unknown-artifact", "warn", `unknown top-level artifact ${entry.name}`);
  }
  if (!imageDir) return;
  let images;
  try { images = fs.readdirSync(imageDir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of images) {
    if (entry.isSymbolicLink()) { issue(checks, "comment-image-symlink", "fail", `${entry.name} is a symlink in comment-images`); continue; }
    if (!entry.isFile()) { issue(checks, "comment-image-entry", "warn", `${entry.name} is not a JPEG file`); continue; }
    if (!entry.name.endsWith(".jpg")) { issue(checks, "comment-image-entry", "warn", `unknown comment image artifact ${entry.name}`); continue; }
    const id = entry.name.slice(0, -4);
    if (!commentIds.has(id)) issue(checks, "orphan-comment-image", "warn", `orphan comment image ${entry.name}`);
  }
}

function auditRound(base, roundId) {
  const checks = [];
  const dir = safeDirectory(base, roundId);
  if (dir.missing) return { roundId, status: "fail", checks: [{ id: "round-missing", status: "fail", message: `round ${roundId} does not exist` }] };
  if (dir.error) return { roundId, status: "fail", checks: [{ id: "round-safe", status: "fail", message: dir.error }] };

  const docs = {};
  for (const name of REQUIRED_JSON) {
    const read = readJsonArtifact(dir.real, name, checks);
    docs[name.replace(".json", "")] = read.value;
  }
  validateSchemas(roundId, docs, checks);
  validateMetaBasics(docs.meta, checks);
  validateCompleteness(docs.meta, checks);
  validateDom(docs.dom, checks);
  validateVideo(dir.real, docs.meta, checks);
  validateNetwork(dir.real, docs.meta, checks);
  const commentInfo = validateComments(dir.real, docs.comments, checks);
  validateResolutions(roundId, docs.resolutions, commentInfo.ids, checks);
  validateDirectoryEntries(dir.real, commentInfo.ids, commentInfo.imageDir, checks);
  if (!checks.length) issue(checks, "package", "pass", "package matches the structural contract");
  return { roundId, status: aggregateStatus(checks), checks };
}

function summarize(rounds) {
  const summary = { rounds: rounds.length, passed: 0, warned: 0, failed: 0 };
  for (const round of rounds) {
    if (round.status === "fail") summary.failed++;
    else if (round.status === "warn") summary.warned++;
    else summary.passed++;
  }
  return summary;
}

function auditLibrary({ projectRoot = process.cwd(), roundId = null } = {}) {
  const checks = [];
  const project = resolveProject(projectRoot);
  if (project.error) {
    issue(checks, "project", "fail", project.error);
    return { status: "fail", project: path.resolve(projectRoot), summary: summarize([]), checks, rounds: [] };
  }
  if (roundId != null && (typeof roundId !== "string" || !ROUND_ID_RE.test(roundId))) {
    issue(checks, "round-filter", "fail", "round filter is not a canonical round id");
    return { status: "fail", project: project.real, summary: summarize([]), checks, rounds: [] };
  }

  const arLexical = path.join(project.real, ".agent-review");
  const rootStat = lstatOrNull(arLexical);
  if (!rootStat) {
    issue(checks, "library", "warn", ".agent-review does not exist; nothing to audit");
    return { status: "warn", project: project.real, summary: summarize([]), checks, rounds: [] };
  }
  if (rootStat.isSymbolicLink()) {
    issue(checks, "library", "fail", ".agent-review is a symlink; refusing to audit through it");
    return { status: "fail", project: project.real, summary: summarize([]), checks, rounds: [] };
  }
  if (!rootStat.isDirectory()) {
    issue(checks, "library", "fail", ".agent-review is not a directory");
    return { status: "fail", project: project.real, summary: summarize([]), checks, rounds: [] };
  }
  let base;
  try {
    base = fs.realpathSync(arLexical);
    if (base !== arLexical) throw new Error("escape");
  } catch {
    issue(checks, "library", "fail", ".agent-review does not resolve to the project-owned directory");
    return { status: "fail", project: project.real, summary: summarize([]), checks, rounds: [] };
  }

  let names;
  try { names = fs.readdirSync(base); }
  catch { issue(checks, "library-list", "fail", ".agent-review cannot be listed"); names = []; }
  const available = names.filter((name) => ROUND_ID_RE.test(name)).sort();
  const selected = roundId ? [roundId] : available;
  if (roundId && !available.includes(roundId)) issue(checks, "round-filter", "fail", `requested round ${roundId} does not exist`);
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (!ROUND_ID_RE.test(name)) issue(checks, "unknown-library-entry", "warn", `unknown .agent-review entry ${name}`);
  }
  const rounds = selected.map((id) => auditRound(base, id));
  const status = aggregateStatus([...checks, ...rounds.map((round) => ({ status: round.status }))]);
  return { status, project: project.real, summary: summarize(rounds), checks, rounds };
}

function formatAudit(report) {
  const lines = ["UI Review Loop evidence audit", `project: ${report.project}`];
  for (const check of report.checks || []) lines.push(`${String(check.status).toUpperCase().padEnd(5)} library                  ${check.message}`);
  for (const round of report.rounds || []) {
    lines.push(`${round.status.toUpperCase().padEnd(5)} ${round.roundId}`);
    for (const check of round.checks || []) if (check.status !== "pass") lines.push(`      ${check.status.toUpperCase().padEnd(5)} ${check.message}`);
  }
  const summary = report.summary || summarize(report.rounds || []);
  lines.push("", `rounds: ${summary.rounds}  passed: ${summary.passed}  warned: ${summary.warned}  failed: ${summary.failed}`, `status: ${report.status}`);
  return lines.join("\n") + "\n";
}

export { ROUND_ID_RE, COMMENT_ID_RE, aggregateStatus, auditLibrary, formatAudit };
