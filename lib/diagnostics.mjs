"use strict";

const MIN_NODE_MAJOR = 22;
const STATUS_WEIGHT = Object.freeze({ pass: 0, warn: 1, fail: 2 });

function aggregateStatus(checks) {
  let status = "pass";
  for (const check of checks || []) {
    if ((STATUS_WEIGHT[check && check.status] ?? 2) > STATUS_WEIGHT[status]) status = check.status;
  }
  return status;
}

function cleanVersion(text) {
  const line = String(text || "").split(/\r?\n/, 1)[0].trim();
  const match = line.match(/v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0].replace(/^v/, "") : "version available";
}

function commandSucceeded(result) {
  return !!result && result.status === 0;
}

function commandMissing(result) {
  return !result || result.errorCode === "ENOENT";
}

function probeFailure(result, label) {
  if (result && result.errorCode === "ETIMEDOUT") return `${label} probe timed out`;
  return `${label} probe failed`;
}

function nodeCheck(nodeVersion) {
  const raw = String(nodeVersion || "");
  const match = /^v?(\d+)\./.exec(raw);
  if (!match) return { id: "node", status: "fail", message: `Node ${MIN_NODE_MAJOR} or newer is required; runtime version could not be read` };
  const major = Number(match[1]);
  if (major < MIN_NODE_MAJOR) return { id: "node", status: "fail", message: `Node ${MIN_NODE_MAJOR} or newer is required; this is Node ${raw}` };
  return { id: "node", status: "pass", message: `Node ${raw.replace(/^v/, "")}` };
}

function ffmpegCheck(exec, { required }) {
  const probe = exec({ bin: "ffmpeg", args: ["-version"], timeoutMs: 5000 });
  if (commandSucceeded(probe)) return { id: "ffmpeg", status: "pass", message: `${cleanVersion(probe.stdout)}` };
  if (commandMissing(probe)) {
    if (required) return { id: "ffmpeg", status: "fail", message: "not found; browser-control recording requires ffmpeg" };
    return { id: "ffmpeg", status: "warn", message: "not found; calibration contact sheets are unavailable" };
  }
  if (required) return { id: "ffmpeg", status: "fail", message: `${probeFailure(probe, "ffmpeg")}; browser-control recording requires it` };
  return { id: "ffmpeg", status: "warn", message: `${probeFailure(probe, "ffmpeg")}; calibration contact sheets may be unavailable` };
}

function agentBrowserChecks(exec) {
  const checks = [];
  const version = exec({ bin: "agent-browser", args: ["--version"], timeoutMs: 5000 });
  if (commandMissing(version)) {
    checks.push({ id: "agent-browser", status: "fail", message: "not found on PATH" });
    return checks;
  }
  if (!commandSucceeded(version)) {
    checks.push({ id: "agent-browser", status: "fail", message: probeFailure(version, "version") });
    return checks;
  }

  checks.push({ id: "agent-browser", status: "pass", message: cleanVersion(version.stdout) });

  const record = exec({ bin: "agent-browser", args: ["record", "--help"], timeoutMs: 5000 });
  checks.push(commandSucceeded(record)
    ? { id: "recording", status: "pass", message: "record command available" }
    : { id: "recording", status: "fail", message: probeFailure(record, "record command") });

  const network = exec({ bin: "agent-browser", args: ["network", "har", "--help"], timeoutMs: 5000 });
  checks.push(commandSucceeded(network)
    ? { id: "network", status: "pass", message: "network har command available" }
    : { id: "network", status: "fail", message: probeFailure(network, "network har command") });
  return checks;
}

function browserControlChecks(exec) {
  const checks = [];
  const version = exec({ bin: "browser-control", args: ["--version"], timeoutMs: 5000 });
  if (commandMissing(version)) {
    checks.push({ id: "browser-control", status: "fail", message: "not found on PATH" });
    return checks;
  }
  if (!commandSucceeded(version)) {
    checks.push({ id: "browser-control", status: "fail", message: probeFailure(version, "version") });
    return checks;
  }

  checks.push({ id: "browser-control", status: "pass", message: cleanVersion(version.stdout) });
  const doctor = exec({ bin: "browser-control", args: ["doctor"], timeoutMs: 10000 });
  if (!commandSucceeded(doctor)) {
    checks.push({ id: "browser-control-doctor", status: "fail", message: probeFailure(doctor, "browser-control doctor") });
    return checks;
  }

  let parsed = null;
  try { parsed = JSON.parse(String(doctor.stdout || "")); } catch {}
  const reported = parsed && ["pass", "warn", "fail"].includes(parsed.status) ? parsed.status : "warn";
  const message = reported === "pass"
    ? "relay and extension checks passed"
    : reported === "fail" ? "browser-control doctor reported failure" : "browser-control doctor reported warnings";
  checks.push({ id: "browser-control-doctor", status: reported, message });
  return checks;
}

function runDoctor({ backend = "agent-browser", nodeVersion = process.versions.node, exec } = {}) {
  if (typeof exec !== "function") throw new TypeError("runDoctor requires an exec function");
  if (backend !== "agent-browser" && backend !== "browser-control") throw new TypeError(`unsupported backend: ${backend}`);

  const checks = [nodeCheck(nodeVersion)];
  if (backend === "browser-control") checks.push(...browserControlChecks(exec));
  else checks.push(...agentBrowserChecks(exec));
  checks.push(ffmpegCheck(exec, { required: backend === "browser-control" }));
  return { status: aggregateStatus(checks), checks };
}

function formatDoctor(report) {
  const lines = ["UI Review Loop doctor"];
  for (const check of report.checks || []) {
    lines.push(`${String(check.status || "fail").toUpperCase().padEnd(5)} ${String(check.id || "unknown").padEnd(22)} ${check.message || ""}`.trimEnd());
  }
  lines.push("", `status: ${report.status || aggregateStatus(report.checks || [])}`);
  return lines.join("\n") + "\n";
}

export { MIN_NODE_MAJOR, aggregateStatus, runDoctor, formatDoctor };
