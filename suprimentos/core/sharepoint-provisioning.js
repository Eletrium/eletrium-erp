(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSharePointProvisioning = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fail(code, details) {
    const error = new Error(code);
    error.code = code;
    if (details !== undefined) error.details = details;
    throw error;
  }
  function sorted(value) { return (value || []).slice().sort(); }
  function sameArray(left, right) { return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right)); }

  function buildPlan(schema, current) {
    if (!schema || !schema.schemaVersion || !schema.lists) fail('SCHEMA_REQUIRED');
    current = current || { lists: {}, permissions: {} };
    const actions = [];
    Object.keys(schema.lists).sort().forEach(function (listName) {
      const wanted = schema.lists[listName];
      const actual = (current.lists || {})[listName];
      if (!actual) actions.push({ type: 'CREATE_LIST', list: listName });
      Object.keys(wanted.fields || {}).sort().forEach(function (field) {
        if (!actual || !actual.fields || actual.fields[field] !== wanted.fields[field]) {
          actions.push({ type: actual && actual.fields && actual.fields[field] ? 'ALTER_FIELD_BLOCKED' : 'CREATE_FIELD', list: listName, field: field, definition: wanted.fields[field] });
        }
      });
      sorted(wanted.indexed).forEach(function (field) {
        if (!actual || (actual.indexed || []).indexOf(field) === -1) actions.push({ type: 'CREATE_INDEX', list: listName, field: field });
      });
      sorted(wanted.unique).forEach(function (rule) {
        if (!actual || (actual.unique || []).indexOf(rule) === -1) actions.push({ type: 'CREATE_UNIQUE_GUARD', list: listName, rule: rule });
      });
    });
    Object.keys(schema.permissions || {}).sort().forEach(function (role) {
      if (!sameArray(schema.permissions[role], (current.permissions || {})[role])) {
        actions.push({ type: 'SET_PERMISSION_CONTRACT', role: role, grants: sorted(schema.permissions[role]) });
      }
    });
    return { dryRun: true, schemaVersion: schema.schemaVersion, writerPolicy: schema.writerPolicy, actions: actions, blocked: actions.filter(function (action) { return action.type === 'ALTER_FIELD_BLOCKED'; }) };
  }

  async function applyPlan(plan, client, options) {
    options = options || {};
    if (!plan || !Array.isArray(plan.actions)) fail('PLAN_REQUIRED');
    if (options.dryRun !== false) return { applied: false, dryRun: true, actions: plan.actions };
    if (!options.allowLiveProvisioning) fail('LIVE_PROVISIONING_GATE_CLOSED');
    if (!client || typeof client.apply !== 'function') fail('PROVISIONING_CLIENT_REQUIRED');
    if (plan.blocked && plan.blocked.length) fail('DESTRUCTIVE_SCHEMA_CHANGE_BLOCKED', plan.blocked);
    const results = [];
    for (const action of plan.actions) results.push(await client.apply(action));
    return { applied: true, dryRun: false, results: results };
  }

  return { buildPlan: buildPlan, applyPlan: applyPlan };
});
