const assert = require('assert');
const livePort = require('../suprimentos/adapters/sharepoint-live-port');

(async function capturesOnlyObservedMetadataAndTraversesEveryListPage() {
  const calls = [];
  const responses = {
    site: { status: 200, body: { id: 'tenant,site,id', displayName: 'Homologação', webUrl: 'https://example.invalid/site' } },
    lists1: { status: 200, body: { value: [{ id: 'l1', name: 'L1' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/tenant%2Csite%2Cid/lists?page=2' } },
    lists2: { status: 200, body: { value: [{ id: 'l2', name: 'L2' }] } },
    columns: { status: 200, body: { value: [
      { name: 'Material_ID', required: true, indexed: true, enforceUniqueValues: true, text: { maxLength: 64 } },
      { name: 'Quantidade', required: true, number: { decimalPlaces: 'automatic' } },
      { name: 'Tipo', required: false, choice: { choices: ['A', 'B'] } }
    ] } },
    items: { status: 200, body: { value: [{ id: '1', fields: {} }] } }
  };
  const transport = { request: async (call) => {
    calls.push(call.path);
    if (/\?\$select=id,displayName,webUrl/.test(call.path)) return responses.site;
    if (/lists\?page=2/.test(call.path)) return responses.lists2;
    if (/\/lists\?\$select=/.test(call.path)) return responses.lists1;
    if (/\/columns\?/.test(call.path)) return responses.columns;
    if (/\/items\?/.test(call.path)) return responses.items;
    throw new Error('unexpected path ' + call.path);
  } };
  const port = await livePort.create({ siteHost: 'gwtecheletrica.sharepoint.com', sitePath: '/sites/EletriumERP', targetLists: ['L1', 'L2', 'MISSING'], credentialProvider: async () => 'runtime-token', transport, sleep: async () => {} });
  const snapshot = await port.captureSchema();
  assert.deepStrictEqual(snapshot.missingLists, ['MISSING']);
  assert.strictEqual(snapshot.writerPolicy, null, 'política não observada não pode ser presumida');
  assert.strictEqual(snapshot.lists.L1.fields.Material_ID, 'Text:64:required');
  assert.strictEqual(snapshot.lists.L1.fields.Quantidade, 'Number:required');
  assert.strictEqual(snapshot.lists.L1.fields.Tipo, 'Choice:A|B:optional');
  const pagination = await port.probePagination();
  assert.strictEqual(pagination.complete, false, 'lista ausente deve falhar fechado');
  assert.strictEqual(pagination.records, 2);
  assert.ok(calls.some((path) => /lists\?page=2/.test(path)));
})().then(() => console.log('suprimentos-sharepoint-live-port.test.js: OK — captura Graph realista e fail-closed'));

(async function policyCannotBeSelfDeclaredWithoutEvidence() {
  await assert.rejects(() => livePort.create({ siteHost: 'gwtecheletrica.sharepoint.com', sitePath: '/sites/EletriumERP', policyAttestation: true, policy: { writerPolicy: 'SINGLE_WRITER_SERVICE_ACCOUNT' }, credentialProvider: async () => 'token', transport: { request: async () => ({ status: 200, body: { id: 'site' } }) } }), /POLICY_EVIDENCE_REF_REQUIRED/);
})();
