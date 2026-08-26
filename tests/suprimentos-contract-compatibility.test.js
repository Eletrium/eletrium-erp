const assert = require('assert');
const baseline = require('../suprimentos/contracts/public-command-surface.v1.json');
const current = require('../suprimentos/contracts/commands.v1.json');
const compatibility = require('../suprimentos/core/contract-compatibility');

function copy(value) { return JSON.parse(JSON.stringify(value)); }

(function protectsPublishedCommandSurface() {
  assert.strictEqual(compatibility.check(baseline, current).ok, true);

  const addedRequired = copy(current);
  addedRequired.operations.reserve.required.push('newMandatoryField');
  assert.ok(compatibility.check(baseline, addedRequired).breakingChanges.some((item) => item.code === 'NEW_REQUIRED_FIELD'));

  const removedOperation = copy(current);
  delete removedOperation.operations['os.consume.v1'];
  assert.ok(compatibility.check(baseline, removedOperation).breakingChanges.some((item) => item.code === 'PUBLIC_SCHEMA_REMOVED'));

  const changedType = copy(current);
  changedType.operations['finance.obligation.v1'].properties.amount.type = 'string';
  assert.ok(compatibility.check(baseline, changedType).breakingChanges.some((item) => item.code === 'PUBLIC_FIELD_TYPE_CHANGED'));
})();

console.log('suprimentos-contract-compatibility.test.js: OK — superfície pública v1 protegida');
