#!/usr/bin/env node
/**
 * UI Review Loop — enhance.mjs
 *
 * Auto-Enhance CLI: reads a completed round's evidence and produces
 * structured findings + patch suggestions, closing the review loop.
 *
 * Commands:
 *   analyze  --round <roundId>   Read evidence, write enhance.json
 *   suggest  --round <roundId>   Turn enhance.json into suggestions.md (human-readable)
 *   apply    --round <roundId>   [--auto] List safe patches (--auto writes applied.json)
 *   help                         Print usage
 *
 * All output lands in .agent-review/<roundId>/ — never committed (.gitignore).
 *
 * Zero external dependencies. Node 22+.
 */
"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");

// ─── node version guard ───────────────────────────────────────────────────────
const MIN_NODE_MAJOR = 22;
(function checkNode() {
  const m = /^v?(\d+)\./.exec(process.versions.node || "");
  if (m && Number(m[1]) < MIN_NODE_MAJOR) {
    process.stderr.write(`enhance: Node ${MIN_NODE_MAJOR}+ required; found ${process.versions.node}\n`);
    process.exit(1);
  }
})();

// ─── imports (dynamic to keep the guard above synchronous) ───────────────────
const { analyzeRound } = await import("../lib/enhance-analyzers.mjs");
const { generatePatches, safePatches, renderPatchesMd } = await import("../lib/enhance-patcher.mjs");

// ─── helpers ──────────────────────────────────────────────────────────────────

function die(msg, code = 1) {
  process.stderr.write(`enhance: ${msg}\n`);
  process.exit(code);
}

function getFlag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] || null);
}

function hasFlag(args, name) {
  return args.includes(name);
}

/** Find the .agent-review directory walking up from cwd. */
function findAgentReviewDir() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, ".agent-review");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveRoundDir(roundId) {
  if (!roundId) die("--round <roundId> is required");
  const arDir = findAgentReviewDir();
  if (!arDir) die("no .agent-review/ directory found — run from inside the project");
  const roundDir = path.join(arDir, roundId);
  if (!fs.existsSync(roundDir)) die(`round directory not found: ${roundDir}`);
  return roundDir;
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    die(`cannot read ${label}: ${err.message}`);
  }
}

