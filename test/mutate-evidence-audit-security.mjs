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
  ["round-directory-containment-disabled", "  const dir = safeDirectory(base, roundId);", "  const dir = { real: path.join(base, roundId) };"],
  ["required-json-safe-file-check-disabled", "  const file = safeFile(roundDir, name);", "  const unsafePath = path.join(roundDir, name);\n  const file = { real: unsafePath, size: lstatOrNull(unsafePath)?.size ?? 0 };"],
];
function restore() { fs.writeFileSync(TARGET, original); }
process.on("exit", restore);
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => process.exit(130));
let caught = 0;
for (const [label, from, to] of mutations) {
  const count = original.split(from).length - 1;
  if (count !== 1) { console.log(`FAIL ${label}: anchor matched ${count} times`); continue; }
  fs.writeFileSync(TARGET, original.replace(from, to));
  const r = spawnSync(process.execPath, [SUITE], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  restore();
  if (r.status !== 0) { console.log(`ok ${label}`); caught++; }
  else { console.log(`FAIL ${label}: survived`); process.stdout.write((r.stdout || "") + (r.stderr || "")); }
}
console.log(`${caught}/${mutations.length} evidence audit security mutations caught`);
process.exit(caught === mutations.length ? 0 : 1);
