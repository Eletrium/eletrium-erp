const assert = require('assert');
const gatewayFactory = require('../suprimentos/core/command-gateway');
const observability = require('../suprimentos/core/observability');

(async function gatewayControlsAuthorizationIdempotencyAndErrors() {
  let calls = 0, now = 10;
  const observer = observability.create({ clock: () => '2026-08-25T00:00:00Z' });
  const gateway = gatewayFactory.create({
    observer, clock: () => ++now,
    authorize: async ({ actorId, operation }) => actorId === 'operator-1' && operation === 'reserve',
    operations: { reserve: async (payload, context) => { calls += 1; if (payload.fail) { const error = new Error('stock'); error.code = 'INSUFFICIENT_STOCK'; throw error; } return { accepted: payload.quantity, correlationId: context.correlationId }; } }
  });
  const envelope = { commandId: 'cmd-1', operation: 'reserve', actorId: 'operator-1', correlationId: 'corr-1', idempotencyKey: 'idem-1', schemaVersion: '1.0.0', payload: { quantity: 2 } };
  const first = await gateway.execute(envelope);
  const replay = await gateway.execute(envelope);
  assert.strictEqual(first.ok, true); assert.strictEqual(replay.replayed, true); assert.strictEqual(calls, 1);
  await assert.rejects(() => gateway.execute(Object.assign({}, envelope, { commandId: 'cmd-2', idempotencyKey: 'idem-2', actorId: 'crm-service' })), /COMMAND_FORBIDDEN/);
  await assert.rejects(() => gateway.execute(Object.assign({}, envelope, { commandId: 'cmd-3', idempotencyKey: 'idem-3', payload: { fail: true } })), (error) => error.code === 'INSUFFICIENT_STOCK');
  await assert.rejects(() => gateway.execute(Object.assign({}, envelope, { payload: { quantity: 3 } })), /IDEMPOTENCY_KEY_REUSED/);
  const telemetry = observer.snapshot();
  assert.strictEqual(telemetry.counters['command_completed:reserve'], 1);
  assert.strictEqual(telemetry.failures, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(telemetry.events[0], 'payload'), false);
})().then(() => console.log('suprimentos-command-gateway.test.js: OK — autorização, retry e telemetria'));
