(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSharePointGraphClient = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function encode(value) { return encodeURIComponent(String(value)); }

  function create(options) {
    options = options || {};
    if (!options.siteId) fail('GRAPH_SITE_ID_REQUIRED');
    if (!options.listIds) fail('GRAPH_LIST_MAP_REQUIRED');
    if (!options.transport || typeof options.transport.request !== 'function') fail('GRAPH_TRANSPORT_REQUIRED');
    if (typeof options.credentialProvider !== 'function') fail('GRAPH_CREDENTIAL_PROVIDER_REQUIRED');
    var rootPath = '/sites/' + encode(options.siteId) + '/lists/';

    async function request(input) {
      var token = await options.credentialProvider();
      if (!token) fail('GRAPH_CREDENTIAL_UNAVAILABLE');
      var headers = Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/json' }, input.headers || {});
      var response = await options.transport.request(Object.assign({}, input, { headers: headers }));
      if (!response) fail('GRAPH_EMPTY_RESPONSE');
      if (response.status === 412) fail('ETAG_CONFLICT', response.body);
      if (response.status < 200 || response.status >= 300) fail('GRAPH_REQUEST_FAILED', { status: response.status, body: response.body });
      return response.body || {};
    }
    function listPath(name) {
      var listId = options.listIds[name];
      if (!listId) fail('GRAPH_LIST_ID_MISSING', name);
      return rootPath + encode(listId);
    }
    async function readAllPages(path) {
      var values = [], next = path, seen = {}, pages = 0;
      while (next) {
        if (seen[next]) fail('GRAPH_PAGINATION_CYCLE', next);
        seen[next] = true; pages += 1;
        var body = await request({ method: 'GET', path: next });
        if (!Array.isArray(body.value)) fail('GRAPH_PAGE_VALUE_REQUIRED', { path: next });
        values = values.concat(body.value);
        var continuation = body['@odata.nextLink'] || null;
        if (body.hasMore === true && !continuation) fail('GRAPH_NEXT_LINK_MISSING', { path: next, pages: pages });
        next = continuation;
      }
      return { complete: true, pages: pages, value: values };
    }
    async function query(name, filter) {
      var path = listPath(name) + '/items?expand=fields';
      if (filter) path += '&$filter=' + encode(filter);
      return readAllPages(path);
    }
    async function append(name, fields) {
      return request({ method: 'POST', path: listPath(name) + '/items', headers: { 'Content-Type': 'application/json' }, body: { fields: fields } });
    }
    async function conditionalUpdate(name, itemId, fields, etag) {
      if (!etag) fail('ETAG_REQUIRED', { list: name, itemId: itemId });
      return request({ method: 'PATCH', path: listPath(name) + '/items/' + encode(itemId) + '/fields', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: fields });
    }
    return { request: request, readAllPages: readAllPages, query: query, append: append, conditionalUpdate: conditionalUpdate };
  }
  return { create: create };
});
