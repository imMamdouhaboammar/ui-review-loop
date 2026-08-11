# UI Review Loop Maturity Phase 1 Design

## Goal

Raise upstream readiness without changing existing round formats, recorder semantics, review-server behavior, or the public start/run/stop workflow.

## Contribution constraints

- Preserve compatibility with the upstream `main` branch at commit `de1854621ac067d1cf9a81953813e217061af0c7`.
- Keep Node >=22 and zero runtime dependencies.
- Do not change schema versions or evidence payload shapes in this phase.
- Do not make `browser-control` the default backend.
- Keep privacy and fail-closed behavior at least as strict as the current implementation.
- Prefer additive modules and small integration diffs over a rewrite.

## Phase 1 scope

### 1. Doctor and capability diagnostics

Add a `doctor` command that reports whether the local environment can support review rounds before a round starts. Diagnostics are capability-based where practical rather than relying on a single version string.

The command must support human-readable output and `--json`.

Checks:

- Node version and minimum support.
- `agent-browser` availability and reported version.
- Required `agent-browser` command families used by the runner: recording and HAR/network capture.
- `ffmpeg` availability as an optional calibration helper.
- `browser-control` availability only when explicitly requested with `--backend browser-control`.
- Overall status must distinguish `pass`, `warn`, and `fail`.

`doctor` must be read-only: it may execute dependency help/version/status commands but must not create `.agent-review/`, start a browser session, begin a recording, or change project files.

### 2. Diagnostic module boundary

Place the diagnostic policy in `lib/diagnostics.mjs`. The module receives injectable command execution functions so tests can be hermetic and the CLI file remains thin.

The module exposes pure classification helpers plus `runDoctor()` and `formatDoctor()`.

### 3. Test architecture seed

Add focused doctor tests in `test/doctor.mjs`. Keep the existing self-test unchanged as the compatibility regression suite.

`npm test` must execute both suites. This starts decomposing tests by responsibility without rewriting the 416-check suite.

### 4. CI portability

Extend the fast CI matrix across Ubuntu, macOS, and Windows on Node 22 and 24. Keep mutation testing separate because it is intentionally expensive.

### 5. Documentation

Document `doctor`, JSON output, backend-specific checks, and the difference between version compatibility and capability diagnostics in README and SKILL docs.

## Public interface

```bash
node scripts/round.mjs doctor
node scripts/round.mjs doctor --json
node scripts/round.mjs doctor --backend browser-control
```

Human output example:

```text
UI Review Loop doctor
PASS node              Node 24.5.0
PASS agent-browser     0.33.1
PASS recording         record command available
PASS network           network har command available
WARN ffmpeg             not found; only calibration contact sheets are affected

status: pass with warnings
```

JSON shape:

```json
{
  "status": "warn",
  "checks": [
    { "id": "node", "status": "pass", "message": "Node 24.5.0" }
  ]
}
```

Check objects use only `id`, `status`, `message`, and optional `details` so downstream automation can consume them without parsing prose.

## Error policy

- A missing required runtime capability is `fail`.
- A supported runtime with an unrecognized newer dependency version is not automatically a failure when required capabilities are present.
- Optional tooling such as ffmpeg is `warn` unless the selected backend requires it.
- Diagnostics never expose environment variables or command output that may contain secrets.

## Testing strategy

Doctor tests use injected command results, not real browser installations. Tests cover missing binaries, old Node, compatible and newer agent-browser versions, required capabilities, optional ffmpeg, browser-control opt-in behavior, JSON structure, and aggregate status.

Existing `test/self-test.mjs` continues to protect the current evidence and server contracts. Mutation testing remains unchanged in this phase.

## Out of scope

Evidence manifests, retention/prune commands, resolution timestamps, broad `round.mjs` decomposition, UI redesign, TypeScript migration, and schema changes belong to later independently reviewable contributions.
