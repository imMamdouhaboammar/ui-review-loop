#!/usr/bin/env node
"use strict";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("evidence audit security mutations: skipped on Windows");
  process.exit(0);
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(ROOT, "..", "lib", "evidence-audit.mjs");
const SUITE = path.join(ROOT, "evidence-audit-security.mjs");
const original = fs.readFileSync(TARGET, "utf8");

const mutations = [
  {
    label: "round-directory-containment-disabled",
    from: "  const dir = safeDirectory(base, roundId);",
    to: "  const dir = { real: path.join(base, roundId) };",
  },
  {
    label: "required-json-safe-file-check-disabled",
    from: "  const file = safeFile(roundDir, name);",
    to: "  const unsafePath = path.join(roundDir, name);\n  const file = { real: unsafePath, size: lstatOrNull(unsafePath)?.size ?? 0 };",
  },
];

function restore() { fs.writeFileSync(TARGET, original); }
process.on("exit", restore);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(130));

let caught = 0;
for (const mutation of mutations) {
  const occurrences = original.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    console.error(`FAIL ${mutation.label}: anchor matched ${occurrences} times`);
    continue;
  }
  fs.writeFileSync(TARGET, original.replace(mutation.from, mutation.to));
  const result = spawnSync(process.execPath, [SUITE], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  restore();
  if (result.status === 0) {
    console.error(`FAIL ${mutation.label}: survived`);
    process.stdout.write((result.stdout || "") + (result.stderr || ""));
  } else {
    console.log(`ok ${mutation.label}`);
    caught++;
  }
}

console.log(`${caught}/${mutations.length} evidence audit security mutations caught`);
process.exit(caught === mutations.length ? 0 : 1);
