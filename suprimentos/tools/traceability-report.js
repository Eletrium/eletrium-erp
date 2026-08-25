#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..'); const matrix = JSON.parse(fs.readFileSync(path.join(root, 'suprimentos/contracts/traceability.v1.json')));
const rows = matrix.requirements.map((item) => { const missing = [item.implementation].concat(item.tests).filter((file) => !fs.existsSync(path.join(root, file))); return Object.assign({}, item, { complete: missing.length === 0, missing }); });
const report = { version: matrix.version, complete: rows.every((item) => item.complete), requirements: rows.length, rows };
console.log(JSON.stringify(report, null, 2)); if (!report.complete) process.exitCode = 1;
