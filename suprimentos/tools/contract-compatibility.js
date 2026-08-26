#!/usr/bin/env node
'use strict';
const baseline = require('../contracts/public-command-surface.v1.json');
const current = require('../contracts/commands.v1.json');
const compatibility = require('../core/contract-compatibility');
const report = compatibility.check(baseline, current);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
