(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosInMemoryOutboxStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function create(initial) {
    var records = copy(initial || []), keys = new Set(records.map(function (item) { return item.idempotencyKey; }));
    return {
      append: async function (event) { if (keys.has(event.idempotencyKey)) return copy(records.find(function (x) { return x.idempotencyKey === event.idempotencyKey; })); records.push(copy(event)); keys.add(event.idempotencyKey); return copy(event); },
      claim: async function (owner, now, limit, leaseMs) {
        var time = new Date(now).getTime(); var claimed = [];
        records.forEach(function (item) {
          var due = !item.nextAttemptAt || new Date(item.nextAttemptAt).getTime() <= time;
          var leaseExpired = !item.leaseUntil || new Date(item.leaseUntil).getTime() <= time;
          if (claimed.length < limit && due && leaseExpired && (item.status === 'LOCAL_PENDING' || item.status === 'SYNC_ERROR')) {
            item.status = 'SENDING'; item.leaseOwner = owner; item.leaseUntil = new Date(time + leaseMs).toISOString(); item.rowVersion = Number(item.rowVersion || 0) + 1; claimed.push(copy(item));
          }
        }); return claimed;
      },
      recoverExpired: async function (now) {
        var time = new Date(now).getTime(), recovered = 0;
        records.forEach(function (item) {
          if (item.status === 'SENDING' && item.leaseUntil && new Date(item.leaseUntil).getTime() <= time) {
            item.status = 'SYNC_ERROR'; item.lastError = 'WORKER_LEASE_EXPIRED'; item.nextAttemptAt = now;
            item.leaseOwner = null; item.leaseUntil = null; recovered += 1;
          }
        }); return recovered;
      },
      complete: async function (id, owner, receipt) { var item = records.find(function (x) { return x.eventId === id; }); if (!item || item.leaseOwner !== owner) throw new Error('LEASE_NOT_OWNED'); item.status = 'SYNCED'; item.receipt = copy(receipt); item.leaseOwner = null; item.leaseUntil = null; },
      retry: async function (id, owner, errorCode, nextAttemptAt) { var item = records.find(function (x) { return x.eventId === id; }); if (!item || item.leaseOwner !== owner) throw new Error('LEASE_NOT_OWNED'); item.status = 'SYNC_ERROR'; item.retryCount = Number(item.retryCount || 0) + 1; item.lastError = errorCode; item.nextAttemptAt = nextAttemptAt; item.leaseOwner = null; item.leaseUntil = null; },
      uncertain: async function (id, owner, errorCode) { var item = records.find(function (x) { return x.eventId === id; }); if (!item || item.leaseOwner !== owner) throw new Error('LEASE_NOT_OWNED'); item.status = 'RECONCILIATION_PENDING'; item.lastError = errorCode; item.leaseOwner = null; item.leaseUntil = null; },
      snapshot: function () { return copy(records); }
    };
  }
  return { create: create };
});
