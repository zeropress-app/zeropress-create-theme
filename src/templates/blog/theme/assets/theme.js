const THEME_KEY = "zeropress-theme";
const SEARCH_ADAPTER_URL = "/_zeropress/search.js";
const SEARCH_LIMIT = 8;

document.documentElement.classList.add("js");

let searchAdapterPromise = null;

function getStorage(type) {
  try {
    return window[type];
  } catch {
    return null;
  }
}

const themeStorage = getStorage("localStorage");

function normalizePath(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  themeStorage?.setItem(THEME_KEY, theme);

  const toggle = document.querySelector("[data-theme-toggle]");
  if (!toggle) {
    return;
  }

  toggle.textContent = theme === "dark" ? "☀️" : "🌙";
  toggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
  );
}

function initThemeToggle() {
  const savedTheme = themeStorage?.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(savedTheme || (prefersDark ? "dark" : "light"));

  const toggle = document.querySelector("[data-theme-toggle]");
  if (!toggle || toggle.dataset.themeToggleReady === "true") {
    return;
  }

  toggle.dataset.themeToggleReady = "true";
  toggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    setTheme(currentTheme === "dark" ? "light" : "dark");
  });
}

function updateFeaturedPosts(root = document) {
  root.querySelectorAll(".post-list--home").forEach((list) => {
    const items = Array.from(list.children).filter((item) =>
      item.matches(".post-item, .post-list-item")
    );

    items.forEach((item) => item.classList.remove("is-featured"));

    const firstVisible = items.find((item) => !item.hidden);
    if (firstVisible) {
      firstVisible.classList.add("is-featured");
    }
  });
}

function initNavigationState() {
  const currentPath = normalizePath(window.location.pathname);

  document.querySelectorAll(".site-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") || href.includes(".xml")) {
      return;
    }

    const linkPath = normalizePath(new URL(href, window.location.origin).pathname);
    const isActive = linkPath === "/"
      ? currentPath === "/"
      : currentPath === linkPath || currentPath.startsWith(linkPath);

    link.classList.toggle("active", isActive);
  });
}

function initArticleContentLinks(root = document) {
  root.querySelectorAll(".article-content a[href]").forEach((link) => {
    if (link.dataset.articleLinkReady === "true") {
      return;
    }

    link.dataset.articleLinkReady = "true";

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#")) {
      return;
    }

    const targetUrl = new URL(href, window.location.href);
    if (targetUrl.origin !== window.location.origin) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer noopener");
    }
  });
}

function initNewsletterIsland(root = document) {
  const modal = root.querySelector("[data-newsletter-modal]");
  const openButtons = Array.from(root.querySelectorAll("[data-newsletter-open]"))
    .filter((element) => element instanceof HTMLButtonElement);

  if (!(modal instanceof HTMLElement) || openButtons.length === 0) {
    return;
  }

  if (modal.dataset.newsletterReady === "true") {
    return;
  }
  modal.dataset.newsletterReady = "true";

  const closeTargets = Array.from(modal.querySelectorAll("[data-newsletter-close]"));
  const closeButton = modal.querySelector(".newsletter-modal__close");
  let lastFocused = null;

  const openModal = (trigger) => {
    lastFocused = trigger instanceof HTMLElement ? trigger : document.activeElement;
    modal.hidden = false;
    document.documentElement.classList.add("newsletter-modal-open");

    if (closeButton instanceof HTMLButtonElement) {
      closeButton.focus();
    }
  };

  const closeModal = () => {
    modal.hidden = true;
    document.documentElement.classList.remove("newsletter-modal-open");

    if (lastFocused instanceof HTMLElement) {
      lastFocused.focus();
    }
  };

  openButtons.forEach((button) => {
    button.addEventListener("click", () => openModal(button));
  });

  closeTargets.forEach((target) => {
    target.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });
}

function loadSearchAdapter() {
  if (!searchAdapterPromise) {
    searchAdapterPromise = import(SEARCH_ADAPTER_URL);
  }

  return searchAdapterPromise;
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable
    || target.matches("input, textarea, select")
    || Boolean(target.closest("[contenteditable='true']"));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPlainText(value) {
  if (!value) {
    return "";
  }

  const template = document.createElement("template");
  template.innerHTML = String(value);
  return (template.content.textContent || "").trim();
}

function getSearchExcerpt(row) {
  return String(row?.plain_excerpt || "").trim() || toPlainText(row?.excerpt);
}

function tokenizeSearchQuery(query) {
  return Array.from(new Set(
    String(query || "")
      .toLowerCase()
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 2),
  ));
}

