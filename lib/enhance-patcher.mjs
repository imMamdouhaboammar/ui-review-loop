/**
 * UI Review Loop — enhance-patcher.mjs
 *
 * Converts analyzer findings into safe, reversible patch suggestions.
 * A patch is a structured description of a change — it is NEVER applied
 * automatically. The caller (enhance.mjs apply) must pass --auto explicitly,
 * and even then only patches classified as "safe" are written.
 *
 * "Safe" means:
 *  - Adding or rewriting a missing accessibility attribute (aria-label, alt)
 *  - Never touching JS logic, CSS rules, or multi-element structures
 *  - Always idempotent (applying twice produces the same result)
 *
 * Patch shape:
 *   {
 *     findingId,          // links back to the finding that generated this patch
 *     file,               // relative path to the file containing the element
 *     selector,           // CSS selector for the target element
 *     attribute,          // HTML attribute name to add/update
 *     currentValue,       // current value (null if absent)
 *     suggestedValue,     // human-readable suggestion (agent fills in the real value)
 *     safe,               // boolean — can be auto-applied
 *     rationale,          // one-line reason
 *   }
 */
"use strict";

// ─── patch generators ────────────────────────────────────────────────────────

/**
 * Generate patches for a list of findings.
 * Only accessibility-category findings with a known selector produce patches.
 * @param {object[]} findings
 * @returns {object[]} patches
 */
function generatePatches(findings) {
  const patches = [];

  for (const finding of findings) {
    if (!finding) continue;

    // Only produce patches for accessibility findings with a selector
    if (finding.category !== "accessibility") continue;
    const selector = finding.evidence && finding.evidence.selector;
    if (!selector) continue;

    // Determine which attribute is missing
    const isButton = /^button|^input\[type=.?button|^input\[type=.?submit/i.test(selector);
    const isImg = /^img|^\[role=.?img/i.test(selector);
    const isInput = /^input|^select|^textarea/i.test(selector);

    if (isImg) {
      patches.push(makePatch(finding.id, selector, "alt", null, "<descriptive alt text>",
        "Images require descriptive alt text for screen readers (WCAG 1.1.1 Level A).", true));
    } else if (isButton) {
      patches.push(makePatch(finding.id, selector, "aria-label", null, "<action label>",
        "Buttons without visible text need an aria-label for screen reader users (WCAG 4.1.2 Level A).", true));
    } else if (isInput) {
      patches.push(makePatch(finding.id, selector, "aria-label", null, "<field label>",
        "Form controls require an accessible label — add aria-label or associate a <label> (WCAG 1.3.1 Level A).", true));
    } else {
      // generic interactive element — suggest aria-label but mark as not auto-safe
      patches.push(makePatch(finding.id, selector, "aria-label", null, "<accessible name>",
        "Interactive element without accessible name — review manually (WCAG 4.1.2).", false));
    }
  }

  return patches;
}

function makePatch(findingId, selector, attribute, currentValue, suggestedValue, rationale, safe) {
  return { findingId, file: null, selector, attribute, currentValue, suggestedValue, safe, rationale };
}

/**
 * Filter patches to only those that are safe to auto-apply.
 * @param {object[]} patches
 * @returns {object[]}
 */
function safePatches(patches) {
  return patches.filter((p) => p.safe === true);
}

/**
 * Render patches as a Markdown diff block for human review.
 * @param {object[]} patches
 * @returns {string}
 */
function renderPatchesMd(patches) {
  if (patches.length === 0) return "_No patchable findings._\n";
  const lines = [];
  for (const p of patches) {
    lines.push(`### ${p.findingId} — \`${p.selector}\``);
    lines.push(`**Attribute:** \`${p.attribute}\``);
    lines.push(`**Suggested value:** \`${p.suggestedValue}\``);
    lines.push(`**Rationale:** ${p.rationale}`);
    lines.push(`**Auto-safe:** ${p.safe ? "✅ yes" : "⚠️ no — review manually"}`);
    lines.push("");
  }
  return lines.join("\n");
}

export { generatePatches, safePatches, renderPatchesMd };
