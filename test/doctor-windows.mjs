#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execProbe } from "../scripts/doctor.mjs";

if (process.platform !== "win32") {
  console.log("doctor windows integration: skipped (not Windows)");
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-doctor-win-"));
const oldPath = process.env.PATH;
const oldPathext = process.env.PATHEXT;

try {
  fs.writeFileSync(path.join(dir, "ar-doctor-probe.cmd"), "@echo off\r\necho shim-ok\r\n");
  process.env.PATH = `${dir}${path.delimiter}${oldPath || ""}`;
  process.env.PATHEXT = oldPathext || ".COM;.EXE;.BAT;.CMD";

  const result = execProbe({ bin: "ar-doctor-probe", args: [], timeoutMs: 5000 });
  assert.equal(result.status, 0, `expected .cmd probe to run, got ${JSON.stringify(result)}`);
  assert.match(result.stdout, /shim-ok/i);
  console.log("doctor windows integration: 1 passed");
} finally {
  if (oldPath === undefined) delete process.env.PATH;
  else process.env.PATH = oldPath;
  if (oldPathext === undefined) delete process.env.PATHEXT;
  else process.env.PATHEXT = oldPathext;
  fs.rmSync(dir, { recursive: true, force: true });
}
