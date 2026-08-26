#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const shadow = require('../core/shadow-pilot');
const root = path.resolve(__dirname, '../..');
const requested = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const input = path.resolve(root, requested || 'suprimentos/fixtures/pilot-shadow-comparison.v1.json');
const fixture = JSON.parse(fs.readFileSync(input, 'utf8'));
if (fixture.syntheticOnly !== true && !process.argv.includes('--allow-non-synthetic')) {
  console.error(JSON.stringify({ pass: false, code: 'NON_SYNTHETIC_INPUT_REQUIRES_EXPLICIT_GATE' }, null, 2));
  process.exit(2);
}
const comparison = shadow.compare(fixture.legacy, fixture.ledger, fixture.criteria);
const report = { reportVersion: '1.0.0', generatedAt: new Date().toISOString(), input: path.relative(root, input).replace(/\\/g, '/'), syntheticOnly: fixture.syntheticOnly === true, pass: comparison.promotionAllowed, comparison };
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
