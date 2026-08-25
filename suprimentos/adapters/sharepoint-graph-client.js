(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosSharePointGraphClient = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function fail(code, details) { var error = new Error(code); error.code = code; if (details !== undefined) error.details = details; throw error; }
  function encode(value) { return encodeURIComponent(String(value)); }
  function isRead(method) { return String(method || 'GET').toUpperCase() === 'GET'; }

  function create(options) {
    options = options || {};
    if (!options.siteId) fail('GRAPH_SITE_ID_REQUIRED');
    if (!options.listIds) fail('GRAPH_LIST_MAP_REQUIRED');
    if (!options.transport || typeof options.transport.request !== 'function') fail('GRAPH_TRANSPORT_REQUIRED');
    if (typeof options.credentialProvider !== 'function') fail('GRAPH_CREDENTIAL_PROVIDER_REQUIRED');
    var rootPath = '/sites/' + encode(options.siteId) + '/lists/';
    var requestTimeoutMs = Number(options.requestTimeoutMs || 15000);
    var maxReadRetries = Number(options.maxReadRetries === undefined ? 3 : options.maxReadRetries);
    var maxPages = Number(options.maxPages || 1000);
    var maxItems = Number(options.maxItems || 100000);
    var sleep = options.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) fail('GRAPH_TIMEOUT_INVALID');
    if (!Number.isInteger(maxReadRetries) || maxReadRetries < 0) fail('GRAPH_RETRY_LIMIT_INVALID');
    if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(maxItems) || maxItems < 1) fail('GRAPH_PAGE_LIMIT_INVALID');

    function normalizeContinuation(value) {
      if (!value) return null;
      var text = String(value);
      if (text.charAt(0) === '/') return text;
      var match = /^https:\/\/graph\.microsoft\.com\/(v1\.0|beta)(\/.*)$/i.exec(text);
      if (!match) fail('GRAPH_CONTINUATION_ORIGIN_REJECTED', { origin: text.split('?')[0] });
      return match[2];
    }
    function retryDelay(response, attempt) {
      var headers = response && response.headers || {};
      var retryAfter = Number(headers['retry-after'] || headers['Retry-After']);
      return Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : Math.min(30000, 250 * Math.pow(2, attempt));
    }
    function withTimeout(promise, method) {
      var timer;
      return Promise.race([
        promise,
        new Promise(function (_, reject) {
          timer = setTimeout(function () {
            var error = new Error(isRead(method) ? 'GRAPH_READ_TIMEOUT' : 'GRAPH_WRITE_EFFECT_UNKNOWN');
            error.code = error.message; error.effectUnknown = !isRead(method); error.retryable = isRead(method); reject(error);
          }, requestTimeoutMs);
        })
      ]).finally(function () { clearTimeout(timer); });
    }

    async function request(input) {
      var token = await options.credentialProvider();
      if (!token) fail('GRAPH_CREDENTIAL_UNAVAILABLE');
      var headers = Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/json' }, input.headers || {});
      var attempt = 0;
      while (true) {
        var response;
        try { response = await withTimeout(Promise.resolve(options.transport.request(Object.assign({}, input, { headers: headers }))), input.method); }
        catch (error) {
          if (isRead(input.method) && attempt < maxReadRetries) { await sleep(retryDelay(null, attempt)); attempt += 1; continue; }
          if (!isRead(input.method) && !error.effectUnknown) { error.effectUnknown = true; error.code = error.code || 'GRAPH_WRITE_EFFECT_UNKNOWN'; }
          throw error;
        }
        if (!response) fail('GRAPH_EMPTY_RESPONSE');
        if (response.status === 412) fail('ETAG_CONFLICT', response.body);
        if (isRead(input.method) && [429, 502, 503, 504].indexOf(response.status) !== -1 && attempt < maxReadRetries) {
          await sleep(retryDelay(response, attempt)); attempt += 1; continue;
        }
        if (response.status < 200 || response.status >= 300) fail('GRAPH_REQUEST_FAILED', { status: response.status, body: response.body });
        return response.body || {};
      }
    }
    function listPath(name) {
      var listId = options.listIds[name];
      if (!listId) fail('GRAPH_LIST_ID_MISSING', name);
      return rootPath + encode(listId);
    }
    async function readAllPages(path) {
      var values = [], next = path, seen = {}, pages = 0;
      while (next) {
        next = normalizeContinuation(next);
        if (seen[next]) fail('GRAPH_PAGINATION_CYCLE', next);
        seen[next] = true; pages += 1;
        if (pages > maxPages) fail('GRAPH_PAGE_LIMIT_EXCEEDED', { maxPages: maxPages });
        var body = await request({ method: 'GET', path: next });
        if (!Array.isArray(body.value)) fail('GRAPH_PAGE_VALUE_REQUIRED', { path: next });
        values = values.concat(body.value);
        if (values.length > maxItems) fail('GRAPH_ITEM_LIMIT_EXCEEDED', { maxItems: maxItems, received: values.length });
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
