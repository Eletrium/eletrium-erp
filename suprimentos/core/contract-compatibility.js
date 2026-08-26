(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosContractCompatibility = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function difference(left, right) { var set = new Set(right || []); return (left || []).filter(function (value) { return !set.has(value); }); }
  function typeOf(schema, field) { return schema && schema.properties && schema.properties[field] && schema.properties[field].type; }
  function inspectSchema(scope, baseline, schema, findings) {
    if (!schema) { findings.push({ scope: scope, code: 'PUBLIC_SCHEMA_REMOVED' }); return; }
    difference(schema.required || [], baseline.required || []).forEach(function (field) { findings.push({ scope: scope, field: field, code: 'NEW_REQUIRED_FIELD' }); });
    Object.keys(baseline.types || {}).forEach(function (field) {
      var actual = typeOf(schema, field);
      if (!actual) findings.push({ scope: scope, field: field, code: 'PUBLIC_FIELD_REMOVED' });
      else if (actual !== baseline.types[field]) findings.push({ scope: scope, field: field, code: 'PUBLIC_FIELD_TYPE_CHANGED', expected: baseline.types[field], actual: actual });
    });
  }
  function check(baseline, current) {
    var findings = [];
    inspectSchema('envelope', baseline.envelope, current.envelope, findings);
    Object.keys(baseline.operations || {}).forEach(function (operation) {
      var expected = baseline.operations[operation], actual = current.operations && current.operations[operation];
      inspectSchema('operation:' + operation, expected, actual, findings);
      if (!actual || !expected.itemRequired) return;
      var itemSchema = actual.properties && actual.properties.items && actual.properties.items.items;
      inspectSchema('operation:' + operation + ':item', { required: expected.itemRequired, types: expected.itemTypes }, itemSchema, findings);
    });
    return { ok: findings.length === 0, baselineVersion: baseline.version, currentVersion: current.contractVersion, breakingChanges: findings };
  }
  return { check: check };
});
