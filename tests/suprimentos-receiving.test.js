const assert = require('assert');
const receiving = require('../suprimentos/core/receiving');

const order = {
  orderId: 'po-1', version: 1, items: [
    { itemId: 'i1', materialId: 'm1', quantity: 10, unitPrice: 5 }
  ]
};

function receipt(accepted, rejected, divergence) {
  return receiving.receive(order, {
    receiptId: 'rec-1', userId: 'usr-1', receivedAt: '2026-08-24T00:00:00Z',
    items: [{
      itemId: 'i1', materialId: 'm1', acceptedQuantity: accepted, rejectedQuantity: rejected || 0,
      divergenceType: divergence, evidenceId: divergence ? 'evidence-1' : undefined
    }]
  });
}

function invoice(overrides) {
  return Object.assign({
    invoiceId: 'nfe-1', invoiceKey: 'key-1', supplierId: 'supplier-1', orderId: 'po-1',
    items: [{ itemId: 'i1', materialId: 'm1', quantity: 6, unitPrice: 5 }],
    idempotencyKey: 'stage-1'
  }, overrides || {});
}

(function partialReceiptPreservesPendingBalance() {
  const result = receipt(6, 0);
  assert.strictEqual(result.items[0].acceptedQuantity, 6);
  assert.strictEqual(result.items[0].pendingQuantity, 4);
})();

(function duplicateInvoiceKeyIsRejected() {
  const first = receiving.stageInvoice(receiving.createState(), invoice());
  assert.throws(() => receiving.stageInvoice(first.state, invoice({
    invoiceId: 'nfe-2', idempotencyKey: 'stage-2'
  })), /INVOICE_KEY_DUPLICATE/);
})();

(function divergenceBlocksAutomaticPromotion() {
  const received = receipt(5, 1, 'DANIFICADO');
  const staged = receiving.stageInvoice(receiving.createState(), invoice({
    items: [{ itemId: 'i1', materialId: 'm1', quantity: 5, unitPrice: 5 }]
  }));
  const matched = receiving.match(order, received, staged.result);
  assert.strictEqual(matched.ok, false);
  assert.ok(matched.divergences.some((item) => item.type === 'DANIFICADO'));
  assert.throws(() => receiving.accept(staged.state, {
    idempotencyKey: 'accept-blocked', matchResult: matched, receipt: received,
    policyId: 'policy-1', policyVersion: 1, correlationId: 'corr-blocked', acceptedAt: '2026-08-24T00:00:00Z'
  }), /MATCH_DIVERGENCE_BLOCKS_ACCEPTANCE/);
})();

(function invoiceWithoutOrderDoesNotMoveStock() {
  const received = receipt(6, 0);
  const staged = receiving.stageInvoice(receiving.createState(), invoice({ orderId: undefined }));
  const matched = receiving.match(order, received, staged.result);
  assert.strictEqual(matched.ok, false);
  assert.strictEqual(matched.divergences[0].type, 'SEM_PEDIDO');
  assert.strictEqual(staged.state.results['accept-without-order'], undefined);
})();

(function acceptanceCreatesIdempotentEntryAndCost() {
  const received = receipt(6, 0);
  const staged = receiving.stageInvoice(receiving.createState(), invoice());
  const matched = receiving.match(order, received, staged.result);
  assert.strictEqual(matched.ok, true);
  const command = {
    idempotencyKey: 'accept-1', matchResult: matched, receipt: received,
    policyId: 'policy-1', policyVersion: 2, correlationId: 'corr-accept-1', acceptedAt: '2026-08-24T00:00:00Z'
  };
  const accepted = receiving.accept(staged.state, command);
  const retry = receiving.accept(accepted.state, command);
  assert.strictEqual(accepted.result.movements[0].type, 'ENTRADA');
  assert.strictEqual(accepted.result.movements[0].itemId, 'i1');
  assert.strictEqual(accepted.result.movements[0].quantity, 6);
  assert.strictEqual(accepted.result.costEvents[0].policyVersion, 2);
  assert.strictEqual(retry.replayed, true);
  assert.deepStrictEqual(retry.result, accepted.result);
})();

console.log('suprimentos-receiving.test.js: OK — Gate E');
