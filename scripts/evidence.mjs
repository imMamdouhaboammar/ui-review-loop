#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ROUND_ID_RE, auditLibrary, formatAudit } from "../lib/evidence-audit.mjs";

function usage() {
  return [
    "usage: evidence.mjs audit [--project <dir>] [--round <roundId>] [--json]",
    "",
    "Audits finalized evidence packages without modifying them.",
    "This is structural verification, not cryptographic tamper detection.",
  ].join("\n");
}

function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  if (args[0] !== "audit") return { error: "expected the audit command" };
  let project = process.cwd();
  let roundId = null;
  let json = false;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") { json = true; continue; }
    if (arg === "--project") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return { error: "--project requires a directory" };
      project = value;
      index++;
      continue;
    }
    if (arg === "--round") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return { error: "--round requires a round id" };
      if (!ROUND_ID_RE.test(value)) return { error: `invalid round id ${JSON.stringify(value)}` };
      roundId = value;
      index++;
      continue;
    }
    return { error: `unexpected argument ${JSON.stringify(arg)}` };
  }
  return { project, roundId, json };
}

function main(args = process.argv.slice(2), io = process) {
  const parsed = parseArgs(args);
  if (parsed.help) { io.stdout.write(usage() + "\n"); return 0; }
  if (parsed.error) { io.stderr.write(`evidence: ${parsed.error}\n${usage()}\n`); return 2; }
  const report = auditLibrary({ projectRoot: parsed.project, roundId: parsed.roundId });
  if (parsed.json) io.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else io.stdout.write(formatAudit(report));
  return report.status === "fail" ? 1 : 0;
}

const isDirectRun = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exitCode = main();

export { main, parseArgs, usage };
