const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');

const NOW = '2026-08-24T00:00:00Z';

function command(key, items, expectedVersions, overrides) {
  return Object.assign({
    idempotencyKey: key,
    documentId: 'doc-1',
    documentVersion: 1,
    correlationId: 'corr-' + key,
    expectedVersions,
    items
  }, overrides || {});
}

function initial(stock) {
  const versions = {};
  Object.keys(stock).forEach((materialId) => { versions[materialId] = 0; });
  return ledger.createState({ openingStockByMaterial: stock, rowVersionsByMaterial: versions });
}

(function testAvailability() {
  assert.strictEqual(ledger.available(10, [{ quantity: 3 }, { quantity: 2 }]), 5);
})();

(function testLegacyAtomicPrevalidation() {
  const cmd = command('legacy-1', [
    { itemId: 'i1', materialId: 'm1', quantity: 2 },
    { itemId: 'i2', materialId: 'm2', quantity: 7 }
  ], { m1: 0, m2: 0 });
  const validation = ledger.validateReserve(cmd, { m1: 10, m2: 5 }, { m1: [], m2: [] });
  assert.strictEqual(validation.ok, false);
  assert.throws(() => ledger.buildReserveEvents(cmd, validation), /PREVALIDATION_FAILED/);
})();

(function testLegacyEventKeyIdempotency() {
  const cmd = command('legacy-2', [{ itemId: 'i1', materialId: 'm1', quantity: 2 }], { m1: 0 });
  const validation = ledger.validateReserve(cmd, { m1: 10 }, { m1: [] });
  const events = ledger.buildReserveEvents(cmd, validation, NOW);
  const first = ledger.applyReservationEvents(events, []);
  const second = ledger.applyReservationEvents(events, first.keys);
  assert.strictEqual(first.appended.length, 1);
  assert.strictEqual(second.appended.length, 0);
})();

(function ts11IntegralReservation() {
  const state = initial({ m1: 10, m2: 4 });
  const cmd = command('ts11', [
    { itemId: 'i1', materialId: 'm1', necessityId: 'n1', quantity: 3 },
    { itemId: 'i2', materialId: 'm2', necessityId: 'n2', quantity: 2 }
  ], { m1: 0, m2: 0 });
  const executed = ledger.reserve(state, cmd, NOW);

  assert.strictEqual(executed.result.reservationEvents.length, 2);
  assert.strictEqual(executed.result.projection.byMaterial.m1.reservedValid, 3);
  assert.strictEqual(executed.result.projection.byMaterial.m1.available, 7);
  assert.strictEqual(executed.result.projection.byMaterial.m2.available, 2);
  assert.deepStrictEqual(executed.result.rowVersionsByMaterial, { m1: 1, m2: 1 });
  assert.strictEqual(state.reservationEvents.length, 0, 'a entrada deve permanecer imutável');
})();

(function ts12MultiproductAtomicFailure() {
  const state = initial({ m1: 10, m2: 1 });
  const before = JSON.stringify(state);
  const cmd = command('ts12', [
    { itemId: 'i1', materialId: 'm1', quantity: 3 },
    { itemId: 'i2', materialId: 'm2', quantity: 2 }
  ], { m1: 0, m2: 0 });

  assert.throws(() => ledger.reserve(state, cmd, NOW), (error) => {
    assert.strictEqual(error.code, 'INSUFFICIENT_STOCK');
    assert.strictEqual(error.details[0].materialId, 'm2');
    return true;
  });
  assert.strictEqual(JSON.stringify(state), before, 'falha de pré-validação não pode gerar efeito parcial');
})();

(function ts13ExplicitTraceableShortage() {
  const state = initial({ m1: 1 });
  const cmd = command('ts13', [{ itemId: 'i1', materialId: 'm1', quantity: 2 }], { m1: 0 });
  try {
    ledger.reserve(state, cmd, NOW);
    assert.fail('deveria rejeitar falta');
  } catch (error) {
    assert.strictEqual(error.code, 'INSUFFICIENT_STOCK');
    assert.deepStrictEqual(error.details[0], {
      itemId: 'i1', materialId: 'm1', requested: 2, available: 1, canReserve: false
    });
    assert.strictEqual(state.reservationEvents.length, 0);
  }
})();

(function ts14CommandRetryIsIdempotent() {
  const state = initial({ m1: 2 });
  const cmd = command('ts14', [{ itemId: 'i1', materialId: 'm1', quantity: 2 }], { m1: 0 });
  const first = ledger.reserve(state, cmd, NOW);
  const retry = ledger.reserve(first.state, cmd, NOW);

  assert.strictEqual(retry.replayed, true);
  assert.deepStrictEqual(retry.result, first.result);
  assert.strictEqual(retry.state.reservationEvents.length, 1);
  assert.strictEqual(retry.state.rowVersionsByMaterial.m1, 1);

  const reusedWithDifferentPayload = command('ts14', [
    { itemId: 'i1', materialId: 'm1', quantity: 1 }
  ], { m1: 1 });
  assert.throws(() => ledger.reserve(first.state, reusedWithDifferentPayload, NOW), /IDEMPOTENCY_KEY_REUSED/);
})();

