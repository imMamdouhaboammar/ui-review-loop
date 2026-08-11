#!/usr/bin/env node
"use strict";

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { formatDoctor, runDoctor } from "../lib/diagnostics.mjs";

const SAFE_CMD_TOKEN_RE = /^[A-Za-z0-9._/:+=-]+$/;

function spawnOptions(timeoutMs) {
  return {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  };
}

function findWindowsCommandShim(bin, timeoutMs) {
  const where = spawnSync("where.exe", [bin], spawnOptions(Math.min(timeoutMs || 5000, 5000)));
  if (where.status !== 0 || typeof where.stdout !== "string") return null;
  return where.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((candidate) => /\.(?:cmd|bat)$/i.test(candidate)) || null;
}

function safeCmdInvocation(shim, args) {
  if (!shim || !Array.isArray(args) || !args.every((arg) => SAFE_CMD_TOKEN_RE.test(String(arg)))) return null;
  return [`"${shim}"`, ...args.map(String)].join(" ");
}

function execProbe({ bin, args, timeoutMs }) {
  const options = spawnOptions(timeoutMs);
  let result = spawnSync(bin, args, options);

  if (process.platform === "win32" && result.error && ["ENOENT", "EINVAL"].includes(result.error.code)) {
    const shim = findWindowsCommandShim(bin, timeoutMs);
    const command = safeCmdInvocation(shim, args);
    if (command) {
      const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
      result = spawnSync(comspec, ["/d", "/s", "/c", command], options);
    }
  }

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

function parseArgs(args) {
  let backend = "agent-browser";
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--backend") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return { error: "--backend requires agent-browser or browser-control" };
      if (value !== "agent-browser" && value !== "browser-control") return { error: `unsupported backend ${JSON.stringify(value)}` };
      backend = value;
      index++;
      continue;
    }
    return { error: `unexpected argument ${JSON.stringify(arg)}` };
  }
  return { backend, json };
}

function main(args = process.argv.slice(2), io = process) {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(usage() + "\n");
    return 0;
  }

  const parsed = parseArgs(args);
  if (parsed.error) {
    io.stderr.write(`doctor: ${parsed.error}\n${usage()}\n`);
    return 2;
  }

  const report = runDoctor({ backend: parsed.backend, exec: execProbe });
  if (parsed.json) io.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else io.stdout.write(formatDoctor(report));
  return report.status === "fail" ? 1 : 0;
}

const isDirectRun = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exitCode = main();

export { execProbe, findWindowsCommandShim, main, parseArgs, safeCmdInvocation, usage };
