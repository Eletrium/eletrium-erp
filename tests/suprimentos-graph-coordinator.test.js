const assert = require('assert');
const graphFactory = require('../suprimentos/adapters/sharepoint-graph-client');
const coordinatorFactory = require('../suprimentos/adapters/single-writer-coordinator');

(async function graphTraversesAllPagesAndSendsIfMatch() {
  const calls = [];
  const client = graphFactory.create({
    siteId: 'site-1', listIds: { Reservas_Estoque: 'list-r' }, credentialProvider: async () => 'token-from-vault',
    transport: { request: async (call) => {
      calls.push(call);
      if (call.method === 'PATCH') return { status: 200, body: { ok: true } };
      if (call.path === '/next-2') return { status: 200, body: { value: [{ id: 2 }] } };
      return { status: 200, body: { value: [{ id: 1 }], '@odata.nextLink': '/next-2' } };
    } }
  });
  const page = await client.query('Reservas_Estoque');
  assert.deepStrictEqual(page.value.map((item) => item.id), [1, 2]);
  await client.conditionalUpdate('Reservas_Estoque', 'item-1', { Row_Version: 2 }, 'etag-1');
  assert.strictEqual(calls[calls.length - 1].headers['If-Match'], 'etag-1');
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer token-from-vault');
})();

(async function graphRejectsBrokenPaginationAndConflicts() {
  const broken = graphFactory.create({ siteId: 'site', listIds: { X: 'x' }, credentialProvider: async () => 't', transport: { request: async () => ({ status: 200, body: { value: [], hasMore: true } }) } });
  await assert.rejects(() => broken.query('X'), /GRAPH_NEXT_LINK_MISSING/);
  const conflict = graphFactory.create({ siteId: 'site', listIds: { X: 'x' }, credentialProvider: async () => 't', transport: { request: async () => ({ status: 412, body: {} }) } });
  await assert.rejects(() => conflict.conditionalUpdate('X', '1', {}, 'old'), /ETAG_CONFLICT/);
})();

(async function coordinatorSerializesAndMakesPartialEffectsVisible() {
  const trace = [], integration = [];
  const port = {
    findCommand: async () => null, readState: async () => ({ complete: true }),
    assertEtags: async () => trace.push('etag'),
    appendReservationEvents: async (events) => { trace.push('reservation:' + events[0].eventId); },
    appendMovementEvents: async () => trace.push('movement'),
    writeProjection: async (projection) => { trace.push('projection:' + Object.keys(projection)[0]); },
    saveCommandResult: async (result) => trace.push('result:' + result.idempotencyKey),
    recordIntegrationEvent: async (event) => integration.push(event)
  };
  const coordinator = coordinatorFactory.create(port);
  await Promise.all([1, 2].map((n) => coordinator.commitAtomic({ expectedEtags: { m1: 'e' + n }, reservationEvents: [{ eventId: 'r' + n }], movementEvents: [], projection: { m1: {} }, commandResult: { idempotencyKey: 'k' + n, correlationId: 'c' + n } })));
  assert.deepStrictEqual(trace, ['etag', 'reservation:r1', 'projection:m1', 'result:k1', 'etag', 'reservation:r2', 'projection:m1', 'result:k2']);
  assert.strictEqual(integration.filter((item) => item.status === 'RECONCILED').length, 2);

  port.writeProjection = async () => { const error = new Error('network'); error.code = 'NETWORK_DOWN'; throw error; };
  const failing = coordinatorFactory.create(port);
  await assert.rejects(() => failing.commitAtomic({ expectedEtags: { m1: 'e3' }, reservationEvents: [{ eventId: 'r3' }], movementEvents: [], projection: { m1: {} }, commandResult: { idempotencyKey: 'k3', correlationId: 'c3' } }), (error) => error.code === 'PERSISTENCE_PARTIAL_RECONCILIATION_REQUIRED' && error.details.effectCommitted);
  assert.ok(integration.some((item) => item.type === 'LEDGER_PARTIAL_EFFECT' && item.reconciliationRequired));
})();

setImmediate(() => console.log('suprimentos-graph-coordinator.test.js: OK — Graph, ETag e escritor único'));
