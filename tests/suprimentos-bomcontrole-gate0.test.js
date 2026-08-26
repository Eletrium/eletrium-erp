const assert = require('assert');
const contract = require('../suprimentos/contracts/bomcontrole-gate0.v1.json');
const fixture = require('../suprimentos/fixtures/bomcontrole.mock.json');
const adapter = require('../suprimentos/adapters/bomcontrole-adapter');

function allGates(value) {
  const status = {};
  contract.requiredGates.forEach((gate) => { status[gate] = value; });
  return status;
}

(function productionRemainsDisabledInVersionedContract() {
  const evaluation = adapter.evaluateGate(contract, allGates(true));
  assert.strictEqual(evaluation.requirementsMet, true);
  assert.strictEqual(evaluation.open, false);
  assert.strictEqual(contract.productionEnabled, false);
})();

(function missingGateIsExplicit() {
  const status = allGates(true);
  status.dlpApproved = false;
  const evaluation = adapter.evaluateGate(contract, status);
  assert.deepStrictEqual(evaluation.missing, ['dlpApproved']);
})();

(function adapterCannotStartWhileGateClosed() {
  assert.throws(() => adapter.create({
    contract, gateStatus: allGates(true), credentialProvider: async () => 'secret',
    transport: async () => ({ externalId: '1' }), reconciliationLookup: async () => null
  }), /BOMCONTROLE_GATE0_CLOSED/);
})();

async function withOpenTestContract(overrides) {
  const openContract = JSON.parse(JSON.stringify(contract));
  openContract.productionEnabled = true;
  return adapter.create(Object.assign({
    contract: openContract,
    gateStatus: allGates(true),
    credentialProvider: async () => 'runtime-only-secret',
    reconciliationLookup: async () => null,
    retryPolicy: { safePreEffectRetries: 2 }
  }, overrides || {}));
}

(async function simulatedCallsRespectIdempotencyAndTimeoutPolicy() {
  const confirmed = await withOpenTestContract({ transport: async (envelope) => ({ externalId: 'bc-1', echoedKey: envelope.headers['Idempotency-Key'] }) });
  const result = await confirmed.send('UPSERT_SUPPLIER', fixture.supplier);
  assert.strictEqual(result.status, 'CONFIRMED');
  assert.strictEqual(result.response.echoedKey, fixture.supplier.Idempotency_Key);

  const timed = await withOpenTestContract({ transport: async () => { const error = new Error('timeout'); error.code = 'TIMEOUT_AFTER_SEND'; throw error; } });
  const pending = await timed.send('CREATE_PAYABLE', fixture.payable);
  assert.deepStrictEqual({ status: pending.status, retryAllowed: pending.retryAllowed }, { status: 'PENDING_RECONCILIATION', retryAllowed: false });

  const replay = await withOpenTestContract({
    reconciliationLookup: async () => ({ externalId: 'bc-existing' }),
    transport: async () => assert.fail('não deve reenviar')
  });
  assert.strictEqual((await replay.send('CREATE_PAYABLE', fixture.payable)).status, 'REPLAYED');
})().catch((error) => { console.error(error); process.exitCode = 1; });

console.log('suprimentos-bomcontrole-gate0.test.js: OK — adapter simulado, segredos e Gate 0');
