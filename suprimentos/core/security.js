(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSecurity = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var grants = Object.freeze({
    SUPRIMENTOS_OPERADOR: ['reserve', 'release', 'receive'],
    SUPRIMENTOS_GESTOR: ['reserve', 'release', 'receive', 'approve', 'manualRetry'],
    SUPRIMENTOS_SERVICE: ['reserve', 'release', 'consume', 'compensate', 'reconcile', 'publish'],
    OS_SERVICE: ['os.consume.v1'], AUDITORIA: []
  });
  var sensitive = /token|secret|password|authorization|credential|chave|cpf|cnpj/i;
  var bearerValue = /Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi;
  var credentialValue = /(client_secret|api[_-]?key|password)=([^&\s]+)/gi;
  function authorize(identity, operation) { return !!identity && (identity.roles || []).some(function (role) { return (grants[role] || []).indexOf(operation) !== -1; }); }
  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.keys(value).reduce(function (out, key) { out[key] = sensitive.test(key) ? '[REDACTED]' : redact(value[key]); return out; }, {});
    if (typeof value === 'string') return value.replace(bearerValue, 'Bearer [REDACTED]').replace(credentialValue, '$1=[REDACTED]');
    return value;
  }
  function sanitizeError(error) {
    error = error || {};
    return redact({ code: error.code || 'UNEXPECTED_ERROR', message: error.message || String(error), details: error.details || null, retryable: error.retryable === true, effectUnknown: error.effectUnknown === true });
  }
  function flags(config) {
    config = config || {};
    return Object.freeze({ sharePointWrites: config.sharePointWrites === true, bomControleProduction: false, uiIntegration: config.uiIntegration === true, shadowMode: config.shadowMode !== false });
  }
  return { grants: grants, authorize: authorize, redact: redact, sanitizeError: sanitizeError, flags: flags };
});
