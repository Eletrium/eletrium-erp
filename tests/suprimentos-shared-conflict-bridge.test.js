const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');
const bridgeFactory = require('../suprimentos/integration/legacy-ui-bridge');

(function auditFindsCurrentConflictsWithoutEditingSharedFiles() {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, '../suprimentos/tools/shared-conflict-audit.js')], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr); const report = JSON.parse(result.stdout);
  assert.ok(report.blockers >= 3); assert.strictEqual(report.protectedFilesModified, false);
  assert.ok(report.findings.some((item) => item.id === 'UI_DIRECT_STOCK_PATCH'));
  assert.ok(report.findings.some((item) => item.id === 'SHARED_PAGINATION_TRUNCATES'));
})();

(async function bridgeRejectsDescriptionsAsKeysAndOnlySendsCommands() {
  const sent = []; const bridge = bridgeFactory.create({ actorId: 'operator-1', send: async (envelope) => { sent.push(envelope); return { ok: true }; } });
  await assert.rejects(() => bridge.reserve({ documentId: 'orc1', correlationId: 'c1', idempotencyKey: 'i1', items: [{ itemId: 'line1', materialDescription: 'Cabo', quantity: 2 }] }), /CANONICAL_ITEM_REQUIRED/);
  await bridge.reserve({ documentId: 'orc1', documentVersion: 2, correlationId: 'c2', idempotencyKey: 'i2', expectedVersions: { mat1: 3 }, items: [{ itemId: 'line1', materialId: 'mat1', quantity: 2 }] });
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].operation, 'reserve'); assert.strictEqual(sent[0].payload.items[0].materialId, 'mat1');
  assert.strictEqual(JSON.stringify(sent).includes('Estoque_Reservado'), false);
})().then(() => console.log('suprimentos-shared-conflict-bridge.test.js: OK — delta real e bridge contratual'));
