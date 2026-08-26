#!/usr/bin/env node
'use strict';
const crypto = require('crypto');
const ledger = require('../core/ledger');
const archive = require('../core/ledger-archive');
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
const initial = ledger.createState({ openingStockByMaterial: { 'material-synthetic-1': 20 }, rowVersionsByMaterial: { 'material-synthetic-1': 0 } });
const command = { idempotencyKey: 'recovery-drill-reserve-1', documentId: 'synthetic-project-1', documentVersion: 1, correlationId: 'recovery-drill-1', expectedVersions: { 'material-synthetic-1': 0 }, items: [{ itemId: 'synthetic-item-1', materialId: 'material-synthetic-1', quantity: 7 }] };
const committed = ledger.reserve(initial, command, '2026-08-26T00:00:00Z');
const bundle = archive.create(committed.state, { createdAt: '2026-08-26T00:01:00Z', source: 'synthetic-recovery-drill' }, sha256);
const verification = archive.verify(bundle, sha256);
const restored = archive.restore(bundle, sha256);
const projection = ledger.rebuildProjection(restored).byMaterial['material-synthetic-1'];
const report = { syntheticOnly: true, verification: verification, projection: projection, archiveChecksum: bundle.checksum };
console.log(JSON.stringify(report, null, 2));
if (!verification.ok || projection.available !== 13) process.exitCode = 1;
