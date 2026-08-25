const assert = require('assert');
const schema = require('../suprimentos/contracts/sharepoint-lists.v1.json');
const provisioning = require('../suprimentos/core/sharepoint-provisioning');

(function canonicalListsAndIndexesExist() {
  ['Necessidades_Materiais', 'Reservas_Estoque', 'Movimentacoes_Estoque', 'Estoque_Projetado', 'Eventos_Integracao'].forEach((name) => {
    assert.ok(schema.lists[name], name);
    assert.ok(schema.lists[name].indexed.length > 0, name + ': indexes');
  });
  assert.strictEqual(schema.writerPolicy, 'SINGLE_WRITER_SERVICE_ACCOUNT');
  assert.deepStrictEqual(schema.permissions.CRM_SERVICE, []);
})();

(function dryRunPlansMissingResourcesWithoutWriting() {
  const plan = provisioning.buildPlan(schema, { lists: {}, permissions: {} });
  assert.strictEqual(plan.dryRun, true);
  assert.ok(plan.actions.some((action) => action.type === 'CREATE_LIST' && action.list === 'Reservas_Estoque'));
  assert.ok(plan.actions.some((action) => action.type === 'CREATE_UNIQUE_GUARD' && action.rule === 'Idempotency_Key'));
})();

(async function liveProvisioningRequiresExplicitGate() {
  const plan = provisioning.buildPlan(schema, { lists: {}, permissions: {} });
  await assert.rejects(() => provisioning.applyPlan(plan, { apply: async () => ({ ok: true }) }, { dryRun: false }), /LIVE_PROVISIONING_GATE_CLOSED/);
  const dry = await provisioning.applyPlan(plan, null, { dryRun: true });
  assert.strictEqual(dry.applied, false);
})();

(function destructiveFieldMutationIsBlocked() {
  const current = {
    lists: { Necessidades_Materiais: { fields: { Necessidade_ID: 'Number:required' }, indexed: [], unique: [] } },
    permissions: {}
  };
  const plan = provisioning.buildPlan(schema, current);
  assert.ok(plan.blocked.some((action) => action.list === 'Necessidades_Materiais' && action.field === 'Necessidade_ID'));
})();

console.log('suprimentos-sharepoint-schema.test.js: OK — schema físico e dry-run');
