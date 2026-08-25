const assert = require('assert');
const homologation = require('../suprimentos/adapters/sharepoint-homologation');
const schema = require('../suprimentos/contracts/sharepoint-lists.v1.json');

(async function homologationIsReadOnlyByDefaultAndLiveProbeIsGated() {
  const snapshot = { capturedAt: '2026-08-25T00:00:00Z', writerPolicy: schema.writerPolicy, permissions: JSON.parse(JSON.stringify(schema.permissions)), lists: JSON.parse(JSON.stringify(schema.lists)) };
  let writes = 0;
  const port = { captureSchema: async () => snapshot, probePagination: async () => ({ complete: true, pages: 3, records: 450 }), probeConditionalWrite: async () => { writes += 1; return { etagConflictDetected: true, cleanupConfirmed: true }; } };
  const dry = await homologation.run(schema, port, { environment: 'homologacao' }); assert.strictEqual(dry.ready, true); assert.strictEqual(writes, 0);
  await assert.rejects(() => homologation.run(schema, port, { liveWriteProbe: true }), /HOMOLOGATION_WRITE_GATE_CLOSED/);
  const live = await homologation.run(schema, port, { liveWriteProbe: true, allowHomologationWrites: true }); assert.strictEqual(live.ready, true); assert.strictEqual(writes, 1);
})().then(() => console.log('suprimentos-sharepoint-homologation.test.js: OK — harness seguro'));
