const assert = require('assert');
const needs = require('../suprimentos/core/material-needs');
const purchasing = require('../suprimentos/core/purchasing');
const receiving = require('../suprimentos/core/receiving');
const ledger = require('../suprimentos/core/ledger');
const exceptions = require('../suprimentos/core/exceptions');

(function shadowPilotEndToEnd() {
  const need = needs.createNeed({
    necessityId: 'nec-shadow-1', proposalId: 'prop-shadow-1', projectId: 'proj-shadow-1',
    packageId: 'pkg-shadow-1', itemId: 'item-shadow-1', materialId: 'mat-shadow-1',
    materialOrigin: 'ELETRIUM', plannedQuantity: 4, unit: 'un', requiredDate: '2026-09-10',
    criticality: 'ALTA', snapshotVersion: 1, status: 'PENDENTE'
  });
  const shortage = needs.createPurchaseRequestFromShortage(need, {
    purchaseRequestId: 'sc-shadow-1', shortageQuantity: 4, idempotencyKey: 'idem-shortage-shadow-1'
  });
  const request = purchasing.createPurchaseRequest({
    purchaseRequestId: shortage.purchaseRequestId, projectId: shortage.projectId,
    necessityId: shortage.necessityId, itemId: shortage.itemId, materialId: shortage.materialId,
    quantity: shortage.quantity, requiredDate: shortage.requiredDate, criticality: shortage.criticality,
    idempotencyKey: shortage.idempotencyKey
  });
  const round = purchasing.createQuoteRound({
    roundId: 'round-shadow-1', version: 1, items: [{
      offerId: 'offer-shadow-1', supplierId: 'supplier-shadow-1',
      purchaseRequestId: request.purchaseRequestId, itemId: request.itemId, materialId: request.materialId,
      quantity: request.quantity, unitPrice: 25, freight: 0, taxes: 0, deliveryDays: 2,
      validUntil: '2026-09-30T23:59:59Z', evidenceId: 'evidence-shadow-1'
    }]
  });
  const comparison = purchasing.buildComparison(round, '2026-08-24T00:00:00Z');
  const approval = purchasing.approveRound(round, comparison, {
    approvalId: 'approval-shadow-1', approverId: 'user-shadow-1',
    selectedOfferId: comparison.recommendedOfferId, approvedAt: '2026-08-24T01:00:00Z'
  }, { policyId: 'policy-shadow-1', version: 1, limit: 200 });
  const order = purchasing.createPurchaseOrder(round, approval, {
    orderId: 'po-shadow-1', idempotencyKey: 'idem-po-shadow-1'
  });
  assert.strictEqual(order.items[0].itemId, need.itemId, 'Item_ID deve sobreviver até o pedido');

  const receipt = receiving.receive(order, {
    receiptId: 'receipt-shadow-1', userId: 'user-shadow-1', receivedAt: '2026-08-25T00:00:00Z',
    items: [{ itemId: need.itemId, materialId: need.materialId, acceptedQuantity: 4 }]
  });
  const staged = receiving.stageInvoice(receiving.createState(), {
    invoiceId: 'invoice-shadow-1', invoiceKey: 'nfe-key-shadow-1', supplierId: order.supplierId,
    orderId: order.orderId, items: [{
      itemId: need.itemId, materialId: need.materialId, quantity: 4, unitPrice: 25
    }], idempotencyKey: 'idem-stage-shadow-1'
  });
  const matched = receiving.match(order, receipt, staged.result);
  assert.strictEqual(matched.ok, true);
  const accepted = receiving.accept(staged.state, {
    idempotencyKey: 'idem-accept-shadow-1', correlationId: 'corr-shadow-1',
    acceptedAt: '2026-08-25T01:00:00Z', matchResult: matched, receipt: receipt,
    policyId: 'cost-policy-shadow-1', policyVersion: 1
  });

  const stockState = ledger.createState({
    openingStockByMaterial: { [need.materialId]: 0 },
    movementEvents: accepted.result.movements,
    rowVersionsByMaterial: { [need.materialId]: 1 }
  });
  const projection = ledger.rebuildProjection(stockState).byMaterial[need.materialId];
  assert.strictEqual(projection.stockPhysical, 4);
  assert.strictEqual(projection.available, 4);
  assert.strictEqual(projection.lastMovementId, accepted.result.movements[0].movementId);

  let exceptionEvents = exceptions.append([], [{
    eventId: 'exc-event-open-shadow-1', exceptionId: 'exc-shadow-1', eventType: 'ABERTA',
    category: 'ESTOQUE_INSUFICIENTE', entity: 'Necessidades_Materiais', entityId: need.necessityId,
    projectId: need.projectId, criticality: need.criticality, requiredDate: need.requiredDate,
    recommendedAction: 'Comprar material', correlationId: 'corr-shadow-1',
    idempotencyKey: 'idem-exc-open-shadow-1', createdAt: '2026-08-24T00:00:00Z'
  }]);
  exceptionEvents = exceptions.append(exceptionEvents, [{
    eventId: 'exc-event-resolve-shadow-1', exceptionId: 'exc-shadow-1', eventType: 'RESOLVIDA',
    resolutionKind: 'RECEBIMENTO_ACEITO', resolutionEvidenceId: receipt.receiptId,
    correlationId: 'corr-shadow-1', idempotencyKey: 'idem-exc-resolve-shadow-1',
    createdAt: '2026-08-25T01:00:00Z'
  }]);
  assert.strictEqual(exceptions.buildWorkQueue(exceptionEvents, '2026-08-25T02:00:00Z').items.length, 0);
})();

console.log('suprimentos-integration-shadow.test.js: OK — Necessidade → Compra → Recebimento → Ledger → Reconciliação operacional');
