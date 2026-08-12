# Evidence Audit Implementation Plan

**Goal:** Add a read-only, mutation-proven structural audit for finalized evidence packages without changing existing recording or review behavior.

**Architecture:** A deep `lib/evidence-audit.mjs` module owns filesystem containment and package validation. A thin `scripts/evidence.mjs` CLI owns parsing, formatting selection, and exit codes. Tests use real temporary directories and no browser dependencies.

## Tasks

### 1. Define the public contract with failing tests
- Create `test/evidence-audit.mjs`.
- Cover status aggregation, valid v1/v2 fixtures, absent library, symlink refusal, required artifacts, schema and round-id consistency, network rules, comments/images, resolutions, transient leftovers, warnings, filtering, formatting, and CLI usage.
- Confirm RED because the audit module does not exist.

### 2. Implement the audit module
- Create `lib/evidence-audit.mjs`.
- Keep all reads no-follow and containment-checked.
- Return stable `pass|warn|fail` records only.
- Never repair or mutate project evidence.
- Make valid v1 and v2 fixtures GREEN.

### 3. Implement the CLI
- Create `scripts/evidence.mjs`.
- Support `audit`, `--project`, `--round`, `--json`, and help.
- Exit 0 for pass/warn, 1 for structural failure, 2 for usage error.
- Do not create `.agent-review` when absent.

### 4. Mutation-proof the new checks
- Create `test/mutate-evidence-audit.mjs` with unique string anchors.
- Sabotage containment, required files, round-id checks, schema rules, network consistency, image validation, resolution-key validation, transient artifact detection, and CLI parsing.
- Require every named mutation to make its targeted check fail.

### 5. Verify independently
- Add a dedicated PR CI workflow file for the evidence audit only so this PR remains independent from the diagnostics contribution.
- Run Node 22/24 on Ubuntu, macOS, and Windows for the focused suite.
- Run the focused mutation proof on Ubuntu Node 22.
- Keep the existing main CI unchanged.

### 6. Upstream packaging
- Remove internal spec/plan files from the clean contribution.
- Squash to one commit above upstream main.
- Review the complete diff for one-concern scope and zero dependencies.
- Open a separate upstream PR only after its exact head commit passes the focused CI and existing `npm test` is re-run in a temporary fork mirror.
