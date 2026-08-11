#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import { runDoctor, formatDoctor, aggregateStatus } from "../lib/diagnostics.mjs";
import { main as doctorMain } from "../scripts/doctor.mjs";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

function result(status, stdout = "", stderr = "") {
  return { status, stdout, stderr, errorCode: status === null ? "ENOENT" : null };
}

function fakeExec(entries) {
  return ({ bin, args }) => entries[[bin, ...args].join(" ")] ?? result(null);
}

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (value) => { stdout += String(value); } },
      stderr: { write: (value) => { stderr += String(value); } },
    },
    read: () => ({ stdout, stderr }),
  };
}

const healthyAgentBrowser = {
  "agent-browser --version": result(0, "agent-browser 0.33.1\n"),
  "agent-browser record --help": result(0, "Video Recording\n"),
  "agent-browser network har --help": result(0, "HAR capture\n"),
};

check("aggregateStatus returns the highest severity", () => {
  assert.equal(aggregateStatus([{ status: "pass" }, { status: "warn" }]), "warn");
  assert.equal(aggregateStatus([{ status: "warn" }, { status: "fail" }]), "fail");
  assert.equal(aggregateStatus([{ status: "pass" }]), "pass");
});

check("healthy agent-browser environment passes with optional ffmpeg warning", () => {
  const report = runDoctor({ nodeVersion: "24.5.0", exec: fakeExec(healthyAgentBrowser) });
  assert.equal(report.status, "warn");
  assert.equal(report.checks.find((c) => c.id === "node").status, "pass");
  assert.equal(report.checks.find((c) => c.id === "agent-browser").status, "pass");
  assert.equal(report.checks.find((c) => c.id === "recording").status, "pass");
  assert.equal(report.checks.find((c) => c.id === "network").status, "pass");
  assert.equal(report.checks.find((c) => c.id === "ffmpeg").status, "warn");
});

check("old Node is a hard failure", () => {
  const report = runDoctor({ nodeVersion: "20.19.0", exec: fakeExec(healthyAgentBrowser) });
  assert.equal(report.status, "fail");
  assert.match(report.checks.find((c) => c.id === "node").message, /22 or newer/);
});

check("missing agent-browser is a hard failure without redundant capability probes", () => {
  const calls = [];
  const report = runDoctor({
    nodeVersion: "22.18.0",
    exec: (request) => { calls.push(request); return result(null); },
  });
  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((c) => c.id === "agent-browser").status, "fail");
  assert.equal(calls.filter((c) => c.bin === "agent-browser").length, 1);
});

check("missing recording capability fails even when version is readable", () => {
  const report = runDoctor({ nodeVersion: "22.18.0", exec: fakeExec({
    ...healthyAgentBrowser,
    "agent-browser record --help": result(2, "", "unknown command"),
  }) });
  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((c) => c.id === "recording").status, "fail");
});

check("missing HAR capability fails even when version is readable", () => {
  const report = runDoctor({ nodeVersion: "22.18.0", exec: fakeExec({
    ...healthyAgentBrowser,
    "agent-browser network har --help": result(2, "", "unknown command"),
  }) });
  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((c) => c.id === "network").status, "fail");
});

check("ffmpeg availability removes the optional warning", () => {
  const report = runDoctor({ nodeVersion: "22.18.0", exec: fakeExec({
    ...healthyAgentBrowser,
    "ffmpeg -version": result(0, "ffmpeg version 7.1\n"),
  }) });
  assert.equal(report.status, "pass");
  assert.equal(report.checks.find((c) => c.id === "ffmpeg").status, "pass");
});

check("browser-control diagnostics require its CLI and ffmpeg", () => {
  const report = runDoctor({ backend: "browser-control", nodeVersion: "22.18.0", exec: fakeExec({
    "browser-control --version": result(0, "0.4.1\n"),
    "browser-control doctor": result(0, JSON.stringify({ status: "pass", extension: { connected: true, versionMatches: true } })),
  }) });
  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((c) => c.id === "browser-control").status, "pass");
  assert.equal(report.checks.find((c) => c.id === "browser-control-doctor").status, "pass");
  assert.equal(report.checks.find((c) => c.id === "ffmpeg").status, "fail");
  assert.equal(report.checks.some((c) => c.id === "agent-browser"), false);
});

check("browser-control doctor warning is preserved without leaking raw output", () => {
  const report = runDoctor({ backend: "browser-control", nodeVersion: "24.5.0", exec: fakeExec({
    "browser-control --version": result(0, "0.4.1\n"),
    "browser-control doctor": result(0, JSON.stringify({ status: "warn", extension: { connected: true, versionMatches: null }, secret: "do-not-copy" })),
    "ffmpeg -version": result(0, "ffmpeg version 7.1\n"),
  }) });
  const doctor = report.checks.find((c) => c.id === "browser-control-doctor");
  assert.equal(report.status, "warn");
  assert.equal(doctor.status, "warn");
  assert.doesNotMatch(JSON.stringify(report), /do-not-copy/);
});

check("formatDoctor renders stable human-readable status lines", () => {
  const text = formatDoctor({ status: "warn", checks: [
    { id: "node", status: "pass", message: "Node 24.5.0" },
    { id: "ffmpeg", status: "warn", message: "not found; calibration contact sheets are unavailable" },
  ] });
  assert.match(text, /^UI Review Loop doctor/m);
  assert.match(text, /PASS\s+node\s+Node 24\.5\.0/);
  assert.match(text, /WARN\s+ffmpeg/);
  assert.match(text, /status: warn/);
});

check("doctor CLI rejects a missing backend value", () => {
  const capture = captureIo();
  assert.equal(doctorMain(["--backend"], capture.io), 2);
  assert.match(capture.read().stderr, /--backend requires/);
});

check("doctor CLI rejects positional arguments", () => {
  const capture = captureIo();
  assert.equal(doctorMain(["agent-browser"], capture.io), 2);
  assert.match(capture.read().stderr, /unexpected argument/);
});

console.log(`doctor tests: ${passed} passed`);
