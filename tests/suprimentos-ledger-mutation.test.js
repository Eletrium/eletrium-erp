const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');

(function reconciliationKillsProjectionMutants() {
  let state = ledger.createState({ openingStockByMaterial: { m1: 5 }, rowVersionsByMaterial: { m1: 0 } });
  state = ledger.reserve(state, { idempotencyKey: 'r1', documentId: 'd1', documentVersion: 1, correlationId: 'c1', expectedVersions: { m1: 0 }, items: [{ itemId: 'i1', materialId: 'm1', quantity: 2 }] }).state;
  const correct = ledger.rebuildProjection(state).byMaterial;
  ['stockPhysical', 'reservedValid', 'available', 'projectionVersion'].forEach((field) => {
    const mutant = JSON.parse(JSON.stringify(correct)); mutant.m1[field] = Number(mutant.m1[field]) + 1;
    const audit = ledger.reconcile(state, mutant); assert.strictEqual(audit.ok, false); assert.ok(audit.differences.some((item) => item.field === field));
  });
  const lastMovementMutant = JSON.parse(JSON.stringify(correct)); lastMovementMutant.m1.lastMovementId = 'fake';
  assert.strictEqual(ledger.reconcile(state, lastMovementMutant).ok, false);
})();

(function invalidEventMutantsAreRejected() {
  const base = { openingStockByMaterial: { m1: 1 }, reservationEvents: [{ eventId: 'x', type: 'RESERVA', documentId: 'd', documentVersion: 1, itemId: 'i', materialId: 'm1', quantity: 2, positionKey: 'd|1|i|m1' }] };
  assert.throws(() => ledger.rebuildProjection(base), /AVAILABLE_BALANCE_NEGATIVE/);
  const invalid = JSON.parse(JSON.stringify(base)); invalid.reservationEvents[0].type = 'DELETE';
  assert.throws(() => ledger.rebuildProjection(invalid), /RESERVATION_EVENT_TYPE_INVALID/);
})();

console.log('suprimentos-ledger-mutation.test.js: OK — mutações detectadas');
