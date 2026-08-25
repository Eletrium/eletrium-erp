(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosShadowPilot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  function number(value, field) { var parsed = Number(value); if (!Number.isFinite(parsed)) fail('SHADOW_VALUE_INVALID', { field: field, value: value }); return parsed; }
  function index(rows) {
    return (rows || []).reduce(function (out, row) {
      if (!row || !row.materialId) fail('SHADOW_MATERIAL_ID_REQUIRED');
      if (out[row.materialId]) fail('SHADOW_MATERIAL_DUPLICATE', row.materialId);
      out[row.materialId] = row; return out;
    }, {});
  }
  function compare(legacyRows, ledgerRows, options) {
    options = options || {};
    var tolerance = number(options.tolerance === undefined ? 0 : options.tolerance, 'tolerance');
    if (tolerance < 0) fail('SHADOW_TOLERANCE_INVALID');
    var minimumCoverage = number(options.minimumCoverage === undefined ? 1 : options.minimumCoverage, 'minimumCoverage');
    if (minimumCoverage < 0 || minimumCoverage > 1) fail('SHADOW_COVERAGE_INVALID');
    var legacy = index(legacyRows), ledger = index(ledgerRows);
    var materialIds = Array.from(new Set(Object.keys(legacy).concat(Object.keys(ledger)))).sort();
    var comparable = 0, differences = [];
    materialIds.forEach(function (materialId) {
      var left = legacy[materialId], right = ledger[materialId];
      if (!left || !right) { differences.push({ materialId: materialId, type: left ? 'MISSING_LEDGER' : 'MISSING_LEGACY', severity: 'CRITICA' }); return; }
      comparable += 1;
      ['stockPhysical', 'reservedValid', 'available'].forEach(function (field) {
        var legacyValue = number(left[field], field), ledgerValue = number(right[field], field), delta = ledgerValue - legacyValue;
        if (Math.abs(delta) > tolerance) differences.push({ materialId: materialId, type: 'VALUE_DIVERGENCE', field: field, legacy: legacyValue, ledger: ledgerValue, delta: delta, severity: field === 'available' ? 'CRITICA' : 'ALTA' });
      });
    });
    var coverage = materialIds.length ? comparable / materialIds.length : 1;
    var critical = differences.filter(function (item) { return item.severity === 'CRITICA'; }).length;
    return {
      shadowOnly: true, promotionAllowed: coverage >= minimumCoverage && differences.length === 0,
      summary: { materials: materialIds.length, comparable: comparable, coverage: coverage, differences: differences.length, critical: critical },
      criteria: { tolerance: tolerance, minimumCoverage: minimumCoverage }, differences: differences,
      recommendedAction: differences.length ? 'MANTER_SHADOW_E_RECONCILIAR' : 'ELEGIVEL_PARA_APROVACAO_HUMANA'
    };
  }
  return { compare: compare };
});
