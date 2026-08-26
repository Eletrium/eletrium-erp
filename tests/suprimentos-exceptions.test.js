const assert = require('assert');
const exceptions = require('../suprimentos/core/exceptions');

function opened(overrides) {
  return Object.assign({
    eventId: 'evt-open-1', exceptionId: 'exc-1', eventType: 'ABERTA',
    category: 'ESTOQUE_INSUFICIENTE', entity: 'Necessidades_Materiais', entityId: 'nec-1',
    projectId: 'proj-1', criticality: 'CRITICA', requiredDate: '2026-08-23T00:00:00Z',
    responsibleId: 'usr-1', recommendedAction: 'Criar solicitação de compra',
    correlationId: 'corr-1', idempotencyKey: 'idem-open-1', createdAt: '2026-08-22T00:00:00Z',
    lastError: 'Saldo insuficiente'
  }, overrides || {});
}

(function queueIsRebuiltOnlyFromAppendOnlyEvents() {
  const events = exceptions.append([], [opened()]);
  const queue = exceptions.buildWorkQueue(events, '2026-08-24T00:00:00Z');
  assert.strictEqual(queue.items.length, 1);
  assert.strictEqual(queue.items[0].exceptionId, 'exc-1');
  assert.strictEqual(queue.items[0].ageHours, 48);
  assert.deepStrictEqual(queue.kpis, { open: 1, critical: 1, overdue: 1, syncOrReconciliation: 0 });
})();

(function retryPreservesFailureHistoryAndIncrementsCount() {
  let events = exceptions.append([], [opened()]);
  const retry = {
    eventId: 'evt-retry-1', exceptionId: 'exc-1', eventType: 'REPROCESSADA',
    correlationId: 'corr-1', idempotencyKey: 'idem-retry-1', createdAt: '2026-08-23T00:00:00Z',
    lastError: 'Timeout novamente'
  };
  events = exceptions.append(events, [retry]);
  events = exceptions.append(events, [retry]);
  const projected = exceptions.rebuild(events, '2026-08-24T00:00:00Z')['exc-1'];
  assert.strictEqual(events.length, 2, 'retry idempotente não duplica evento');
  assert.strictEqual(projected.retryCount, 1);
  assert.strictEqual(projected.lastError, 'Timeout novamente');
})();

(function criticalExceptionCannotCloseByVisualStatusOnly() {
  const invalid = {
    eventId: 'evt-close-visual', exceptionId: 'exc-1', eventType: 'RESOLVIDA',
    correlationId: 'corr-1', idempotencyKey: 'idem-close', createdAt: '2026-08-24T00:00:00Z',
    status: 'verde'
  };
  assert.throws(() => exceptions.append([opened()], [invalid]), /RESOLUTION_KIND_REQUIRED/);
})();

(function resolutionAndReopeningKeepFullTrail() {
  let events = exceptions.append([], [opened()]);
  events = exceptions.append(events, [{
    eventId: 'evt-resolve-1', exceptionId: 'exc-1', eventType: 'RESOLVIDA',
    resolutionKind: 'RECONCILIADO', resolutionEvidenceId: 'recon-1', correlationId: 'corr-1',
    idempotencyKey: 'idem-resolve-1', createdAt: '2026-08-24T00:00:00Z'
  }]);
  assert.strictEqual(exceptions.buildWorkQueue(events, '2026-08-24T01:00:00Z').items.length, 0);
  events = exceptions.append(events, [{
    eventId: 'evt-reopen-1', exceptionId: 'exc-1', eventType: 'REABERTA',
    correlationId: 'corr-1', idempotencyKey: 'idem-reopen-1', createdAt: '2026-08-24T02:00:00Z',
    lastError: 'Divergência reapareceu'
  }]);
  const queue = exceptions.buildWorkQueue(events, '2026-08-24T03:00:00Z');
  assert.strictEqual(events.length, 3);
  assert.strictEqual(queue.items[0].status, 'ABERTA');
  assert.strictEqual(queue.items[0].resolution, null);
})();

(function supplyQueueDoesNotNeedCrmOrOsState() {
  const events = exceptions.append([], [
    opened({
      eventId: 'evt-sync', exceptionId: 'exc-sync', category: 'SYNC_ERROR', entity: 'Eventos_Integracao',
      entityId: 'integration-1', projectId: null, criticality: 'ALTA', requiredDate: null,
      recommendedAction: 'Reconciliar evento', idempotencyKey: 'idem-sync'
    })
  ]);
  const queue = exceptions.buildWorkQueue(events, '2026-08-24T00:00:00Z');
  assert.strictEqual(queue.kpis.syncOrReconciliation, 1);
  assert.strictEqual(queue.items[0].entity, 'Eventos_Integracao');
})();

console.log('suprimentos-exceptions.test.js: OK — Gate F');
