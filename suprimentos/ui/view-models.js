(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosViewModels = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function inventory(projection, reconciliation) {
    projection = projection || {}; reconciliation = reconciliation || { ok: false, findings: [] };
    return {
      materialId: projection.materialId || null, physical: Number(projection.stockPhysical || 0),
      reserved: Number(projection.reservedValid || 0), available: Number(projection.available || 0),
      projectionVersion: Number(projection.projectionVersion || 0), reconciled: reconciliation.ok === true,
      severity: reconciliation.ok ? 'OK' : 'BLOCKED', findingsCount: (reconciliation.findings || []).length,
      actions: reconciliation.ok ? ['RESERVE', 'RELEASE'] : ['RECONCILE']
    };
  }
  function conflict(error) {
    var details = error && error.details || {};
    return { visible: true, code: error && (error.code || error.message) || 'UNKNOWN_ERROR', materialId: details.materialId || null,
      expectedVersion: details.expected, actualVersion: details.actual, requiresReload: true, canForce: false };
  }
  function exceptionQueue(queue) {
    return { totals: Object.assign({ open: 0, critical: 0, overdue: 0, syncOrReconciliation: 0 }, queue && queue.kpis),
      items: (queue && queue.items || []).map(function (item) { return { id: item.exceptionId, category: item.category, criticality: item.criticality, ageHours: item.ageHours, responsibleId: item.responsibleId || null, action: item.recommendedAction, canResolve: false }; }) };
  }
  function receivingMatch(match) {
    return { accepted: !!(match && match.ok), status: match && match.ok ? 'MATCH_OK' : 'DIVERGENCE',
      divergences: (match && match.divergences || []).map(function (item) { return { type: item.type, itemId: item.itemId || null, expected: item.expected, actual: item.actual }; }),
      canPostStock: !!(match && match.ok), requiresEvidence: !!(match && !match.ok) };
  }
  return { inventory: inventory, conflict: conflict, exceptionQueue: exceptionQueue, receivingMatch: receivingMatch };
});
