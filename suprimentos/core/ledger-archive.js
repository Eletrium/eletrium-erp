(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ledger'));
  else root.SuprimentosLedgerArchive = factory(root.SuprimentosLedger);
})(typeof self !== 'undefined' ? self : this, function (ledger) {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function canonical(value) { return ledger.fingerprintCommand(value); }
  function requireDigest(digest) { if (typeof digest !== 'function') fail('ARCHIVE_DIGEST_REQUIRED'); }
  function create(state, metadata, digest) {
    requireDigest(digest);
    var snapshot = ledger.createState(state);
    var rebuilt = ledger.rebuildProjection(snapshot);
    var payload = { formatVersion: 'suprimentos-ledger-archive.v1', createdAt: metadata && metadata.createdAt, source: metadata && metadata.source || 'unknown', state: snapshot, projection: rebuilt.byMaterial };
    if (!payload.createdAt || !Number.isFinite(new Date(payload.createdAt).getTime())) fail('ARCHIVE_CREATED_AT_REQUIRED');
    return { payload: payload, checksumAlgorithm: 'sha256', checksum: digest(canonical(payload)) };
  }
  function verify(archive, digest) {
    requireDigest(digest);
    if (!archive || !archive.payload || archive.payload.formatVersion !== 'suprimentos-ledger-archive.v1') fail('ARCHIVE_FORMAT_INVALID');
    var checksumValid = digest(canonical(archive.payload)) === archive.checksum;
    if (!checksumValid) return { ok: false, checksumValid: false, projectionValid: false, reason: 'ARCHIVE_CHECKSUM_MISMATCH' };
    var rebuilt;
    try { rebuilt = ledger.rebuildProjection(archive.payload.state); }
    catch (error) { return { ok: false, checksumValid: true, projectionValid: false, reason: error.code || error.message }; }
    var projectionValid = canonical(rebuilt.byMaterial) === canonical(archive.payload.projection);
    return { ok: projectionValid, checksumValid: true, projectionValid: projectionValid, reason: projectionValid ? null : 'ARCHIVE_PROJECTION_MISMATCH' };
  }
  function restore(archive, digest) {
    var report = verify(archive, digest);
    if (!report.ok) fail('ARCHIVE_RESTORE_BLOCKED', report);
    return ledger.createState(clone(archive.payload.state));
  }
  return { create: create, verify: verify, restore: restore };
});
