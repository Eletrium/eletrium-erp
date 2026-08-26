(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosCommandRecovery = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function count(value) { return Array.isArray(value) ? value.length : 0; }
  function ageMs(timestamp, now) {
    var created = new Date(timestamp).getTime(), current = new Date(now).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(current)) fail('RECOVERY_TIMESTAMP_INVALID');
    return Math.max(0, current - created);
  }

  function inspect(record, evidence, options) {
    record = record || {}; evidence = evidence || {}; options = options || {};
    if (!record.idempotencyKey) fail('RECOVERY_COMMAND_KEY_REQUIRED');
    var now = options.now || new Date().toISOString();
    var graceMs = Number(options.graceMs === undefined ? 300000 : options.graceMs);
    if (!Number.isFinite(graceMs) || graceMs < 0) fail('RECOVERY_GRACE_INVALID');
    var reservationEvents = count(evidence.reservationEvents);
    var movementEvents = count(evidence.movementEvents);
    var ledgerEvents = reservationEvents + movementEvents;
    var projectionWrites = Number(evidence.projectionWrites || 0);
    var hasResult = Boolean(record.result);
    var fingerprint = record.commandFingerprint || null;
    var status = record.status || null;
    var report = {
      idempotencyKey: record.idempotencyKey, status: status, fingerprintPresent: Boolean(fingerprint),
      evidence: { reservationEvents: reservationEvents, movementEvents: movementEvents, projectionWrites: projectionWrites },
      automaticMutationAllowed: false, requiresExpectedEtag: true
    };
    if (!fingerprint) return Object.assign(report, { classification: 'QUARANTINE', reason: 'IDEMPOTENCY_FINGERPRINT_MISSING', action: 'MANUAL_FORENSIC_REVIEW' });
    if (status === 'RECONCILED' && hasResult) return Object.assign(report, { classification: 'COMPLETE', reason: null, action: 'NONE' });
    if (hasResult && status !== 'RECONCILED') return Object.assign(report, { classification: 'INCONSISTENT', reason: 'RESULT_WITHOUT_RECONCILED_STATUS', action: 'RECONCILE_STATUS_WITH_CAS' });
    if (status !== 'SENDING') return Object.assign(report, { classification: 'QUARANTINE', reason: 'RECOVERY_STATUS_UNSUPPORTED', action: 'MANUAL_FORENSIC_REVIEW' });
    var elapsed = ageMs(record.updatedAt || record.createdAt, now);
    report.ageMs = elapsed;
    if (elapsed < graceMs) return Object.assign(report, { classification: 'IN_FLIGHT', reason: 'RECOVERY_GRACE_ACTIVE', action: 'WAIT' });
    if (ledgerEvents === 0 && projectionWrites === 0) return Object.assign(report, { classification: 'ORPHAN_CLAIM', reason: 'NO_EFFECT_EVIDENCE', action: 'ABORT_CLAIM_WITH_CAS_AFTER_OPERATOR_APPROVAL' });
    if (ledgerEvents === 0 && projectionWrites > 0) return Object.assign(report, { classification: 'INCONSISTENT', reason: 'PROJECTION_WITHOUT_LEDGER', action: 'REBUILD_PROJECTION_FROM_LEDGER' });
    return Object.assign(report, {
      classification: 'PARTIAL_EFFECT', reason: 'LEDGER_EFFECT_WITHOUT_COMMAND_RESULT',
      action: 'RECONCILE_THEN_COMPLETE_OR_COMPENSATE',
      compensationCandidates: (evidence.reservationEvents || []).concat(evidence.movementEvents || []).map(function (event) { return event.eventId; }).filter(Boolean)
    });
  }

  function summarize(reports) {
    var counts = {};
    (reports || []).forEach(function (report) { counts[report.classification] = Number(counts[report.classification] || 0) + 1; });
    return { total: (reports || []).length, counts: counts, deployBlocker: (reports || []).some(function (report) { return report.classification !== 'COMPLETE'; }) };
  }
  return { inspect: inspect, summarize: summarize };
});
