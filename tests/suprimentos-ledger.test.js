const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');

(function testAvailability() {
  assert.strictEqual(ledger.available(10, [{ quantity: 3 }, { quantity: 2 }]), 5);
})();

(function testAtomicPrevalidation() {
  const command = {
    idempotencyKey: 'cmd-1',
    documentId: 'doc-1',
    documentVersion: 1,
    correlationId: 'corr-1',
    items: [
      { itemId: 'i1', materialId: 'm1', quantity: 2 },
      { itemId: 'i2', materialId: 'm2', quantity: 7 }
    ]
  };
  const validation = ledger.validateReserve(command, { m1: 10, m2: 5 }, { m1: [], m2: [] });
  assert.strictEqual(validation.ok, false);
  assert.throws(() => ledger.buildReserveEvents(command, validation), /PREVALIDATION_FAILED/);
})();

(function testIdempotency() {
  const command = {
    idempotencyKey: 'cmd-2',
    documentId: 'doc-2',
    documentVersion: 1,
    correlationId: 'corr-2',
    items: [{ itemId: 'i1', materialId: 'm1', quantity: 2 }]
  };
  const validation = ledger.validateReserve(command, { m1: 10 }, { m1: [] });
  const events = ledger.buildReserveEvents(command, validation, '2026-08-24T00:00:00Z');
  const first = ledger.applyReservationEvents(events, []);
  const second = ledger.applyReservationEvents(events, first.keys);
  assert.strictEqual(first.appended.length, 1);
  assert.strictEqual(second.appended.length, 0);
})();

console.log('suprimentos-ledger.test.js: OK');