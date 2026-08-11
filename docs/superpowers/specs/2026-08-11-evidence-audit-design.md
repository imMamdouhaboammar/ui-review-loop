# Evidence Audit Design

## Goal

Add a read-only structural audit for finalized `.agent-review/<roundId>/` packages. The audit verifies the existing frozen package contract without changing recorder behavior, evidence schemas, or review-server semantics.

## Constraints

- Zero runtime dependencies and Node >=22.
- Read-only: never create, rewrite, delete, rename, chmod, or repair evidence.
- Never follow symlinked `.agent-review`, round directories, artifacts, or comment-image directories.
- Do not claim cryptographic tamper detection. This phase checks structural consistency only.
- Support both agent-browser v1 packages and browser-control v2 `meta.json` packages.
- Ignore `.partial-*` and control files at the library root; finalized round directories are the audit target.

## Public interface

```bash
node scripts/evidence.mjs audit
node scripts/evidence.mjs audit --project /path/to/project
node scripts/evidence.mjs audit --round 20260717T142233Z-a1b2c3
node scripts/evidence.mjs audit --json
```

Omitting `--round` audits every finalized round. Exit 0 means no hard structural failure (warnings may exist), exit 1 means at least one round failed, and exit 2 means invalid CLI usage.

## Checks

Library:
- Project path must exist and resolve to a directory.
- `.agent-review` absent is a warning with zero rounds.
- `.agent-review` must be a real directory, never a symlink.
- Finalized rounds must use the canonical round-id shape and be real contained directories.

Per round:
- `meta.json`, `dom.json`, `comments.json`, and `resolutions.json` are required regular non-symlink files containing valid JSON.
- `video.webm` is required, regular, non-symlink, and non-empty.
- Directory name and every JSON `roundId` must agree.
- `meta.schemaVersion` is 1 or 2; `dom/comments/resolutions.schemaVersion` is 1.
- `meta.completeness.video|dom|network` values are `complete|partial|missing`.
- v2 meta requires `versions.backend === "browser-control"`, `completeness.network === "missing"`, and no `network.har`.
- v1 requires `network.har` when network completeness is not `missing`; a present HAR must be a regular non-symlink file containing parseable HAR JSON.
- `comments.reviewState` is `open|submitted`; `comments.comments` is an array.
- Every comment id has canonical `c-<uuid>` shape and has a non-empty JPEG sidecar under a real `comment-images` directory.
- Resolution keys must refer to comments in the same round; each item carries a canonical `resolvedInRoundId` and readable `resolvedAt` timestamp.
- Finalized packages fail if raw/transient recorder artifacts remain: `network.raw.har`, `video.webm.json`, or `frames-*.jsonl`.
- Orphan JPEGs and unknown top-level files are warnings, not failures, to avoid breaking forwards-compatible additions.

## Architecture

`lib/evidence-audit.mjs` owns containment, parsing, package checks, aggregate status, and human formatting. `scripts/evidence.mjs` owns argument parsing and exit codes only.

The audit result shape is stable and automation-friendly:

```json
{
  "status": "warn",
  "project": "/real/path",
  "summary": { "rounds": 2, "passed": 1, "warned": 1, "failed": 0 },
  "checks": [],
  "rounds": [
    { "roundId": "...", "status": "pass", "checks": [] }
  ]
}
```

Checks contain only `id`, `status`, and `message`.

## Testing

Focused tests build temporary libraries and cover: empty library, symlink refusal, valid v1/v2 packages, missing/malformed required files, cross-file round-id mismatch, completeness/network consistency, invalid comments/images, invalid resolution keys, raw leftovers, warnings for unknown/orphan files, round filtering, JSON/human output, and strict CLI parsing.

A focused mutation harness must prove the important checks can fail before the contribution is considered ready.
