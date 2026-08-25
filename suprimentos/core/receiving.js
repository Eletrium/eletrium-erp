(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosReceiving = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { const error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function required(value, field) { if (value === undefined || value === null || value === '') fail(field + '_REQUIRED'); }
  function positive(value, field) { if (!Number.isFinite(Number(value)) || Number(value) <= 0) fail(field + '_INVALID'); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function fingerprint(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return '[' + value.map(fingerprint).join(',') + ']'; return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + fingerprint(value[key])).join(',') + '}'; }

  function createState(initial) {
    initial = initial || {};
    return { invoiceByKey: copy(initial.invoiceByKey || {}), results: copy(initial.results || {}), fingerprints: copy(initial.fingerprints || {}) };
  }
  function once(state, key, payload, handler) {
    required(key, 'IDEMPOTENCY_KEY');
    const next = createState(state);
    const hash = fingerprint(payload);
    if (next.results[key]) {
      if (next.fingerprints[key] !== hash) fail('IDEMPOTENCY_KEY_REUSED');
      return { state: next, result: copy(next.results[key]), replayed: true };
    }
    const result = handler(copy(payload), next);
    next.results[key] = copy(result); next.fingerprints[key] = hash;
    return { state: next, result: result, replayed: false };
  }

  function stageInvoice(state, command) {
    return once(state, command && command.idempotencyKey, command, function (payload, next) {
      required(payload.invoiceKey, 'INVOICE_KEY'); required(payload.invoiceId, 'INVOICE_ID'); required(payload.supplierId, 'SUPPLIER_ID');
      if (!Array.isArray(payload.items) || payload.items.length === 0) fail('INVOICE_ITEMS_REQUIRED');
      if (next.invoiceByKey[payload.invoiceKey]) fail('INVOICE_KEY_DUPLICATE');
      const invoice = { invoiceId: payload.invoiceId, invoiceKey: payload.invoiceKey, supplierId: payload.supplierId, orderId: payload.orderId || null, status: 'STAGED', items: copy(payload.items) };
      next.invoiceByKey[payload.invoiceKey] = copy(invoice);
      return invoice;
    });
  }

  function receive(order, command) {
    if (!order || !Array.isArray(order.items)) fail('ORDER_REQUIRED');
    command = command || {}; required(command.receiptId, 'RECEIPT_ID'); required(command.userId, 'USER_ID'); required(command.receivedAt, 'RECEIVED_AT');
    if (!Array.isArray(command.items) || command.items.length === 0) fail('RECEIPT_ITEMS_REQUIRED');
    const received = command.items.map(function (item) {
      const ordered = order.items.find((candidate) => candidate.itemId === item.itemId && candidate.materialId === item.materialId);
      if (!ordered) fail('ORDER_ITEM_NOT_FOUND', item.itemId);
      const accepted = Number(item.acceptedQuantity || 0); if (!Number.isFinite(accepted) || accepted < 0) fail('ACCEPTED_QUANTITY_INVALID');
      const rejected = Number(item.rejectedQuantity || 0); if (!Number.isFinite(rejected) || rejected < 0) fail('REJECTED_QUANTITY_INVALID');
      if (accepted + rejected <= 0) fail('RECEIPT_QUANTITY_REQUIRED');
      if (Number(item.acceptedQuantity) + rejected > Number(ordered.quantity)) fail('RECEIPT_EXCEEDS_ORDER');
      if (rejected > 0 && (!item.divergenceType || (!item.evidenceId && !item.observation))) fail('DIVERGENCE_EVIDENCE_REQUIRED');
      return Object.assign({}, copy(item), { acceptedQuantity: accepted, rejectedQuantity: rejected, pendingQuantity: Number(ordered.quantity) - accepted });
    });
    return { receiptId: command.receiptId, orderId: order.orderId, orderVersion: order.version, userId: command.userId, receivedAt: command.receivedAt, status: 'RECEBIDO', items: received };
  }

  function match(order, receipt, invoice) {
    if (!order || !receipt || !invoice) fail('MATCH_INPUT_REQUIRED');
    const divergences = [];
    if (!invoice.orderId) divergences.push({ type: 'SEM_PEDIDO', invoiceId: invoice.invoiceId });
    else if (invoice.orderId !== order.orderId) divergences.push({ type: 'SEM_PEDIDO', invoiceId: invoice.invoiceId, informedOrderId: invoice.orderId });
    receipt.items.forEach(function (received) {
      const ordered = order.items.find((item) => item.itemId === received.itemId && item.materialId === received.materialId);
      const invoiced = invoice.items.find((item) => item.itemId === received.itemId && item.materialId === received.materialId);
      if (!invoiced) divergences.push({ type: 'ITEM', itemId: received.itemId, materialId: received.materialId });
      else {
        if (Number(invoiced.quantity) !== Number(received.acceptedQuantity)) divergences.push({ type: 'QUANTIDADE', itemId: received.itemId, expected: received.acceptedQuantity, actual: invoiced.quantity });
        if (ordered && Number(invoiced.unitPrice) !== Number(ordered.unitPrice)) divergences.push({ type: 'PRECO', itemId: received.itemId, expected: ordered.unitPrice, actual: invoiced.unitPrice });
      }
      if (received.rejectedQuantity > 0) divergences.push({ type: received.divergenceType || 'OUTRA', itemId: received.itemId, rejectedQuantity: received.rejectedQuantity });
    });
    return { orderId: order.orderId, receiptId: receipt.receiptId, invoiceId: invoice.invoiceId, ok: divergences.length === 0, divergences: divergences };
  }

  function accept(state, command) {
    return once(state, command && command.idempotencyKey, command, function (payload) {
      if (!payload.matchResult || !payload.matchResult.ok) fail('MATCH_DIVERGENCE_BLOCKS_ACCEPTANCE');
      if (!payload.receipt || !Array.isArray(payload.receipt.items)) fail('RECEIPT_REQUIRED');
      required(payload.correlationId, 'CORRELATION_ID'); required(payload.acceptedAt, 'ACCEPTED_AT');
      required(payload.policyId, 'POLICY_ID'); positive(payload.policyVersion, 'POLICY_VERSION');
      const movements = payload.receipt.items.map(function (item) {
        const eventId = payload.idempotencyKey + ':entry:' + item.itemId;
        return {
          eventId: eventId, movementId: eventId, type: 'ENTRADA', materialId: item.materialId,
          itemId: item.itemId, quantity: item.acceptedQuantity, documentId: payload.receipt.receiptId,
          documentVersion: payload.receipt.orderVersion, correlationId: payload.correlationId,
          idempotencyKey: eventId, createdAt: payload.acceptedAt
        };
      });
      const costs = payload.receipt.items.map(function (item) {
        return { costEventId: payload.idempotencyKey + ':cost:' + item.itemId, materialId: item.materialId, quantity: item.acceptedQuantity, policyId: payload.policyId, policyVersion: Number(payload.policyVersion) };
      });
      return { status: 'ACEITO', movements: movements, costEvents: costs };
    });
  }

  return { createState: createState, stageInvoice: stageInvoice, receive: receive, match: match, accept: accept };
});
