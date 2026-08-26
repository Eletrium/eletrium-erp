(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./command-gateway'), require('./schema-validator'), require('./security'));
  else root.SuprimentosRuntime = factory(root.SuprimentosCommandGateway, root.SuprimentosSchemaValidator, root.SuprimentosSecurity);
})(typeof self !== 'undefined' ? self : this, function (gatewayFactory, validator, security) {
  'use strict';
  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function create(options) {
    options = options || {};
    if (!options.contract || typeof options.identityProvider !== 'function') fail('RUNTIME_CONFIGURATION_REQUIRED');
    var handlers = options.handlers || {}, observer = options.observer;
    var gateway = gatewayFactory.create({
      operations: handlers, observer: observer, clock: options.clock,
      maxPayloadBytes: options.maxPayloadBytes, rateLimiter: options.rateLimiter, replayGuard: options.replayGuard,
      authorize: async function (request) { var identity = await options.identityProvider(request.actorId); return security.authorize(identity, request.operation); }
    });
    return {
      execute: async function (envelope) {
        try { validator.validateCommand(options.contract, envelope); }
        catch (error) { if (observer && observer.emit) observer.emit('ERROR', 'schema_rejected', { operation: envelope && envelope.operation, actorId: envelope && envelope.actorId, correlationId: envelope && envelope.correlationId, commandId: envelope && envelope.commandId, errorCode: error.code || error.message }); throw error; }
        var flags = security.flags(options.flags);
        if (!flags.shadowMode && envelope.operation === 'publish' && !flags.sharePointWrites) fail('SHAREPOINT_WRITE_FLAG_CLOSED');
        return gateway.execute(envelope);
      },
      flags: security.flags(options.flags)
    };
  }
  return { create: create };
});
