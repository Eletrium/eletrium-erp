const assert = require('assert');
const producer = require('../suprimentos/integration/os-consumption-producer');
const verifier = require('../suprimentos/core/integration-contracts');

function input() {
  return { commandId: 'cmd-1', actorId: 'os-service', correlationId: 'corr-1', idempotencyKey: 'idem-1', proposalId: 'p1', projectId: 'pr1', packageId: 'pkg1', osId: 'os1', necessityId: 'n1', documentVersion: 3, expectedVersions: { m1: 7 }, items: [{ itemId: 'exec1', materialId: 'm1', quantity: 2, reservationDocumentId: 'n1', reservationDocumentVersion: 2, reservationItemId: 'need-line-1' }] };
}

(function producerBuildsCanonicalPayloadWithoutReadingOsStateMachine() {
  const built = producer.build(input());
  assert.strictEqual(built.envelope.operation, 'os.consume.v1');
  assert.strictEqual(built.envelope.payload.projectId, 'pr1');
  const command = verifier.fromOsConsumption(built.envelope);
  assert.strictEqual(command.documentId, 'os1'); assert.strictEqual(command.items[0].sourceItemId, 'need-line-1');
})();

(function retryMustKeepKeyAndExactPayload() {
  const first = producer.build(input()), replay = producer.build(input());
  assert.strictEqual(producer.assertRetry(first, replay), true);
  const changed = input(); changed.items[0].quantity = 3;
  assert.throws(() => producer.assertRetry(first, producer.build(changed)), /RETRY_PAYLOAD_CHANGED/);
  const newKey = input(); newKey.idempotencyKey = 'idem-2';
  assert.throws(() => producer.assertRetry(first, producer.build(newKey)), /RETRY_IDEMPOTENCY_KEY_CHANGED/);
})();

(function descriptionsCannotReplaceRelationalIds() {
  const broken = input(); delete broken.items[0].materialId; broken.items[0].materialDescription = 'Cabo';
  assert.throws(() => producer.build(broken), /MATERIAL_ID_REQUIRED/);
})();

console.log('suprimentos-os-producer.test.js: OK — builder canônico e retry imutável');
