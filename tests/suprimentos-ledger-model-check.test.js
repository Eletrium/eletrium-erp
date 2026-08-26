const assert = require('assert');
const ledger = require('../suprimentos/core/ledger');

(function exploresSmallStateSpaceExhaustively() {
  const visited = new Set(); let explored = 0;
  function check(state, depth, path) {
    const projection = ledger.rebuildProjection(state); const item = projection.byMaterial.m1;
    assert.ok(item.stockPhysical >= 0); assert.ok(item.reservedValid >= 0); assert.ok(item.available >= 0);
    assert.strictEqual(item.available, item.stockPhysical - item.reservedValid);
    const signature = depth + '|' + item.stockPhysical + '|' + item.reservedValid + '|' + Object.values(projection.positions).sort().join(',');
    if (visited.has(signature)) return; visited.add(signature); explored += 1;
    if (depth === 0) return;
    const version = state.rowVersionsByMaterial.m1 || 0, suffix = path || 'root';
    if (item.available > 0) {
      const id = 'i-' + suffix; const command = { idempotencyKey: 'r-' + suffix, documentId: 'd-' + suffix, documentVersion: 1, correlationId: 'c-' + suffix, expectedVersions: { m1: version }, items: [{ itemId: id, materialId: 'm1', quantity: 1 }] };
      const result = ledger.reserve(state, command); assert.strictEqual(ledger.reserve(result.state, command).replayed, true); check(result.state, depth - 1, suffix + 'r');
    }
    Object.keys(projection.positions).filter((key) => projection.positions[key] > 0).slice(0, 2).forEach((key, index) => {
      const parts = key.split('|'), source = { itemId: parts[2], materialId: 'm1', quantity: 1 };
      const base = { documentId: parts[0], documentVersion: Number(parts[1]), correlationId: 'c-' + suffix + index, expectedVersions: { m1: version }, items: [source] };
      check(ledger.release(state, Object.assign({ idempotencyKey: 'l-' + suffix + index }, base)).state, depth - 1, suffix + 'l' + index);
      if (item.stockPhysical > 0) check(ledger.consume(state, Object.assign({ idempotencyKey: 'c-' + suffix + index }, base)).state, depth - 1, suffix + 'c' + index);
    });
  }
  check(ledger.createState({ openingStockByMaterial: { m1: 2 }, rowVersionsByMaterial: { m1: 0 } }), 6, 's');
  assert.ok(explored >= 15, 'espaço de estados pequeno demais: ' + explored);
})();

console.log('suprimentos-ledger-model-check.test.js: OK — espaço de estados explorado');
