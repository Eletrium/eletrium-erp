(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SuprimentosObservability = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function create(options) {
    options = options || {};
    var events = [];
    var sink = typeof options.sink === 'function' ? options.sink : function () {};
    function emit(level, name, context) {
      context = context || {};
      var event = {
        timestamp: (options.clock || function () { return new Date().toISOString(); })(),
        level: level, name: name, operation: context.operation || null,
        correlationId: context.correlationId || null, commandId: context.commandId || null,
        actorId: context.actorId || null, durationMs: context.durationMs === undefined ? null : context.durationMs,
        errorCode: context.errorCode || null, replayed: !!context.replayed
      };
      events.push(event); sink(copy(event)); return copy(event);
    }
    function snapshot() {
      var counters = {};
      events.forEach(function (event) {
        var key = event.name + (event.operation ? ':' + event.operation : '');
        counters[key] = (counters[key] || 0) + 1;
      });
      return { events: copy(events), counters: counters, failures: events.filter(function (event) { return event.level === 'ERROR'; }).length };
    }
    return { emit: emit, snapshot: snapshot };
  }
  return { create: create };
});
