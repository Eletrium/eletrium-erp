const assert = require('assert');
const shadow = require('../suprimentos/core/shadow-pilot');
const health = require('../suprimentos/core/operational-health');

(function shadowNeverPromotesDivergentOrIncompleteData() {
  const legacy = [{ materialId: 'm1', stockPhysical: 5, reservedValid: 2, available: 3 }, { materialId: 'm2', stockPhysical: 1, reservedValid: 0, available: 1 }];
  const ledger = [{ materialId: 'm1', stockPhysical: 5, reservedValid: 1, available: 4 }];
  const report = shadow.compare(legacy, ledger);
  assert.strictEqual(report.shadowOnly, true);
  assert.strictEqual(report.promotionAllowed, false);
  assert.strictEqual(report.summary.coverage, 0.5);
  assert.ok(report.differences.some((item) => item.type === 'MISSING_LEDGER'));
  assert.ok(report.differences.some((item) => item.field === 'available'));
})();

(function identicalProjectionIsOnlyEligibleForHumanApproval() {
  const rows = [{ materialId: 'm1', stockPhysical: 5, reservedValid: 2, available: 3 }];
  const report = shadow.compare(rows, JSON.parse(JSON.stringify(rows)));
  assert.strictEqual(report.promotionAllowed, true);
  assert.strictEqual(report.recommendedAction, 'ELEGIVEL_PARA_APROVACAO_HUMANA');
})();

(function operationalAlertsBlockPromotion() {
  const report = health.evaluate({ commands: 100, errors: 2, reconciliationPending: 1, oldestPendingMinutes: 20, incompleteReads: 1, unresolvedConflicts: 1 });
  assert.strictEqual(report.healthy, false);
  assert.strictEqual(report.promotionAllowed, false);
  assert.deepStrictEqual(report.alerts.map((item) => item.code).sort(), ['COMMAND_ERROR_RATE', 'INCOMPLETE_GRAPH_READ', 'RECONCILIATION_BACKLOG', 'RECONCILIATION_STALE', 'UNRESOLVED_CONCURRENCY_CONFLICT'].sort());
})();

console.log('suprimentos-shadow-operability.test.js: OK — comparação sombra e bloqueios operacionais');
