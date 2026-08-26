(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosOperationalHealth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function evaluate(input, thresholds) {
    input = input || {}; thresholds = thresholds || {};
    var maxPending = Number(thresholds.maxReconciliationPending === undefined ? 0 : thresholds.maxReconciliationPending);
    var maxErrorRate = Number(thresholds.maxErrorRate === undefined ? 0.01 : thresholds.maxErrorRate);
    var maxOldestMinutes = Number(thresholds.maxOldestPendingMinutes === undefined ? 15 : thresholds.maxOldestPendingMinutes);
    var commands = Number(input.commands || 0), errors = Number(input.errors || 0), pending = Number(input.reconciliationPending || 0);
    var oldest = Number(input.oldestPendingMinutes || 0), incompleteReads = Number(input.incompleteReads || 0), conflicts = Number(input.unresolvedConflicts || 0);
    var errorRate = commands ? errors / commands : 0, alerts = [];
    if (pending > maxPending) alerts.push({ code: 'RECONCILIATION_BACKLOG', severity: 'CRITICA', actual: pending, limit: maxPending });
    if (oldest > maxOldestMinutes) alerts.push({ code: 'RECONCILIATION_STALE', severity: 'CRITICA', actual: oldest, limit: maxOldestMinutes });
    if (errorRate > maxErrorRate) alerts.push({ code: 'COMMAND_ERROR_RATE', severity: 'ALTA', actual: errorRate, limit: maxErrorRate });
    if (incompleteReads > 0) alerts.push({ code: 'INCOMPLETE_GRAPH_READ', severity: 'CRITICA', actual: incompleteReads, limit: 0 });
    if (conflicts > 0) alerts.push({ code: 'UNRESOLVED_CONCURRENCY_CONFLICT', severity: 'ALTA', actual: conflicts, limit: 0 });
    return {
      healthy: alerts.length === 0, promotionAllowed: alerts.length === 0,
      indicators: { commands: commands, errors: errors, errorRate: errorRate, reconciliationPending: pending, oldestPendingMinutes: oldest, incompleteReads: incompleteReads, unresolvedConflicts: conflicts },
      alerts: alerts
    };
  }
  return { evaluate: evaluate };
});
