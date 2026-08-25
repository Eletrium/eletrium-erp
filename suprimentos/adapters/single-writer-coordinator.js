(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSingleWriterCoordinator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }

  function create(port) {
    var required = ['findCommand', 'readState', 'assertEtags', 'appendReservationEvents', 'appendMovementEvents', 'writeProjection', 'saveCommandResult', 'recordIntegrationEvent'];
    required.forEach(function (method) { if (!port || typeof port[method] !== 'function') fail('SINGLE_WRITER_PORT_INVALID', method); });
    var tail = Promise.resolve();

    function serialized(task) {
      var run = tail.then(task, task);
      tail = run.catch(function () {});
      return run;
    }
    async function commitAtomic(unit) {
      return serialized(async function () {
        var correlationId = unit.commandResult && unit.commandResult.correlationId;
        var ledgerStarted = false;
        await port.assertEtags(unit.expectedEtags || {});
        await port.recordIntegrationEvent({ type: 'LEDGER_COMMIT_STARTED', correlationId: correlationId, status: 'LOCAL_PENDING' });
        try {
          if ((unit.reservationEvents || []).length) { await port.appendReservationEvents(unit.reservationEvents); ledgerStarted = true; }
          if ((unit.movementEvents || []).length) { await port.appendMovementEvents(unit.movementEvents); ledgerStarted = true; }
          await port.writeProjection(unit.projection || {}, unit.expectedEtags || {});
          await port.saveCommandResult(unit.commandResult);
          await port.recordIntegrationEvent({ type: 'LEDGER_COMMIT_COMPLETED', correlationId: correlationId, status: 'RECONCILED' });
          return { committed: true };
        } catch (error) {
          if (error && (error.status === 412 || error.code === 'ETAG_CONFLICT')) {
            if (!ledgerStarted) fail('ETAG_CONFLICT', error.details);
          }
          if (ledgerStarted) {
            await port.recordIntegrationEvent({ type: 'LEDGER_PARTIAL_EFFECT', correlationId: correlationId, status: 'SYNC_ERROR', errorCode: error.code || error.message, reconciliationRequired: true });
            fail('PERSISTENCE_PARTIAL_RECONCILIATION_REQUIRED', { correlationId: correlationId, cause: error.code || error.message, effectCommitted: true });
          }
          throw error;
        }
      });
    }
    return { findCommand: port.findCommand, readState: port.readState, commitAtomic: commitAtomic, whenIdle: function () { return tail; } };
  }
  return { create: create };
});
