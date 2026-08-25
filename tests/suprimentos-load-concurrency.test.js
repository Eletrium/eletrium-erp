const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');
const storeFactory = require('../suprimentos/adapters/in-memory-ledger-store');

(function rebuildsFiveThousandAppendOnlyEvents() {
  const reservationEvents = [];
  for (let i = 0; i < 2500; i += 1) {
    const base = { documentId: 'doc-' + i, documentVersion: 1, itemId: 'item-' + i, materialId: 'm1', quantity: 1, correlationId: 'c-' + i, createdAt: '2026-08-25T00:00:00Z', positionKey: 'doc-' + i + '|1|item-' + i + '|m1' };
    reservationEvents.push(Object.assign({}, base, { eventId: 'r-' + i, idempotencyKey: 'r-' + i, type: 'RESERVA' }));
    reservationEvents.push(Object.assign({}, base, { eventId: 'l-' + i, idempotencyKey: 'l-' + i, type: 'LIBERACAO' }));
  }
  const started = Date.now();
  const projection = ledger.rebuildProjection({ openingStockByMaterial: { m1: 100 }, reservationEvents, movementEvents: [], rowVersionsByMaterial: { m1: 5000 } });
  assert.strictEqual(projection.byMaterial.m1.available, 100);
  assert.ok(Date.now() - started < 5000, 'rebuild de 5.000 eventos excedeu 5s');
})();

(function onlyOneWriterWinsTheLastBalance() {
  const store = storeFactory.create({ openingStockByMaterial: { m1: 1 }, rowVersionsByMaterial: { m1: 0 } });
  let won = 0, conflicts = 0;
  for (let i = 0; i < 50; i += 1) {
    try {
      store.execute('reserve', { idempotencyKey: 'race-' + i, documentId: 'doc-' + i, documentVersion: 1, correlationId: 'corr-' + i, expectedVersions: { m1: 0 }, items: [{ itemId: 'i-' + i, materialId: 'm1', quantity: 1 }] });
      won += 1;
    } catch (error) { if (error.code === 'ROW_VERSION_CONFLICT') conflicts += 1; else throw error; }
  }
  assert.strictEqual(won, 1); assert.strictEqual(conflicts, 49);
  assert.strictEqual(ledger.deriveAvailability(store.snapshot(), 'm1'), 0);
})();

console.log('suprimentos-load-concurrency.test.js: OK — 5.000 eventos e corrida 50:1');
