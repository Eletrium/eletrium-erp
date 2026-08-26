const assert = require('assert');
const graphFactory = require('../suprimentos/adapters/sharepoint-graph-client');

function client(overrides) {
  return graphFactory.create(Object.assign({
    siteId: 'site', listIds: { X: 'x' }, credentialProvider: async () => 'token',
    requestTimeoutMs: 25, maxReadRetries: 2, sleep: async () => {},
    transport: { request: async () => ({ status: 200, body: { value: [] } }) }
  }, overrides || {}));
}

(async function retriesThrottledReadsAndHonorsPagination() {
  let calls = 0;
  const graph = client({ transport: { request: async () => {
    calls += 1;
    if (calls === 1) return { status: 429, headers: { 'Retry-After': '0' }, body: {} };
    if (calls === 2) return { status: 200, body: { value: [{ id: '1' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/site/lists/x/items?page=2' } };
    return { status: 200, body: { value: [{ id: '2' }] } };
  } } });
  const page = await graph.query('X');
  assert.strictEqual(calls, 3);
  assert.strictEqual(page.complete, true);
  assert.deepStrictEqual(page.value.map((item) => item.id), ['1', '2']);
})();

(async function rejectsForeignContinuationBeforeLeakingCredential() {
  let calls = 0;
  const graph = client({ transport: { request: async () => {
    calls += 1;
    return { status: 200, body: { value: [], '@odata.nextLink': 'https://evil.invalid/steal' } };
  } } });
  await assert.rejects(() => graph.query('X'), (error) => error.code === 'GRAPH_CONTINUATION_ORIGIN_REJECTED');
  assert.strictEqual(calls, 1);
})();

(async function refusesUnboundedResultSets() {
  const graph = client({ maxItems: 1, transport: { request: async () => ({ status: 200, body: { value: [{ id: '1' }, { id: '2' }] } }) } });
  await assert.rejects(() => graph.query('X'), (error) => error.code === 'GRAPH_ITEM_LIMIT_EXCEEDED');
})();

(async function writeTimeoutIsAnUncertainEffectAndNeverBlindlyRetried() {
  let calls = 0;
  const graph = client({ requestTimeoutMs: 5, transport: { request: async () => { calls += 1; return new Promise(() => {}); } } });
  await assert.rejects(() => graph.append('X', { A: 1 }), (error) => error.code === 'GRAPH_WRITE_EFFECT_UNKNOWN' && error.effectUnknown === true);
  assert.strictEqual(calls, 1);
})();

(async function writeServerErrorIsAlsoAnUncertainEffect() {
  let calls = 0;
  const graph = client({ transport: { request: async () => { calls += 1; return { status: 503, body: { error: 'after-commit-unknown' } }; } } });
  await assert.rejects(() => graph.append('X', { A: 1 }), (error) => error.code === 'GRAPH_WRITE_EFFECT_UNKNOWN' && error.effectUnknown === true && error.details.status === 503);
  assert.strictEqual(calls, 1);
})();

setTimeout(() => console.log('suprimentos-graph-hardening.test.js: OK — retry de leitura, paginação segura, limites e escrita incerta'), 15);
