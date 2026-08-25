const assert = require('assert');
const storeFactory = require('../suprimentos/adapters/in-memory-outbox-store');
const graphFactory = require('../suprimentos/adapters/sharepoint-graph-client');

(async function expiredWorkerLeaseCanBeRecoveredWithoutDuplicateRecord() {
  const store = storeFactory.create([{ eventId: 'e1', idempotencyKey: 'idem1', status: 'LOCAL_PENDING', retryCount: 0 }]);
  const first = await store.claim('dead-worker', '2026-08-25T00:00:00Z', 1, 1000); assert.strictEqual(first.length, 1);
  assert.strictEqual((await store.claim('new-worker', '2026-08-25T00:00:00.500Z', 1, 1000)).length, 0);
  assert.strictEqual(await store.recoverExpired('2026-08-25T00:00:02Z'), 1);
  const recovered = await store.claim('new-worker', '2026-08-25T00:00:02Z', 1, 1000); assert.strictEqual(recovered.length, 1);
  const replay = await store.append({ eventId: 'other-id', idempotencyKey: 'idem1', status: 'LOCAL_PENDING' }); assert.strictEqual(replay.eventId, 'e1'); assert.strictEqual(store.snapshot().length, 1);
})();

(async function paginationCycleIsRejected() {
  const graph = graphFactory.create({ siteId: 'site', listIds: { X: 'x' }, credentialProvider: async () => 't', transport: { request: async (call) => ({ status: 200, body: { value: [], '@odata.nextLink': call.path } }) } });
  await assert.rejects(() => graph.query('X'), /GRAPH_PAGINATION_CYCLE/);
})();

setImmediate(() => console.log('suprimentos-chaos-worker.test.js: OK — worker morto, duplicidade e ciclo de página'));
