const assert = require('assert');
const mock = require('../suprimentos/tools/mock-gateway-server');
const migration = require('../suprimentos/core/migration-simulator');
const schema = require('../suprimentos/contracts/sharepoint-lists.v1.json');

(async function mockGatewayExecutesRealCoreWithoutExternalWrites() {
  const app = mock.create(); await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port; const url = `http://127.0.0.1:${port}/v1/suprimentos/commands`;
  const envelope = { commandId: 'c1', operation: 'reserve', actorId: 'u1', correlationId: 'corr1', idempotencyKey: 'idem1', schemaVersion: '1.0.0', payload: { documentId: 'd1', documentVersion: 1, expectedVersions: { 'SYN-MAT-1': 0 }, items: [{ itemId: 'i1', materialId: 'SYN-MAT-1', quantity: 3 }] } };
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()); assert.strictEqual(health.externalWrites, false);
    const first = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) }); assert.strictEqual(first.status, 202);
    const replay = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) }).then((r) => r.json()); assert.strictEqual(replay.replayed, true);
    const conflict = Object.assign({}, envelope, { commandId: 'c2', idempotencyKey: 'idem2', correlationId: 'corr2' });
    const rejected = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(conflict) }); assert.strictEqual(rejected.status, 409);
    assert.strictEqual(app.snapshot().reservationEvents.length, 1);
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
})();

(function additiveMigrationCanBeReplayedAndRolledBackAsSnapshot() {
  const initial = { capturedAt: '2026-08-25T00:00:00Z', writerPolicy: schema.writerPolicy, lists: {}, permissions: {} };
  const result = migration.simulate(schema, initial); assert.strictEqual(result.applied, true); assert.strictEqual(result.verification.conformant, true);
  assert.deepStrictEqual(result.rollback.replacementSnapshot, initial);
  const replay = migration.simulate(schema, result.after); assert.strictEqual(replay.report.conformant, true); assert.strictEqual(replay.verification.conformant, true);
  const broken = JSON.parse(JSON.stringify(result.after)); broken.lists.Necessidades_Materiais.fields.Necessidade_ID = 'Number:required';
  assert.strictEqual(migration.simulate(schema, broken).blocked, true);
})();

setImmediate(() => console.log('suprimentos-mock-migration.test.js: OK — mock gateway e migração reversível'));
