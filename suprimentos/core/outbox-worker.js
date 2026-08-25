(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosOutboxWorker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function create(options) {
    options = options || {}; var store = options.store, sender = options.sender;
    if (!store || !sender || typeof sender.send !== 'function') fail('OUTBOX_DEPENDENCIES_REQUIRED');
    var owner = options.owner || 'worker-1', maxRetries = Number(options.maxRetries || 5), leaseMs = Number(options.leaseMs || 30000);
    var clock = options.clock || function () { return new Date().toISOString(); };
    function backoff(retry) { return Math.min(3600000, 1000 * Math.pow(2, retry)); }
    async function runOnce(limit) {
      var now = clock(); if (typeof store.recoverExpired === 'function') await store.recoverExpired(now);
      var claimed = await store.claim(owner, now, Number(limit || 20), leaseMs); var results = [];
      for (const event of claimed) {
        try {
          var receipt = await sender.send(event);
          if (!receipt || !receipt.externalId) fail('EXTERNAL_RECEIPT_REQUIRED');
          await store.complete(event.eventId, owner, receipt); results.push({ eventId: event.eventId, status: 'SYNCED' });
        } catch (error) {
          var effectUnknown = error && error.effectUnknown === true;
          var retryable = error && error.retryable === true && Number(event.retryCount || 0) < maxRetries;
          if (effectUnknown) { await store.uncertain(event.eventId, owner, error.code || 'EFFECT_UNKNOWN'); results.push({ eventId: event.eventId, status: 'RECONCILIATION_PENDING' }); }
          else if (retryable) { var next = new Date(new Date(now).getTime() + backoff(Number(event.retryCount || 0))).toISOString(); await store.retry(event.eventId, owner, error.code || 'RETRYABLE_ERROR', next); results.push({ eventId: event.eventId, status: 'SYNC_ERROR', nextAttemptAt: next }); }
          else { await store.uncertain(event.eventId, owner, error.code || 'NON_RETRYABLE_ERROR'); results.push({ eventId: event.eventId, status: 'RECONCILIATION_PENDING' }); }
        }
      }
      return { owner: owner, claimed: claimed.length, results: results };
    }
    return { runOnce: runOnce };
  }
  return { create: create };
});