function writeJsonAtomic(filePath, value) {
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function writeMdAtomic(filePath, content) {
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

// ─── commands ─────────────────────────────────────────────────────────────────

/**
 * analyze --round <roundId> [--dry-run]
 *
 * Reads meta.json, dom.json, network.har from the round package,
 * runs all analyzers, and writes enhance.json.
 */
function cmdAnalyze(args) {
  const roundId = getFlag(args, "--round");
  const dryRun = hasFlag(args, "--dry-run");
  const roundDir = resolveRoundDir(roundId);

  const meta = readJsonFile(path.join(roundDir, "meta.json"), "meta.json");
  const dom = readJsonFile(path.join(roundDir, "dom.json"), "dom.json");
  const har = readJsonFile(path.join(roundDir, "network.har"), "network.har"); // null for browser-control rounds

  if (!meta) die(`meta.json not found in ${roundDir} — is this a completed round?`);
  if (!dom) die(`dom.json not found in ${roundDir} — round may be incomplete`);

  const result = analyzeRound({ meta, dom, har });

  const enhanceJson = {
    schemaVersion: 1,
    roundId: roundId,
    analyzedAt: new Date().toISOString(),
    summary: result.summary,
    findings: result.findings,
  };

  if (dryRun) {
    process.stdout.write(JSON.stringify(enhanceJson, null, 2) + "\n");
    console.log(`\n[dry-run] enhance.json NOT written.`);
    return;
  }

  const outPath = path.join(roundDir, "enhance.json");
  writeJsonAtomic(outPath, enhanceJson);

  const { total, critical, warn, info } = result.summary;
  console.log(`enhance analyze: ${total} finding(s) — critical: ${critical}, warn: ${warn}, info: ${info}`);
  console.log(`  wrote: ${outPath}`);
  if (critical > 0) {
    console.log(`  ⚠  ${critical} critical finding(s) — run 'enhance suggest' for details`);
  }
  console.log(`  next: node "${path.join(SKILL_DIR, "scripts", "enhance.mjs")}" suggest --round ${roundId}`);
}

/**
 * suggest --round <roundId>
 *
 * Reads enhance.json (produced by analyze) and renders suggestions.md —
 * a Markdown document the agent and operator can read directly.
 */
function cmdSuggest(args) {
  const roundId = getFlag(args, "--round");
  const roundDir = resolveRoundDir(roundId);
  const enhancePath = path.join(roundDir, "enhance.json");

  const enhance = readJsonFile(enhancePath, "enhance.json");
  if (!enhance) die(`enhance.json not found — run 'enhance analyze --round ${roundId}' first`);

  const { findings, summary, analyzedAt } = enhance;
  const patches = generatePatches(findings);

  const md = renderSuggestionsMd({ roundId, analyzedAt, summary, findings, patches });

  const outPath = path.join(roundDir, "suggestions.md");
  writeMdAtomic(outPath, md);

  console.log(`enhance suggest: ${findings.length} finding(s), ${patches.length} patchable`);
  console.log(`  wrote: ${outPath}`);
  if (patches.length > 0) {
    console.log(`  next: node "${path.join(SKILL_DIR, "scripts", "enhance.mjs")}" apply --round ${roundId}`);
  }
}

/**
 * apply --round <roundId> [--auto]
 *
 * Lists safe patches. With --auto, writes applied.json recording what
 * would be applied (the actual file edits remain for the agent to execute —
 * this tool records intent, not file mutations, staying zero-dependency and safe).
 */
function cmdApply(args) {
  const roundId = getFlag(args, "--round");
  const auto = hasFlag(args, "--auto");
  const roundDir = resolveRoundDir(roundId);

  const enhance = readJsonFile(path.join(roundDir, "enhance.json"), "enhance.json");
  if (!enhance) die(`enhance.json not found — run 'enhance analyze --round ${roundId}' first`);

  const patches = generatePatches(enhance.findings);
  const safe = safePatches(patches);
  const unsafe = patches.filter((p) => !p.safe);

  console.log(`\nenhance apply — round ${roundId}`);
  console.log(`  ${patches.length} patch(es) total: ${safe.length} safe, ${unsafe.length} require manual review\n`);

  if (safe.length === 0 && patches.length === 0) {
    console.log("  No patches generated. All findings require manual code review.");
    return;
  }

  console.log(renderPatchesMd(patches));

  if (!auto) {
    console.log("─".repeat(60));
    console.log("To record these as the intended fixes, re-run with --auto:");
    console.log(`  node "${path.join(SKILL_DIR, "scripts", "enhance.mjs")}" apply --round ${roundId} --auto`);
    console.log("\nNote: --auto writes applied.json (intent log) but does NOT edit source files.");
    console.log("The agent must make the actual code changes guided by the patch list above.");
    return;
  }

  // --auto: write applied.json as an intent record ─────────────────────────
  const appliedJson = {
    schemaVersion: 1,
    roundId,
    appliedAt: new Date().toISOString(),
    note: "Patches recorded as intent. Agent must apply actual source changes.",
    safePatches: safe,
    manualPatches: unsafe,
  };
  const appliedPath = path.join(roundDir, "applied.json");
  writeJsonAtomic(appliedPath, appliedJson);

  console.log(`\n  ✅ applied.json written: ${appliedPath}`);
  console.log(`  ${safe.length} safe patches logged as intent.`);
  if (unsafe.length > 0) {
    console.log(`  ⚠  ${unsafe.length} patch(es) require manual attention (see suggestions.md).`);
  }
  console.log("\n  Next steps for the agent:");
  console.log("  1. Read applied.json for the patch list");
  console.log("  2. Apply each safe patch to the source files");
  console.log("  3. Re-record a new round to verify the fixes");
}

// ─── markdown renderer ────────────────────────────────────────────────────────

function renderSuggestionsMd({ roundId, analyzedAt, summary, findings, patches }) {
  const severityEmoji = { critical: "🔴", warn: "🟡", info: "🔵" };
  const categoryLabel = {
    accessibility: "♿ Accessibility",
    performance: "⚡ Performance",
    network: "🌐 Network",
    ux: "🎨 UX",
    console: "🖥 Console",
  };

  const lines = [
    `# Auto-Enhance Suggestions`,
    ``,
    `**Round:** \`${roundId}\`  `,
    `**Analyzed at:** ${new Date(analyzedAt).toLocaleString()}  `,
    `**Findings:** ${summary.total} total — 🔴 ${summary.critical} critical · 🟡 ${summary.warn} warn · 🔵 ${summary.info} info`,
    ``,
    `> These findings were generated automatically from recorded evidence (dom.json, network.har, meta.json).`,
    `> They are suggestions — the agent must verify each before acting.`,
    `> Critical findings should be addressed before the next round.`,
    ``,
    `---`,
    ``,
    `## Findings`,
    ``,
  ];

  if (findings.length === 0) {
    lines.push("_No findings detected. The round evidence looks clean!_");
  } else {
    // group by severity
    for (const severity of ["critical", "warn", "info"]) {
      const group = findings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      lines.push(`### ${severityEmoji[severity]} ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${group.length})`);
      lines.push("");
      for (const f of group) {
        lines.push(`#### ${f.id} · ${categoryLabel[f.category] || f.category}`);
        lines.push(`**${f.title}**`);
        lines.push("");
        lines.push(f.detail);
        if (f.evidence && Object.keys(f.evidence).some((k) => f.evidence[k])) {
          lines.push("");
          lines.push("_Evidence:_ " + Object.entries(f.evidence)
            .filter(([, v]) => v != null && v !== "")
            .map(([k, v]) => `${k}: \`${v}\``)
            .join(", "));
        }
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Patchable Findings");
  lines.push("");
  lines.push(patches.length > 0 ? renderPatchesMd(patches) : "_No automatically patchable findings._");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Next Steps for the Agent");
  lines.push("");
  lines.push("1. Address all **critical** findings before committing.");
  lines.push("2. Review **warn** findings and decide which to fix in this iteration.");
  lines.push("3. Apply patchable fixes: ");
  lines.push(`   \`node "${path.join(SKILL_DIR, "scripts", "enhance.mjs")}" apply --round ${roundId} --auto\``);
  lines.push("4. Record a new round after fixes to verify resolution.");
  lines.push("");

  return lines.join("\n");
}

// ─── help ─────────────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
UI Review Loop — Auto-Enhance CLI

Usage:
  node enhance.mjs analyze --round <roundId>          Analyse evidence → enhance.json
  node enhance.mjs analyze --round <roundId> --dry-run  Print findings, do not write
  node enhance.mjs suggest --round <roundId>          Render suggestions.md
  node enhance.mjs apply   --round <roundId>          List safe patches (no writes)
  node enhance.mjs apply   --round <roundId> --auto   Log intent to applied.json

All output files land in .agent-review/<roundId>/ and are gitignored.
The agent must apply actual source changes guided by suggestions.md.

Workflow after 'round stop':
  1. enhance analyze --round <id>
  2. enhance suggest --round <id>   ← read suggestions.md
  3. enhance apply   --round <id> --auto
  4. Fix source code, record a new round to verify.

Or integrate with round stop:
  round.mjs stop --summary "..." --auto-enhance
`.trim());
}

// ─── main ─────────────────────────────────────────────────────────────────────

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "analyze":  return cmdAnalyze(rest);
    case "suggest":  return cmdSuggest(rest);
    case "apply":    return cmdApply(rest);
    case "help":
    case "--help":
    case "-h":       return cmdHelp();
    default:
      die(`unknown command: ${cmd || "(none)"}. Run 'enhance.mjs help' for usage.`, 2);
  }
}

main();
