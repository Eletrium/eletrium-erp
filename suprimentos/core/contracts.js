(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosContracts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fail(code, details) {
    const error = new Error(code);
    error.code = code;
    if (details !== undefined) error.details = details;
    throw error;
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function present(value) {
    return value !== undefined && value !== null && value !== '';
  }

  function entityContract(contracts, entityName) {
    if (!contracts || !contracts.entities || !contracts.entities[entityName]) {
      fail('ENTITY_CONTRACT_NOT_FOUND', entityName);
    }
    return contracts.entities[entityName];
  }

  function enumRules(contract) {
    return Object.keys(contract).filter(function (key) { return /Enum$/.test(key); }).map(function (key) {
      const field = key === 'originEnum' ? 'Origem_Material' : key === 'typeEnum' ? 'Tipo' : key === 'statusEnum' ? 'Status' : null;
      return { field: field, values: contract[key] };
    }).filter(function (rule) { return rule.field; });
  }

  function validateEntity(contracts, entityName, record) {
    const contract = entityContract(contracts, entityName);
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail('RECORD_REQUIRED');
    (contract.required || []).forEach(function (field) {
      if (!present(record[field])) fail(field + '_REQUIRED', { entity: entityName });
    });
    (contract.relations || []).forEach(function (field) {
      if (!present(record[field]) && own(record, field.replace(/_ID$/, '_Descricao'))) {
        fail(field + '_REQUIRED', { entity: entityName, rejectedDescriptionField: field.replace(/_ID$/, '_Descricao') });
      }
    });
    enumRules(contract).forEach(function (rule) {
      if (present(record[rule.field]) && rule.values.indexOf(record[rule.field]) === -1) {
        fail(rule.field + '_INVALID', { entity: entityName, allowed: rule.values });
      }
    });
    if (present(record.Row_Version) && (!Number.isInteger(Number(record.Row_Version)) || Number(record.Row_Version) < 0)) {
      fail('ROW_VERSION_INVALID');
    }
    return true;
  }

  function compositeValue(record, uniqueRule) {
    const fields = uniqueRule.split('+');
    return fields.map(function (field) {
      if (!present(record[field])) fail(field + '_REQUIRED_FOR_UNIQUENESS');
      return String(record[field]);
    }).join('|');
  }

  function assertUnique(contracts, entityName, records) {
    const contract = entityContract(contracts, entityName);
    if (!Array.isArray(records)) fail('RECORDS_REQUIRED');
    (contract.unique || []).forEach(function (rule) {
      const seen = new Set();
      records.forEach(function (record) {
        const value = compositeValue(record, rule);
        if (seen.has(value)) fail('UNIQUE_CONSTRAINT_VIOLATION', { entity: entityName, rule: rule, value: value });
        seen.add(value);
      });
    });
    return true;
  }

  function conditionalUpdate(current, patch, expectedVersion, versionField) {
    versionField = versionField || 'Row_Version';
    if (!current || typeof current !== 'object') fail('CURRENT_RECORD_REQUIRED');
    const actual = Number(current[versionField]);
    const expected = Number(expectedVersion);
    if (!Number.isInteger(actual) || actual < 0) fail('CURRENT_VERSION_INVALID');
    if (!Number.isInteger(expected) || expected < 0) fail('EXPECTED_VERSION_INVALID');
    if (actual !== expected) fail('ROW_VERSION_CONFLICT', { expected: expected, actual: actual, versionField: versionField });
    const next = Object.assign({}, current, patch || {});
    next[versionField] = actual + 1;
    return next;
  }

  async function readAllPages(fetchPage, options) {
    if (typeof fetchPage !== 'function') fail('FETCH_PAGE_REQUIRED');
    options = options || {};
    const maxPages = Number(options.maxPages || 1000);
    const records = [];
    const visited = new Set();
    let cursor = null;
    let pages = 0;
    while (true) {
      if (pages >= maxPages) fail('PAGINATION_LIMIT_EXCEEDED', { maxPages: maxPages });
      const page = await fetchPage(cursor);
      pages += 1;
      if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean') {
        fail('PAGINATION_RESPONSE_INVALID', { page: pages });
      }
      Array.prototype.push.apply(records, page.items);
      if (!page.hasMore) return { items: records, pages: pages, complete: true };
      if (!present(page.nextCursor)) fail('PAGINATION_INCOMPLETE', { page: pages });
      if (visited.has(page.nextCursor)) fail('PAGINATION_CURSOR_LOOP', { cursor: page.nextCursor });
      visited.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  function compareProjection(rebuiltByMaterial, storedByMaterial) {
    const rebuilt = rebuiltByMaterial || {};
    const stored = storedByMaterial || {};
    const ids = Array.from(new Set(Object.keys(rebuilt).concat(Object.keys(stored))));
    const fields = ['Estoque_Fisico', 'Reservado_Valido', 'Disponivel', 'Projection_Version', 'Ultimo_Movimento_ID'];
    const differences = [];
    ids.forEach(function (materialId) {
      const expected = rebuilt[materialId] || {};
      const actual = stored[materialId] || {};
      fields.forEach(function (field) {
        const left = expected[field] === undefined ? null : expected[field];
        const right = actual[field] === undefined ? null : actual[field];
        if (left !== right) differences.push({ materialId: materialId, field: field, expected: left, actual: right });
      });
    });
    return { ok: differences.length === 0, differences: differences, replacement: rebuilt };
  }

  return {
    validateEntity: validateEntity,
    assertUnique: assertUnique,
    conditionalUpdate: conditionalUpdate,
    readAllPages: readAllPages,
    compareProjection: compareProjection
  };
});
