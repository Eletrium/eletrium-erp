const assert = require('assert');
const recovery = require('../suprimentos/core/command-recovery');

const base = { idempotencyKey: 'cmd-1', commandFingerprint: 'fp-1', status: 'SENDING', updatedAt: '2026-08-26T10:00:00Z' };
const options = { now: '2026-08-26T10:10:00Z', graceMs: 300000 };

(function classifiesRecoveryWithoutAutomaticMutation() {
  const orphan = recovery.inspect(base, {}, options);
  assert.strictEqual(orphan.classification, 'ORPHAN_CLAIM');
  assert.strictEqual(orphan.automaticMutationAllowed, false);

  const partial = recovery.inspect(base, {
    reservationEvents: [{ eventId: 'r-1' }], movementEvents: [], projectionWrites: 0
  }, options);
  assert.strictEqual(partial.classification, 'PARTIAL_EFFECT');
  assert.deepStrictEqual(partial.compensationCandidates, ['r-1']);

  const inconsistent = recovery.inspect(base, { projectionWrites: 1 }, options);
  assert.strictEqual(inconsistent.reason, 'PROJECTION_WITHOUT_LEDGER');

  const inFlight = recovery.inspect(base, {}, { now: '2026-08-26T10:01:00Z', graceMs: 300000 });
  assert.strictEqual(inFlight.action, 'WAIT');

  const complete = recovery.inspect(Object.assign({}, base, { status: 'RECONCILED', result: { ok: true } }), {}, options);
  assert.strictEqual(complete.classification, 'COMPLETE');

  const legacy = recovery.inspect(Object.assign({}, base, { commandFingerprint: null }), {}, options);
  assert.strictEqual(legacy.classification, 'QUARANTINE');

  const summary = recovery.summarize([complete, orphan, partial]);
  assert.deepStrictEqual(summary.counts, { COMPLETE: 1, ORPHAN_CLAIM: 1, PARTIAL_EFFECT: 1 });
  assert.strictEqual(summary.deployBlocker, true);
})();

console.log('suprimentos-command-recovery.test.js: OK — recuperação fail-closed sem mutação automática');
