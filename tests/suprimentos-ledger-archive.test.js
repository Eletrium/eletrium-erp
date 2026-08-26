const assert = require('assert');
const crypto = require('crypto');
const ledger = require('../suprimentos/core/ledger');
const archive = require('../suprimentos/core/ledger-archive');
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }

(function archiveRestoresOnlyWhenChecksumAndProjectionMatch() {
  const state = ledger.createState({ openingStockByMaterial: { m1: 10 }, rowVersionsByMaterial: { m1: 0 } });
  const reserved = ledger.reserve(state, { idempotencyKey: 'archive-reserve', documentId: 'doc-1', documentVersion: 1, correlationId: 'archive-corr', expectedVersions: { m1: 0 }, items: [{ itemId: 'i1', materialId: 'm1', quantity: 4 }] }, '2026-08-26T00:00:00Z');
  const bundle = archive.create(reserved.state, { createdAt: '2026-08-26T00:01:00Z', source: 'test' }, digest);
  assert.strictEqual(archive.verify(bundle, digest).ok, true);
  assert.strictEqual(ledger.deriveAvailability(archive.restore(bundle, digest), 'm1'), 6);
  const corrupted = copy(bundle);
  corrupted.payload.state.reservationEvents[0].quantity = 9;
  assert.strictEqual(archive.verify(corrupted, digest).reason, 'ARCHIVE_CHECKSUM_MISMATCH');
  assert.throws(() => archive.restore(corrupted, digest), (error) => error.code === 'ARCHIVE_RESTORE_BLOCKED');
  const projectionChanged = copy(bundle);
  projectionChanged.payload.projection.m1.available = 99;
  projectionChanged.checksum = digest(ledger.fingerprintCommand(projectionChanged.payload));
  assert.strictEqual(archive.verify(projectionChanged, digest).reason, 'ARCHIVE_PROJECTION_MISMATCH');
})();

console.log('suprimentos-ledger-archive.test.js: OK — backup verificável e restore fail-closed');
