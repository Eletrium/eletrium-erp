const assert = require('assert');
const gate = require('../suprimentos/core/deployment-gate');
const bomContract = require('../suprimentos/contracts/bomcontrole-gate0.v1.json');

(function safeShadowProfilePassesWithoutExternalAuthority() {
  const result = gate.evaluate({ mode: 'SHADOW', externalWritesEnabled: false, bomControleProduction: false }, bomContract);
  assert.strictEqual(result.allowed, true); assert.strictEqual(result.allowedMode, 'SHADOW');
})();

(function shadowWritesAndPlaintextSecretsAreRejected() {
  const result = gate.evaluate({ mode: 'SHADOW', externalWritesEnabled: true, clientSecret: 'must-not-exist' }, bomContract);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.blockers.some((item) => item.code === 'SHADOW_EXTERNAL_WRITES_FORBIDDEN'));
  assert.ok(result.blockers.some((item) => item.code === 'PLAINTEXT_SECRET_FIELD_REJECTED'));
})();

(function productionCannotBypassHomologationOrGateH() {
  const profile = { mode: 'PRODUCTION', siteId: 'site', listIds: ['x'], serviceAccountOwner: 'owner', secretProviderRef: 'vault://ref', dlpPolicyRef: 'dlp-1', rollbackEvidenceRef: 'ev-1', reconciliationEvidenceRef: 'ev-2' };
  const result = gate.evaluate(profile, bomContract);
  assert.strictEqual(result.allowed, false);
  assert.ok(result.blockers.some((item) => item.code === 'HOMOLOGATION_APPROVAL_REQUIRED'));
  assert.ok(result.blockers.some((item) => item.code === 'BOMCONTROLE_PRODUCTION_DISABLED_BY_CONTRACT'));
})();

console.log('suprimentos-deployment-gate.test.js: OK — shadow seguro, evidências e Gate H');
