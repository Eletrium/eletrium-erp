(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosIntegrationContracts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  function required(value, field) { if (value === undefined || value === null || value === '') fail(field + '_REQUIRED'); }
  function assertVersion(version) { if (version !== '1.0.0') fail('CONTRACT_VERSION_UNSUPPORTED', { supported: ['1.0.0'], actual: version }); }
  function assertCanonicalChain(input) {
    ['proposalId', 'projectId', 'packageId', 'osId', 'necessityId'].forEach(function (field) { required(input && input[field], field.replace(/[A-Z]/g, function (c) { return '_' + c; }).toUpperCase()); });
    return true;
  }
  function fromOsConsumption(envelope) {
    assertVersion(envelope && envelope.schemaVersion); var payload = envelope.payload || {};
    assertCanonicalChain(payload); required(envelope.idempotencyKey, 'IDEMPOTENCY_KEY'); required(envelope.correlationId, 'CORRELATION_ID');
    if (!Array.isArray(payload.items) || !payload.items.length) fail('ITEMS_REQUIRED');
    return {
      idempotencyKey: envelope.idempotencyKey, correlationId: envelope.correlationId,
      documentId: payload.osId, documentVersion: payload.documentVersion,
      expectedVersions: payload.expectedVersions,
      items: payload.items.map(function (item) { return {
        itemId: item.itemId, materialId: item.materialId, quantity: item.quantity,
        necessityId: payload.necessityId, sourceDocumentId: item.reservationDocumentId,
        sourceDocumentVersion: item.reservationDocumentVersion, sourceItemId: item.reservationItemId
      }; })
    };
  }
  function toFinancialObligation(input) {
    ['obligationId', 'supplierId', 'orderId', 'invoiceId', 'dueDate', 'evidenceId', 'idempotencyKey', 'correlationId'].forEach(function (field) { required(input && input[field], field.replace(/[A-Z]/g, function (c) { return '_' + c; }).toUpperCase()); });
    if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) fail('AMOUNT_INVALID');
    return Object.freeze({
      operation: 'finance.obligation.v1', schemaVersion: '1.0.0', idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId, payload: Object.freeze({ obligationId: input.obligationId,
        supplierId: input.supplierId, orderId: input.orderId, invoiceId: input.invoiceId,
        currency: 'BRL', amount: Number(input.amount), dueDate: input.dueDate, evidenceId: input.evidenceId })
    });
  }
  return { assertCanonicalChain: assertCanonicalChain, fromOsConsumption: fromOsConsumption, toFinancialObligation: toFinancialObligation };
});
