# UI Review Loop Maturity Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add upstream-friendly diagnostics, focused tests, and cross-platform CI without changing evidence formats or existing review-round behavior.

**Architecture:** Keep `scripts/round.mjs` as the public CLI and add `lib/diagnostics.mjs` as an isolated capability-classification module. Tests inject command execution results into the module, while the CLI provides a small real-process adapter. Existing self-tests remain the regression authority.

**Tech Stack:** Node.js >=22, ESM, built-in Node modules only, GitHub Actions.

## Global Constraints

- Zero runtime dependencies.
- Preserve existing start/run/stop/abort/pending/resolve/calibrate behavior.
- Preserve all existing evidence schemas and package formats.
- `doctor` must be read-only.
- Default backend remains `agent-browser`.
- Existing privacy and fail-closed behavior must not weaken.

---

### Task 1: Add focused failing doctor tests

**Files:**
- Create: `test/doctor.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runDoctor(options)` and `formatDoctor(result)` from `lib/diagnostics.mjs`.
- Produces: regression expectations for status aggregation and backend-specific checks.

- [ ] **Step 1: Add tests for pass/warn/fail aggregation**
- [ ] **Step 2: Add tests for missing agent-browser and missing capabilities**
- [ ] **Step 3: Add tests proving ffmpeg is optional for agent-browser**
- [ ] **Step 4: Add tests proving ffmpeg and browser-control become required for browser-control diagnostics**
- [ ] **Step 5: Add JSON and human-format output tests**
- [ ] **Step 6: Update `npm test` to run `test/doctor.mjs` before `test/self-test.mjs`**
- [ ] **Step 7: Run tests and confirm the doctor suite fails because `lib/diagnostics.mjs` does not exist**

### Task 2: Implement the diagnostic module

**Files:**
- Create: `lib/diagnostics.mjs`
- Test: `test/doctor.mjs`

**Interfaces:**
- `runDoctor({ backend, nodeVersion, exec }) -> { status, checks }`
- `formatDoctor(result) -> string`
- `aggregateStatus(checks) -> "pass" | "warn" | "fail"`

- [ ] **Step 1: Implement stable check records and aggregate status**
- [ ] **Step 2: Implement Node minimum-version classification**
- [ ] **Step 3: Probe `agent-browser --version` through the injected executor**
- [ ] **Step 4: Probe recording and network/HAR command help without starting either facility**
- [ ] **Step 5: Probe optional ffmpeg**
- [ ] **Step 6: For explicit browser-control diagnostics, probe browser-control version/status and require ffmpeg**
- [ ] **Step 7: Ensure raw stdout/stderr is summarized rather than copied into result details**
- [ ] **Step 8: Run focused tests until green**

### Task 3: Wire `doctor` into the existing CLI

**Files:**
- Modify: `scripts/round.mjs`
- Test: `test/doctor.mjs`

**Interfaces:**
- Adds commands: `doctor`, `doctor --json`, `doctor --backend browser-control`.

- [ ] **Step 1: Add CLI subprocess adapter using `spawnSync` with bounded timeouts and no shell**
- [ ] **Step 2: Route `doctor` before any project artifact-directory access**
- [ ] **Step 3: Print formatted text by default and stable JSON for `--json`**
- [ ] **Step 4: Exit 1 only when aggregate status is `fail`; warnings exit 0**
- [ ] **Step 5: Run focused tests and the full self-test**

### Task 4: Expand fast CI portability

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- CI verifies Node 22 and 24 on Linux, macOS, and Windows.

- [ ] **Step 1: Replace the single-runner matrix with `os x node-version`**
- [ ] **Step 2: Keep `fail-fast: false`**
- [ ] **Step 3: Run `npm test` identically on every matrix entry**
- [ ] **Step 4: Keep mutation workflow unchanged**

### Task 5: Document diagnostics

**Files:**
- Modify: `README.md`
- Modify: `SKILL.md`

**Interfaces:**
- Documents the three doctor forms and their exit semantics.

- [ ] **Step 1: Add a preflight/doctor section to README**
- [ ] **Step 2: Add agent guidance to run doctor when setup is uncertain or a recording preflight fails**
- [ ] **Step 3: State that capability checks complement, rather than erase, supported-version guidance**
- [ ] **Step 4: Re-read privacy language and ensure doctor docs make no new data-safety promises**

### Task 6: Verification and upstream packaging

**Files:**
- No production-file changes unless verification identifies defects.

- [ ] **Step 1: Run `npm test` on the branch**
- [ ] **Step 2: Inspect the complete diff against `main`**
- [ ] **Step 3: Confirm no evidence schema or existing CLI output was unintentionally changed**
- [ ] **Step 4: Let the expanded GitHub Actions matrix complete**
- [ ] **Step 5: Prepare a contribution summary focused on motivation, compatibility, tests, and risk**
