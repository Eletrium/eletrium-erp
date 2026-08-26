const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');
const storeFactory = require('../suprimentos/adapters/in-memory-ledger-store');
const sharePointFactory = require('../suprimentos/adapters/sharepoint-ledger-adapter');
const reconciliation = require('../suprimentos/core/reconciliation');

function reserveCommand(key, expected) {
  return {
    idempotencyKey: key, documentId: 'doc-1', documentVersion: 1, correlationId: 'corr-' + key,
    expectedVersions: { m1: expected }, items: [{ itemId: 'i1', materialId: 'm1', quantity: 5 }]
  };
}

(function ackLostAfterCommitReplaysWithoutDuplicate() {
  const store = storeFactory.create({ openingStockByMaterial: { m1: 5 }, rowVersionsByMaterial: { m1: 0 } });
  const command = reserveCommand('ack-lost', 0);
  assert.throws(() => store.execute('reserve', command, { failAt: 'AFTER_COMMIT_BEFORE_ACK' }), (error) => error.code === 'ACK_LOST_AFTER_COMMIT' && error.effectCommitted);
  const retry = store.execute('reserve', command);
  assert.strictEqual(retry.replayed, true);
  assert.strictEqual(store.snapshot().reservationEvents.length, 1);
})();

(function failureBeforeCommitHasNoEffect() {
  const store = storeFactory.create({ openingStockByMaterial: { m1: 5 }, rowVersionsByMaterial: { m1: 0 } });
  assert.throws(() => store.execute('reserve', reserveCommand('before', 0), { failAt: 'BEFORE_COMMIT' }), /INJECTED_FAILURE_BEFORE_COMMIT/);
  assert.strictEqual(store.snapshot().reservationEvents.length, 0);
})();

(function staleEtagBecomesVisibleConflict() {
  const state = ledger.createState({ openingStockByMaterial: { m1: 5 }, rowVersionsByMaterial: { m1: 0 } });
  const adapter = sharePointFactory.create({
    findCommand: async () => null,
    readState: async () => ({ complete: true, state, etags: { m1: 'etag-1' } }),
    commitAtomic: async () => { const error = new Error('precondition'); error.status = 412; throw error; }
  });
  return assert.rejects(() => adapter.execute('reserve', reserveCommand('etag', 0)), /ROW_VERSION_CONFLICT/);
})();

(function incompletePaginationCannotCommit() {
  const adapter = sharePointFactory.create({
    findCommand: async () => null,
    readState: async () => ({ complete: false }),
    commitAtomic: async () => assert.fail('commit não deve ocorrer')
  });
  return assert.rejects(() => adapter.execute('reserve', reserveCommand('incomplete', 0)), /INCOMPLETE_STATE_READ/);
})();

(function partialConsumptionOpensReconciliationException() {
  const reserved = ledger.reserve(ledger.createState({ openingStockByMaterial: { m1: 5 }, rowVersionsByMaterial: { m1: 0 } }), reserveCommand('reserve-for-consume', 0), '2026-08-25T00:00:00Z');
  const store = storeFactory.create(reserved.state);
  const consume = {
    idempotencyKey: 'partial-consume', documentId: 'os-contract-1', documentVersion: 1,
    correlationId: 'corr-partial', expectedVersions: { m1: 1 },
    items: [{ itemId: 'consume-i1', materialId: 'm1', quantity: 2, sourceDocumentId: 'doc-1', sourceDocumentVersion: 1, sourceItemId: 'i1' }]
  };
  assert.throws(() => store.execute('consume', consume, { failAt: 'PARTIAL_RESERVATION_WRITE' }), /INJECTED_PARTIAL_WRITE/);
  const audit = reconciliation.inspect(store.snapshot(), {});
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.findings.some((item) => item.type === 'CONSUMPTION_WITHOUT_MOVEMENT'));
  assert.ok(audit.exceptionDrafts.some((item) => item.category === 'RECONCILIACAO_PENDENTE'));
})();

console.log('suprimentos-adapters-faults.test.js: OK — adapters, ETag e falhas combinadas');
