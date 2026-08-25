(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ledger'));
  else root.SuprimentosReconciliation = factory(root.SuprimentosLedger);
})(typeof self !== 'undefined' ? self : this, function (ledger) {
  'use strict';
  function finding(type, severity, materialId, details) { return { type: type, severity: severity, materialId: materialId || null, details: details || null }; }

  function inspect(state, storedProjection) {
    const findings = [];
    let rebuilt;
    try { rebuilt = ledger.rebuildProjection(state); }
    catch (error) {
      findings.push(finding('LEDGER_INVARIANT_BROKEN', 'CRITICA', error.details && error.details.materialId, { code: error.code || error.message, details: error.details }));
      return { ok: false, findings: findings, repairPlan: [], exceptionDrafts: toExceptions(findings) };
    }
    const projectionCheck = ledger.reconcile(state, storedProjection || {});
    projectionCheck.differences.forEach(function (difference) {
      findings.push(finding('PROJECTION_DIVERGENCE', 'ALTA', difference.materialId, difference));
    });
    const movementByReservation = new Set((state.movementEvents || []).map(function (event) { return event.reservationEventId; }).filter(Boolean));
    (state.reservationEvents || []).filter(function (event) { return event.type === 'CONSUMO'; }).forEach(function (event) {
      if (!movementByReservation.has(event.eventId)) findings.push(finding('CONSUMPTION_WITHOUT_MOVEMENT', 'CRITICA', event.materialId, { reservationEventId: event.eventId, correlationId: event.correlationId }));
    });
    const repairPlan = [];
    if (projectionCheck.differences.length) repairPlan.push({ type: 'REBUILD_PROJECTION', replacement: rebuilt.byMaterial, requiresConditionalWrite: true });
    if (findings.some(function (item) { return item.type === 'CONSUMPTION_WITHOUT_MOVEMENT'; })) repairPlan.push({ type: 'MANUAL_COMPENSATION_REQUIRED', automatic: false });
    return { ok: findings.length === 0, findings: findings, repairPlan: repairPlan, rebuilt: rebuilt, exceptionDrafts: toExceptions(findings) };
  }

  function toExceptions(findings) {
    return findings.map(function (item, index) {
      return {
        category: 'RECONCILIACAO_PENDENTE',
        entity: item.type === 'PROJECTION_DIVERGENCE' ? 'Estoque_Projetado' : 'Movimentacoes_Estoque',
        entityId: item.materialId || 'ledger-global',
        criticality: item.severity,
        recommendedAction: item.type === 'PROJECTION_DIVERGENCE' ? 'Reconstruir projeção com CAS' : 'Revisar correlação e emitir compensação',
        findingIndex: index,
        details: item.details
      };
    });
  }

  return { inspect: inspect, toExceptions: toExceptions };
});
