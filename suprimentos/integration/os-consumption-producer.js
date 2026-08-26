(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosOsConsumptionProducer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  function required(value, code) { if (value === undefined || value === null || value === '') fail(code); return String(value); }
  function positive(value, code) { var number = Number(value); if (!Number.isFinite(number) || number <= 0) fail(code); return number; }
  function version(value, code) { var number = Number(value); if (!Number.isInteger(number) || number < 1) fail(code); return number; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.keys(value).sort().reduce(function (out, key) { out[key] = stable(value[key]); return out; }, {});
    return value;
  }
  function fingerprint(envelope) {
    var text = JSON.stringify(stable(envelope)), h = 2166136261;
    for (var i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'fnv1a32:' + ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function build(input) {
    input = input || {};
    var chain = {
      proposalId: required(input.proposalId, 'PROPOSAL_ID_REQUIRED'),
      projectId: required(input.projectId, 'PROJECT_ID_REQUIRED'),
      packageId: required(input.packageId, 'PACKAGE_ID_REQUIRED'),
      osId: required(input.osId, 'OS_ID_REQUIRED'),
      necessityId: required(input.necessityId, 'NECESSITY_ID_REQUIRED')
    };
    if (!Array.isArray(input.items) || !input.items.length) fail('ITEMS_REQUIRED');
    var expectedVersions = copy(input.expectedVersions || {});
    var items = input.items.map(function (item) {
      var materialId = required(item.materialId, 'MATERIAL_ID_REQUIRED');
      if (!Number.isInteger(Number(expectedVersions[materialId])) || Number(expectedVersions[materialId]) < 0) fail('EXPECTED_VERSION_REQUIRED', materialId);
      return {
        itemId: required(item.itemId, 'ITEM_ID_REQUIRED'), materialId: materialId,
        quantity: positive(item.quantity, 'QUANTITY_INVALID'),
        reservationDocumentId: required(item.reservationDocumentId, 'RESERVATION_DOCUMENT_ID_REQUIRED'),
        reservationDocumentVersion: version(item.reservationDocumentVersion, 'RESERVATION_DOCUMENT_VERSION_INVALID'),
        reservationItemId: required(item.reservationItemId, 'RESERVATION_ITEM_ID_REQUIRED')
      };
    });
    var envelope = {
      commandId: required(input.commandId, 'COMMAND_ID_REQUIRED'), operation: 'os.consume.v1',
      actorId: required(input.actorId, 'ACTOR_ID_REQUIRED'), correlationId: required(input.correlationId, 'CORRELATION_ID_REQUIRED'),
      idempotencyKey: required(input.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED'), schemaVersion: '1.0.0',
      payload: Object.assign(chain, { documentVersion: version(input.documentVersion, 'DOCUMENT_VERSION_INVALID'), expectedVersions: expectedVersions, items: items })
    };
    return Object.freeze({ envelope: Object.freeze(envelope), fingerprint: fingerprint(envelope) });
  }
  function assertRetry(previous, next) {
    if (!previous || !next || previous.envelope.idempotencyKey !== next.envelope.idempotencyKey) fail('RETRY_IDEMPOTENCY_KEY_CHANGED');
    if (previous.fingerprint !== next.fingerprint) fail('RETRY_PAYLOAD_CHANGED', { previous: previous.fingerprint, next: next.fingerprint });
    return true;
  }
  return { build: build, fingerprint: fingerprint, assertRetry: assertRetry };
});
