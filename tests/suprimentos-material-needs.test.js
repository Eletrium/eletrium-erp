const assert = require('assert');
const domain = require('../suprimentos/core/material-needs');

function base(overrides) {
  return Object.assign({
    necessityId: 'nec-1', proposalId: 'prop-1', projectId: 'proj-1', eapId: 'eap-1',
    itemId: 'item-1', materialId: 'mat-1', materialOrigin: 'ELETRIUM', plannedQuantity: 10,
    unit: 'm', requiredDate: '2026-09-10', criticality: 'NORMAL', responsibleId: 'usr-1',
    snapshotVersion: 1, status: 'PENDENTE'
  }, overrides || {});
}

(function ts18NeedIsBornWithProjectAndSnapshot() {
  const need = domain.createNeed(base({ osId: undefined }));
  assert.strictEqual(need.proposalId, 'prop-1');
  assert.strictEqual(need.projectId, 'proj-1');
  assert.strictEqual(need.eapId, 'eap-1');
  assert.strictEqual(need.osId, null, 'OS deve permanecer referência contratual opcional');
  assert.strictEqual(need.snapshotVersion, 1);

  const revised = domain.reviseNeed(need, base({
    necessityId: 'nec-2', snapshotVersion: 2, plannedQuantity: 12
  }));
  assert.strictEqual(revised.priorNecessityId, 'nec-1');
  assert.strictEqual(need.plannedQuantity, 10, 'revisão não sobrescreve snapshot anterior');
})();

(function ts19ClientOriginDoesNotCreateEletriumCostOrStock() {
  const need = domain.createNeed(base({ materialOrigin: 'CLIENTE' }));
  assert.deepStrictEqual(need.ownershipAllocations, { ELETRIUM: 0, CLIENTE: 10 });
  assert.throws(() => domain.createPurchaseRequestFromShortage(need, {
    purchaseRequestId: 'sc-1', shortageQuantity: 2, idempotencyKey: 'idem-1'
  }), /CLIENT_MATERIAL_PURCHASE_FORBIDDEN/);
})();

(function ts20MixedOriginKeepsOwnershipSeparate() {
  const need = domain.createNeed(base({
    materialOrigin: 'MISTA', ownershipAllocations: { ELETRIUM: 6, CLIENTE: 4 }
  }));
  assert.deepStrictEqual(need.ownershipAllocations, { ELETRIUM: 6, CLIENTE: 4 });
  assert.throws(() => domain.createNeed(base({
    materialOrigin: 'MISTA', ownershipAllocations: { ELETRIUM: 7, CLIENTE: 4 }
  })), /OWNERSHIP_ALLOCATION_MISMATCH/);
  assert.throws(() => domain.createPurchaseRequestFromShortage(need, {
    purchaseRequestId: 'sc-over', shortageQuantity: 7, idempotencyKey: 'idem-over'
  }), /SHORTAGE_EXCEEDS_ELETRIUM_OWNERSHIP/);
})();

(function ts21ShortageCreatesTraceablePurchaseRequest() {
  const need = domain.createNeed(base({
    materialOrigin: 'MISTA', ownershipAllocations: { ELETRIUM: 6, CLIENTE: 4 }
  }));
  const request = domain.createPurchaseRequestFromShortage(need, {
    purchaseRequestId: 'sc-1', shortageQuantity: 4, eletriumAttendedQuantity: 2,
    idempotencyKey: 'idem-sc-1'
  });
  assert.deepStrictEqual({
    purchaseRequestId: request.purchaseRequestId,
    necessityId: request.necessityId,
    projectId: request.projectId,
    itemId: request.itemId,
    materialId: request.materialId,
    ownership: request.ownership
  }, {
    purchaseRequestId: 'sc-1', necessityId: 'nec-1', projectId: 'proj-1',
    itemId: 'item-1', materialId: 'mat-1', ownership: 'ELETRIUM'
  });
})();

console.log('suprimentos-material-needs.test.js: OK — TS-18 a TS-21');
