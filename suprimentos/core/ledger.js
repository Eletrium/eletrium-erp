(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosLedger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function assertPositive(n, field) {
    if (!Number.isFinite(n) || n <= 0) throw new Error(field + '_INVALID');
  }

  function available(stockPhysical, activeReservations) {
    if (!Number.isFinite(stockPhysical)) throw new Error('STOCK_INVALID');
    const reserved = (activeReservations || []).reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    return stockPhysical - reserved;
  }

  function validateReserve(command, stockByMaterial, reservationsByMaterial) {
    if (!command || !command.idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    if (!Array.isArray(command.items) || command.items.length === 0) throw new Error('ITEMS_REQUIRED');

    const seen = new Set();
    const result = command.items.map(function (item) {
      if (!item.itemId || !item.materialId) throw new Error('ITEM_ID_REQUIRED');
      assertPositive(Number(item.quantity), 'QUANTITY');
      const localKey = item.itemId + '|' + item.materialId;
      if (seen.has(localKey)) throw new Error('DUPLICATE_ITEM');
      seen.add(localKey);

      const physical = Number(stockByMaterial[item.materialId] || 0);
      const free = available(physical, reservationsByMaterial[item.materialId] || []);
      return {
        itemId: item.itemId,
        materialId: item.materialId,
        requested: Number(item.quantity),
        available: free,
        canReserve: free >= Number(item.quantity)
      };
    });

    return {
      ok: result.every(function (x) { return x.canReserve; }),
      items: result
    };
  }

  function buildReserveEvents(command, validation, now) {
    if (!validation || !validation.ok) throw new Error('PREVALIDATION_FAILED');
    const ts = now || new Date().toISOString();
    return validation.items.map(function (item) {
      return {
        type: 'RESERVA',
        documentId: command.documentId,
        documentVersion: command.documentVersion,
        itemId: item.itemId,
        materialId: item.materialId,
        quantity: item.requested,
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey + ':' + item.itemId,
        createdAt: ts
      };
    });
  }

  function applyReservationEvents(events, priorKeys) {
    const keys = new Set(priorKeys || []);
    const appended = [];
    (events || []).forEach(function (event) {
      if (!event.idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
      if (keys.has(event.idempotencyKey)) return;
      keys.add(event.idempotencyKey);
      appended.push(event);
    });
    return { appended: appended, keys: Array.from(keys) };
  }

  return {
    available: available,
    validateReserve: validateReserve,
    buildReserveEvents: buildReserveEvents,
    applyReservationEvents: applyReservationEvents
  };
});