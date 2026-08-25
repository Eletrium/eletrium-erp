(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosMaterialNeeds = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ORIGINS = Object.freeze({ ELETRIUM: 'ELETRIUM', CLIENT: 'CLIENTE', MIXED: 'MISTA' });

  function fail(code, details) {
    const error = new Error(code);
    error.code = code;
    if (details !== undefined) error.details = details;
    throw error;
  }
  function required(value, field) { if (value === undefined || value === null || value === '') fail(field + '_REQUIRED'); }
  function positive(value, field) { if (!Number.isFinite(Number(value)) || Number(value) <= 0) fail(field + '_INVALID'); }
  function nonNegative(value, field) { if (!Number.isFinite(Number(value)) || Number(value) < 0) fail(field + '_INVALID'); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  function normalizeAllocations(command) {
    const quantity = Number(command.plannedQuantity);
    if (command.materialOrigin === ORIGINS.ELETRIUM) return { ELETRIUM: quantity, CLIENTE: 0 };
    if (command.materialOrigin === ORIGINS.CLIENT) return { ELETRIUM: 0, CLIENTE: quantity };
    if (command.materialOrigin !== ORIGINS.MIXED) fail('MATERIAL_ORIGIN_INVALID');
    const allocations = command.ownershipAllocations || {};
    nonNegative(allocations.ELETRIUM, 'ELETRIUM_ALLOCATION');
    nonNegative(allocations.CLIENTE, 'CLIENTE_ALLOCATION');
    if (Number(allocations.ELETRIUM) + Number(allocations.CLIENTE) !== quantity) {
      fail('OWNERSHIP_ALLOCATION_MISMATCH', { plannedQuantity: quantity, allocations: allocations });
    }
    if (Number(allocations.ELETRIUM) === 0 || Number(allocations.CLIENTE) === 0) fail('MIXED_ALLOCATION_REQUIRED');
    return { ELETRIUM: Number(allocations.ELETRIUM), CLIENTE: Number(allocations.CLIENTE) };
  }

  function createNeed(command) {
    command = command || {};
    ['necessityId', 'proposalId', 'projectId', 'itemId', 'materialId', 'unit', 'requiredDate', 'criticality', 'status'].forEach(function (field) {
      required(command[field], field.replace(/[A-Z]/g, function (letter) { return '_' + letter; }).toUpperCase());
    });
    if (!command.eapId && !command.packageId) fail('EAP_OR_PACKAGE_ID_REQUIRED');
    positive(command.snapshotVersion, 'SNAPSHOT_VERSION');
    positive(command.plannedQuantity, 'PLANNED_QUANTITY');
    const allocations = normalizeAllocations(command);
    return {
      necessityId: command.necessityId,
      proposalId: command.proposalId,
      projectId: command.projectId,
      eapId: command.eapId || null,
      packageId: command.packageId || null,
      osId: command.osId || null,
      itemId: command.itemId,
      materialId: command.materialId,
      materialOrigin: command.materialOrigin,
      plannedQuantity: Number(command.plannedQuantity),
      attendedQuantity: 0,
      ownershipAllocations: allocations,
      unit: command.unit,
      requiredDate: command.requiredDate,
      criticality: command.criticality,
      responsibleId: command.responsibleId || null,
      snapshotVersion: Number(command.snapshotVersion),
      status: command.status,
      priorNecessityId: command.priorNecessityId || null
    };
  }

  function reviseNeed(current, command) {
    if (!current) fail('CURRENT_NEED_REQUIRED');
    if (!command || command.snapshotVersion !== current.snapshotVersion + 1) fail('SNAPSHOT_VERSION_CONFLICT');
    return createNeed(Object.assign({}, current, command, {
      priorNecessityId: current.necessityId,
      osId: command.osId === undefined ? current.osId : command.osId
    }));
  }

  function createPurchaseRequestFromShortage(need, command) {
    if (!need) fail('NEED_REQUIRED');
    command = command || {};
    required(command.purchaseRequestId, 'PURCHASE_REQUEST_ID');
    required(command.idempotencyKey, 'IDEMPOTENCY_KEY');
    positive(command.shortageQuantity, 'SHORTAGE_QUANTITY');
    const eletriumOwned = Number(need.ownershipAllocations && need.ownershipAllocations.ELETRIUM || 0);
    const alreadyAttended = Number(command.eletriumAttendedQuantity || 0);
    const purchasable = Math.max(0, eletriumOwned - alreadyAttended);
    if (need.materialOrigin === ORIGINS.CLIENT) fail('CLIENT_MATERIAL_PURCHASE_FORBIDDEN');
    if (Number(command.shortageQuantity) > purchasable) {
      fail('SHORTAGE_EXCEEDS_ELETRIUM_OWNERSHIP', { requested: Number(command.shortageQuantity), purchasable: purchasable });
    }
    return {
      purchaseRequestId: command.purchaseRequestId,
      necessityId: need.necessityId,
      proposalId: need.proposalId,
      projectId: need.projectId,
      eapId: need.eapId,
      packageId: need.packageId,
      osId: need.osId,
      itemId: need.itemId,
      materialId: need.materialId,
      quantity: Number(command.shortageQuantity),
      requiredDate: need.requiredDate,
      criticality: need.criticality,
      ownership: ORIGINS.ELETRIUM,
      idempotencyKey: command.idempotencyKey,
      status: 'PENDENTE'
    };
  }

  return { ORIGINS: ORIGINS, createNeed: createNeed, reviseNeed: reviseNeed, createPurchaseRequestFromShortage: createPurchaseRequestFromShortage };
});
