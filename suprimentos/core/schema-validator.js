(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSchemaValidator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  function typeOk(value, type) {
    if (type === 'object') return value && typeof value === 'object' && !Array.isArray(value);
    if (type === 'array') return Array.isArray(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === type;
  }
  function validate(schema, value, path) {
    path = path || '$';
    if (!schema) fail('SCHEMA_REQUIRED', { path: path });
    if (schema.type && !typeOk(value, schema.type)) fail('SCHEMA_TYPE_INVALID', { path: path, expected: schema.type });
    if (schema.const !== undefined && value !== schema.const) fail('SCHEMA_CONST_INVALID', { path: path, expected: schema.const });
    if (schema.enum && schema.enum.indexOf(value) === -1) fail('SCHEMA_ENUM_INVALID', { path: path, allowed: schema.enum });
    if (typeof value === 'string' && schema.minLength && value.length < schema.minLength) fail('SCHEMA_MIN_LENGTH', { path: path });
    if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) fail('SCHEMA_MINIMUM', { path: path });
    if (typeof value === 'number' && schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail('SCHEMA_EXCLUSIVE_MINIMUM', { path: path });
    if (Array.isArray(value) && schema.minItems && value.length < schema.minItems) fail('SCHEMA_MIN_ITEMS', { path: path });
    if (Array.isArray(value) && schema.items) value.forEach(function (item, index) { validate(schema.items, item, path + '[' + index + ']'); });
    if (schema.type === 'object') {
      (schema.required || []).forEach(function (key) { if (value[key] === undefined || value[key] === null || value[key] === '') fail('SCHEMA_REQUIRED_FIELD', { path: path + '.' + key }); });
      Object.keys(schema.properties || {}).forEach(function (key) { if (value[key] !== undefined) validate(schema.properties[key], value[key], path + '.' + key); });
      if (schema.additionalProperties === false) Object.keys(value).forEach(function (key) { if (!schema.properties[key]) fail('SCHEMA_ADDITIONAL_PROPERTY', { path: path + '.' + key }); });
    }
    return true;
  }
  function validateCommand(contract, envelope) {
    validate(contract.envelope, envelope);
    var operation = contract.operations[envelope.operation];
    if (!operation) fail('COMMAND_SCHEMA_NOT_FOUND', { operation: envelope.operation });
    validate(operation, envelope.payload, '$.payload');
    return true;
  }
  return { validate: validate, validateCommand: validateCommand };
});
