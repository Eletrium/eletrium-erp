#!/usr/bin/env node
'use strict';
const childProcess = require('child_process');
const boundary = require('../core/change-boundary');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}
const base = argument('--base', process.env.SUPRIMENTOS_BASE_REF || 'origin/active-suprimentos-v1.2.1-20260824');
const head = argument('--head', 'HEAD');
const execution = childProcess.spawnSync('git', ['diff', '--name-only', base + '...' + head], { encoding: 'utf8' });
if (execution.status !== 0) {
  console.error(JSON.stringify({ ok: false, code: 'BOUNDARY_DIFF_FAILED', base: base, head: head, stderr: (execution.stderr || '').trim() }, null, 2));
  process.exit(2);
}
const report = Object.assign({ base: base, head: head }, boundary.evaluate((execution.stdout || '').split(/\r?\n/)));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
