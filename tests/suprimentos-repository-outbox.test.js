const assert = require('assert');
const repositoryFactory = require('../suprimentos/adapters/sharepoint-repository');
const outboxStore = require('../suprimentos/adapters/in-memory-outbox-store');
const workerFactory = require('../suprimentos/core/outbox-worker');

(async function repositoryMapsIdsAndEnforcesIdempotency() {
  const appended = [], patched = [];
  const graph = {
    query: async (list, filter) => {
      if (list === 'Estoque_Projetado') return { complete: true, value: [{ id: 'row-m1', eTag: 'etag-live', fields: { Material_ID: 'm1' } }] };
      if (/duplicate/.test(filter || '')) return { complete: true, value: [{ id: 'prior', fields: { Idempotency_Key: 'duplicate' } }] };
      return { complete: true, value: [] };
    },
    append: async (list, fields) => { appended.push({ list, fields }); return { id: 'new' }; },
    conditionalUpdate: async (list, id, fields, etag) => { patched.push({ list, id, fields, etag }); return { ok: true }; }
  };
  const repo = repositoryFactory.create(graph);
  await repo.appendReservationEvents([{ eventId: 'e1', materialId: 'm1', itemId: 'i1', documentId: 'd1', documentVersion: 1, idempotencyKey: 'new-key', correlationId: 'c1', quantity: 2, type: 'RESERVA', createdAt: '2026-08-25T00:00:00Z' }]);
  const replay = await repo.appendReservationEvents([{ eventId: 'e2', idempotencyKey: 'duplicate' }]);
  assert.strictEqual(appended[0].fields.Material_ID, 'm1'); assert.strictEqual(appended[0].fields.Reserva_ID, 'e1'); assert.strictEqual(replay[0].replayed, true);
  await repo.writeProjection({ m1: { stockPhysical: 5, reservedValid: 2, available: 3, projectionVersion: 4, lastMovementId: null } }, { m1: 'etag-command' });
  assert.strictEqual(patched[0].etag, 'etag-command'); assert.strictEqual(patched[0].fields.Disponivel, 3);
})();

(async function outboxUsesLeaseRetryAndUncertainEffectPolicy() {
  let now = '2026-08-25T00:00:00Z', attempts = 0;
  const store = outboxStore.create([
    { eventId: 'ok', idempotencyKey: 'i-ok', status: 'LOCAL_PENDING', retryCount: 0 },
    { eventId: 'retry', idempotencyKey: 'i-retry', status: 'LOCAL_PENDING', retryCount: 0 },
    { eventId: 'unknown', idempotencyKey: 'i-unknown', status: 'LOCAL_PENDING', retryCount: 0 }
  ]);
  const worker = workerFactory.create({ store, owner: 'worker-a', clock: () => now, sender: { send: async (event) => {
    attempts += 1;
    if (event.eventId === 'retry') { const e = new Error('503'); e.code = 'HTTP_503'; e.retryable = true; throw e; }
    if (event.eventId === 'unknown') { const e = new Error('timeout'); e.code = 'TIMEOUT_AFTER_SEND'; e.effectUnknown = true; throw e; }
    return { externalId: 'remote-' + event.eventId };
  } } });
  const first = await worker.runOnce(10);
  assert.strictEqual(first.claimed, 3); assert.strictEqual(attempts, 3);
  let snapshot = store.snapshot();
  assert.strictEqual(snapshot.find((x) => x.eventId === 'ok').status, 'SYNCED');
  assert.strictEqual(snapshot.find((x) => x.eventId === 'retry').status, 'SYNC_ERROR');
  assert.strictEqual(snapshot.find((x) => x.eventId === 'unknown').status, 'RECONCILIATION_PENDING');
  await worker.runOnce(10); assert.strictEqual(attempts, 3, 'backoff e efeito incerto impedem retry imediato/cego');
  now = '2026-08-25T00:00:02Z'; await worker.runOnce(10); assert.strictEqual(attempts, 4);
})();

setImmediate(() => console.log('suprimentos-repository-outbox.test.js: OK — mapeamento, lease, retry e efeito incerto'));
