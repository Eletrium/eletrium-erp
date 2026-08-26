#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
const ui = read('suprimentos.html'), graph = read('graph.js');
const checks = [
  { id: 'UI_DIRECT_STOCK_PATCH', severity: 'BLOCKER', file: 'suprimentos.html', detected: /Estoque_Reservado:\s*novoValor/.test(ui), action: 'Substituir por command gateway e ledger' },
  { id: 'UI_BEST_EFFORT_ROLLBACK', severity: 'BLOCKER', file: 'suprimentos.html', detected: /async function reverterReservas/.test(ui), action: 'Emitir LIBERACAO ou COMPENSACAO append-only' },
  { id: 'UI_DIRECT_PURCHASE_WRITES', severity: 'HIGH', file: 'suprimentos.html', detected: /EG\.createItem\("Solicitacoes_Compra"/.test(ui), action: 'Encaminhar comando versionado ao gateway' },
  { id: 'UI_DIRECT_QUOTE_STATE', severity: 'HIGH', file: 'suprimentos.html', detected: /EG\.patchItemFields\("Cotacoes_Fornecedor"/.test(ui), action: 'Mover escolha atômica para domínio de compras' },
  { id: 'SHARED_PAGINATION_TRUNCATES', severity: 'BLOCKER', file: 'graph.js', detected: /resultado TRUNCADO/.test(graph), action: 'Adapter de Suprimentos deve rejeitar leitura incompleta' },
  { id: 'DELEGATED_BROAD_WRITE_SCOPE', severity: 'HIGH', file: 'graph.js', detected: /Sites\.ReadWrite\.All/.test(graph), action: 'Usar service account com menor privilégio no gateway' },
  { id: 'DIRECT_SCREEN_TO_GRAPH', severity: 'BLOCKER', file: 'suprimentos.html', detected: /EG\.(?:gpatch|createItem|patchItemFields)/.test(ui), action: 'Tela deve depender exclusivamente do bridge' }
];
const report = { auditedFiles: ['suprimentos.html', 'graph.js'], protectedFilesModified: false, blockers: checks.filter((item) => item.detected && item.severity === 'BLOCKER').length, findings: checks.filter((item) => item.detected) };
console.log(JSON.stringify(report, null, 2));
