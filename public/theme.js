// Runs before first paint so the page never flashes the wrong theme.
// A saved choice wins; otherwise follow the system setting.
(function () {
  var theme = 'light';
  // A host page (or the reader's explicit choice) may already have set the theme; keep it.
  var preset = document.documentElement.getAttribute('data-theme');
  if (preset === 'light' || preset === 'dark') { theme = preset; }
  else try {
    var saved = localStorage.getItem('rf-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
  } catch (e) { /* storage blocked: keep default */ }
  document.documentElement.setAttribute('data-theme', theme);
  window.rfToggleTheme = function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('rf-theme', next); } catch (e) { /* ignore */ }
    return next;
  };
})();
