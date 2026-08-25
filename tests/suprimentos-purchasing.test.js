const assert = require('assert');
const purchasing = require('../suprimentos/core/purchasing');

function request() {
  return purchasing.createPurchaseRequest({
    purchaseRequestId: 'sc-1', projectId: 'proj-1', necessityId: 'nec-1', itemId: 'item-1',
    materialId: 'mat-1', quantity: 10, requiredDate: '2026-09-10', criticality: 'NORMAL',
    idempotencyKey: 'idem-sc-1'
  });
}

function round(overrides) {
  return purchasing.createQuoteRound(Object.assign({
    roundId: 'round-1', version: 1, items: [
      {
        offerId: 'offer-a', supplierId: 'supplier-a', purchaseRequestId: 'sc-1', itemId: 'item-1', materialId: 'mat-1',
        quantity: 10, unitPrice: 10, freight: 20, taxes: 5, deliveryDays: 5,
        validUntil: '2026-09-30T23:59:59Z', evidenceId: 'evidence-a'
      },
      {
        offerId: 'offer-b', supplierId: 'supplier-b', purchaseRequestId: 'sc-1', itemId: 'item-1', materialId: 'mat-1',
        quantity: 10, unitPrice: 11, freight: 0, taxes: 0, deliveryDays: 3,
        validUntil: '2026-09-30T23:59:59Z', evidenceId: 'evidence-b'
      }
    ]
  }, overrides || {}));
}

(function ts33CreatesTraceablePurchaseRequest() {
  const created = request();
  assert.deepStrictEqual({
    purchaseRequestId: created.purchaseRequestId, projectId: created.projectId,
    necessityId: created.necessityId, itemId: created.itemId, materialId: created.materialId
  }, {
    purchaseRequestId: 'sc-1', projectId: 'proj-1', necessityId: 'nec-1',
    itemId: 'item-1', materialId: 'mat-1'
  });
})();

(function ts34QuoteRoundIsVersionedAndEvidenceBacked() {
  const created = round();
  assert.strictEqual(created.version, 1);
  assert.strictEqual(created.offers.length, 2);
  assert.ok(created.offers.every((offer) => offer.supplierId && offer.evidenceId));
})();

(function ts35ComparisonUsesLandedCost() {
  const comparison = purchasing.buildComparison(round(), '2026-08-24T00:00:00Z');
  assert.strictEqual(comparison.recommendedOfferId, 'offer-b');
  assert.deepStrictEqual(comparison.ranked.map((offer) => offer.totalCost), [110, 125]);
})();

(function ts36ApprovalUsesVersionedAuthorityPolicy() {
  const createdRound = round();
  const comparison = purchasing.buildComparison(createdRound, '2026-08-24T00:00:00Z');
  assert.throws(() => purchasing.approveRound(createdRound, comparison, {
    approvalId: 'ap-1', approverId: 'usr-1', selectedOfferId: 'offer-b', approvedAt: '2026-08-24T00:00:00Z'
  }, { policyId: 'policy-1', version: 3, limit: 100 }), /APPROVAL_LIMIT_EXCEEDED/);

  const approval = purchasing.approveRound(createdRound, comparison, {
    approvalId: 'ap-1', approverId: 'usr-1', selectedOfferId: 'offer-b', approvedAt: '2026-08-24T00:00:00Z'
  }, { policyId: 'policy-1', version: 3, limit: 200 });
  assert.strictEqual(approval.policyVersion, 3);
  assert.strictEqual(approval.selectedOffer.totalCost, 110);
  assert.strictEqual(Object.isFrozen(approval), true);
})();

(function ts37OrderFreezesApprovedSnapshot() {
  const createdRound = round();
  const comparison = purchasing.buildComparison(createdRound, '2026-08-24T00:00:00Z');
  const approval = purchasing.approveRound(createdRound, comparison, {
    approvalId: 'ap-1', approverId: 'usr-1', selectedOfferId: 'offer-b', approvedAt: '2026-08-24T00:00:00Z'
  }, { policyId: 'policy-1', version: 3, limit: 200 });
  const order = purchasing.createPurchaseOrder(createdRound, approval, {
    orderId: 'po-1', idempotencyKey: 'idem-po-1'
  });
  assert.strictEqual(order.supplierId, 'supplier-b');
  assert.strictEqual(order.items[0].itemId, 'item-1');
  assert.strictEqual(order.items[0].unitPrice, 11);
  assert.strictEqual(order.approvalFingerprint, approval.snapshotFingerprint);
  assert.strictEqual(Object.isFrozen(order.items[0]), true);
})();

(function ts38ReprocessingIsIdempotent() {
  const state = purchasing.createCommandState();
  const payload = { purchaseRequestId: 'sc-1', status: 'PENDENTE' };
  const first = purchasing.processIdempotent(state, 'cmd-1', payload, (value) => ({ accepted: true, value }));
  const retry = purchasing.processIdempotent(first.state, 'cmd-1', payload, () => assert.fail('handler não deve repetir'));
  assert.strictEqual(retry.replayed, true);
  assert.deepStrictEqual(retry.result, first.result);
  assert.throws(() => purchasing.processIdempotent(first.state, 'cmd-1', {
    purchaseRequestId: 'sc-1', status: 'ALTERADA'
  }, () => ({})), /IDEMPOTENCY_KEY_REUSED/);
})();

(function ts39ExceptionsAreExplicit() {
  const expired = round({
    items: [{
      offerId: 'offer-expired', supplierId: 'supplier-a', purchaseRequestId: 'sc-1', itemId: 'item-1', materialId: 'mat-1',
      quantity: 10, unitPrice: 10, freight: 0, taxes: 0, deliveryDays: 5,
      validUntil: '2026-08-01T00:00:00Z', evidenceId: 'evidence-expired'
    }]
  });
  assert.throws(() => purchasing.buildComparison(expired, '2026-08-24T00:00:00Z'), /QUOTE_EXPIRED/);
  assert.throws(() => purchasing.createQuoteRound({ roundId: 'empty', version: 1, items: [] }), /QUOTE_ITEMS_REQUIRED/);
})();

(function ts40QuantityChangeCreatesNewRound() {
  const original = round();
  const revised = purchasing.reviseApprovedRound(original, {
    roundId: 'round-2', version: 2, items: [{
      offerId: 'offer-c', supplierId: 'supplier-a', purchaseRequestId: 'sc-1', itemId: 'item-1', materialId: 'mat-1',
      quantity: 12, unitPrice: 9.5, freight: 20, taxes: 5, deliveryDays: 5,
      validUntil: '2026-09-30T23:59:59Z', evidenceId: 'evidence-c'
    }]
  });
  assert.strictEqual(revised.priorRoundId, 'round-1');
  assert.strictEqual(revised.version, 2);
  assert.strictEqual(original.offers[0].quantity, 10, 'snapshot anterior não deve ser sobrescrito');
  assert.throws(() => purchasing.reviseApprovedRound(original, {
    roundId: 'round-x', version: 3, items: revised.offers
  }), /ROUND_VERSION_CONFLICT/);
})();

console.log('suprimentos-purchasing.test.js: OK — TS-33 a TS-40');
