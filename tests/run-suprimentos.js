#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir)
  .filter((name) => /^suprimentos-.*\.test\.js$/.test(name))
  .sort();
const startedAt = new Date().toISOString();
const results = [];

files.forEach((name) => {
  const execution = childProcess.spawnSync(process.execPath, [path.join(testsDir, name)], {
    encoding: 'utf8', env: Object.assign({}, process.env, { SUPRIMENTOS_TEST_MODE: 'shadow' })
  });
  results.push({
    test: name,
    ok: execution.status === 0,
    exitCode: execution.status,
    stdout: (execution.stdout || '').trim(),
    stderr: (execution.stderr || '').trim()
  });
});

const report = {
  suite: 'Suprimentos A-F + piloto-sombra',
  startedAt,
  finishedAt: new Date().toISOString(),
  total: results.length,
  passed: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
  results
};

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  results.forEach((item) => console.log((item.ok ? 'PASS' : 'FAIL') + ' ' + item.test));
  console.log(`Resultado: ${report.passed}/${report.total} suítes verdes`);
}
if (report.failed) process.exitCode = 1;
