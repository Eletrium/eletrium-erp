const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');
const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, '../suprimentos/tools/performance-budget.js')], { encoding: 'utf8' });
assert.strictEqual(result.status, 0, result.stdout + result.stderr); const report = JSON.parse(result.stdout);
assert.strictEqual(report.passed, true); assert.deepStrictEqual(report.results.map((item) => item.events), [5000, 20000]);
console.log('suprimentos-performance-budget.test.js: OK — orçamento 5k/20k');
