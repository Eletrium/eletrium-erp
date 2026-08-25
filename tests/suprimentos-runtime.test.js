const assert = require('assert');
const runtimeFactory = require('../suprimentos/core/runtime');
const contract = require('../suprimentos/contracts/commands.v1.json');
const observer = require('../suprimentos/core/observability').create();

(async function executableBoundaryCombinesSchemaRbacAndHandler() {
  const runtime = runtimeFactory.create({ contract, observer, identityProvider: async (actorId) => ({ actorId, roles: actorId === 'os-service' ? ['OS_SERVICE'] : ['SUPRIMENTOS_OPERADOR'] }), handlers: {
    reserve: async (payload) => ({ reserved: payload.items.length }),
    'os.consume.v1': async (payload) => ({ acceptedOsId: payload.osId })
  } });
  const base = { commandId: 'cmd1', operation: 'reserve', actorId: 'operator', correlationId: 'corr1', idempotencyKey: 'idem1', schemaVersion: '1.0.0', payload: { documentId: 'd1', documentVersion: 1, expectedVersions: { m1: 0 }, items: [{ itemId: 'i1', materialId: 'm1', quantity: 1 }] } };
  assert.strictEqual((await runtime.execute(base)).value.reserved, 1);
  await assert.rejects(() => runtime.execute(Object.assign({}, base, { commandId: 'cmd2', idempotencyKey: 'idem2', actorId: 'os-service' })), /COMMAND_FORBIDDEN/);
  assert.strictEqual(runtime.flags.bomControleProduction, false);
})().then(() => console.log('suprimentos-runtime.test.js: OK — schema + RBAC + gateway'));
