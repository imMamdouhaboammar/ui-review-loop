#!/usr/bin/env node
"use strict";

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { formatDoctor, runDoctor } from "../lib/diagnostics.mjs";

function execProbe({ bin, args, timeoutMs }) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: "",
    errorCode: result.error && result.error.code ? result.error.code : null,
  };
}

function usage() {
  return [
    "usage: doctor.mjs [--json] [--backend agent-browser|browser-control]",
    "",
    "Runs read-only capability checks. It never creates .agent-review/ or starts a recording.",
  ].join("\n");
}

function getFlag(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function main(args = process.argv.slice(2), io = process) {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(usage() + "\n");
    return 0;
  }

  const allowed = new Set(["--json", "--backend", "agent-browser", "browser-control"]);
  const unknown = args.find((arg) => !allowed.has(arg));
  if (unknown) {
    io.stderr.write(`doctor: unknown argument ${JSON.stringify(unknown)}\n${usage()}\n`);
    return 2;
  }

  const backend = getFlag(args, "--backend") || "agent-browser";
  if (backend !== "agent-browser" && backend !== "browser-control") {
    io.stderr.write(`doctor: unsupported backend ${JSON.stringify(backend)}\n${usage()}\n`);
    return 2;
  }

  const report = runDoctor({ backend, exec: execProbe });
  if (args.includes("--json")) io.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else io.stdout.write(formatDoctor(report));
  return report.status === "fail" ? 1 : 0;
}

const isDirectRun = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exitCode = main();

export { execProbe, main, usage };
