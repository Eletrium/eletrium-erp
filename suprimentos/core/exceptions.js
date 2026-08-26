(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosExceptions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CATEGORIES = Object.freeze([
    'ESTOQUE_INSUFICIENTE', 'COMPRA_ATRASADA', 'COTACAO_PENDENTE', 'APROVACAO_PENDENTE',
    'RECEBIMENTO_DIVERGENTE', 'NFE_DIVERGENTE', 'SYNC_ERROR', 'RECONCILIACAO_PENDENTE', 'MATERIAL_CRITICO_OS'
  ]);
  const TYPES = Object.freeze({ OPEN: 'ABERTA', ASSIGN: 'ATRIBUIDA', RETRY: 'REPROCESSADA', RESOLVE: 'RESOLVIDA', REOPEN: 'REABERTA' });
  function fail(code, details) { const error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function required(value, field) { if (value === undefined || value === null || value === '') fail(field + '_REQUIRED'); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  function validateEvent(event) {
    event = event || {};
    ['eventId', 'exceptionId', 'eventType', 'idempotencyKey', 'correlationId', 'createdAt'].forEach(function (field) {
      required(event[field], field.replace(/[A-Z]/g, (letter) => '_' + letter).toUpperCase());
    });
    if (Object.values(TYPES).indexOf(event.eventType) === -1) fail('EXCEPTION_EVENT_TYPE_INVALID');
    if (event.eventType === TYPES.OPEN) {
      ['category', 'entity', 'entityId', 'criticality', 'recommendedAction'].forEach(function (field) {
        required(event[field], field.replace(/[A-Z]/g, (letter) => '_' + letter).toUpperCase());
      });
      if (CATEGORIES.indexOf(event.category) === -1) fail('EXCEPTION_CATEGORY_INVALID');
      if (['CRITICA', 'ALTA', 'NORMAL', 'BAIXA'].indexOf(event.criticality) === -1) fail('CRITICALITY_INVALID');
    }
    if (event.eventType === TYPES.RESOLVE) {
      required(event.resolutionKind, 'RESOLUTION_KIND'); required(event.resolutionEvidenceId, 'RESOLUTION_EVIDENCE_ID');
    }
    return true;
  }

  function append(events, incoming) {
    const current = copy(events || []);
    const keys = new Set(current.map((event) => event.idempotencyKey));
    const ids = new Set(current.map((event) => event.eventId));
    (incoming || []).forEach(function (event) {
      validateEvent(event);
      if (keys.has(event.idempotencyKey)) {
        const prior = current.find((item) => item.idempotencyKey === event.idempotencyKey);
        if (JSON.stringify(prior) !== JSON.stringify(event)) fail('IDEMPOTENCY_KEY_REUSED');
        return;
      }
      if (ids.has(event.eventId)) fail('EVENT_ID_DUPLICATE');
      current.push(copy(event)); keys.add(event.idempotencyKey); ids.add(event.eventId);
    });
    return current;
  }

  function rebuild(events, now) {
    const projection = {};
    (events || []).forEach(function (event) {
      validateEvent(event);
      let item = projection[event.exceptionId];
      if (event.eventType === TYPES.OPEN) {
        if (item) fail('EXCEPTION_ALREADY_OPENED', event.exceptionId);
        item = projection[event.exceptionId] = {
          exceptionId: event.exceptionId, category: event.category, entity: event.entity, entityId: event.entityId,
          projectId: event.projectId || null, criticality: event.criticality, requiredDate: event.requiredDate || null,
          responsibleId: event.responsibleId || null, recommendedAction: event.recommendedAction,
          correlationId: event.correlationId, status: 'ABERTA', lastError: event.lastError || null,
          retryCount: 0, openedAt: event.createdAt, updatedAt: event.createdAt, resolution: null
        };
      } else {
        if (!item) fail('EXCEPTION_NOT_OPENED', event.exceptionId);
        if (event.eventType === TYPES.ASSIGN) { required(event.responsibleId, 'RESPONSIBLE_ID'); item.responsibleId = event.responsibleId; item.status = 'EM_TRATAMENTO'; }
        if (event.eventType === TYPES.RETRY) { item.retryCount += 1; item.lastError = event.lastError || item.lastError; item.status = 'EM_TRATAMENTO'; }
        if (event.eventType === TYPES.RESOLVE) { item.status = 'RESOLVIDA'; item.resolution = { kind: event.resolutionKind, evidenceId: event.resolutionEvidenceId, eventId: event.eventId }; }
        if (event.eventType === TYPES.REOPEN) { item.status = 'ABERTA'; item.resolution = null; item.lastError = event.lastError || item.lastError; }
        item.updatedAt = event.createdAt;
      }
    });
    const reference = new Date(now || new Date().toISOString()).getTime();
    Object.keys(projection).forEach(function (id) {
      const item = projection[id];
      const openedAt = new Date(item.openedAt).getTime();
      if (!Number.isFinite(reference) || !Number.isFinite(openedAt)) fail('EXCEPTION_DATE_INVALID', id);
      item.ageHours = Math.max(0, Math.floor((reference - openedAt) / 3600000));
      item.overdue = item.requiredDate ? new Date(item.requiredDate).getTime() < reference && item.status !== 'RESOLVIDA' : false;
    });
    return projection;
  }

  function buildWorkQueue(events, now) {
    const projection = rebuild(events, now);
    const open = Object.values(projection).filter((item) => item.status !== 'RESOLVIDA');
    open.sort(function (left, right) {
      const critical = { CRITICA: 0, ALTA: 1, NORMAL: 2, BAIXA: 3 };
      return critical[left.criticality] - critical[right.criticality] || right.ageHours - left.ageHours;
    });
    return {
      items: open,
      kpis: {
        open: open.length,
        critical: open.filter((item) => item.criticality === 'CRITICA').length,
        overdue: open.filter((item) => item.overdue).length,
        syncOrReconciliation: open.filter((item) => item.category === 'SYNC_ERROR' || item.category === 'RECONCILIACAO_PENDENTE').length
      }
    };
  }

  return { CATEGORIES: CATEGORIES, TYPES: TYPES, validateEvent: validateEvent, append: append, rebuild: rebuild, buildWorkQueue: buildWorkQueue };
});
