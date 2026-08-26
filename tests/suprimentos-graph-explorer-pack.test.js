const assert = require('assert');
const pack = require('../suprimentos/fixtures/sharepoint-graph-explorer-readonly-batch.v1.json');

(function batchIsReadOnlyAndDoesNotExtractBusinessFields() {
  assert.strictEqual(pack.requests.length, 16);
  assert.ok(pack.requests.every((request) => request.method === 'GET'));
  assert.strictEqual(JSON.stringify(pack).includes('expand=fields'), false);
  assert.ok(pack.requests.filter((request) => /^columns-/.test(request.id)).length === 7);
  assert.ok(pack.requests.filter((request) => /^access-/.test(request.id)).every((request) => /\$select=id/.test(request.url)));
  assert.strictEqual(new Set(pack.requests.map((request) => request.id)).size, pack.requests.length);
})();

console.log('suprimentos-graph-explorer-pack.test.js: OK — lote GET sem dados comerciais');
