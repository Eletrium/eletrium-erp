(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosLedger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RESERVATION_TYPES = Object.freeze({
    RESERVE: 'RESERVA', RELEASE: 'LIBERACAO', CONSUME: 'CONSUMO', COMPENSATE: 'COMPENSACAO'
  });
  const MOVEMENT_TYPES = Object.freeze({
    IN: 'ENTRADA', OUT: 'SAIDA', ADJUST: 'AJUSTE', RETURN: 'DEVOLUCAO', TRANSFER: 'TRANSFERENCIA'
  });

  function fail(code, details) {
    const error = new Error(code);
    error.code = code;
    if (details !== undefined) error.details = details;
    throw error;
  }
  function assertNonEmpty(value, field) {
    if (typeof value !== 'string' || value.trim() === '') fail(field + '_REQUIRED');
  }
  function assertPositive(n, field) {
    if (!Number.isFinite(n) || n <= 0) fail(field + '_INVALID');
  }
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }
  function uniqueMaterials(items) {
    return Array.from(new Set((items || []).map(function (item) { return item.materialId; })));
  }

  function positionKey(eventOrItem, command) {
    const source = eventOrItem.source || {};
    const documentId = eventOrItem.sourceDocumentId || source.documentId || eventOrItem.documentId || (command && command.documentId);
    const documentVersion = eventOrItem.sourceDocumentVersion || source.documentVersion || eventOrItem.documentVersion || (command && command.documentVersion);
    const itemId = eventOrItem.sourceItemId || source.itemId || eventOrItem.itemId;
    const materialId = eventOrItem.materialId;
    assertNonEmpty(String(documentId || ''), 'SOURCE_DOCUMENT_ID');
    if (documentVersion === undefined || documentVersion === null || documentVersion === '') fail('SOURCE_DOCUMENT_VERSION_REQUIRED');
    assertNonEmpty(String(itemId || ''), 'SOURCE_ITEM_ID');
    assertNonEmpty(String(materialId || ''), 'MATERIAL_ID');
    return [documentId, documentVersion, itemId, materialId].join('|');
  }

  function reservationDelta(event) {
    const quantity = Number(event.quantity);
    assertPositive(Math.abs(quantity), 'EVENT_QUANTITY');
    if (event.type === RESERVATION_TYPES.RESERVE) return quantity;
    if (event.type === RESERVATION_TYPES.RELEASE || event.type === RESERVATION_TYPES.CONSUME) return -quantity;
    if (event.type === RESERVATION_TYPES.COMPENSATE) {
      if (!Number.isFinite(Number(event.reservationDelta)) || Number(event.reservationDelta) === 0) fail('COMPENSATION_DELTA_REQUIRED');
      return Number(event.reservationDelta);
    }
    fail('RESERVATION_EVENT_TYPE_INVALID', event.type);
  }

  function movementDelta(event) {
    const quantity = Number(event.quantity);
    assertPositive(Math.abs(quantity), 'MOVEMENT_QUANTITY');
    if (event.type === MOVEMENT_TYPES.IN || event.type === MOVEMENT_TYPES.RETURN) return quantity;
    if (event.type === MOVEMENT_TYPES.OUT) return -quantity;
    if (event.type === MOVEMENT_TYPES.ADJUST || event.type === MOVEMENT_TYPES.TRANSFER) {
      if (!Number.isFinite(Number(event.physicalDelta)) || Number(event.physicalDelta) === 0) fail('MOVEMENT_DELTA_REQUIRED');
      return Number(event.physicalDelta);
    }
    fail('MOVEMENT_EVENT_TYPE_INVALID', event.type);
  }

  function available(stockPhysical, activeReservations) {
    if (!Number.isFinite(stockPhysical)) fail('STOCK_INVALID');
    const reserved = (activeReservations || []).reduce(function (sum, reservation) {
      return sum + (Number(reservation.quantity) || 0);
    }, 0);
    return stockPhysical - reserved;
  }

  function rebuildProjection(input) {
    input = input || {};
    const opening = input.openingStockByMaterial || {};
    const projection = {};
    const positions = {};
    const compensatedEventIds = new Set();
    Object.keys(opening).forEach(function (materialId) {
      const physical = Number(opening[materialId]);
      if (!Number.isFinite(physical)) fail('STOCK_INVALID', materialId);
      projection[materialId] = {
        materialId: materialId, stockPhysical: physical, reservedValid: 0, available: physical,
        projectionVersion: Number((input.rowVersionsByMaterial || {})[materialId] || 0), lastMovementId: null
      };
    });
    (input.reservationEvents || []).forEach(function (event) {
      assertNonEmpty(event.materialId, 'MATERIAL_ID');
      if (!projection[event.materialId]) projection[event.materialId] = {
        materialId: event.materialId, stockPhysical: 0, reservedValid: 0, available: 0,
        projectionVersion: Number((input.rowVersionsByMaterial || {})[event.materialId] || 0), lastMovementId: null
      };
      const delta = reservationDelta(event);
      const key = event.positionKey || positionKey(event);
      positions[key] = (positions[key] || 0) + delta;
      projection[event.materialId].reservedValid += delta;
      if (event.compensatesEventId) compensatedEventIds.add(event.compensatesEventId);
    });
    (input.movementEvents || []).forEach(function (event) {
      assertNonEmpty(event.materialId, 'MATERIAL_ID');
      if (!projection[event.materialId]) projection[event.materialId] = {
        materialId: event.materialId, stockPhysical: 0, reservedValid: 0, available: 0,
        projectionVersion: Number((input.rowVersionsByMaterial || {})[event.materialId] || 0), lastMovementId: null
      };
      projection[event.materialId].stockPhysical += movementDelta(event);
      projection[event.materialId].lastMovementId = event.eventId || null;
      if (event.compensatesEventId) compensatedEventIds.add(event.compensatesEventId);
    });
    Object.keys(positions).forEach(function (key) {
      if (positions[key] < 0) fail('RESERVATION_POSITION_NEGATIVE', { positionKey: key, balance: positions[key] });
    });
    Object.keys(projection).forEach(function (materialId) {
      const item = projection[materialId];
      if (item.reservedValid < 0) fail('RESERVED_BALANCE_NEGATIVE', materialId);
      item.available = item.stockPhysical - item.reservedValid;
      if (item.available < 0) fail('AVAILABLE_BALANCE_NEGATIVE', materialId);
    });
    return { byMaterial: projection, positions: positions, compensatedEventIds: Array.from(compensatedEventIds) };
  }

  function validateCommand(command) {
    if (!command) fail('COMMAND_REQUIRED');
    assertNonEmpty(command.idempotencyKey, 'IDEMPOTENCY_KEY');
    assertNonEmpty(command.documentId, 'DOCUMENT_ID');
    if (command.documentVersion === undefined || command.documentVersion === null || command.documentVersion === '') fail('DOCUMENT_VERSION_REQUIRED');
    assertNonEmpty(command.correlationId, 'CORRELATION_ID');
    if (!Array.isArray(command.items) || command.items.length === 0) fail('ITEMS_REQUIRED');
    const seen = new Set();
    command.items.forEach(function (item) {
      assertNonEmpty(item.itemId, 'ITEM_ID');
      assertNonEmpty(item.materialId, 'MATERIAL_ID');
      assertPositive(Number(item.quantity), 'QUANTITY');
      const key = item.itemId + '|' + item.materialId;
      if (seen.has(key)) fail('DUPLICATE_ITEM');
      seen.add(key);
    });
  }

  function validateReserve(command, stockByMaterial, reservationsByMaterial) {
    validateCommand(command);
    const result = command.items.map(function (item) {
      const physical = Number(stockByMaterial[item.materialId] || 0);
      const free = available(physical, reservationsByMaterial[item.materialId] || []);
      return { itemId: item.itemId, materialId: item.materialId, requested: Number(item.quantity), available: free, canReserve: free >= Number(item.quantity) };
    });
    return { ok: result.every(function (item) { return item.canReserve; }), items: result };
  }

  function baseEvent(command, item, type, now, suffix) {
    const key = command.idempotencyKey + ':' + suffix + ':' + item.itemId;
    return {
      eventId: key, type: type, documentId: command.documentId, documentVersion: command.documentVersion,
      itemId: item.itemId, necessityId: item.necessityId, materialId: item.materialId,
      quantity: Number(item.quantity), correlationId: command.correlationId, idempotencyKey: key,
      createdAt: now || new Date().toISOString()
    };
  }

  function buildReserveEvents(command, validation, now) {
    if (!validation || !validation.ok) fail('PREVALIDATION_FAILED');
    return validation.items.map(function (validated) {
      const source = command.items.find(function (item) { return item.itemId === validated.itemId && item.materialId === validated.materialId; });
      const event = baseEvent(command, source, RESERVATION_TYPES.RESERVE, now, 'reserve');
      event.positionKey = positionKey(event);
      return event;
    });
  }

  function applyReservationEvents(events, priorKeys) {
    const keys = new Set(priorKeys || []);
    const appended = [];
    (events || []).forEach(function (event) {
      assertNonEmpty(event.idempotencyKey, 'IDEMPOTENCY_KEY');
      if (keys.has(event.idempotencyKey)) return;
      keys.add(event.idempotencyKey);
      appended.push(event);
    });
    return { appended: appended, keys: Array.from(keys) };
  }

  function expectedVersion(command, materialId) {
    if (!command.expectedVersions || !own(command.expectedVersions, materialId)) fail('EXPECTED_ROW_VERSION_REQUIRED', materialId);
    const version = Number(command.expectedVersions[materialId]);
    if (!Number.isInteger(version) || version < 0) fail('EXPECTED_ROW_VERSION_INVALID', materialId);
    return version;
  }
  function verifyVersions(command, state) {
    uniqueMaterials(command.items).forEach(function (materialId) {
      const expected = expectedVersion(command, materialId);
      const actual = Number(state.rowVersionsByMaterial[materialId] || 0);
      if (expected !== actual) fail('ROW_VERSION_CONFLICT', { materialId: materialId, expected: expected, actual: actual });
    });
  }
  function balancesForCommand(command, rebuilt) {
    return command.items.map(function (item) {
      const key = positionKey(item, command);
      return { item: item, positionKey: key, balance: Number(rebuilt.positions[key] || 0) };
    });
  }

  function planReserve(command, state, now) {
    validateCommand(command);
    const rebuilt = rebuildProjection(state);
    const validation = { ok: true, items: command.items.map(function (item) {
      const projected = rebuilt.byMaterial[item.materialId] || { stockPhysical: 0, reservedValid: 0, available: 0 };
      return { itemId: item.itemId, materialId: item.materialId, requested: Number(item.quantity), available: projected.available, canReserve: projected.available >= Number(item.quantity) };
    }) };
    validation.ok = validation.items.every(function (item) { return item.canReserve; });
    if (!validation.ok) fail('INSUFFICIENT_STOCK', validation.items.filter(function (item) { return !item.canReserve; }));
    return { reservationEvents: buildReserveEvents(command, validation, now), movementEvents: [] };
  }

  function planRelease(command, state, now) {
    validateCommand(command);
    const balances = balancesForCommand(command, rebuildProjection(state));
    const invalid = balances.filter(function (entry) { return entry.balance < Number(entry.item.quantity); });
    if (invalid.length) fail('RESERVATION_BALANCE_INSUFFICIENT', invalid);
    return { reservationEvents: balances.map(function (entry) {
      const event = baseEvent(command, entry.item, RESERVATION_TYPES.RELEASE, now, 'release');
      event.positionKey = entry.positionKey;
      return event;
    }), movementEvents: [] };
  }

  function planConsume(command, state, now) {
    validateCommand(command);
    const rebuilt = rebuildProjection(state);
    const balances = balancesForCommand(command, rebuilt);
    const invalidReservations = balances.filter(function (entry) { return entry.balance < Number(entry.item.quantity); });
    if (invalidReservations.length) fail('RESERVATION_BALANCE_INSUFFICIENT', invalidReservations);
    const invalidStock = command.items.filter(function (item) {
      const projected = rebuilt.byMaterial[item.materialId];
      return !projected || projected.stockPhysical < Number(item.quantity);
    });
    if (invalidStock.length) fail('PHYSICAL_STOCK_INSUFFICIENT', invalidStock);
    const reservationEvents = [];
    const movementEvents = [];
    balances.forEach(function (entry) {
      const reservation = baseEvent(command, entry.item, RESERVATION_TYPES.CONSUME, now, 'consume');
      reservation.positionKey = entry.positionKey;
      reservationEvents.push(reservation);
      const movement = baseEvent(command, entry.item, MOVEMENT_TYPES.OUT, now, 'movement-out');
      movement.reservationEventId = reservation.eventId;
      movementEvents.push(movement);
    });
    return { reservationEvents: reservationEvents, movementEvents: movementEvents };
  }

  function eventIndex(state) {
    const index = {};
    (state.reservationEvents || []).concat(state.movementEvents || []).forEach(function (event) { if (event.eventId) index[event.eventId] = event; });
    return index;
  }

  function planCompensate(command, state, now) {
    if (!command) fail('COMMAND_REQUIRED');
    assertNonEmpty(command.idempotencyKey, 'IDEMPOTENCY_KEY');
    assertNonEmpty(command.documentId, 'DOCUMENT_ID');
    assertNonEmpty(command.correlationId, 'CORRELATION_ID');
    if (!Array.isArray(command.targetEventIds) || command.targetEventIds.length === 0) fail('TARGET_EVENTS_REQUIRED');
    if (new Set(command.targetEventIds).size !== command.targetEventIds.length) fail('DUPLICATE_TARGET_EVENT');
    const index = eventIndex(state);
    const alreadyCompensated = new Set(rebuildProjection(state).compensatedEventIds);
    const targets = command.targetEventIds.map(function (eventId) {
      if (!index[eventId]) fail('TARGET_EVENT_NOT_FOUND', eventId);
      if (alreadyCompensated.has(eventId)) fail('TARGET_EVENT_ALREADY_COMPENSATED', eventId);
      return index[eventId];
    });
    command.items = targets.map(function (event) { return { itemId: event.itemId, materialId: event.materialId, quantity: event.quantity }; });
    if (command.documentVersion === undefined) command.documentVersion = 1;
    verifyVersions(command, state);
    const reservationEvents = [];
    const movementEvents = [];
    targets.forEach(function (target) {
      const item = { itemId: target.itemId, materialId: target.materialId, quantity: target.quantity };
      if (Object.values(RESERVATION_TYPES).indexOf(target.type) !== -1) {
        const event = baseEvent(command, item, RESERVATION_TYPES.COMPENSATE, now, 'compensate-' + target.eventId);
        event.compensatesEventId = target.eventId;
        event.positionKey = target.positionKey || positionKey(target);
        event.reservationDelta = -reservationDelta(target);
        reservationEvents.push(event);
      } else {
        const event = baseEvent(command, item, MOVEMENT_TYPES.ADJUST, now, 'compensate-' + target.eventId);
        event.compensatesEventId = target.eventId;
        event.physicalDelta = -movementDelta(target);
        movementEvents.push(event);
      }
    });
    return { reservationEvents: reservationEvents, movementEvents: movementEvents };
  }

  function createState(initial) {
    initial = initial || {};
    return {
      openingStockByMaterial: clone(initial.openingStockByMaterial || {}),
      reservationEvents: clone(initial.reservationEvents || []), movementEvents: clone(initial.movementEvents || []),
      rowVersionsByMaterial: clone(initial.rowVersionsByMaterial || {}), commandResultsByKey: clone(initial.commandResultsByKey || {}),
      commandFingerprintsByKey: clone(initial.commandFingerprintsByKey || {})
    };
  }

  function commit(state, command, planned, fingerprint) {
    const next = createState(state);
    next.reservationEvents = next.reservationEvents.concat(clone(planned.reservationEvents));
    next.movementEvents = next.movementEvents.concat(clone(planned.movementEvents));
    uniqueMaterials(command.items).forEach(function (materialId) {
      next.rowVersionsByMaterial[materialId] = Number(next.rowVersionsByMaterial[materialId] || 0) + 1;
    });
    const result = {
      idempotencyKey: command.idempotencyKey, correlationId: command.correlationId,
      reservationEvents: clone(planned.reservationEvents), movementEvents: clone(planned.movementEvents),
      rowVersionsByMaterial: clone(next.rowVersionsByMaterial), projection: rebuildProjection(next)
    };
    next.commandResultsByKey[command.idempotencyKey] = clone(result);
    next.commandFingerprintsByKey[command.idempotencyKey] = fingerprint;
    return { state: next, result: result, replayed: false };
  }

  function execute(state, operation, command, now) {
    state = createState(state);
    if (!command || !command.idempotencyKey) fail('IDEMPOTENCY_KEY_REQUIRED');
    const fingerprint = stableStringify(command);
    if (own(state.commandResultsByKey, command.idempotencyKey)) {
      if (state.commandFingerprintsByKey[command.idempotencyKey] !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED');
      return { state: state, result: clone(state.commandResultsByKey[command.idempotencyKey]), replayed: true };
    }
    command = clone(command);
    if (operation !== 'compensate') verifyVersions(command, state);
    let planned;
    if (operation === 'reserve') planned = planReserve(command, state, now);
    else if (operation === 'release') planned = planRelease(command, state, now);
    else if (operation === 'consume') planned = planConsume(command, state, now);
    else if (operation === 'compensate') planned = planCompensate(command, state, now);
    else fail('OPERATION_INVALID', operation);
    return commit(state, command, planned, fingerprint);
  }

  function reconcile(state, storedProjection) {
    const rebuilt = rebuildProjection(state);
    const expected = rebuilt.byMaterial;
    const actual = storedProjection || {};
    const materialIds = Array.from(new Set(Object.keys(expected).concat(Object.keys(actual))));
    const differences = [];
    materialIds.forEach(function (materialId) {
      const wanted = expected[materialId] || { stockPhysical: 0, reservedValid: 0, available: 0, projectionVersion: 0, lastMovementId: null };
      const found = actual[materialId] || { stockPhysical: 0, reservedValid: 0, available: 0, projectionVersion: 0, lastMovementId: null };
      ['stockPhysical', 'reservedValid', 'available', 'projectionVersion', 'lastMovementId'].forEach(function (field) {
        const equal = field === 'lastMovementId'
          ? (wanted[field] || null) === (found[field] || null)
          : Number(wanted[field]) === Number(found[field]);
        if (!equal) differences.push({ materialId: materialId, field: field, expected: wanted[field], actual: found[field] });
      });
    });
    return { ok: differences.length === 0, differences: differences, rebuilt: rebuilt };
  }

  function deriveAvailability(state, materialId) {
    assertNonEmpty(materialId, 'MATERIAL_ID');
    const projected = rebuildProjection(state).byMaterial[materialId];
    return projected ? projected.available : 0;
  }

  return {
    RESERVATION_TYPES: RESERVATION_TYPES, MOVEMENT_TYPES: MOVEMENT_TYPES,
    available: available, validateReserve: validateReserve, buildReserveEvents: buildReserveEvents,
    applyReservationEvents: applyReservationEvents, rebuildProjection: rebuildProjection, createState: createState,
    deriveAvailability: deriveAvailability,
    execute: execute,
    reserve: function (state, command, now) { return execute(state, 'reserve', command, now); },
    release: function (state, command, now) { return execute(state, 'release', command, now); },
    consume: function (state, command, now) { return execute(state, 'consume', command, now); },
    compensate: function (state, command, now) { return execute(state, 'compensate', command, now); },
    reconcile: reconcile
  };
});
