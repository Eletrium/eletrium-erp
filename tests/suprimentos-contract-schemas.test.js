const assert = require('assert');
const schemas = require('../suprimentos/contracts/commands.v1.json');
const validator = require('../suprimentos/core/schema-validator');
const integration = require('../suprimentos/core/integration-contracts');

(function validatesEnvelopeWithoutExtraVisualStatus() {
  const envelope = { commandId: 'c1', operation: 'reserve', actorId: 'u1', correlationId: 'corr1', idempotencyKey: 'i1', schemaVersion: '1.0.0', payload: { documentId: 'd1', documentVersion: 1, expectedVersions: { m1: 0 }, items: [{}] } };
  assert.strictEqual(validator.validateCommand(schemas, envelope), true);
  assert.throws(() => validator.validateCommand(schemas, Object.assign({}, envelope, { visualStatus: 'verde' })), /SCHEMA_ADDITIONAL_PROPERTY/);
  assert.throws(() => validator.validateCommand(schemas, Object.assign({}, envelope, { schemaVersion: '2.0.0' })), /SCHEMA_CONST_INVALID/);
})();

(function osContractIsConvertedWithoutDependingOnOsStateMachine() {
  const command = integration.fromOsConsumption({ schemaVersion: '1.0.0', idempotencyKey: 'os-consume-1', correlationId: 'corr-os', payload: {
    proposalId: 'prop1', projectId: 'proj1', packageId: 'pkg1', osId: 'os1', necessityId: 'nec1', documentVersion: 3,
    expectedVersions: { m1: 7 }, items: [{ itemId: 'exec1', materialId: 'm1', quantity: 2, reservationDocumentId: 'need1', reservationDocumentVersion: 1, reservationItemId: 'line1' }]
  }});
  assert.strictEqual(command.documentId, 'os1'); assert.strictEqual(command.items[0].necessityId, 'nec1');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(command, 'osStatus'), false);
  assert.throws(() => integration.fromOsConsumption({ schemaVersion: '9.0.0', payload: {} }), /CONTRACT_VERSION_UNSUPPORTED/);
})();

(function financeReceivesObligationNotStockMutation() {
  const event = integration.toFinancialObligation({ obligationId: 'obl1', supplierId: 'sup1', orderId: 'po1', invoiceId: 'nf1', amount: 125.4, dueDate: '2026-09-30', evidenceId: 'match1', idempotencyKey: 'fin1', correlationId: 'corr1' });
  assert.strictEqual(event.payload.currency, 'BRL'); assert.strictEqual(event.payload.amount, 125.4);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(event.payload, 'stock'), false);
  assert.strictEqual(validator.validate(schemas.operations['finance.obligation.v1'], event.payload), true);
})();

console.log('suprimentos-contract-schemas.test.js: OK — schemas, OS e Financeiro');
