(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosPurchasing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fail(code, details) {
    const error = new Error(code);
    error.code = code;
    if (details !== undefined) error.details = details;
    throw error;
  }
  function required(value, field) { if (value === undefined || value === null || value === '') fail(field + '_REQUIRED'); }
  function positive(value, field) { if (!Number.isFinite(Number(value)) || Number(value) <= 0) fail(field + '_INVALID'); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function stable(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + stable(value[key]); }).join(',') + '}';
  }
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function createPurchaseRequest(command) {
    command = command || {};
    ['purchaseRequestId', 'projectId', 'necessityId', 'itemId', 'materialId', 'requiredDate', 'criticality', 'idempotencyKey'].forEach(function (field) {
      required(command[field], field.replace(/[A-Z]/g, function (letter) { return '_' + letter; }).toUpperCase());
    });
    positive(command.quantity, 'QUANTITY');
    return {
      purchaseRequestId: command.purchaseRequestId, version: Number(command.version || 1),
      projectId: command.projectId, necessityId: command.necessityId, itemId: command.itemId,
      materialId: command.materialId, quantity: Number(command.quantity), requiredDate: command.requiredDate,
      criticality: command.criticality, idempotencyKey: command.idempotencyKey, status: 'PENDENTE'
    };
  }

  function createQuoteRound(command) {
    command = command || {};
    required(command.roundId, 'ROUND_ID');
    positive(command.version, 'VERSION');
    if (!Array.isArray(command.items) || command.items.length === 0) fail('QUOTE_ITEMS_REQUIRED');
    const offers = command.items.map(function (offer) {
      ['offerId', 'supplierId', 'purchaseRequestId', 'itemId', 'materialId', 'validUntil', 'evidenceId'].forEach(function (field) {
        required(offer[field], field.replace(/[A-Z]/g, function (letter) { return '_' + letter; }).toUpperCase());
      });
      positive(offer.quantity, 'QUANTITY');
      positive(offer.unitPrice, 'UNIT_PRICE');
      nonNegative(offer.freight || 0, 'FREIGHT');
      nonNegative(offer.taxes || 0, 'TAXES');
      positive(offer.deliveryDays, 'DELIVERY_DAYS');
      return Object.assign({}, copy(offer), {
        quantity: Number(offer.quantity), unitPrice: Number(offer.unitPrice),
        freight: Number(offer.freight || 0), taxes: Number(offer.taxes || 0), deliveryDays: Number(offer.deliveryDays)
      });
    });
    return { roundId: command.roundId, version: Number(command.version), priorRoundId: command.priorRoundId || null, status: 'ABERTA', offers: offers };
  }

  function nonNegative(value, field) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) fail(field + '_INVALID');
  }

  function buildComparison(round, asOf) {
    if (!round || !Array.isArray(round.offers)) fail('ROUND_REQUIRED');
    const timestamp = new Date(asOf || new Date().toISOString()).getTime();
    if (!Number.isFinite(timestamp)) fail('AS_OF_INVALID');
    const ranked = round.offers.map(function (offer) {
      const validUntil = new Date(offer.validUntil).getTime();
      if (!Number.isFinite(validUntil)) fail('QUOTE_VALIDITY_INVALID', offer.offerId);
      if (validUntil < timestamp) fail('QUOTE_EXPIRED', offer.offerId);
      return Object.assign({}, copy(offer), {
        totalCost: Number((offer.quantity * offer.unitPrice + offer.freight + offer.taxes).toFixed(2))
      });
    }).sort(function (left, right) {
      return left.totalCost - right.totalCost || left.deliveryDays - right.deliveryDays || left.supplierId.localeCompare(right.supplierId);
    });
    if (ranked.length === 0) fail('NO_SUPPLIER_OFFERS');
    return { roundId: round.roundId, roundVersion: round.version, generatedAt: asOf, ranked: ranked, recommendedOfferId: ranked[0].offerId };
  }

  function approveRound(round, comparison, command, policy) {
    if (!round || round.status !== 'ABERTA') fail('ROUND_NOT_APPROVABLE');
    if (!comparison || comparison.roundId !== round.roundId || comparison.roundVersion !== round.version) fail('COMPARISON_SNAPSHOT_MISMATCH');
    command = command || {};
    policy = policy || {};
    required(command.approvalId, 'APPROVAL_ID');
    required(command.approverId, 'APPROVER_ID');
    required(policy.policyId, 'POLICY_ID');
    positive(policy.version, 'POLICY_VERSION');
    nonNegative(policy.limit, 'POLICY_LIMIT');
    const selected = comparison.ranked.find(function (offer) { return offer.offerId === command.selectedOfferId; });
    if (!selected) fail('SELECTED_OFFER_NOT_FOUND');
    if (selected.totalCost > Number(policy.limit)) fail('APPROVAL_LIMIT_EXCEEDED', { total: selected.totalCost, limit: Number(policy.limit) });
    const snapshot = {
      approvalId: command.approvalId, approverId: command.approverId, approvedAt: command.approvedAt,
      justification: command.justification || null, policyId: policy.policyId, policyVersion: Number(policy.version),
      roundId: round.roundId, roundVersion: round.version, selectedOffer: copy(selected), status: 'APROVADA'
    };
    snapshot.snapshotFingerprint = stable(snapshot);
    return deepFreeze(snapshot);
  }

  function createPurchaseOrder(round, approval, command) {
    if (!approval || approval.status !== 'APROVADA') fail('APPROVAL_REQUIRED');
    if (!round || round.roundId !== approval.roundId || round.version !== approval.roundVersion) fail('APPROVED_ROUND_MISMATCH');
    command = command || {};
    required(command.orderId, 'ORDER_ID');
    required(command.idempotencyKey, 'IDEMPOTENCY_KEY');
    const offer = approval.selectedOffer;
    return deepFreeze({
      orderId: command.orderId, version: Number(command.version || 1), supplierId: offer.supplierId,
      roundId: round.roundId, roundVersion: round.version, approvalId: approval.approvalId,
      approvalFingerprint: approval.snapshotFingerprint, idempotencyKey: command.idempotencyKey,
      status: 'EMITIDO', items: [{
        purchaseRequestId: offer.purchaseRequestId, itemId: offer.itemId, materialId: offer.materialId, quantity: offer.quantity,
        unitPrice: offer.unitPrice, freight: offer.freight, taxes: offer.taxes,
        deliveryDays: offer.deliveryDays, totalCost: offer.totalCost
      }]
    });
  }

  function reviseApprovedRound(round, command) {
    if (!round) fail('ROUND_REQUIRED');
    command = command || {};
    if (Number(command.version) !== Number(round.version) + 1) fail('ROUND_VERSION_CONFLICT');
    return createQuoteRound(Object.assign({}, command, { priorRoundId: round.roundId }));
  }

  function createCommandState(initial) {
    initial = initial || {};
    return { results: copy(initial.results || {}), fingerprints: copy(initial.fingerprints || {}) };
  }

  function processIdempotent(state, key, payload, handler) {
    required(key, 'IDEMPOTENCY_KEY');
    if (typeof handler !== 'function') fail('HANDLER_REQUIRED');
    const current = createCommandState(state);
    const fingerprint = stable(payload);
    if (current.results[key]) {
      if (current.fingerprints[key] !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED');
      return { state: current, result: copy(current.results[key]), replayed: true };
    }
    const result = handler(copy(payload));
    current.results[key] = copy(result);
    current.fingerprints[key] = fingerprint;
    return { state: current, result: result, replayed: false };
  }

  return {
    createPurchaseRequest: createPurchaseRequest, createQuoteRound: createQuoteRound,
    buildComparison: buildComparison, approveRound: approveRound, createPurchaseOrder: createPurchaseOrder,
    reviseApprovedRound: reviseApprovedRound, createCommandState: createCommandState, processIdempotent: processIdempotent
  };
});
