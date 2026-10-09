// Runs before first paint so the page never flashes the wrong theme.
(function () {
  try {
    var saved = localStorage.getItem('rf-theme');
    var theme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* storage blocked: keep default */ }
})();
