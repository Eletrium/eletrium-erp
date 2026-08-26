const assert = require('assert');
const schema = require('../suprimentos/contracts/sharepoint-lists.v1.json');
const verifier = require('../suprimentos/core/sharepoint-schema-verifier');

function conformantSnapshot() {
  const lists = {};
  Object.keys(schema.lists).forEach((name) => {
    lists[name] = JSON.parse(JSON.stringify(schema.lists[name]));
  });
  return { capturedAt: '2026-08-25T00:00:00Z', writerPolicy: schema.writerPolicy, lists, permissions: JSON.parse(JSON.stringify(schema.permissions)) };
}

(function detectsConformantSnapshotAndCreatesStableEvidence() {
  const report = verifier.verify(schema, conformantSnapshot());
  assert.strictEqual(report.conformant, true);
  assert.strictEqual(report.findings.length, 0);
  assert.strictEqual(report.desiredFingerprint, verifier.fingerprint(schema));
})();

(function additiveDriftProducesExecutableDryRunPlan() {
  const snapshot = conformantSnapshot();
  delete snapshot.lists.Reservas_Estoque.fields.Correlation_ID;
  snapshot.lists.Reservas_Estoque.indexed = snapshot.lists.Reservas_Estoque.indexed.filter((field) => field !== 'Correlation_ID');
  const report = verifier.verify(schema, snapshot);
  const plan = verifier.migrationPlan(report);
  assert.strictEqual(report.safeToApplyAdditiveMigration, true);
  assert.ok(plan.actions.some((item) => item.action === 'CREATE_FIELD' && item.field === 'Correlation_ID'));
  assert.ok(plan.actions.some((item) => item.action === 'CREATE_INDEX' && item.field === 'Correlation_ID'));
})();

(function destructiveAndConcurrencyDriftBlockAutomaticMigration() {
  const snapshot = conformantSnapshot();
  snapshot.lists.Necessidades_Materiais.fields.Necessidade_ID = 'Number:required';
  snapshot.lists.Necessidades_Materiais.concurrencyField = 'Modified';
  snapshot.writerPolicy = 'DIRECT_UI_WRITES';
  const report = verifier.verify(schema, snapshot);
  const plan = verifier.migrationPlan(report);
  assert.strictEqual(report.safeToApplyAdditiveMigration, false);
  assert.strictEqual(plan.blocked, true);
  assert.ok(report.blockers.some((item) => item.code === 'FIELD_DEFINITION_MISMATCH'));
  assert.ok(report.blockers.some((item) => item.code === 'WRITER_POLICY_DRIFT'));
})();

(function permissionsAndAppendOnlyAreAudited() {
  const snapshot = conformantSnapshot();
  snapshot.permissions.CRM_SERVICE = ['append'];
  snapshot.lists.Movimentacoes_Estoque.appendOnly = false;
  const report = verifier.verify(schema, snapshot);
  assert.ok(report.findings.some((item) => item.code === 'PERMISSION_DRIFT' && item.role === 'CRM_SERVICE'));
  assert.ok(report.findings.some((item) => item.code === 'APPEND_ONLY_POLICY_DRIFT'));
})();

console.log('suprimentos-sharepoint-verifier.test.js: OK — drift, evidência e migração segura');
