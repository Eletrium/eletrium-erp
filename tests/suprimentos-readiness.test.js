const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');
const execution = childProcess.spawnSync(process.execPath, [path.join(__dirname, '../suprimentos/tools/readiness-report.js')], { encoding: 'utf8' });
assert.strictEqual(execution.status, 0, execution.stderr);
const report = JSON.parse(execution.stdout);
assert.strictEqual(report.readyForEnvironmentHomologation, true);
assert.ok(report.checks.every((item) => item.ok));
console.log('suprimentos-readiness.test.js: OK — pacote pronto para homologação de ambiente');
