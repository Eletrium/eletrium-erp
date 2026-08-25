const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');
function run(file, args) { return childProcess.spawnSync(process.execPath, [path.join(__dirname, '..', file)].concat(args || []), { encoding: 'utf8' }); }

(function osConsumerKitIsExecutable() {
  const result = run('suprimentos/tools/verify-os-contract.js'); assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout); assert.strictEqual(report.compatible, true); assert.strictEqual(report.operation, 'os.consume.v1');
})();

(function everyGateHasExistingTestsAndReleaseIsFingerprintable() {
  const gates = run('suprimentos/tools/gate-report.js'); assert.strictEqual(gates.status, 0, gates.stderr); assert.strictEqual(JSON.parse(gates.stdout).gates.length, 8);
  const release = run('suprimentos/tools/release-manifest.js'); assert.strictEqual(release.status, 0, release.stderr); const manifest = JSON.parse(release.stdout);
  assert.match(manifest.aggregateSha256, /^[a-f0-9]{64}$/); assert.ok(manifest.files > 40);
})();

console.log('suprimentos-contract-kit-release.test.js: OK — kit OS, Gates e release manifest');
