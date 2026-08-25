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

    async function execute(envelope) {
      envelope = envelope || {};
      required(envelope.commandId, 'COMMAND_ID_REQUIRED'); required(envelope.operation, 'OPERATION_REQUIRED');
      required(envelope.actorId, 'ACTOR_ID_REQUIRED'); required(envelope.correlationId, 'CORRELATION_ID_REQUIRED');
      required(envelope.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED'); required(envelope.schemaVersion, 'SCHEMA_VERSION_REQUIRED');
      if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) fail('PAYLOAD_REQUIRED');
      var handler = operations[envelope.operation];
      if (typeof handler !== 'function') fail('OPERATION_NOT_REGISTERED', envelope.operation);
      var fingerprint = stable(envelope);
      if (prior[envelope.idempotencyKey]) {
        if (prior[envelope.idempotencyKey].fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED');
        observer.emit('INFO', 'command_replayed', Object.assign({}, envelope, { replayed: true }));
        return Object.assign({}, prior[envelope.idempotencyKey].result, { replayed: true });
      }
      if (!await authorize({ actorId: envelope.actorId, operation: envelope.operation, schemaVersion: envelope.schemaVersion })) fail('COMMAND_FORBIDDEN');
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
