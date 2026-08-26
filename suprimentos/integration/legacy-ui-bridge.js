(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosLegacyUiBridge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  function create(options) {
    options = options || {}; if (typeof options.send !== 'function') fail('COMMAND_TRANSPORT_REQUIRED');
    var actorId = options.actorId || 'suprimentos-ui'; var version = options.schemaVersion || '1.0.0';
    function item(input) {
      if (!input.itemId || !input.materialId || !Number.isFinite(Number(input.quantity)) || Number(input.quantity) <= 0) fail('CANONICAL_ITEM_REQUIRED', input);
      return { itemId: String(input.itemId), materialId: String(input.materialId), quantity: Number(input.quantity), necessityId: input.necessityId || undefined };
    }
    async function command(operation, input) {
      if (!input || !input.documentId || !input.correlationId || !input.idempotencyKey) fail('COMMAND_CONTEXT_REQUIRED');
      var envelope = { commandId: input.commandId || input.idempotencyKey, operation: operation, actorId: actorId, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey, schemaVersion: version,
        payload: { documentId: String(input.documentId), documentVersion: Number(input.documentVersion || 1), expectedVersions: input.expectedVersions || {}, items: (input.items || []).map(item) } };
      return options.send(envelope);
    }
    return { reserve: function (input) { return command('reserve', input); }, release: function (input) { return command('release', input); }, consume: function (input) { return command('consume', input); } };
  }
  return { create: create };
});
