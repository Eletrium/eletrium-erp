const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');

function random(seed) { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); }

(function deterministicPropertyTestNeverCreatesOrDestroysReservedBalanceSilently() {
  const rnd = random(20260825);
  for (let scenario = 0; scenario < 100; scenario += 1) {
    const opening = 5 + Math.floor(rnd() * 50); let state = ledger.createState({ openingStockByMaterial: { m1: opening }, rowVersionsByMaterial: { m1: 0 } });
    const positions = [];
    for (let step = 0; step < 20; step += 1) {
      const projection = ledger.rebuildProjection(state).byMaterial.m1; const operationRoll = rnd();
      if (operationRoll < 0.5 && projection.available > 0) {
        const quantity = 1 + Math.floor(rnd() * projection.available); const item = 'i-' + scenario + '-' + step;
        state = ledger.reserve(state, { idempotencyKey: 'r-' + scenario + '-' + step, documentId: 'd-' + item, documentVersion: 1, correlationId: 'c-' + item, expectedVersions: { m1: state.rowVersionsByMaterial.m1 }, items: [{ itemId: item, materialId: 'm1', quantity }] }).state;
        positions.push({ item, quantity, documentId: 'd-' + item });
      } else if (positions.length) {
        const p = positions.shift(); state = ledger.release(state, { idempotencyKey: 'l-' + scenario + '-' + step, documentId: p.documentId, documentVersion: 1, correlationId: 'c-l-' + step, expectedVersions: { m1: state.rowVersionsByMaterial.m1 }, items: [{ itemId: p.item, materialId: 'm1', quantity: p.quantity }] }).state;
      }
      const rebuilt = ledger.rebuildProjection(state).byMaterial.m1;
      assert.ok(rebuilt.available >= 0); assert.strictEqual(rebuilt.available, rebuilt.stockPhysical - rebuilt.reservedValid);
    }
    assert.strictEqual(ledger.reconcile(state, ledger.rebuildProjection(state).byMaterial).ok, true);
  }
})();

console.log('suprimentos-ledger-fuzz.test.js: OK — 2.000 operações determinísticas');
