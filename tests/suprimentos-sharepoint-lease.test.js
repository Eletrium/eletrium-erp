const assert = require('assert');
const leaseFactory = require('../suprimentos/adapters/sharepoint-lease-store');

(async function leaseUsesEtagAndFencingToken() {
  let now = '2026-08-25T00:00:00Z', row = null;
  const graph = {
    query: async () => ({ complete: true, value: row ? [JSON.parse(JSON.stringify(row))] : [] }),
    append: async (list, fields) => { row = { id: 'lease-row', eTag: 'e1', fields: Object.assign({}, fields) }; return row; },
    conditionalUpdate: async (list, id, fields, etag) => { if (etag !== row.eTag) { const e = new Error('412'); e.code = 'ETAG_CONFLICT'; throw e; } row.fields = Object.assign({}, row.fields, fields); row.eTag = 'e' + row.fields.Row_Version; return row; }
  };
  const leases = leaseFactory.create(graph, { clock: () => now });
  const first = await leases.acquire('material:m1', 'worker-a', 1000); assert.strictEqual(first.fencingToken, 1);
  await assert.rejects(() => leases.acquire('material:m1', 'worker-b', 1000), /LEASE_BUSY/);
  const renewed = await leases.renew(first, 1000); assert.strictEqual(renewed.fencingToken, 2);
  await assert.rejects(() => leases.release(first), /LEASE_FENCED/);
  now = '2026-08-25T00:00:02Z'; const takeover = await leases.acquire('material:m1', 'worker-b', 1000); assert.strictEqual(takeover.fencingToken, 3);
})().then(() => console.log('suprimentos-sharepoint-lease.test.js: OK — ETag e fencing token'));
