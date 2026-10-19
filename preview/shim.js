// Preview only: answers /api/* inside the browser so the site and dashboard work with no server.
// Loaded before gate.js; the real backend module resolves the promise once it has seeded the demo store.
(function () {
  var orig = window.fetch.bind(window);
  var resolveBackend;
  var backend = new Promise(function (r) { resolveBackend = r; });
  window.__rfBackendReady = function (b) { resolveBackend(b); };
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var u = new URL(url, location.href);
    // Compare hosts, not origins: inside a sandboxed frame location.origin can be "null".
    var local = (typeof url === 'string' && url.charAt(0) === '/') || u.host === location.host;
    if (local && u.pathname.indexOf('/api/') !== -1) return backend.then(function (b) { return b.handle(u, init || {}); });
    return orig(input, init);
  };
})();
