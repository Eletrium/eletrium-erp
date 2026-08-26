(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosCommandGateway = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function stable(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'; return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + stable(value[key]); }).join(',') + '}'; }
  function required(value, code) { if (value === undefined || value === null || value === '') fail(code); }

  function create(options) {
    options = options || {};
    var operations = options.operations || {};
    var authorize = options.authorize || function () { return false; };
    var observer = options.observer || { emit: function () {} };
    var prior = {};
    var clock = options.clock || function () { return Date.now(); };
    var maxPayloadBytes = Number(options.maxPayloadBytes || 262144);
    var rateLimiter = options.rateLimiter || function () { return true; };
    var replayGuard = options.replayGuard || function () { return true; };

    async function execute(envelope) {
      envelope = envelope || {};
      required(envelope.commandId, 'COMMAND_ID_REQUIRED'); required(envelope.operation, 'OPERATION_REQUIRED');
      required(envelope.actorId, 'ACTOR_ID_REQUIRED'); required(envelope.correlationId, 'CORRELATION_ID_REQUIRED');
      required(envelope.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED'); required(envelope.schemaVersion, 'SCHEMA_VERSION_REQUIRED');
      if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) fail('PAYLOAD_REQUIRED');
      var payloadBytes = stable(envelope.payload).length;
      if (payloadBytes > maxPayloadBytes) { observer.emit('ERROR', 'command_rejected', Object.assign({}, envelope, { errorCode: 'PAYLOAD_TOO_LARGE' })); fail('PAYLOAD_TOO_LARGE', { bytes: payloadBytes, max: maxPayloadBytes }); }
      var handler = operations[envelope.operation];
      if (typeof handler !== 'function') { observer.emit('ERROR', 'command_rejected', Object.assign({}, envelope, { errorCode: 'OPERATION_NOT_REGISTERED' })); fail('OPERATION_NOT_REGISTERED', envelope.operation); }
      var fingerprint = stable(envelope);
      if (prior[envelope.idempotencyKey]) {
        if (prior[envelope.idempotencyKey].fingerprint !== fingerprint) { observer.emit('ERROR', 'command_rejected', Object.assign({}, envelope, { errorCode: 'IDEMPOTENCY_KEY_REUSED' })); fail('IDEMPOTENCY_KEY_REUSED'); }
        observer.emit('INFO', 'command_replayed', Object.assign({}, envelope, { replayed: true }));
        return Object.assign({}, prior[envelope.idempotencyKey].result, { replayed: true });
      }
      if (!await rateLimiter({ actorId: envelope.actorId, operation: envelope.operation })) { observer.emit('ERROR', 'command_rejected', Object.assign({}, envelope, { errorCode: 'COMMAND_RATE_LIMITED' })); fail('COMMAND_RATE_LIMITED'); }
      if (!await replayGuard(envelope)) { observer.emit('ERROR', 'command_rejected', Object.assign({}, envelope, { errorCode: 'COMMAND_REPLAY_REJECTED' })); fail('COMMAND_REPLAY_REJECTED'); }
      if (!await authorize({ actorId: envelope.actorId, operation: envelope.operation, schemaVersion: envelope.schemaVersion })) { observer.emit('ERROR', 'command_rejected', Object.assign({}, envelope, { errorCode: 'COMMAND_FORBIDDEN' })); fail('COMMAND_FORBIDDEN'); }
      var started = clock();
      observer.emit('INFO', 'command_started', envelope);
      try {
        var value = await handler(envelope.payload, { commandId: envelope.commandId, actorId: envelope.actorId, correlationId: envelope.correlationId, idempotencyKey: envelope.idempotencyKey, schemaVersion: envelope.schemaVersion });
        var result = { ok: true, commandId: envelope.commandId, correlationId: envelope.correlationId, operation: envelope.operation, replayed: false, value: value };
        prior[envelope.idempotencyKey] = { fingerprint: fingerprint, result: result };
        observer.emit('INFO', 'command_completed', Object.assign({}, envelope, { durationMs: clock() - started }));
        return result;
      } catch (error) {
        observer.emit('ERROR', 'command_failed', Object.assign({}, envelope, { durationMs: clock() - started, errorCode: error.code || 'UNEXPECTED_ERROR' }));
        throw error;
      }
    }
    return { execute: execute };
  }
  return { create: create };
});
