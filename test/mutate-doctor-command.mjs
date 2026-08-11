#!/usr/bin/env node
"use strict";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(ROOT, "..", "scripts", "doctor.mjs");
const SUITE = path.join(ROOT, "doctor.mjs");
const original = fs.readFileSync(TARGET, "utf8");
const from = "const SAFE_CMD_TOKEN_RE = /^[A-Za-z0-9._/:+=-]+$/;";
const to = "const SAFE_CMD_TOKEN_RE = /^.*$/;";

function restore() { fs.writeFileSync(TARGET, original); }
process.on("exit", restore);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(130));

const occurrences = original.split(from).length - 1;
if (occurrences !== 1) {
  console.error(`FAIL doctor-command mutation anchor matched ${occurrences} times`);
  process.exit(1);
}

fs.writeFileSync(TARGET, original.replace(from, to));
const result = spawnSync(process.execPath, [SUITE], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const output = (result.stdout || "") + (result.stderr || "");
restore();

if (!/^\s*FAIL\s+safe Windows shim invocation rejects shell metacharacters$/m.test(output)) {
  console.error("FAIL doctor-command mutation survived");
  process.stdout.write(output);
  process.exit(1);
}

console.log("1/1 doctor command mutations caught");
