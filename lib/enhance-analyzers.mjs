/**
 * UI Review Loop — enhance-analyzers.mjs
 *
 * Reads the three evidence channels of a completed round and produces a
 * structured list of findings categorised by severity and type.
 *
 * All analysis is READ-ONLY — this module never writes to .agent-review/.
 *
 * Exported surface:
 *   analyzeRound(roundDir, { meta, dom, har }) → { findings: Finding[] }
 *   analyzeDom(dom)      → Finding[]
 *   analyzeHar(har)      → Finding[]
 *   analyzeTimeline(dom) → Finding[]
 *
 * Finding shape:
 *   { id, severity, category, title, detail, evidence }
 *   severity: "critical" | "warn" | "info"
 *   category: "accessibility" | "performance" | "ux" | "network" | "console"
 *   evidence: { selector?, frameIndex?, segmentId?, url?, statusCode? }
 */
"use strict";

// ─── constants ──────────────────────────────────────────────────────────────

const SLOW_REQUEST_MS = 1000;        // HAR: request duration threshold
const LARGE_RESPONSE_KB = 500;       // HAR: response body size threshold
const MAX_FINDINGS = 200;            // safety cap to avoid enormous reports
const MISSING_ALT_SCORE_THRESHOLD = 0; // every missing alt is at least warn

// Patterns for identifying meaningful interactive elements without labels
const INTERACTIVE_SELECTORS = /^(button|a|input|select|textarea|details|summary)$/i;
const HEADING_SELECTORS = /^h[1-6]$/i;

// ─── helpers ─────────────────────────────────────────────────────────────────

let _findingCounter = 0;
function makeFinding(severity, category, title, detail, evidence = {}) {
  return { id: `f-${String(++_findingCounter).padStart(4, "0")}`, severity, category, title, detail, evidence };
}

function resetCounter() { _findingCounter = 0; }