function highlightMatches(text, terms) {
  if (!text || !terms.length) {
    return escapeHtml(text || "");
  }

  const pattern = terms
    .slice()
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");

  return escapeHtml(text).replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

function normalizeSearchResultUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) {
      return null;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function initSearch() {
  const palette = document.querySelector("[data-cmdk]");
  if (!(palette instanceof HTMLElement) || palette.dataset.cmdkReady === "true") {
    return;
  }
  palette.dataset.cmdkReady = "true";

  const input = palette.querySelector("[data-cmdk-input]");
  const list = palette.querySelector("[data-cmdk-list]");
  const empty = palette.querySelector("[data-cmdk-empty]");
  if (!(input instanceof HTMLInputElement) || !(list instanceof HTMLElement) || !(empty instanceof HTMLElement)) {
    return;
  }

  const openButtons = Array.from(document.querySelectorAll("[data-cmdk-open]"))
    .filter((button) => button instanceof HTMLButtonElement);

  openButtons.forEach((button) => {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
  });

  let previousFocus = null;
  let renderTicket = 0;

  const setEmpty = (message) => {
    empty.textContent = message;
    empty.hidden = false;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const clearActive = () => {
    list.querySelectorAll("a").forEach((item) => {
      item.classList.remove("is-active");
      item.setAttribute("aria-selected", "false");
    });
    input.removeAttribute("aria-activedescendant");
  };

  const setActiveOption = (item) => {
    clearActive();
    if (!(item instanceof HTMLAnchorElement)) {
      return;
    }

    item.classList.add("is-active");
    item.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", item.id);
  };

  const renderResults = (rows, terms) => {
    list.replaceChildren();
    let firstResult = null;

    rows.forEach((row) => {
      const url = normalizeSearchResultUrl(row.url);
      if (!url) {
        return;
      }

      const item = document.createElement("li");
      item.setAttribute("role", "presentation");

      const link = document.createElement("a");
      link.href = url;
      link.className = "cmdk__result";
      link.id = `cmdk-option-${list.children.length}`;
      link.setAttribute("role", "option");
      link.setAttribute("aria-selected", "false");

      const title = row.meta?.title || url;
      const excerpt = getSearchExcerpt(row);
      link.innerHTML = `<span class="cmdk__result-title">${highlightMatches(title, terms)}</span>`
        + (excerpt
          ? `<span class="cmdk__result-excerpt">${highlightMatches(excerpt, terms)}</span>`
          : "");

      item.appendChild(link);
      list.appendChild(item);
      firstResult ||= link;
    });

    if (!firstResult) {
      setEmpty("No matches.");
      return;
    }

    empty.hidden = true;
    input.setAttribute("aria-expanded", "true");
    setActiveOption(firstResult);
  };

  const render = (query) => {
    const ticket = ++renderTicket;
    const normalizedQuery = String(query || "").trim();
    list.replaceChildren();

    if (!normalizedQuery) {
      setEmpty("Type to search.");
      return;
    }

    setEmpty("Searching...");
    const terms = tokenizeSearchQuery(normalizedQuery);

    loadSearchAdapter()
      .then((api) => api.search(normalizedQuery, { limit: SEARCH_LIMIT }))
      .then((searchResult) => Promise.all(
        (searchResult?.results || []).map((result) => result.data()),
      ))
      .then((rows) => {
        if (ticket !== renderTicket) {
          return;
        }

        renderResults(rows, terms);
      })
      .catch((error) => {
        if (ticket !== renderTicket) {
          return;
        }

        console.warn("[ZeroPress Search] Search is unavailable.", error);
        list.replaceChildren();
        setEmpty("Search index is unavailable.");
      });
  };

  const open = () => {
    if (palette.hidden) {
      previousFocus = document.activeElement;
    }

    palette.hidden = false;
    input.value = "";
    render("");
    window.setTimeout(() => input.focus(), 10);
  };

  const close = () => {
    palette.hidden = true;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus();
    }
    previousFocus = null;
  };

  openButtons.forEach((button) => {
    button.addEventListener("click", open);
  });

  palette.querySelectorAll("[data-cmdk-close]").forEach((element) => {
    element.addEventListener("click", close);
  });

  input.addEventListener("input", () => render(input.value));

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      palette.hidden ? open() : close();
      return;
    }

    if (event.key === "Escape" && !palette.hidden) {
      close();
      return;
    }

    if (!palette.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const items = Array.from(list.querySelectorAll("a"));
      if (!items.length) {
        return;
      }

      let index = items.findIndex((item) => item.classList.contains("is-active"));
      index = event.key === "ArrowDown"
        ? (index + 1) % items.length
        : (index - 1 + items.length) % items.length;
      setActiveOption(items[index]);
      items[index].scrollIntoView({ block: "nearest" });
      return;
    }

    if (!palette.hidden && event.key === "Enter") {
      const active = list.querySelector("a.is-active");
      if (active instanceof HTMLAnchorElement) {
        event.preventDefault();
        window.location.href = active.href;
      }
      return;
    }

    if (palette.hidden && event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!isEditableTarget(event.target)) {
        event.preventDefault();
        open();
      }
    }
  });
}

function applyPageEnhancements(root = document) {
  updateFeaturedPosts(root);
  initArticleContentLinks(root);
  initNewsletterIsland(root);
  initNavigationState();
  initSearch();
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  applyPageEnhancements(document);
});