(function ts15LastBalanceUsesCompareAndSwap() {
  const state = initial({ m1: 5 });
  const first = ledger.reserve(state, command('ts15-a', [
    { itemId: 'i1', materialId: 'm1', quantity: 5 }
  ], { m1: 0 }), NOW);

  assert.throws(() => ledger.reserve(first.state, command('ts15-b', [
    { itemId: 'i2', materialId: 'm1', quantity: 5 }
  ], { m1: 0 }), NOW), (error) => {
    assert.strictEqual(error.code, 'ROW_VERSION_CONFLICT');
    assert.deepStrictEqual(error.details, { materialId: 'm1', expected: 0, actual: 1 });
    return true;
  });
  assert.strictEqual(first.state.reservationEvents.length, 1);
  assert.strictEqual(ledger.rebuildProjection(first.state).byMaterial.m1.available, 0);
})();

(function releaseDoesNotDeleteOriginalReservation() {
  const reserved = ledger.reserve(initial({ m1: 5 }), command('release-reserve', [
    { itemId: 'i1', materialId: 'm1', quantity: 4 }
  ], { m1: 0 }), NOW);
  const released = ledger.release(reserved.state, command('release-command', [
    {
      itemId: 'release-i1', materialId: 'm1', quantity: 3,
      sourceDocumentId: 'doc-1', sourceDocumentVersion: 1, sourceItemId: 'i1'
    }
  ], { m1: 1 }, { documentId: 'release-doc' }), NOW);

  assert.deepStrictEqual(released.state.reservationEvents.map((event) => event.type), ['RESERVA', 'LIBERACAO']);
  assert.strictEqual(released.result.projection.byMaterial.m1.reservedValid, 1);
  assert.strictEqual(released.result.projection.byMaterial.m1.available, 4);
})();

(function consumeClosesReservationAndMovesPhysicalStock() {
  const reserved = ledger.reserve(initial({ m1: 5 }), command('consume-reserve', [
    { itemId: 'i1', materialId: 'm1', quantity: 4 }
  ], { m1: 0 }), NOW);
  const consumed = ledger.consume(reserved.state, command('consume-command', [
    {
      itemId: 'consume-i1', materialId: 'm1', quantity: 2,
      sourceDocumentId: 'doc-1', sourceDocumentVersion: 1, sourceItemId: 'i1'
    }
  ], { m1: 1 }, { documentId: 'os-contract-id' }), NOW);

  const projected = consumed.result.projection.byMaterial.m1;
  assert.strictEqual(projected.stockPhysical, 3);
  assert.strictEqual(projected.reservedValid, 2);
  assert.strictEqual(projected.available, 1);
  assert.strictEqual(consumed.state.movementEvents[0].type, 'SAIDA');
})();

(function projectionCanBeRebuiltAndReconciled() {
  const reserved = ledger.reserve(initial({ m1: 10 }), command('rebuild-1', [
    { itemId: 'i1', materialId: 'm1', quantity: 3 }
  ], { m1: 0 }), NOW);
  const rebuilt = ledger.rebuildProjection(reserved.state);
  assert.deepStrictEqual(rebuilt.byMaterial.m1, {
    materialId: 'm1', stockPhysical: 10, reservedValid: 3, available: 7,
    projectionVersion: 1, lastMovementId: null
  });
  assert.strictEqual(ledger.reconcile(reserved.state, rebuilt.byMaterial).ok, true);

  const divergent = ledger.reconcile(reserved.state, {
    m1: { stockPhysical: 10, reservedValid: 0, available: 10, projectionVersion: 1, lastMovementId: null }
  });
  assert.strictEqual(divergent.ok, false);
  assert.deepStrictEqual(divergent.differences.map((difference) => difference.field), ['reservedValid', 'available']);
})();

(function ts56PartialFailureUsesCompensatingEvent() {
  const partial = ledger.reserve(initial({ m1: 5 }), command('ts56-partial', [
    { itemId: 'i1', materialId: 'm1', quantity: 5 }
  ], { m1: 0 }), NOW);
  const originalId = partial.state.reservationEvents[0].eventId;
  const compensated = ledger.compensate(partial.state, {
    idempotencyKey: 'ts56-compensate',
    documentId: 'recovery-1',
    documentVersion: 1,
    correlationId: 'corr-ts56',
    expectedVersions: { m1: 1 },
    targetEventIds: [originalId]
  }, NOW);

  assert.strictEqual(compensated.state.reservationEvents.length, 2, 'o evento original deve ser preservado');
  assert.strictEqual(compensated.state.reservationEvents[1].type, 'COMPENSACAO');
  assert.strictEqual(compensated.state.reservationEvents[1].compensatesEventId, originalId);
  assert.strictEqual(compensated.result.projection.byMaterial.m1.reservedValid, 0);
  assert.strictEqual(compensated.result.projection.byMaterial.m1.available, 5);
  assert.strictEqual(compensated.state.rowVersionsByMaterial.m1, 2);
})();

console.log('suprimentos-ledger.test.js: OK — TS-11, TS-12, TS-13, TS-14, TS-15 e TS-56');
