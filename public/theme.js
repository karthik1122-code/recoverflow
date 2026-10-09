// Runs before first paint so the page never flashes the wrong theme.
(function () {
  try {
    var saved = localStorage.getItem('rf-theme');
    var theme = saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* storage blocked: keep default */ }
})();
