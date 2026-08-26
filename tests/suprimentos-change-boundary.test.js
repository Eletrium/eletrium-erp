const assert = require('assert');
const boundary = require('../suprimentos/core/change-boundary');

(function protectsSharedFilesAcrossPathStyles() {
  const report = boundary.evaluate([
    './suprimentos/core/ledger.js', 'tests/suprimentos-ledger.test.js', '.\\graph.js', 'os.html', 'os.html'
  ]);
  assert.strictEqual(report.ok, false);
  assert.deepStrictEqual(report.violations, ['graph.js', 'os.html']);
  assert.deepStrictEqual(report.allowed, ['suprimentos/core/ledger.js', 'tests/suprimentos-ledger.test.js']);
  assert.strictEqual(boundary.evaluate(['suprimentos/core/ledger.js']).ok, true);
})();

console.log('suprimentos-change-boundary.test.js: OK — arquivos compartilhados protegidos por CI');
