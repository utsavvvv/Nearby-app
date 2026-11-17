// Runs before the page draws so a saved Light/Dark choice doesn't flash the wrong colours.
// (A separate file, not inline, so the Content-Security-Policy can forbid inline scripts.)
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('theme') || '"system"');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch { /* storage blocked: follow the system */ }
}());
