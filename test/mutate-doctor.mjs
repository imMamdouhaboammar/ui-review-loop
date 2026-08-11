#!/usr/bin/env node
"use strict";

// Focused mutation harness for doctor diagnostics. The legacy mutation harness owns the
// round/server/recorder suite; this one keeps the new diagnostic seam independently provable.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = {
  diagnostics: path.join(ROOT, "..", "lib", "diagnostics.mjs"),
  doctor: path.join(ROOT, "..", "scripts", "doctor.mjs"),
};
const SUITE = path.join(ROOT, "doctor.mjs");

const MUTATIONS = [
  {
    label: "doctor-severity-ignores-warnings",
    file: "diagnostics",
    from: "const STATUS_WEIGHT = Object.freeze({ pass: 0, warn: 1, fail: 2 });",
    to: "const STATUS_WEIGHT = Object.freeze({ pass: 0, warn: 0, fail: 2 });",
    breaks: ["aggregateStatus returns the highest severity"],
  },
  {
    label: "doctor-runtime-floor-disabled",
    file: "diagnostics",
    from: "  if (major < MIN_NODE_MAJOR) return { id: \"node\", status: \"fail\", message: `Node ${MIN_NODE_MAJOR} or newer is required; this is Node ${raw}` };",
    to: "  if (major < 0) return { id: \"node\", status: \"fail\", message: `Node ${MIN_NODE_MAJOR} or newer is required; this is Node ${raw}` };",
    breaks: ["old Node is a hard failure"],
  },
  {
    label: "doctor-missing-agent-browser-accepted",
    file: "diagnostics",
    from: "    checks.push({ id: \"agent-browser\", status: \"fail\", message: \"not found on PATH\" });",
    to: "    checks.push({ id: \"agent-browser\", status: \"pass\", message: \"not found on PATH\" });",
    breaks: ["missing agent-browser is a hard failure without redundant capability probes"],
  },
  {
    label: "doctor-timeout-mislabeled-as-missing",
    file: "diagnostics",
    from: "  return !result || result.errorCode === \"ENOENT\";",
    to: "  return !result || result.status === null || result.errorCode === \"ENOENT\";",
    breaks: ["timed out agent-browser probe is not mislabeled as missing"],
  },
  {
    label: "doctor-record-capability-assumed",
    file: "diagnostics",
    from: "  checks.push(commandSucceeded(record)\n    ? { id: \"recording\", status: \"pass\", message: \"record command available\" }\n    : { id: \"recording\", status: \"fail\", message: probeFailure(record, \"record command\") });",
    to: "  checks.push({ id: \"recording\", status: \"pass\", message: \"record command available\" });",
    breaks: ["missing recording capability fails even when version is readable"],
  },
  {
    label: "doctor-network-capability-assumed",
    file: "diagnostics",
    from: "  checks.push(commandSucceeded(network)\n    ? { id: \"network\", status: \"pass\", message: \"network har command available\" }\n    : { id: \"network\", status: \"fail\", message: probeFailure(network, \"network har command\") });",
    to: "  checks.push({ id: \"network\", status: \"pass\", message: \"network har command available\" });",
    breaks: ["missing HAR capability fails even when version is readable"],
  },
  {
    label: "doctor-ffmpeg-success-still-warns",
    file: "diagnostics",
    from: "  if (commandSucceeded(probe)) return { id: \"ffmpeg\", status: \"pass\", message: `${cleanVersion(probe.stdout)}` };",
    to: "  if (commandSucceeded(probe)) return { id: \"ffmpeg\", status: \"warn\", message: `${cleanVersion(probe.stdout)}` };",
    breaks: ["ffmpeg availability removes the optional warning"],
  },
  {
    label: "doctor-browser-control-does-not-require-ffmpeg",
    file: "diagnostics",
    from: "  checks.push(ffmpegCheck(exec, { required: backend === \"browser-control\" }));",
    to: "  checks.push(ffmpegCheck(exec, { required: false }));",
    breaks: ["browser-control diagnostics require its CLI and ffmpeg"],
  },
  {
    label: "doctor-browser-control-warning-upgraded-to-pass",
    file: "diagnostics",
    from: "  const reported = parsed && [\"pass\", \"warn\", \"fail\"].includes(parsed.status) ? parsed.status : \"warn\";",
    to: "  const reported = \"pass\";",
    breaks: ["browser-control doctor warning is preserved without leaking raw output"],
  },
  {
    label: "doctor-browser-control-raw-output-leaked",
    file: "diagnostics",
    from: "  checks.push({ id: \"browser-control-doctor\", status: reported, message });",
    to: "  checks.push({ id: \"browser-control-doctor\", status: reported, message: String(doctor.stdout || message) });",
    breaks: ["browser-control doctor warning is preserved without leaking raw output"],
  },
  {
    label: "doctor-human-status-not-uppercase",
    file: "diagnostics",
    from: "String(check.status || \"fail\").toUpperCase().padEnd(5)",
    to: "String(check.status || \"fail\").toLowerCase().padEnd(5)",
    breaks: ["formatDoctor renders stable human-readable status lines"],
  },
  {
    label: "doctor-missing-backend-value-misdiagnosed",
    file: "doctor",
    from: "      if (!value || value.startsWith(\"-\")) return { error: \"--backend requires agent-browser or browser-control\" };",
    to: "      if (false) return { error: \"--backend requires agent-browser or browser-control\" };",
    breaks: ["doctor CLI rejects a missing backend value"],
  },
  {
    label: "doctor-positional-error-loses-specific-diagnosis",
    file: "doctor",
    from: "    return { error: `unexpected argument ${JSON.stringify(arg)}` };",
    to: "    return { error: `unknown argument ${JSON.stringify(arg)}` };",
    breaks: ["doctor CLI rejects positional arguments"],
  },
];

const originals = new Map(Object.entries(TARGETS).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
function restore() {
  for (const [key, file] of Object.entries(TARGETS)) fs.writeFileSync(file, originals.get(key));
}
function modifiedTargets() {
  return Object.entries(TARGETS)
    .filter(([key, file]) => fs.readFileSync(file, "utf8") !== originals.get(key))
    .map(([key]) => key);
}
process.on("exit", restore);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(130));

function runSuite() {
  const result = spawnSync(process.execPath, [SUITE], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const output = (result.stdout || "") + (result.stderr || "");
  const failed = [...output.matchAll(/^\s*FAIL\s+(.*)$/gm)].map((match) => match[1].trim());
  return { status: result.status, output, failed };
}

const only = process.argv[2];
const chosen = only ? MUTATIONS.filter((mutation) => mutation.label.includes(only)) : MUTATIONS;
let bad = 0;

const baseline = runSuite();
if (baseline.status !== 0 || baseline.failed.length) {
  console.error("doctor mutation baseline is not green");
  process.stderr.write(baseline.output);
  process.exit(1);
}
console.log("baseline: doctor suite green\n");

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
console.log(`\n${chosen.length - bad}/${chosen.length} doctor mutations caught`);
process.exit(bad ? 1 : 0);
