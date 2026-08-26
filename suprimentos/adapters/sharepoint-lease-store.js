(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSharePointLeaseStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIST = 'Leases_Processamento';
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  function create(graph, options) {
    options = options || {}; if (!graph || !graph.query || !graph.append || !graph.conditionalUpdate) fail('GRAPH_CLIENT_REQUIRED');
    var clock = options.clock || function () { return new Date().toISOString(); };
    async function load(key) {
      var page = await graph.query(LIST, "fields/Lease_Key eq '" + String(key).replace(/'/g, "''") + "'");
      if (!page.complete) fail('INCOMPLETE_STATE_READ'); if (page.value.length > 1) fail('LEASE_UNIQUENESS_BROKEN', key);
      return page.value[0] || null;
    }
    async function acquire(key, owner, ttlMs) {
      if (!key || !owner || !Number.isFinite(Number(ttlMs)) || Number(ttlMs) <= 0) fail('LEASE_COMMAND_INVALID');
      var now = clock(), until = new Date(new Date(now).getTime() + Number(ttlMs)).toISOString(), row = await load(key);
      if (!row) {
        var created = await graph.append(LIST, { Lease_Key: key, Owner_ID: owner, Lease_Until: until, Fencing_Token: 1, Row_Version: 1, Updated_At: now });
        return { key: key, owner: owner, until: until, fencingToken: 1, rowVersion: 1, itemId: created.id, etag: created.eTag || created['@odata.etag'] };
      }
      var fields = row.fields || row, expired = new Date(fields.Lease_Until).getTime() <= new Date(now).getTime();
      if (!expired && fields.Owner_ID !== owner) fail('LEASE_BUSY', { key: key, owner: fields.Owner_ID, until: fields.Lease_Until });
      var token = Number(fields.Fencing_Token || 0) + 1, version = Number(fields.Row_Version || 0) + 1;
      await graph.conditionalUpdate(LIST, row.id, { Owner_ID: owner, Lease_Until: until, Fencing_Token: token, Row_Version: version, Updated_At: now }, row.eTag || row['@odata.etag']);
      return { key: key, owner: owner, until: until, fencingToken: token, rowVersion: version, itemId: row.id };
    }
    async function renew(lease, ttlMs) {
      var row = await load(lease.key); if (!row) fail('LEASE_NOT_FOUND'); var fields = row.fields || row;
      if (fields.Owner_ID !== lease.owner || Number(fields.Fencing_Token) !== Number(lease.fencingToken)) fail('LEASE_FENCED');
      return acquire(lease.key, lease.owner, ttlMs);
    }
    async function release(lease) {
      var row = await load(lease.key); if (!row) return { released: true, replayed: true }; var fields = row.fields || row;
      if (fields.Owner_ID !== lease.owner || Number(fields.Fencing_Token) !== Number(lease.fencingToken)) fail('LEASE_FENCED');
      var now = clock(); await graph.conditionalUpdate(LIST, row.id, { Lease_Until: now, Row_Version: Number(fields.Row_Version || 0) + 1, Updated_At: now }, row.eTag || row['@odata.etag']);
      return { released: true, replayed: false };
    }
    return { load: load, acquire: acquire, renew: renew, release: release };
  }
  return { create: create, LIST: LIST };
});
