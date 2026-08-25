(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core/ledger'));
  else root.SuprimentosSharePointLedgerAdapter = factory(root.SuprimentosLedger);
})(typeof self !== 'undefined' ? self : this, function (ledger) {
  'use strict';
  function fail(code, details) { const error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }

  function create(client) {
    if (!client || typeof client.findCommand !== 'function' || typeof client.readState !== 'function' || typeof client.commitAtomic !== 'function') {
      fail('SHAREPOINT_CLIENT_CONTRACT_INVALID');
    }
    return {
      execute: async function (operation, command, now) {
        if (!command || !command.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED');
        const prior = await client.findCommand(command.idempotencyKey);
        if (prior) return { result: prior, replayed: true };
        const materialIds = Array.from(new Set((command.items || []).map(function (item) { return item.materialId; })));
        const loaded = await client.readState(materialIds);
        if (!loaded || !loaded.complete) fail('INCOMPLETE_STATE_READ');
        let executed;
        try {
          executed = ledger.execute(loaded.state, operation, command, now);
          await client.commitAtomic({
            expectedEtags: loaded.etags,
            reservationEvents: executed.result.reservationEvents,
            movementEvents: executed.result.movementEvents,
            projection: executed.result.projection.byMaterial,
            commandResult: executed.result
          });
        } catch (error) {
          if (error && (error.status === 412 || error.code === 'ETAG_CONFLICT')) fail('ROW_VERSION_CONFLICT', error.details);
          throw error;
        }
        return { result: executed.result, replayed: false };
      }
    };
  }
  return { create: create };
});
