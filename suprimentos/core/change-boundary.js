(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosChangeBoundary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEFAULT_PROTECTED = Object.freeze([
    'inbound.html', 'reaquecimento.html', 'os.html', 'outbox.js', 'suprimentos.html', 'graph.js'
  ]);
  function normalize(path) { return String(path || '').replace(/\\/g, '/').replace(/^\.\//, ''); }
  function evaluate(paths, protectedPaths) {
    var protectedSet = new Set((protectedPaths || DEFAULT_PROTECTED).map(normalize));
    var changed = Array.from(new Set((paths || []).map(normalize).filter(Boolean))).sort();
    var violations = changed.filter(function (path) { return protectedSet.has(path); });
    var allowed = changed.filter(function (path) { return !protectedSet.has(path); });
    return { ok: violations.length === 0, changed: changed, violations: violations, allowed: allowed };
  }
  return { DEFAULT_PROTECTED: DEFAULT_PROTECTED, normalize: normalize, evaluate: evaluate };
});
