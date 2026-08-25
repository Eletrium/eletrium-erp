#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'suprimentos/contracts/gates.v1.json'), 'utf8'));
const gates = Object.keys(matrix.gates).sort().map((gate) => {
  const tests = matrix.gates[gate]; const missing = tests.filter((name) => !fs.existsSync(path.join(root, 'tests', name)));
  return { gate, declaredTests: tests.length, complete: missing.length === 0, missing };
});
const report = { version: matrix.version, complete: gates.every((gate) => gate.complete), gates };
console.log(JSON.stringify(report, null, 2)); if (!report.complete) process.exitCode = 1;
