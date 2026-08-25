(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSharePointSchemaVerifier = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.keys(value).sort().reduce(function (out, key) {
      out[key] = stable(value[key]); return out;
    }, {});
    return value;
  }
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function fingerprint(value) { return 'fnv1a32:' + hash(JSON.stringify(stable(value))); }
  function has(list, value) { return (list || []).indexOf(value) !== -1; }

  function verify(schema, snapshot) {
    if (!schema || !schema.schemaVersion || !schema.lists) throw new Error('SCHEMA_REQUIRED');
    if (!snapshot || !snapshot.lists) throw new Error('LIVE_SCHEMA_SNAPSHOT_REQUIRED');
    var findings = [];
    Object.keys(schema.lists).sort().forEach(function (listName) {
      var wanted = schema.lists[listName];
      var actual = snapshot.lists[listName];
      if (!actual) {
        findings.push({ severity: 'ERROR', code: 'LIST_MISSING', list: listName });
        return;
      }
      Object.keys(wanted.fields || {}).sort().forEach(function (field) {
        if (!actual.fields || actual.fields[field] === undefined) {
          findings.push({ severity: 'ERROR', code: 'FIELD_MISSING', list: listName, field: field });
        } else if (actual.fields[field] !== wanted.fields[field]) {
          findings.push({ severity: 'BLOCKER', code: 'FIELD_DEFINITION_MISMATCH', list: listName, field: field, expected: wanted.fields[field], actual: actual.fields[field] });
        }
      });
      (wanted.indexed || []).forEach(function (field) {
        if (!has(actual.indexed, field)) findings.push({ severity: 'ERROR', code: 'INDEX_MISSING', list: listName, field: field });
      });
      (wanted.unique || []).forEach(function (rule) {
        if (!has(actual.unique, rule)) findings.push({ severity: 'ERROR', code: 'UNIQUE_GUARD_MISSING', list: listName, rule: rule });
      });
      if (!!wanted.appendOnly !== !!actual.appendOnly) findings.push({ severity: 'ERROR', code: 'APPEND_ONLY_POLICY_DRIFT', list: listName, expected: !!wanted.appendOnly, actual: !!actual.appendOnly });
      if (wanted.concurrencyField && actual.concurrencyField !== wanted.concurrencyField) findings.push({ severity: 'BLOCKER', code: 'CONCURRENCY_FIELD_DRIFT', list: listName, expected: wanted.concurrencyField, actual: actual.concurrencyField || null });
    });
    Object.keys(schema.permissions || {}).sort().forEach(function (role) {
      var expected = (schema.permissions[role] || []).slice().sort();
      var actual = ((snapshot.permissions || {})[role] || []).slice().sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) findings.push({ severity: 'ERROR', code: 'PERMISSION_DRIFT', role: role, expected: expected, actual: actual });
    });
    if (snapshot.writerPolicy !== schema.writerPolicy) findings.push({ severity: 'BLOCKER', code: 'WRITER_POLICY_DRIFT', expected: schema.writerPolicy, actual: snapshot.writerPolicy || null });
    var blockers = findings.filter(function (finding) { return finding.severity === 'BLOCKER'; });
    return {
      schemaVersion: schema.schemaVersion,
      desiredFingerprint: fingerprint(schema),
      snapshotFingerprint: fingerprint(snapshot),
      verifiedAt: snapshot.capturedAt || null,
      conformant: findings.length === 0,
      safeToApplyAdditiveMigration: blockers.length === 0,
      findings: findings,
      blockers: blockers
    };
  }

  function migrationPlan(report) {
    if (!report || !Array.isArray(report.findings)) throw new Error('VERIFICATION_REPORT_REQUIRED');
    var actions = report.findings.map(function (finding) {
      var map = { LIST_MISSING: 'CREATE_LIST', FIELD_MISSING: 'CREATE_FIELD', INDEX_MISSING: 'CREATE_INDEX', UNIQUE_GUARD_MISSING: 'CREATE_UNIQUE_GUARD', PERMISSION_DRIFT: 'SET_PERMISSION_CONTRACT', APPEND_ONLY_POLICY_DRIFT: 'SET_APPEND_ONLY_POLICY' };
      return Object.assign({}, finding, { action: map[finding.code] || 'MANUAL_REVIEW', automatic: !!map[finding.code] });
    });
    return { dryRun: true, schemaVersion: report.schemaVersion, desiredFingerprint: report.desiredFingerprint, blocked: !report.safeToApplyAdditiveMigration, actions: actions };
  }

  return { verify: verify, migrationPlan: migrationPlan, fingerprint: fingerprint };
});
