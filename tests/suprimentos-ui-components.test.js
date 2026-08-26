const assert = require('assert');
const vm = require('../suprimentos/ui/view-models');
const components = require('../suprimentos/ui/components');

(function inventoryNeverTurnsDriftIntoAnActionableGreenStatus() {
  const model = vm.inventory({ materialId: 'm1', stockPhysical: 5, reservedValid: 2, available: 3, projectionVersion: 4 }, { ok: false, findings: [{}] });
  assert.strictEqual(model.reconciled, false); assert.deepStrictEqual(model.actions, ['RECONCILE']);
  const html = components.inventoryCard(model); assert.match(html, /Reconciliação obrigatória/); assert.doesNotMatch(html, /data-command="reserve"/);
})();

(function conflictCannotBeForcedFromVisualComponent() {
  const model = vm.conflict({ code: 'ROW_VERSION_CONFLICT', details: { materialId: 'm1', expected: 1, actual: 2 } });
  assert.strictEqual(model.requiresReload, true); assert.strictEqual(model.canForce, false);
  assert.match(components.conflictDialog(model), /data-command="reload"/);
})();

(function queueEscapesUntrustedTextAndDoesNotResolveDirectly() {
  const model = vm.exceptionQueue({ kpis: { open: 1 }, items: [{ exceptionId: '<img src=x onerror=1>', category: 'SYNC_ERROR', criticality: 'ALTA', recommendedAction: '<script>x</script>' }] });
  const html = components.queueTable(model); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/); assert.strictEqual(model.items[0].canResolve, false);
})();

console.log('suprimentos-ui-components.test.js: OK — componentes isolados e seguros');
