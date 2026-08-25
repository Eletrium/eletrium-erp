const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');
const components = require('../suprimentos/ui/components');
const vm = require('../suprimentos/ui/view-models');

(function traceabilityHasNoOrphans() {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, '../suprimentos/tools/traceability-report.js')], { encoding: 'utf8' }); assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout); assert.strictEqual(report.complete, true); assert.ok(report.requirements >= 10);
})();

(function componentsExposeTextAndSemanticChannels() {
  const inventory = components.inventoryCard(vm.inventory({ materialId: 'm1', available: 0 }, { ok: false, findings: [{}] })); assert.match(inventory, /role="status"/); assert.match(inventory, /Reconciliação obrigatória/);
  const dialog = components.conflictDialog(vm.conflict({ code: 'ROW_VERSION_CONFLICT' })); assert.match(dialog, /role="alertdialog"/); assert.match(dialog, /aria-labelledby=/);
  const table = components.queueTable(vm.exceptionQueue({ kpis: {}, items: [] })); assert.match(table, /<thead>/); assert.match(table, /<th>/);
})();

console.log('suprimentos-traceability-accessibility.test.js: OK — rastreabilidade e semântica');
