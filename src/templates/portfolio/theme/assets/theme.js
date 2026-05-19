(function () {
  var KEY = "portfolio2-theme";

  function normalizePath(value) {
    try {
      var url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin) return "";
      return url.pathname.replace(/\/$/, "") || "/";
    } catch (error) {
      return "";
    }
  }

  var currentPath = normalizePath(window.location.pathname);
  document.querySelectorAll(".legal-side__list a, .legal-nav a, .primary-nav a").forEach(function (link) {
    var href = normalizePath(link.getAttribute("href") || "");
    if (href && href === currentPath) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
  });

  var btn = document.querySelector("[data-theme-toggle]");
  if (!btn) return;

  function apply(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(KEY, t); } catch (e) {}
  }
  btn.addEventListener("click", function () {
    var current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    apply(current === "dark" ? "light" : "dark");
  });
})();
