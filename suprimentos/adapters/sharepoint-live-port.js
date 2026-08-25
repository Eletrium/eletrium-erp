(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sharepoint-graph-client'));
  else root.SuprimentosSharePointLivePort = factory(root.SuprimentosSharePointGraphClient);
})(typeof self !== 'undefined' ? self : this, function (graphFactory) {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; error.details = details; throw error; }
  function encode(value) { return encodeURIComponent(String(value)); }
  function typeOf(column) {
    var base;
    if (column.choice) base = 'Choice:' + (column.choice.choices || []).join('|');
    else if (column.number) base = column.number.decimalPlaces === 'none' ? 'Integer' : 'Number';
    else if (column.dateTime) base = 'DateTime';
    else if (column.text && column.text.allowMultipleLines === true) base = 'Note';
    else if (column.text) base = 'Text:' + Number(column.text.maxLength || 255);
    else if (column.boolean) base = 'Boolean';
    else if (column.lookup) base = 'Lookup';
    else return null;
    return base + ':' + (column.required === true ? 'required' : 'optional');
  }
  function fetchTransport(options) {
    options = options || {}; var baseUrl = String(options.baseUrl || 'https://graph.microsoft.com/v1.0').replace(/\/$/, '');
    var fetchFn = options.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) fail('FETCH_TRANSPORT_UNAVAILABLE');
    return { request: async function (input) {
      var response = await fetchFn(baseUrl + input.path, { method: input.method, headers: input.headers, body: input.body === undefined ? undefined : JSON.stringify(input.body) });
      var body = null, raw = await response.text();
      if (raw) { try { body = JSON.parse(raw); } catch (_) { body = { message: raw.slice(0, 1000) }; } }
      var headers = {}; if (response.headers && typeof response.headers.forEach === 'function') response.headers.forEach(function (value, key) { headers[key] = value; });
      return { status: response.status, headers: headers, body: body };
    } };
  }
  async function create(options) {
    options = options || {};
    if (!/^[A-Za-z0-9.-]+\.sharepoint\.com$/i.test(options.siteHost || '')) fail('SHAREPOINT_HOST_INVALID');
    if (!/^\/sites\/[A-Za-z0-9._-]+$/.test(options.sitePath || '')) fail('SHAREPOINT_SITE_PATH_INVALID');
    if (typeof options.credentialProvider !== 'function') fail('GRAPH_CREDENTIAL_PROVIDER_REQUIRED');
    if (options.policyAttestation === true && !(options.policy && options.policy.evidenceRef)) fail('POLICY_EVIDENCE_REF_REQUIRED');
    var transport = options.transport || fetchTransport(options);
    var common = { credentialProvider: options.credentialProvider, transport: transport, requestTimeoutMs: options.requestTimeoutMs, maxReadRetries: options.maxReadRetries, maxPages: options.maxPages, maxItems: options.maxItems, sleep: options.sleep };
    var resolver = graphFactory.create(Object.assign({}, common, { siteId: 'resolver', listIds: {} }));
    var site = await resolver.request({ method: 'GET', path: '/sites/' + encode(options.siteHost) + ':' + options.sitePath + '?$select=id,displayName,webUrl' });
    if (!site.id) fail('SHAREPOINT_SITE_NOT_FOUND');
    var discovery = await resolver.readAllPages('/sites/' + encode(site.id) + '/lists?$select=id,name,displayName');
    var target = options.targetLists || discovery.value.map(function (item) { return item.name || item.displayName; });
    var listIds = {}, missingLists = [];
    target.forEach(function (name) {
      var match = discovery.value.find(function (item) { return item.name === name || item.displayName === name; });
      if (match) listIds[name] = match.id; else missingLists.push(name);
    });
    var graph = graphFactory.create(Object.assign({}, common, { siteId: site.id, listIds: listIds }));
    var policy = options.policyAttestation === true ? (options.policy || {}) : {};

    async function captureSchema() {
      var lists = {};
      for (const name of Object.keys(listIds).sort()) {
        var columns = await graph.readAllPages('/sites/' + encode(site.id) + '/lists/' + encode(listIds[name]) + '/columns?$top=200');
        var fields = {}, indexed = [], unique = [];
        columns.value.forEach(function (column) {
          var definition = typeOf(column); if (definition) fields[column.name] = definition;
          if (column.indexed === true) indexed.push(column.name);
          if (column.enforceUniqueValues === true) unique.push(column.name);
        });
        var declared = (policy.lists || {})[name] || {};
        lists[name] = { fields: fields, indexed: indexed.sort(), unique: Array.from(new Set(unique.concat(declared.uniqueGuards || []))).sort(), appendOnly: declared.appendOnly === true, concurrencyField: declared.concurrencyField || null };
      }
      return { capturedAt: new Date().toISOString(), source: 'MICROSOFT_GRAPH_READONLY', site: { id: site.id, displayName: site.displayName || null, webUrl: site.webUrl || null }, missingLists: missingLists.slice(), writerPolicy: policy.writerPolicy || null, permissions: policy.permissions || {}, lists: lists };
    }
    async function probePagination() {
      var probes = [], complete = missingLists.length === 0;
      for (const name of Object.keys(listIds).sort()) {
        var page = await graph.query(name); probes.push({ list: name, complete: page.complete === true, pages: page.pages, records: page.value.length });
        if (page.complete !== true) complete = false;
      }
      return { complete: complete, missingLists: missingLists.slice(), pages: probes.reduce(function (sum, item) { return sum + item.pages; }, 0), records: probes.reduce(function (sum, item) { return sum + item.records; }, 0), probes: probes };
    }
    return { site: site, listIds: Object.assign({}, listIds), missingLists: missingLists.slice(), captureSchema: captureSchema, probePagination: probePagination };
  }
  return { create: create, fetchTransport: fetchTransport, typeOf: typeOf };
});
