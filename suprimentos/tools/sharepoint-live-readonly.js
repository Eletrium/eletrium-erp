#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const livePort = require('../adapters/sharepoint-live-port');
const homologation = require('../adapters/sharepoint-homologation');
const security = require('../core/security');
const schema = require('../contracts/sharepoint-lists.v1.json');
const root = path.resolve(__dirname, '../..');
const requested = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const input = path.resolve(root, requested || 'suprimentos/fixtures/sharepoint-homologation-profile.example.json');
const profile = JSON.parse(fs.readFileSync(input, 'utf8'));
const token = process.env.SUPRIMENTOS_GRAPH_ACCESS_TOKEN;
if (!token) { console.error(JSON.stringify({ pass: false, code: 'GRAPH_ACCESS_TOKEN_REQUIRED', guidance: 'Configure somente no ambiente de execução; não grave no perfil ou repositório.' }, null, 2)); process.exit(2); }
if (profile.readOnly !== true) { console.error(JSON.stringify({ pass: false, code: 'READONLY_PROFILE_REQUIRED' }, null, 2)); process.exit(2); }
(async function () {
  try {
    const port = await livePort.create(Object.assign({}, profile, { credentialProvider: async () => token }));
    const result = await homologation.run(schema, port, { environment: profile.environment || 'homologacao' });
    console.log(JSON.stringify({ reportVersion: '1.0.0', generatedAt: new Date().toISOString(), pass: result.ready, readOnly: true, result }, null, 2));
    if (!result.ready) process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify({ pass: false, readOnly: true, error: security.sanitizeError(error) }, null, 2)); process.exitCode = 1; }
})();
