#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import { safeCmdInvocation } from "../scripts/doctor.mjs";

assert.equal(
  safeCmdInvocation("C:\\Program Files\\probe.cmd", ["--version"]),
  '"C:\\Program Files\\probe.cmd" --version',
);
assert.equal(safeCmdInvocation("C:\\probe.cmd", ["--version", "bad&arg"]), null);
assert.equal(
  safeCmdInvocation("C:\\probe.cmd", ["status", "--json"]),
  '"C:\\probe.cmd" status --json',
);

console.log("doctor command tests: 3 passed");
