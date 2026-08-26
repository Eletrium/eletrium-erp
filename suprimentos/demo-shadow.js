(function () {
  'use strict';
  var ledger = window.SuprimentosLedger, reconciliation = window.SuprimentosReconciliation;
  var state = { openingStockByMaterial: { MAT_001: 12 }, rowVersionsByMaterial: { MAT_001: 2 }, reservationEvents: [
    { eventId: 'demo-r1', type: 'RESERVA', documentId: 'NEC_DEMO', documentVersion: 1, itemId: 'ITEM_1', materialId: 'MAT_001', quantity: 5, idempotencyKey: 'demo-r1', correlationId: 'demo', createdAt: '2026-08-25T00:00:00Z', positionKey: 'NEC_DEMO|1|ITEM_1|MAT_001' },
    { eventId: 'demo-l1', type: 'LIBERACAO', documentId: 'NEC_DEMO', documentVersion: 1, itemId: 'ITEM_1', materialId: 'MAT_001', quantity: 2, idempotencyKey: 'demo-l1', correlationId: 'demo', createdAt: '2026-08-25T00:01:00Z', positionKey: 'NEC_DEMO|1|ITEM_1|MAT_001' }
  ], movementEvents: [] };
  var stored = null;
  function render(useDrift) {
    var rebuilt = ledger.rebuildProjection(state), item = rebuilt.byMaterial.MAT_001;
    if (!stored) stored = JSON.parse(JSON.stringify(rebuilt.byMaterial));
    if (useDrift) stored.MAT_001.available = 999;
    else stored = JSON.parse(JSON.stringify(rebuilt.byMaterial));
    var audit = reconciliation.inspect(state, stored);
    document.getElementById('physical').textContent = item.stockPhysical;
    document.getElementById('reserved').textContent = item.reservedValid;
    document.getElementById('available').textContent = item.available;
    var status = document.getElementById('reconciliation'); status.textContent = audit.ok ? 'OK' : 'DRIFT'; status.className = 'value ' + (audit.ok ? 'ok' : 'bad');
    document.getElementById('output').textContent = JSON.stringify({ projection: item, findings: audit.findings, repairPlan: audit.repairPlan }, null, 2);
  }
  document.getElementById('run').addEventListener('click', function () { render(false); });
  document.getElementById('drift').addEventListener('click', function () { render(true); });
  var queueModel = window.SuprimentosViewModels.exceptionQueue({ kpis: { open: 1, critical: 0, overdue: 0, syncOrReconciliation: 1 }, items: [{ exceptionId: 'SYN-EXC-001', category: 'RECONCILIACAO_PENDENTE', criticality: 'ALTA', recommendedAction: 'Revisar evento de integração' }] });
  document.getElementById('queue').innerHTML = window.SuprimentosComponents.queueTable(queueModel); render(false);
})();
