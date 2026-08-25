(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sharepoint-schema-verifier'));
  else root.SuprimentosMigrationSimulator = factory(root.SuprimentosSharePointSchemaVerifier);
})(typeof self !== 'undefined' ? self : this, function (verifier) {
  'use strict';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function simulate(schema, snapshot) {
    var before = copy(snapshot), report = verifier.verify(schema, snapshot);
    if (!report.safeToApplyAdditiveMigration) return { applied: false, blocked: true, report: report, before: before, after: copy(snapshot) };
    var after = copy(snapshot); after.lists = after.lists || {}; after.permissions = after.permissions || {};
    Object.keys(schema.lists).forEach(function (name) {
      if (!after.lists[name]) after.lists[name] = { fields: {}, indexed: [], unique: [] };
      var actual = after.lists[name], wanted = schema.lists[name];
      Object.keys(wanted.fields || {}).forEach(function (field) { if (actual.fields[field] === undefined) actual.fields[field] = wanted.fields[field]; });
      actual.indexed = Array.from(new Set((actual.indexed || []).concat(wanted.indexed || [])));
      actual.unique = Array.from(new Set((actual.unique || []).concat(wanted.unique || [])));
      if (wanted.concurrencyField) actual.concurrencyField = wanted.concurrencyField;
      if (wanted.appendOnly) actual.appendOnly = true;
    });
    after.permissions = copy(schema.permissions); after.writerPolicy = schema.writerPolicy;
    var verified = verifier.verify(schema, after);
    return { applied: true, blocked: false, report: report, before: before, after: after, verification: verified,
      rollback: { replacementSnapshot: before, expectedFingerprint: verifier.fingerprint(before) } };
  }
  return { simulate: simulate };
});
