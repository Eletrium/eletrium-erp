(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosDeploymentGate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var secretFields = /^(credential|clientSecret|accessToken|apiKey|password|secret)$/i;
  var homologationRequired = ['siteId', 'listIds', 'serviceAccountOwner', 'secretProviderRef', 'dlpPolicyRef', 'rollbackEvidenceRef', 'reconciliationEvidenceRef'];
  function present(value) { return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0); }
  function evaluate(profile, bomContract) {
    profile = profile || {}; bomContract = bomContract || {};
    var mode = String(profile.mode || 'SHADOW').toUpperCase(), blockers = [];
    Object.keys(profile).filter(function (key) { return secretFields.test(key); }).forEach(function (key) { blockers.push({ code: 'PLAINTEXT_SECRET_FIELD_REJECTED', field: key }); });
    if (['SHADOW', 'HOMOLOGATION', 'PRODUCTION'].indexOf(mode) === -1) blockers.push({ code: 'DEPLOYMENT_MODE_INVALID', mode: mode });
    if (mode !== 'SHADOW') homologationRequired.filter(function (field) { return !present(profile[field]); }).forEach(function (field) { blockers.push({ code: 'ENVIRONMENT_EVIDENCE_REQUIRED', field: field }); });
    if (mode === 'SHADOW' && profile.externalWritesEnabled === true) blockers.push({ code: 'SHADOW_EXTERNAL_WRITES_FORBIDDEN' });
    if (profile.bomControleProduction === true && bomContract.productionEnabled !== true) blockers.push({ code: 'BOMCONTROLE_GATE0_CLOSED' });
    if (mode === 'PRODUCTION') {
      if (profile.homologationApproved !== true) blockers.push({ code: 'HOMOLOGATION_APPROVAL_REQUIRED' });
      if (profile.uiIntegrationApproved !== true) blockers.push({ code: 'UI_INTEGRATION_APPROVAL_REQUIRED' });
      if (bomContract.productionEnabled !== true) blockers.push({ code: 'BOMCONTROLE_PRODUCTION_DISABLED_BY_CONTRACT' });
    }
    return { mode: mode, allowed: blockers.length === 0, allowedMode: blockers.length ? 'NONE' : mode, blockers: blockers, secretsAccepted: false };
  }
  return { evaluate: evaluate, homologationRequired: homologationRequired.slice() };
});
