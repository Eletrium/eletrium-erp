#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const gate = require('../core/deployment-gate');
const bomContract = require('../contracts/bomcontrole-gate0.v1.json');
const root = path.resolve(__dirname, '../..');
const requested = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const input = path.resolve(root, requested || 'suprimentos/fixtures/deployment-profile.shadow.v1.json');
const profile = JSON.parse(fs.readFileSync(input, 'utf8'));
const evaluation = gate.evaluate(profile, bomContract);
const report = { reportVersion: '1.0.0', generatedAt: new Date().toISOString(), input: path.relative(root, input).replace(/\\/g, '/'), pass: evaluation.allowed, evaluation };
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
