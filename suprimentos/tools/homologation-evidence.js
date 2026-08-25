#!/usr/bin/env node
'use strict';
const childProcess = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '../..');
function run(args) { const result = childProcess.spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr || result.stdout); return JSON.parse(result.stdout); }
try {
  const tests = run(['tests/run-suprimentos.js', '--json']);
  const readiness = run(['suprimentos/tools/readiness-report.js']);
  const gates = run(['suprimentos/tools/gate-report.js']);
  const release = run(['suprimentos/tools/release-manifest.js']);
  console.log(JSON.stringify({ evidenceVersion: '1.0.0', generatedAt: new Date().toISOString(), pass: tests.failed === 0 && readiness.readyForEnvironmentHomologation && gates.complete, tests: { total: tests.total, passed: tests.passed, failed: tests.failed }, readiness, gates, release: { release: release.release, files: release.files, aggregateSha256: release.aggregateSha256 } }, null, 2));
} catch (error) { console.error(JSON.stringify({ pass: false, error: error.message })); process.exitCode = 1; }
