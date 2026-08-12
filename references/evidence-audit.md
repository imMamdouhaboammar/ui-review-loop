# Evidence audit

`evidence.mjs audit` checks finalized `.agent-review/<roundId>/` packages against the package contract documented in `formats.md`.

It is intentionally read-only. The audit never creates, repairs, deletes, renames, or rewrites evidence. It also refuses to follow symlinked evidence roots and treats symlinked package entries as failures.

This is structural verification, not cryptographic tamper detection. A structurally valid file can still have been replaced with another structurally valid file. Cryptographic manifests, if introduced, belong to a separate format change.

## Commands

From the project whose evidence should be checked:

```bash
node "$AR_SKILL_DIR/scripts/evidence.mjs" audit
node "$AR_SKILL_DIR/scripts/evidence.mjs" audit --json
node "$AR_SKILL_DIR/scripts/evidence.mjs" audit --round 20260717T142233Z-a1b2c3
```

To audit another project without changing the current directory:

```bash
node "$AR_SKILL_DIR/scripts/evidence.mjs" audit --project /path/to/project
```

Exit status:

- `0`: no hard structural failure; warnings may still be present
- `1`: at least one structural check failed
- `2`: invalid command-line usage

## What fails

Examples of hard failures include:

- a symlinked `.agent-review` root or symlinked entry inside a finalized package
- missing, non-regular, or malformed required JSON files
- mismatched `roundId` values or unsupported schema versions
- invalid metadata timestamps, summary bounds, completeness values, or DOM segment shape
- video evidence missing when the metadata does not declare it `missing`
- a missing or malformed v1 HAR when network evidence is declared present
- any HAR in a browser-control v2 package, or v2 metadata that declares network evidence present
- missing or invalid comment JPEG sidecars
- resolution records that do not refer to comments in the feedback round or carry invalid round/timestamp fields
- raw/transient capture files such as `network.raw.har`, `video.webm.json`, or `frames-*.jsonl` left in a finalized package

## What warns

Warnings identify states that deserve attention but can be forwards-compatible or internally consistent:

- `.agent-review` does not exist, so there is nothing to audit
- a video file exists while metadata declares video evidence `missing`
- a v1 HAR exists while metadata declares network evidence `missing`
- an unknown top-level artifact is present
- a JPEG exists in `comment-images/` without a matching comment

Unknown additions are warnings rather than failures so a newer package format does not automatically make an older audit unusable.

## Backends

The audit understands the currently documented package split:

- schema v1 `meta.json`: agent-browser evidence, with HAR presence following `completeness.network`
- schema v2 `meta.json`: browser-control evidence, `versions.backend` is `browser-control`, network completeness is `missing`, and `network.har` is absent

The other package JSON files remain schema version 1 in both cases.

## Downstream: Auto-Enhance

After a structural audit passes, consider running the auto-enhance pipeline to extract
actionable signals from the evidence without waiting for operator comments:

```bash
node "$AR_SKILL_DIR/scripts/enhance.mjs" analyze --round <roundId>
node "$AR_SKILL_DIR/scripts/enhance.mjs" suggest --round <roundId>
```

`enhance analyze` reads `dom.json`, `network.har`, and `meta.json` from the same package
and produces `enhance.json` (structured findings) and, on `suggest`, `suggestions.md`
(human-readable with patch guidance). Output lands in the same round directory and is
gitignored. See `SKILL.md` → "Auto-Enhance Loop" for the full workflow.
