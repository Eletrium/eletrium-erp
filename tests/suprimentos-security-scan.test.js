const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');
const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, '../suprimentos/tools/security-scan.js')], { encoding: 'utf8' });
assert.strictEqual(result.status, 0, result.stdout + result.stderr);
const report = JSON.parse(result.stdout); assert.strictEqual(report.passed, true); assert.ok(report.scannedFiles > 30);
console.log('suprimentos-security-scan.test.js: OK — sem segredo ou chamada direta');
