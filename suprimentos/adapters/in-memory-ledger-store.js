(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core/ledger'));
  else root.SuprimentosInMemoryLedgerStore = factory(root.SuprimentosLedger);
})(typeof self !== 'undefined' ? self : this, function (ledger) {
  'use strict';
  if (!ledger) throw new Error('LEDGER_DEPENDENCY_REQUIRED');

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function fault(code, details) { const error = new Error(code); error.code = code; if (details) Object.assign(error, details); throw error; }

  function create(initial) {
    let state = ledger.createState(initial);
    return {
      snapshot: function () { return copy(state); },
      execute: function (operation, command, options) {
        options = options || {};
        if (options.failAt === 'BEFORE_COMMIT') fault('INJECTED_FAILURE_BEFORE_COMMIT', { effectCommitted: false });
        const executed = ledger.execute(state, operation, command, options.now);
        if (options.failAt === 'PARTIAL_RESERVATION_WRITE') {
          const partial = ledger.createState(state);
          partial.reservationEvents = partial.reservationEvents.concat(copy(executed.result.reservationEvents));
          Object.keys(executed.result.rowVersionsByMaterial).forEach(function (materialId) {
            partial.rowVersionsByMaterial[materialId] = executed.result.rowVersionsByMaterial[materialId];
          });
          state = partial;
          fault('INJECTED_PARTIAL_WRITE', { effectCommitted: true, correlationId: command.correlationId });
        }
        state = executed.state;
        if (options.failAt === 'AFTER_COMMIT_BEFORE_ACK') fault('ACK_LOST_AFTER_COMMIT', { effectCommitted: true, retryRequired: true });
        return executed;
      },
      replaceProjectionStateForTest: function (next) { state = ledger.createState(next); }
    };
  }

  return { create: create };
});
