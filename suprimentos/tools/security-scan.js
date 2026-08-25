#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
const files = walk(path.join(root, 'suprimentos')).filter((file) => /\.(js|json|ya?ml|html|md)$/.test(file) && !/security-scan\.js$/.test(file));
const rules = [
  { code: 'HARDCODED_BEARER', pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/g },
  { code: 'HARDCODED_SECRET', pattern: /(clientSecret|apiKey|password)\s*[:=]\s*['"][^'"]{8,}['"]/gi },
  { code: 'DIRECT_BOMCONTROLE_UI_CALL', pattern: /(?:demo-shadow|suprimentos\.html)[\s\S]{0,200}(?:bomcontrole|documenter\.getpostman)/gi }
];
const findings = [];
files.forEach((file) => { const content = fs.readFileSync(file, 'utf8'); rules.forEach((rule) => { if (rule.pattern.test(content)) findings.push({ code: rule.code, file: path.relative(root, file).replace(/\\/g, '/') }); rule.pattern.lastIndex = 0; }); });
const report = { scannedFiles: files.length, passed: findings.length === 0, findings };
console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
