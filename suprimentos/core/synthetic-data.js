(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSyntheticData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function pad(value) { return String(value).padStart(6, '0'); }
  function generate(count, options) {
    options = options || {}; count = Number(count);
    if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error('SYNTHETIC_COUNT_INVALID');
    var projectCount = Number(options.projectCount || 20), materialCount = Number(options.materialCount || 100), records = [];
    for (var i = 1; i <= count; i += 1) {
      var project = 'SYN-PROJ-' + pad(((i - 1) % projectCount) + 1), material = 'SYN-MAT-' + pad(((i - 1) % materialCount) + 1);
      records.push({
        syntheticOnly: true, proposalId: 'SYN-PROP-' + pad(((i - 1) % projectCount) + 1), projectId: project,
        packageId: project + '-PKG-' + pad((i % 5) + 1), necessityId: 'SYN-NEC-' + pad(i), itemId: 'SYN-ITEM-' + pad(i),
        materialId: material, materialOrigin: i % 7 === 0 ? 'CLIENTE' : 'ELETRIUM', plannedQuantity: (i % 25) + 1,
        unit: 'un', requiredDate: '2026-10-' + String((i % 28) + 1).padStart(2, '0'), criticality: i % 10 === 0 ? 'ALTA' : 'NORMAL', snapshotVersion: 1
      });
    }
    return { syntheticOnly: true, generatedCount: records.length, records: records };
  }
  return { generate: generate };
});
