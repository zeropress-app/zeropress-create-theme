/* The Margin — progressive enhancement */
(function () {
  var KEY = "margin-theme";
  var root = document.documentElement;

  function apply(t) {
    root.setAttribute("data-theme", t);
    if (t === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem(KEY, t); } catch (e) {}
  }
  function current() { return root.getAttribute("data-theme") || "light"; }

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    apply(current() === "dark" ? "light" : "dark");
  });

  var bar = document.querySelector("[data-reading-progress] span");
  if (bar) {
    var update = function () {
      var doc = document.documentElement;
      var scrolled = doc.scrollTop || document.body.scrollTop;
      var max = doc.scrollHeight - doc.clientHeight;
      var pct = max > 0 ? Math.min(100, (scrolled / max) * 100) : 0;
      bar.style.width = pct + "%";
    };
    document.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }
})();
