#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const validator = require('../core/schema-validator');
const integration = require('../core/integration-contracts');
const contract = require('../contracts/commands.v1.json');
const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../fixtures/os-consumer-contract.v1.json');
try {
  const envelope = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  validator.validateCommand(contract, envelope);
  const ledgerCommand = integration.fromOsConsumption(envelope);
  console.log(JSON.stringify({ compatible: true, contractVersion: contract.contractVersion, operation: envelope.operation, osId: envelope.payload.osId, necessityId: envelope.payload.necessityId, materialIds: ledgerCommand.items.map((item) => item.materialId) }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ compatible: false, errorCode: error.code || error.message, details: error.details || null })); process.exitCode = 1;
}
