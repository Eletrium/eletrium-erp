const assert = require('assert');
const security = require('../suprimentos/core/security');

(function leastPrivilegeAndFeatureGates() {
  assert.strictEqual(security.authorize({ roles: ['OS_SERVICE'] }, 'os.consume.v1'), true);
  assert.strictEqual(security.authorize({ roles: ['OS_SERVICE'] }, 'reserve'), false);
  assert.strictEqual(security.authorize({ roles: ['AUDITORIA'] }, 'manualRetry'), false);
  const flags = security.flags({ sharePointWrites: true, bomControleProduction: true });
  assert.strictEqual(flags.sharePointWrites, true); assert.strictEqual(flags.bomControleProduction, false); assert.strictEqual(flags.shadowMode, true);
})();

(function secretsAreRecursivelyRedacted() {
  const safe = security.redact({ actorId: 'u1', Authorization: 'Bearer abc', nested: { clientSecret: 'xyz', materialId: 'm1' }, rows: [{ cpf: '000', quantity: 1 }] });
  assert.strictEqual(safe.Authorization, '[REDACTED]'); assert.strictEqual(safe.nested.clientSecret, '[REDACTED]'); assert.strictEqual(safe.nested.materialId, 'm1'); assert.strictEqual(safe.rows[0].cpf, '[REDACTED]');
})();

console.log('suprimentos-security.test.js: OK — RBAC, flags e redaction');
