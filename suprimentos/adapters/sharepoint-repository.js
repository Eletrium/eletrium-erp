(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSharePointRepository = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LISTS = Object.freeze({ needs: 'Necessidades_Materiais', reservations: 'Reservas_Estoque', movements: 'Movimentacoes_Estoque', projection: 'Estoque_Projetado', integration: 'Eventos_Integracao' });
  var COMMON = { materialId: 'Material_ID', itemId: 'Item_ID', documentId: 'Documento_ID', documentVersion: 'Documento_Versao', idempotencyKey: 'Idempotency_Key', correlationId: 'Correlation_ID', quantity: 'Quantidade', type: 'Tipo', createdAt: 'Created_At' };
  var RESERVATION = Object.assign({}, COMMON, { eventId: 'Reserva_ID', necessityId: 'Necessidade_ID', positionKey: 'Position_Key', compensatesEventId: 'Compensates_Event_ID', reservationDelta: 'Reservation_Delta', rowVersion: 'Row_Version' });
  var MOVEMENT = Object.assign({}, COMMON, { eventId: 'Movimento_ID', compensatesEventId: 'Compensates_Event_ID', physicalDelta: 'Physical_Delta', reservationEventId: 'Reservation_Event_ID' });
  var INTEGRATION = { eventId: 'Evento_ID', entity: 'Entidade', entityId: 'Entity_ID', sequence: 'Sequence', idempotencyKey: 'Idempotency_Key', correlationId: 'Correlation_ID', status: 'Status', retryCount: 'Retry_Count', payloadJson: 'Payload_JSON', resultJson: 'Result_JSON', errorCode: 'Error_Code', leaseOwner: 'Lease_Owner', leaseUntil: 'Lease_Until', rowVersion: 'Row_Version', createdAt: 'Created_At', updatedAt: 'Updated_At' };
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  function fieldsOf(item) { return item && (item.fields || item); }
  function mapToFields(record, mapping) { return Object.keys(mapping).reduce(function (out, key) { if (record[key] !== undefined) out[mapping[key]] = record[key]; return out; }, {}); }
  function mapFromFields(item, mapping) { var fields = fieldsOf(item) || {}; return Object.keys(mapping).reduce(function (out, key) { if (fields[mapping[key]] !== undefined) out[key] = fields[mapping[key]]; return out; }, { _itemId: item && item.id, _etag: item && (item.eTag || item['@odata.etag']) }); }
  function create(graph) {
    if (!graph || typeof graph.query !== 'function' || typeof graph.append !== 'function' || typeof graph.conditionalUpdate !== 'function') fail('GRAPH_CLIENT_REQUIRED');
    async function findByIdempotency(list, key) {
      var result = await graph.query(list, "fields/Idempotency_Key eq '" + String(key).replace(/'/g, "''") + "'");
      if (!result.complete) fail('INCOMPLETE_STATE_READ');
      if (result.value.length > 1) fail('IDEMPOTENCY_UNIQUENESS_BROKEN', { list: list, key: key });
      return result.value[0] || null;
    }
    async function appendEvents(list, events) {
      var written = [];
      for (const event of events || []) {
        var mapping = list === LISTS.reservations ? RESERVATION : list === LISTS.movements ? MOVEMENT : INTEGRATION;
        var fields = mapToFields(event, mapping);
        if (list === LISTS.reservations && fields.Row_Version === undefined) fields.Row_Version = 1;
        var prior = await findByIdempotency(list, event.idempotencyKey);
        if (prior) {
          var priorFields = fieldsOf(prior) || {};
          var changed = Object.keys(fields).filter(function (field) { return JSON.stringify(priorFields[field]) !== JSON.stringify(fields[field]); });
          if (changed.length) fail('IDEMPOTENCY_EVENT_PAYLOAD_MISMATCH', { list: list, idempotencyKey: event.idempotencyKey, fields: changed });
          written.push({ replayed: true, item: prior }); continue;
        }
        written.push({ replayed: false, item: await graph.append(list, fields) });
      }
      return written;
    }
    async function writeProjection(byMaterial, etags) {
      var results = [];
      for (const materialId of Object.keys(byMaterial || {}).sort()) {
        var item = byMaterial[materialId]; var current = await graph.query(LISTS.projection, "fields/Material_ID eq '" + String(materialId).replace(/'/g, "''") + "'");
        if (!current.complete) fail('INCOMPLETE_STATE_READ');
        if (current.value.length > 1) fail('PROJECTION_ROW_NOT_UNIQUE', { materialId: materialId, count: current.value.length });
        var fields = {
          Material_ID: materialId, Estoque_Fisico: item.stockPhysical, Reservado_Valido: item.reservedValid,
          Disponivel: item.available, Ultimo_Movimento_ID: item.lastMovementId,
          Projection_Version: item.projectionVersion, Reconciled_At: item.reconciledAt || new Date().toISOString()
        };
        if (current.value.length === 0) {
          if (etags[materialId]) fail('ETAG_CONFLICT', { materialId: materialId, expected: etags[materialId], actual: null });
          results.push(await graph.append(LISTS.projection, fields));
        } else {
          var row = current.value[0]; results.push(await graph.conditionalUpdate(LISTS.projection, row.id, fields, etags[materialId] || row.eTag || row['@odata.etag']));
        }
      }
      return results;
    }
    async function readState(materialIds) {
      materialIds = Array.from(new Set(materialIds || []));
      if (!materialIds.length) fail('MATERIAL_IDS_REQUIRED');
      var filter = materialIds.map(function (id) { return "fields/Material_ID eq '" + String(id).replace(/'/g, "''") + "'"; }).join(' or ');
      var reservationPage = await graph.query(LISTS.reservations, filter);
      var movementPage = await graph.query(LISTS.movements, filter);
      var projectionPage = await graph.query(LISTS.projection, filter);
      if (!reservationPage.complete || !movementPage.complete || !projectionPage.complete) fail('INCOMPLETE_STATE_READ');
      var versions = {}, etags = {};
      projectionPage.value.forEach(function (row) { var f = fieldsOf(row); versions[f.Material_ID] = Number(f.Projection_Version || 0); etags[f.Material_ID] = row.eTag || row['@odata.etag']; });
      materialIds.forEach(function (id) { if (versions[id] === undefined) { versions[id] = 0; etags[id] = null; } });
      return { complete: true, state: { openingStockByMaterial: {}, reservationEvents: reservationPage.value.map(function (x) { return mapFromFields(x, RESERVATION); }), movementEvents: movementPage.value.map(function (x) { return mapFromFields(x, MOVEMENT); }), rowVersionsByMaterial: versions, commandResultsByKey: {}, commandFingerprintsByKey: {} }, etags: etags };
    }
    async function findCommand(key) {
      var row = await findByIdempotency(LISTS.integration, key);
      if (!row) return null; var fields = fieldsOf(row);
      var metadata = fields.Payload_JSON ? JSON.parse(fields.Payload_JSON) : {};
      return { result: fields.Result_JSON ? JSON.parse(fields.Result_JSON) : null, commandFingerprint: metadata.commandFingerprint || null, status: fields.Status || null };
    }
    async function assertEtags(etags) {
      for (const materialId of Object.keys(etags || {})) {
        var page = await graph.query(LISTS.projection, "fields/Material_ID eq '" + String(materialId).replace(/'/g, "''") + "'");
        if (!page.complete || page.value.length > 1) fail('PROJECTION_ROW_NOT_UNIQUE', { materialId: materialId });
        if (page.value.length === 0) { if (etags[materialId]) fail('ETAG_CONFLICT', { materialId: materialId, expected: etags[materialId], actual: null }); else continue; }
        var actual = page.value[0].eTag || page.value[0]['@odata.etag'];
        if (actual !== etags[materialId]) fail('ETAG_CONFLICT', { materialId: materialId, expected: etags[materialId], actual: actual });
      }
      return true;
    }
    async function claimCommand(result, metadata) {
      metadata = metadata || {};
      if (!metadata.commandFingerprint) fail('COMMAND_FINGERPRINT_REQUIRED');
      var prior = await findByIdempotency(LISTS.integration, result.idempotencyKey);
      if (prior) {
        var fields = fieldsOf(prior), payload = fields.Payload_JSON ? JSON.parse(fields.Payload_JSON) : {};
        if (!payload.commandFingerprint) fail('IDEMPOTENCY_FINGERPRINT_MISSING', { idempotencyKey: result.idempotencyKey });
        if (payload.commandFingerprint !== metadata.commandFingerprint) fail('IDEMPOTENCY_KEY_REUSED', { idempotencyKey: result.idempotencyKey });
        if (!fields.Result_JSON) fail('COMMAND_RECONCILIATION_REQUIRED', { idempotencyKey: result.idempotencyKey, status: fields.Status });
        return { replayed: true, result: JSON.parse(fields.Result_JSON) };
      }
      var now = new Date().toISOString();
      return graph.append(LISTS.integration, mapToFields({ eventId: 'command:' + result.idempotencyKey, entity: 'SupplyCommand', entityId: result.idempotencyKey, sequence: 1, idempotencyKey: result.idempotencyKey, correlationId: result.correlationId, status: 'SENDING', retryCount: 0, payloadJson: JSON.stringify({ commandFingerprint: metadata.commandFingerprint }), rowVersion: 1, createdAt: now, updatedAt: now }, INTEGRATION));
    }
    async function saveCommandResult(result, metadata) {
      metadata = metadata || {};
      if (!metadata.commandFingerprint) fail('COMMAND_FINGERPRINT_REQUIRED');
      var row = await findByIdempotency(LISTS.integration, result.idempotencyKey);
      if (!row) fail('COMMAND_CLAIM_NOT_FOUND', { idempotencyKey: result.idempotencyKey });
      var fields = fieldsOf(row), payload = fields.Payload_JSON ? JSON.parse(fields.Payload_JSON) : {};
      if (!payload.commandFingerprint) fail('IDEMPOTENCY_FINGERPRINT_MISSING', { idempotencyKey: result.idempotencyKey });
      if (payload.commandFingerprint !== metadata.commandFingerprint) fail('IDEMPOTENCY_KEY_REUSED', { idempotencyKey: result.idempotencyKey });
      if (fields.Result_JSON) return { replayed: true, result: JSON.parse(fields.Result_JSON) };
      return graph.conditionalUpdate(LISTS.integration, row.id, { Status: 'RECONCILED', Result_JSON: JSON.stringify(result), Row_Version: Number(fields.Row_Version || 0) + 1, Updated_At: new Date().toISOString() }, row.eTag || row['@odata.etag']);
    }
    return {
      lists: LISTS, findByIdempotency: findByIdempotency,
      findCommand: findCommand, readState: readState, assertEtags: assertEtags,
      claimCommand: claimCommand, saveCommandResult: saveCommandResult,
      appendReservationEvents: function (events) { return appendEvents(LISTS.reservations, events); },
      appendMovementEvents: function (events) { return appendEvents(LISTS.movements, events); },
      writeProjection: writeProjection,
      mapReservation: function (item) { return mapFromFields(item, RESERVATION); },
      recordIntegrationEvent: function (event) {
        var now = event.updatedAt || event.createdAt || new Date().toISOString();
        var normalized = Object.assign({
          eventId: (event.correlationId || 'global') + ':' + (event.type || 'integration') + ':' + now,
          entity: 'LedgerCommit', entityId: event.correlationId || 'ledger-global', sequence: 1,
          idempotencyKey: (event.correlationId || 'global') + ':' + (event.type || 'integration') + ':' + now,
          retryCount: 0, rowVersion: 1, createdAt: now, updatedAt: now, errorCode: event.errorCode || null,
          payloadJson: JSON.stringify(event)
        }, event);
        return graph.append(LISTS.integration, mapToFields(normalized, INTEGRATION));
      }
    };
  }
  return { create: create, LISTS: LISTS, mapToFields: mapToFields, mapFromFields: mapFromFields };
});
