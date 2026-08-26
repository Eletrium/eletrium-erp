(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core/sharepoint-schema-verifier'));
  else root.SuprimentosSharePointHomologation = factory(root.SuprimentosSharePointSchemaVerifier);
})(typeof self !== 'undefined' ? self : this, function (verifier) {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  async function run(schema, port, options) {
    options = options || {}; if (!port || typeof port.captureSchema !== 'function' || typeof port.probePagination !== 'function') fail('HOMOLOGATION_PORT_REQUIRED');
    var snapshot = await port.captureSchema(); var schemaReport = verifier.verify(schema, snapshot);
    var pagination = await port.probePagination();
    if (!pagination || pagination.complete !== true) fail('HOMOLOGATION_PAGINATION_FAILED');
    var writeProbe = { executed: false, reason: 'DRY_RUN' };
    if (options.liveWriteProbe === true) {
      if (options.allowHomologationWrites !== true) fail('HOMOLOGATION_WRITE_GATE_CLOSED');
      if (!schemaReport.conformant) fail('HOMOLOGATION_SCHEMA_DRIFT', schemaReport.findings);
      if (typeof port.probeConditionalWrite !== 'function') fail('CONDITIONAL_WRITE_PROBE_REQUIRED');
      writeProbe = await port.probeConditionalWrite();
      if (!writeProbe || writeProbe.etagConflictDetected !== true || writeProbe.cleanupConfirmed !== true) fail('CONDITIONAL_WRITE_PROBE_FAILED', writeProbe);
    }
    return { environment: options.environment || 'unconfigured', schema: schemaReport, pagination: pagination, writeProbe: writeProbe,
      ready: schemaReport.conformant && pagination.complete === true && (options.liveWriteProbe !== true || writeProbe.etagConflictDetected === true) };
  }
  return { run: run };
});
