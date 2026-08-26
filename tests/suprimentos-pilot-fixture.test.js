const assert = require('assert');
const fixture = require('../suprimentos/fixtures/pilot-shadow.v1.json');

(function fixtureIsSyntheticAndRelational() {
  assert.strictEqual(fixture.syntheticOnly, true);
  ['proposalId', 'projectId', 'packageId', 'necessityId', 'purchaseRequestId', 'orderId', 'receiptId'].forEach((field) => {
    assert.ok(fixture[field].includes('shadow'), field);
  });
  assert.ok(fixture.material.materialId.includes('shadow'));
  assert.ok(fixture.material.itemId.includes('shadow'));
})();

(function expectedOutcomesAreExplicit() {
  assert.deepStrictEqual(fixture.expected, {
    physicalAfterReceipt: 4,
    availableAfterReceipt: 4,
    openExceptionsAfterResolution: 0,
    duplicateLedgerEffects: 0
  });
})();

console.log('suprimentos-pilot-fixture.test.js: OK — fixture sintética versionada');
