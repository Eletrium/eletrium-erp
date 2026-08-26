const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');
const integration = require('../suprimentos/core/integration-contracts');

(function osConsumesByContractAndFinanceReceivesIndependentObligation() {
  let state = ledger.createState({ openingStockByMaterial: { m1: 3 }, rowVersionsByMaterial: { m1: 0 } });
  state = ledger.reserve(state, { idempotencyKey: 'reserve-nec1', documentId: 'nec1', documentVersion: 1, correlationId: 'corr-flow', expectedVersions: { m1: 0 }, items: [{ itemId: 'line1', materialId: 'm1', necessityId: 'nec1', quantity: 3 }] }).state;
  const command = integration.fromOsConsumption({ schemaVersion: '1.0.0', idempotencyKey: 'consume-os1', correlationId: 'corr-flow', payload: {
    proposalId: 'prop1', projectId: 'proj1', packageId: 'pkg1', osId: 'os1', necessityId: 'nec1', documentVersion: 1,
    expectedVersions: { m1: 1 }, items: [{ itemId: 'execution-line1', materialId: 'm1', quantity: 2, reservationDocumentId: 'nec1', reservationDocumentVersion: 1, reservationItemId: 'line1' }]
  }});
  state = ledger.consume(state, command).state;
  const projection = ledger.rebuildProjection(state).byMaterial.m1;
  assert.deepStrictEqual({ physical: projection.stockPhysical, reserved: projection.reservedValid, available: projection.available }, { physical: 1, reserved: 1, available: 0 });
  const retry = ledger.consume(state, command); assert.strictEqual(retry.replayed, true);
  const obligation = integration.toFinancialObligation({ obligationId: 'obl1', supplierId: 'sup1', orderId: 'po1', invoiceId: 'nf1', amount: 90, dueDate: '2026-09-30', evidenceId: 'match1', idempotencyKey: 'fin1', correlationId: 'corr-flow' });
  assert.strictEqual(obligation.operation, 'finance.obligation.v1'); assert.strictEqual(projection.stockPhysical, 1, 'evento financeiro não altera ledger');
})();

console.log('suprimentos-boundary-e2e.test.js: OK — OS contratual e obrigação financeira');
