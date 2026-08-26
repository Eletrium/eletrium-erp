#!/usr/bin/env node
'use strict';
const http = require('http');
const runtimeFactory = require('../core/runtime');
const observability = require('../core/observability');
const storeFactory = require('../adapters/in-memory-ledger-store');
const contract = require('../contracts/commands.v1.json');

function create(options) {
  options = options || {}; const observer = observability.create();
  const store = storeFactory.create(options.initialState || { openingStockByMaterial: { 'SYN-MAT-1': 10 }, rowVersionsByMaterial: { 'SYN-MAT-1': 0 } });
  const runtime = runtimeFactory.create({ contract, observer, identityProvider: async () => ({ roles: ['SUPRIMENTOS_OPERADOR'] }), handlers: {
    reserve: async (payload, context) => store.execute('reserve', Object.assign({}, payload, { idempotencyKey: context.idempotencyKey, correlationId: context.correlationId })).result
  } });
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ status: 'shadow', externalWrites: false })); }
    if (req.method !== 'POST' || req.url !== '/v1/suprimentos/commands') { res.writeHead(404); return res.end(); }
    let raw = ''; req.on('data', (chunk) => { raw += chunk; if (raw.length > 524288) req.destroy(); });
    req.on('end', async () => {
      try { const result = await runtime.execute(JSON.parse(raw)); res.writeHead(202, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); }
      catch (error) { const status = error.code === 'COMMAND_FORBIDDEN' ? 403 : /CONFLICT|REUSED/.test(error.code || '') ? 409 : /SCHEMA|REQUIRED|INVALID/.test(error.code || '') ? 400 : 422; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, errorCode: error.code || 'UNEXPECTED_ERROR', details: error.details || null })); }
    });
  });
  return { server, snapshot: store.snapshot, telemetry: observer.snapshot };
}
module.exports = { create };
if (require.main === module) {
  const app = create(); const port = Number(process.env.SUPRIMENTOS_MOCK_PORT || 8787);
  app.server.listen(port, '127.0.0.1', () => console.log('Suprimentos mock gateway em http://127.0.0.1:' + port));
}
