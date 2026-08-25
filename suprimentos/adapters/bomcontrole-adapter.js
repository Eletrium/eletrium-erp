(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosBomControleAdapter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { const error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function present(value) { return value !== undefined && value !== null && value !== ''; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  function evaluateGate(contract, status) {
    if (!contract || !Array.isArray(contract.requiredGates)) fail('GATE_CONTRACT_REQUIRED');
    status = status || {};
    const missing = contract.requiredGates.filter(function (gate) { return status[gate] !== true; });
    return { open: missing.length === 0 && contract.productionEnabled === true, requirementsMet: missing.length === 0, productionEnabled: contract.productionEnabled === true, missing: missing };
  }

  function validateOperation(contract, operation, payload) {
    const definition = contract.operations && contract.operations[operation];
    if (!definition) fail('OPERATION_NOT_ALLOWED', operation);
    (definition.required || []).forEach(function (field) { if (!present(payload && payload[field])) fail(field + '_REQUIRED'); });
    return true;
  }

  function create(options) {
    options = options || {};
    const contract = options.contract;
    const gate = evaluateGate(contract, options.gateStatus);
    if (!gate.open) fail('BOMCONTROLE_GATE0_CLOSED', gate);
    if (typeof options.credentialProvider !== 'function') fail('RUNTIME_CREDENTIAL_PROVIDER_REQUIRED');
    if (typeof options.transport !== 'function') fail('TRANSPORT_REQUIRED');
    if (typeof options.reconciliationLookup !== 'function') fail('RECONCILIATION_LOOKUP_REQUIRED');

    return {
      send: async function (operation, payload) {
        validateOperation(contract, operation, payload);
        const prior = await options.reconciliationLookup(payload.Idempotency_Key);
        if (prior) return { status: 'REPLAYED', result: copy(prior), replayed: true };
        const credential = await options.credentialProvider();
        if (!credential) fail('RUNTIME_CREDENTIAL_UNAVAILABLE');
        const envelope = {
          operation: operation,
          payloadVersion: payload.Snapshot_Versao || 1,
          entityId: payload.Entity_ID || payload.Obrigacao_ID || payload.Fornecedor_ID,
          correlationId: payload.Correlation_ID,
          body: copy(payload),
          headers: { 'Idempotency-Key': payload.Idempotency_Key, 'X-Correlation-ID': payload.Correlation_ID }
        };
        try {
          const response = await options.transport(envelope, credential);
          if (!response || !present(response.externalId)) fail('EXTERNAL_RESPONSE_INVALID');
          return { status: 'CONFIRMED', externalId: response.externalId, response: copy(response), replayed: false };
        } catch (error) {
          if (error && (error.code === 'TIMEOUT_AFTER_SEND' || error.effectUnknown === true)) {
            return { status: 'PENDING_RECONCILIATION', retryAllowed: false, idempotencyKey: payload.Idempotency_Key, correlationId: payload.Correlation_ID };
          }
          if (error && error.effectCommitted === false && options.retryPolicy && options.retryPolicy.safePreEffectRetries > 0) {
            return { status: 'RETRY_QUEUED', retryAllowed: true, maxRetries: options.retryPolicy.safePreEffectRetries };
          }
          throw error;
        }
      }
    };
  }

  return { evaluateGate: evaluateGate, validateOperation: validateOperation, create: create };
});
