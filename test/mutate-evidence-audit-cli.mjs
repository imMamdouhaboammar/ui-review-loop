#!/usr/bin/env node
"use strict";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(ROOT, "..", "scripts", "evidence.mjs");
const SUITE = path.join(ROOT, "evidence-audit-cli.mjs");
const original = fs.readFileSync(TARGET, "utf8");
const mutations = [
  ["hard-failure-exit-code", "  return report.status === \"fail\" ? 1 : 0;", "  return 0;"],
  ["json-output-disabled", "  if (parsed.json) io.stdout.write(JSON.stringify(report, null, 2) + \"\\n\");", "  if (false) io.stdout.write(JSON.stringify(report, null, 2) + \"\\n\");"],
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
console.log(`${caught}/${mutations.length} evidence audit CLI mutations caught`);
process.exit(caught === mutations.length ? 0 : 1);
