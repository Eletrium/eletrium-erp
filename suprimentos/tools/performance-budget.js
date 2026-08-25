#!/usr/bin/env node
'use strict';
const ledger = require('../core/ledger');
function events(count) { const result = []; for (let i = 0; i < count / 2; i += 1) { const base = { documentId: 'd' + i, documentVersion: 1, itemId: 'i' + i, materialId: 'm1', quantity: 1, positionKey: 'd' + i + '|1|i' + i + '|m1' }; result.push(Object.assign({ eventId: 'r' + i, type: 'RESERVA' }, base), Object.assign({ eventId: 'l' + i, type: 'LIBERACAO' }, base)); } return result; }
const budgets = [{ events: 5000, maxMs: 1000 }, { events: 20000, maxMs: 3000 }];
const results = budgets.map((budget) => { const started = process.hrtime.bigint(); const projection = ledger.rebuildProjection({ openingStockByMaterial: { m1: 100 }, reservationEvents: events(budget.events), rowVersionsByMaterial: { m1: budget.events } }); const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6; return { events: budget.events, elapsedMs: Number(elapsedMs.toFixed(3)), maxMs: budget.maxMs, passed: elapsedMs <= budget.maxMs && projection.byMaterial.m1.available === 100 }; });
const report = { passed: results.every((item) => item.passed), results };
console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