function truncate(str, max = 120) {
  if (typeof str !== "string") return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ─── DOM analyzer ────────────────────────────────────────────────────────────

/**
 * Analyses dom.json evidence for accessibility, UX, and structural issues.
 * @param {object} dom  — parsed dom.json
 * @returns {import("./enhance-analyzers.mjs").Finding[]}
 */
function analyzeDom(dom) {
  if (!dom || !Array.isArray(dom.segments)) return [];
  const findings = [];

  for (const seg of dom.segments) {
    if (!Array.isArray(seg.frames)) continue;
    const segId = seg.id;

    // ── build a lightweight element model from mutation frames ──────────────
    const seenSelectors = new Set();
    const mutatedSelectors = new Set();
    const clickedSelectors = new Set();
    const valueSelectors = new Map();  // selector → last value seen
    const consoleErrors = [];
    let lastVisibleText = "";
    let emptyTextFrames = 0;

    for (const frame of seg.frames) {
      // track visible text
      if (typeof frame.text === "string") {
        if (frame.text.trim() === "" && lastVisibleText !== "") emptyTextFrames++;
        lastVisibleText = frame.text;
      }

      // track mutations (attribute changes, child list changes)
      if (Array.isArray(frame.mutations)) {
        for (const m of frame.mutations) {
          if (m && m.target) mutatedSelectors.add(m.target);
        }
      }

      // track clicks
      if (frame.kind === "action" && frame.data && frame.data.name === "click" && frame.data.target) {
        clickedSelectors.add(frame.data.target);
        seenSelectors.add(frame.data.target);
      }

      // track form values
      if (frame.values && typeof frame.values === "object") {
        for (const [sel, val] of Object.entries(frame.values)) {
          seenSelectors.add(sel);
          valueSelectors.set(sel, val);
        }
      }

      // track console errors / fetch errors from kind field
      if (frame.kind === "fetch:error" && frame.data) {
        consoleErrors.push({ frameIndex: frame.i, segmentId: segId, url: frame.data.url || "" });
      }

      if (findings.length >= MAX_FINDINGS) break;
    }

    // ── finding: content disappears (potential blank screen or failed render) ─
    if (emptyTextFrames >= 2 && lastVisibleText.trim() !== "") {
      findings.push(makeFinding(
        "warn", "ux",
        "Content disappeared then reappeared",
        `The page's visible text went blank ${emptyTextFrames} time(s) during the round — could indicate a flash of unstyled content, loading state without skeleton, or failed render.`,
        { segmentId: segId }
      ));
    }

    // ── finding: buttons/inputs clicked but never have aria/label evidence ──
    for (const sel of clickedSelectors) {
      // heuristic: selector matches interactive but has no label-like substring
      const isInteractive = INTERACTIVE_SELECTORS.test(sel.split(/[#.\[:\s]/)[0]);
      const hasLabelHint = /\[aria-label\]|\[title\]|\[name\]|\[id\]|\[alt\]/.test(sel);
      if (isInteractive && !hasLabelHint) {
        findings.push(makeFinding(
          "warn", "accessibility",
          "Interactive element clicked without visible label evidence",
          `Selector "${truncate(sel)}" was clicked but shows no aria-label, title, or name attribute in the recorded selector. Verify that a visible label or accessible name is present.`,
          { selector: sel, segmentId: segId }
        ));
        if (findings.length >= MAX_FINDINGS) break;
      }
    }

    // ── finding: redacted fields (could mask important UX state) ───────────
    let redactedCount = 0;
    for (const val of valueSelectors.values()) {
      if (val === "[redacted]") redactedCount++;
    }
    if (redactedCount > 0) {
      findings.push(makeFinding(
        "info", "ux",
        `${redactedCount} form field(s) were redacted in the evidence`,
        "These fields are excluded from timeline evidence by the --redact flag or built-in heuristics. Confirm the review covers the redacted fields visually via the video.",
        { segmentId: segId }
      ));
    }

    // ── finding: fetch errors ───────────────────────────────────────────────
    for (const err of consoleErrors.slice(0, 10)) {
      findings.push(makeFinding(
        "warn", "network",
        "Fetch error recorded in DOM timeline",
        `A fetch:error frame was recorded at frame ${err.frameIndex}${err.url ? ` (${truncate(err.url, 80)})` : ""}. Check the network.har for the matching failed request.`,
        { frameIndex: err.frameIndex, segmentId: err.segmentId, url: err.url }
      ));
      if (findings.length >= MAX_FINDINGS) break;
    }

    // ── finding: segment completeness ──────────────────────────────────────
    if (seg.complete === false) {
      findings.push(makeFinding(
        "info", "ux",
        "Segment did not end cleanly",
        `Segment ${segId} has complete=false (endReason: ${seg.endReason || "unknown"}). Evidence for this segment may be partial.`,
        { segmentId: segId }
      ));
    }
  }

  return findings;
}

// ─── HAR analyzer ────────────────────────────────────────────────────────────

/**
 * Analyses network.har for slow requests, errors, and missing cache headers.
 * @param {object|null} har  — parsed network.har, or null for browser-control rounds
 * @returns {import("./enhance-analyzers.mjs").Finding[]}
 */
function analyzeHar(har) {
  if (!har) return [];
  const log = har.log;
  if (!log || !Array.isArray(log.entries)) return [];

  const findings = [];
  const slowRequests = [];
  const errorRequests = [];
  const uncachedLargeRequests = [];

  for (const entry of log.entries) {
    if (!entry || !entry.request) continue;
    const url = entry.request.url || "";
    const status = entry.response && entry.response.status;
    const time = entry.time; // ms
    const bodySize = entry.response && entry.response.content && entry.response.content.size;

    // slow requests
    if (typeof time === "number" && time >= SLOW_REQUEST_MS) {
      slowRequests.push({ url, time, status });
    }

    // 4xx / 5xx errors (excluding expected 304)
    if (typeof status === "number" && status >= 400) {
      errorRequests.push({ url, status });
    }

    // large responses without cache headers
    if (typeof bodySize === "number" && bodySize > LARGE_RESPONSE_KB * 1024) {
      const headers = (entry.response && entry.response.headers) || [];
      const hasCacheControl = headers.some((h) => h.name && h.name.toLowerCase() === "cache-control");
      if (!hasCacheControl) {
        uncachedLargeRequests.push({ url, sizeKb: Math.round(bodySize / 1024) });
      }
    }

    if (findings.length >= MAX_FINDINGS) break;
  }

  // emit findings ─────────────────────────────────────────────────────────────
  if (slowRequests.length > 0) {
    const worst = slowRequests.sort((a, b) => b.time - a.time).slice(0, 5);
    for (const req of worst) {
      findings.push(makeFinding(
        req.time >= 3000 ? "critical" : "warn",
        "performance",
        `Slow request: ${Math.round(req.time)}ms`,
        `${truncate(req.url, 80)} took ${Math.round(req.time)}ms (status ${req.status ?? "?"}).`,
        { url: req.url, statusCode: req.status }
      ));
    }
  }

  for (const req of errorRequests.slice(0, 10)) {
    findings.push(makeFinding(
      req.status >= 500 ? "critical" : "warn",
      "network",
      `HTTP ${req.status} error`,
      `Request to ${truncate(req.url, 80)} returned ${req.status}.`,
      { url: req.url, statusCode: req.status }
    ));
    if (findings.length >= MAX_FINDINGS) break;
  }

  for (const req of uncachedLargeRequests.slice(0, 5)) {
    findings.push(makeFinding(
      "info",
      "performance",
      `Large response (${req.sizeKb} KB) without cache-control`,
      `${truncate(req.url, 80)} is ${req.sizeKb} KB with no Cache-Control header — consider adding caching.`,
      { url: req.url }
    ));
    if (findings.length >= MAX_FINDINGS) break;
  }

  return findings;
}

// ─── Timeline analyzer ───────────────────────────────────────────────────────

/**
 * Analyses the DOM timeline for UX timing patterns:
 * high frame density (rapid mutations), long gaps between actions, etc.
 * @param {object} dom  — parsed dom.json
 * @returns {import("./enhance-analyzers.mjs").Finding[]}
 */
function analyzeTimeline(dom) {
  if (!dom || !Array.isArray(dom.segments)) return [];
  const findings = [];

  for (const seg of dom.segments) {
    if (!Array.isArray(seg.frames) || seg.frames.length < 2) continue;
    const segId = seg.id;

    // ── mutation burst detection ────────────────────────────────────────────
    // A burst = ≥5 mutation frames within a 500ms window
    const mutFrames = seg.frames.filter(
      (f) => f.kind === "action" || f.kind === "mutation" || (Array.isArray(f.mutations) && f.mutations.length > 0)
    );

    let burstStart = null;
    let burstCount = 0;
    for (let i = 0; i < mutFrames.length; i++) {
      const t = mutFrames[i].t;
      if (burstStart === null) { burstStart = t; burstCount = 1; continue; }
      if (t - burstStart <= 500) {
        burstCount++;
      } else {
        if (burstCount >= 5) {
          findings.push(makeFinding(
            "warn", "performance",
            `DOM mutation burst: ${burstCount} changes in 500ms`,
            `Segment ${segId} had ${burstCount} DOM changes within a 500ms window starting at t=${burstStart}ms. This may cause layout thrashing or jank.`,
            { segmentId: segId }
          ));
          if (findings.length >= MAX_FINDINGS) break;
        }
        burstStart = t; burstCount = 1;
      }
    }

    // ── long wait between actions ───────────────────────────────────────────
    const actionFrames = seg.frames.filter((f) => f.kind === "action");
    for (let i = 1; i < actionFrames.length; i++) {
      const gap = actionFrames[i].t - actionFrames[i - 1].t;
      if (gap >= 5000) {
        findings.push(makeFinding(
          "info", "ux",
          `Long wait between actions: ${Math.round(gap / 1000)}s`,
          `In segment ${segId}, actions at t=${actionFrames[i - 1].t}ms and t=${actionFrames[i].t}ms have a ${Math.round(gap / 1000)}s gap — may indicate a blocking operation or user hesitation.`,
          { segmentId: segId, frameIndex: actionFrames[i].i }
        ));
        if (findings.length >= MAX_FINDINGS) break;
      }
    }

    // ── navigation mid-round ────────────────────────────────────────────────
    const navFrames = seg.frames.filter((f) => f.kind === "navigation");
    if (navFrames.length > 0) {
      findings.push(makeFinding(
        "info", "ux",
        `${navFrames.length} navigation(s) detected in segment`,
        `Segment ${segId} includes ${navFrames.length} navigation frame(s). Review the video to confirm these are expected page transitions.`,
        { segmentId: segId }
      ));
    }

    if (findings.length >= MAX_FINDINGS) break;
  }

  return findings;
}

// ─── meta analyzer ───────────────────────────────────────────────────────────

/**
 * Analyses meta.json for evidence quality signals (completeness, sync confidence).
 * @param {object} meta  — parsed meta.json
 * @returns {import("./enhance-analyzers.mjs").Finding[]}
 */
function analyzeMeta(meta) {
  if (!meta) return [];
  const findings = [];

  const c = meta.completeness;
  if (c) {
    if (c.video === "missing") {
      findings.push(makeFinding("critical", "ux", "Video evidence missing", "The round has no video — the review site cannot show the recording. Re-record this round.", {}));
    } else if (c.video === "partial") {
      findings.push(makeFinding("warn", "ux", "Video evidence partial", "The video recording has gaps. The operator may not be able to review all frames.", {}));
    }
    if (c.dom === "missing") {
      findings.push(makeFinding("critical", "ux", "DOM timeline missing", "No DOM evidence was captured. The round package is incomplete.", {}));
    }
    if (c.network === "missing" && meta.schemaVersion !== 2) {
      findings.push(makeFinding("warn", "network", "Network capture missing", "No network.har was produced. Network analysis is unavailable for this round.", {}));
    }
    if (Array.isArray(c.gaps) && c.gaps.length > 0) {
      findings.push(makeFinding("info", "ux", `${c.gaps.length} evidence gap(s) recorded`, `Gaps: ${c.gaps.map((g) => g.reason).join(", ")}. Evidence may be incomplete in these windows.`, {}));
    }
  }

  const sync = meta.sync;
  if (sync && sync.confidence === "low") {
    findings.push(makeFinding("info", "ux", "DOM-to-video sync confidence is low", `Sync method: ${sync.method || "unavailable"}. Timestamped comments may not align precisely with video frames. Run 'round.mjs calibrate' to improve this.`, {}));
  }

  return findings;
}

// ─── main entry point ────────────────────────────────────────────────────────

/**
 * Run all analyzers on a round's parsed evidence objects.
 * @param {{ meta: object, dom: object, har: object|null }} evidence
 * @returns {{ findings: object[], summary: object }}
 */
function analyzeRound({ meta, dom, har }) {
  resetCounter();
  const all = [
    ...analyzeMeta(meta),
    ...analyzeDom(dom),
    ...analyzeHar(har),
    ...analyzeTimeline(dom),
  ].slice(0, MAX_FINDINGS);

  const bySeverity = { critical: 0, warn: 0, info: 0 };
  for (const f of all) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;

  return {
    findings: all,
    summary: {
      total: all.length,
      critical: bySeverity.critical,
      warn: bySeverity.warn,
      info: bySeverity.info,
    },
  };
}

export { analyzeRound, analyzeDom, analyzeHar, analyzeTimeline, analyzeMeta };
