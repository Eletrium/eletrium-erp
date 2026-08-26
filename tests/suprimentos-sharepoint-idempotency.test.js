const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');
const adapterFactory = require('../suprimentos/adapters/sharepoint-ledger-adapter');
const coordinatorFactory = require('../suprimentos/adapters/single-writer-coordinator');
const repositoryFactory = require('../suprimentos/adapters/sharepoint-repository');

function command(quantity) {
  return {
    idempotencyKey: 'retry-1', documentId: 'doc-1', documentVersion: 1,
    correlationId: 'corr-1', expectedVersions: { m1: 0 },
    items: [{ itemId: 'item-1', materialId: 'm1', quantity: quantity }]
  };
}

(async function persistedFingerprintProtectsRemoteRetries() {
  const original = command(2);
  const priorResult = { idempotencyKey: original.idempotencyKey, correlationId: original.correlationId };
  const createAdapter = (prior) => adapterFactory.create({
    findCommand: async () => prior,
    readState: async () => assert.fail('replay não deve reler nem escrever estado'),
    commitAtomic: async () => assert.fail('replay não deve persistir novamente')
  });

  const replay = await createAdapter({ result: priorResult, commandFingerprint: ledger.fingerprintCommand(original) }).execute('reserve', original);
  assert.strictEqual(replay.replayed, true);
  assert.deepStrictEqual(replay.result, priorResult);

  await assert.rejects(
    () => createAdapter({ result: priorResult, commandFingerprint: ledger.fingerprintCommand(original) }).execute('reserve', command(3)),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED'
  );
  await assert.rejects(
    () => createAdapter({ result: priorResult, commandFingerprint: null }).execute('reserve', original),
    (error) => error.code === 'IDEMPOTENCY_FINGERPRINT_MISSING'
  );
  await assert.rejects(
    () => createAdapter({ result: null, commandFingerprint: ledger.fingerprintCommand(original), status: 'SENDING' }).execute('reserve', original),
    (error) => error.code === 'COMMAND_RECONCILIATION_REQUIRED'
  );
})();

(async function repositoryPersistsAndReadsFingerprint() {
  const rows = [];
  const graph = {
    query: async (list, filter) => {
      const keyMatch = /Idempotency_Key eq '([^']+)'/.exec(filter || '');
      return { complete: true, value: rows.filter((row) => !keyMatch || row.fields.Idempotency_Key === keyMatch[1]) };
    },
    append: async (list, fields) => { const row = { id: String(rows.length + 1), eTag: 'etag-1', fields: fields }; rows.push(row); return row; },
    conditionalUpdate: async (list, id, fields, etag) => {
      const row = rows.find((item) => item.id === id);
      assert.ok(row); assert.strictEqual(etag, row.eTag);
      row.fields = Object.assign({}, row.fields, fields); row.eTag = 'etag-' + row.fields.Row_Version;
      return row;
    }
  };
  const repository = repositoryFactory.create(graph);
  const result = { idempotencyKey: 'persist-1', correlationId: 'corr-persist' };
  await repository.claimCommand(result, { commandFingerprint: '{"command":1}' });
  await repository.saveCommandResult(result, { commandFingerprint: '{"command":1}' });
  const stored = await repository.findCommand('persist-1');
  assert.deepStrictEqual(stored.result, result);
  assert.strictEqual(stored.commandFingerprint, '{"command":1}');
  await assert.rejects(() => repository.saveCommandResult(result, {}), (error) => error.code === 'COMMAND_FINGERPRINT_REQUIRED');

  const interrupted = { idempotencyKey: 'interrupted-1', correlationId: 'corr-interrupted' };
  await repository.claimCommand(interrupted, { commandFingerprint: 'fingerprint-original' });
  const pending = await repository.findCommand('interrupted-1');
  assert.strictEqual(pending.result, null); assert.strictEqual(pending.status, 'SENDING');
  await assert.rejects(
    () => repository.claimCommand(interrupted, { commandFingerprint: 'fingerprint-original' }),
    (error) => error.code === 'COMMAND_RECONCILIATION_REQUIRED'
  );
  await assert.rejects(
    () => repository.claimCommand(interrupted, { commandFingerprint: 'fingerprint-alterado' }),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED'
  );
})();

(async function coordinatorForwardsFingerprintToDurablePort() {
  let received;
  const port = {
    findCommand: async () => null,
    readState: async () => ({ complete: true }),
    assertEtags: async () => true,
    claimCommand: async () => ({}),
    appendReservationEvents: async () => [],
    appendMovementEvents: async () => [],
    writeProjection: async () => [],
    saveCommandResult: async (result, metadata) => { received = { result, metadata }; },
    recordIntegrationEvent: async () => ({})
  };
  const coordinator = coordinatorFactory.create(port);
  const result = { idempotencyKey: 'forward-1', correlationId: 'corr-forward' };
  await coordinator.commitAtomic({ expectedEtags: {}, reservationEvents: [], movementEvents: [], projection: {}, commandResult: result, commandFingerprint: 'fingerprint-1' });
  assert.deepStrictEqual(received, { result: result, metadata: { commandFingerprint: 'fingerprint-1' } });
})().then(() => console.log('suprimentos-sharepoint-idempotency.test.js: OK — replay remoto protegido por fingerprint'));
