const assert = require('assert');
const gatewayFactory = require('../suprimentos/core/command-gateway');
const observability = require('../suprimentos/core/observability');

(async function limitsPayloadRateAndReplayBeforeHandler() {
  let calls = 0, allowed = true, replayAllowed = true; const observer = observability.create();
  const gateway = gatewayFactory.create({ observer, maxPayloadBytes: 40, authorize: async () => true,
    rateLimiter: async () => allowed, replayGuard: async () => replayAllowed,
    operations: { reserve: async () => { calls += 1; return { ok: true }; } } });
  function envelope(key, payload) { return { commandId: 'c-' + key, operation: 'reserve', actorId: 'u1', correlationId: 'corr-' + key, idempotencyKey: key, schemaVersion: '1.0.0', payload: payload || { x: 1 } }; }
  await assert.rejects(() => gateway.execute(envelope('large', { text: 'x'.repeat(100) })), /PAYLOAD_TOO_LARGE/);
  allowed = false; await assert.rejects(() => gateway.execute(envelope('limited')), /COMMAND_RATE_LIMITED/);
  allowed = true; replayAllowed = false; await assert.rejects(() => gateway.execute(envelope('replay')), /COMMAND_REPLAY_REJECTED/);
  assert.strictEqual(calls, 0); assert.strictEqual(observer.snapshot().counters['command_rejected:reserve'], 3);
})();

console.log('suprimentos-gateway-hardening.test.js: OK — tamanho, rate limit e replay guard');
