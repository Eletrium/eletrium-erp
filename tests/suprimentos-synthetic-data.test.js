const assert = require('assert');
const generator = require('../suprimentos/core/synthetic-data');

(function createsLargeSafeReferentialDataset() {
  const data = generator.generate(5000, { projectCount: 25, materialCount: 200 });
  assert.strictEqual(data.generatedCount, 5000); assert.ok(data.records.every((item) => item.syntheticOnly));
  assert.strictEqual(new Set(data.records.map((item) => item.necessityId)).size, 5000);
  assert.strictEqual(new Set(data.records.map((item) => item.projectId)).size, 25);
  assert.strictEqual(new Set(data.records.map((item) => item.materialId)).size, 200);
  assert.ok(data.records.every((item) => item.necessityId.startsWith('SYN-')));
})();

console.log('suprimentos-synthetic-data.test.js: OK — massa sintética de 5.000 necessidades');
