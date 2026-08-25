#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
function exists(file) { return fs.existsSync(path.join(root, file)); }
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
const gateH = JSON.parse(read('suprimentos/contracts/bomcontrole-gate0.v1.json'));
const required = [
  'suprimentos/contracts/entities.v1.json', 'suprimentos/contracts/sharepoint-lists.v1.json',
  'suprimentos/contracts/commands.v1.json', 'suprimentos/contracts/openapi.v1.yaml',
  'suprimentos/core/ledger.js', 'suprimentos/core/outbox-worker.js', 'suprimentos/core/runtime.js',
  'suprimentos/adapters/sharepoint-repository.js', 'suprimentos/adapters/sharepoint-lease-store.js',
  'suprimentos/ui/components.js', 'suprimentos/contracts/gates.v1.json',
  'suprimentos/tools/homologation-evidence.js', 'suprimentos/tools/security-scan.js',
  'suprimentos/spec/CHANGELOG-SUPRIMENTOS-RC1.md', 'suprimentos/spec/RUNBOOK-IMPLANTACAO-RECONCILIACAO.md'
];
const checks = [
  { id: 'ARTIFACTS', ok: required.every(exists), details: required.filter((file) => !exists(file)) },
  { id: 'BOM_CONTROLE_GATE', ok: gateH.productionEnabled === false, details: { productionEnabled: gateH.productionEnabled } },
  { id: 'CI_PATH_ISOLATION', ok: /suprimentos\/\*\*/.test(read('.github/workflows/suprimentos-ci.yml')), details: null },
  { id: 'PROTECTED_UI_UNTOUCHED_BY_DESIGN', ok: /não autoriza alteração da tela/i.test(read('suprimentos/spec/SUPRIMENTOS-INTERFACE-DELTA.md')), details: null }
];
const report = { generatedAt: new Date().toISOString(), readyForEnvironmentHomologation: checks.every((item) => item.ok), checks };
console.log(JSON.stringify(report, null, 2));
if (!report.readyForEnvironmentHomologation) process.exitCode = 1;
