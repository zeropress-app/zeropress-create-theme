// Mock comments for the minimal2 POC theme.
// Keyed by post.public_id. Persisted in localStorage so the demo feels live.
const MOCK_COMMENTS = {
  "3001": [
    { id: "c1", name: "Mina", body: "Loved the rhythm between serif body and sans headings. Very readable.", createdAt: "2026-05-11T10:00:00Z" },
    { id: "c2", name: "Theo", body: "The blockquote treatment is especially nice in dark mode.", createdAt: "2026-05-11T14:30:00Z" }
  ],
  "3002": [
    { id: "c1", name: "Sam", body: "Cutting the merely-good lines is the hardest part.", createdAt: "2026-05-08T08:30:00Z" }
  ],
  "3003": [
    { id: "c1", name: "Priya", body: "I keep coming back to plain text files too. They outlive every app.", createdAt: "2026-05-04T11:10:00Z" }
  ]
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHTML(value) {
  return String(value == null ? "" : value).replace(/[&<>"]/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  }[ch]));
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

function initialOf(name) {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

function initComments() {
  $$("[data-comments-root]").forEach((root) => {
    const postId = root.dataset.commentsPost;
    if (!postId) return;
    const storageKey = "zp-min2-comments:" + postId;
    let comments;
    try {
      const saved = localStorage.getItem(storageKey);
      comments = saved ? JSON.parse(saved) : (MOCK_COMMENTS[postId] || []);
    } catch {
      comments = MOCK_COMMENTS[postId] || [];
    }

    const list = $("[data-comments-list]", root);
    const count = $("[data-comments-count]", root);
    const form = $("[data-comment-form]", root);

    const save = () => {
      try { localStorage.setItem(storageKey, JSON.stringify(comments)); } catch {}
    };

    function render() {
      if (count) count.textContent = "(" + comments.length + ")";
      if (!list) return;
      if (!comments.length) {
        list.innerHTML = '<li class="comments__empty">No comments yet. Be the first to write something.</li>';
        return;
      }
      list.innerHTML = comments.map((c) => `
        <li class="comment">
          <div class="comment__head">
            <span class="comment__avatar" aria-hidden="true">${escapeHTML(initialOf(c.name))}</span>
            <span class="comment__author">${escapeHTML(c.name)}</span>
            <time class="comment__date" datetime="${escapeHTML(c.createdAt)}">${escapeHTML(formatDate(c.createdAt))}</time>
          </div>
          <p class="comment__body">${escapeHTML(c.body)}</p>
        </li>
      `).join("");
    }

    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        const body = String(fd.get("body") || "").trim();
        if (!body) return;
        const name = String(fd.get("name") || "").trim() || "Anonymous";
        comments.push({
          id: "local-" + Date.now(),
          name,
          body,
          createdAt: new Date().toISOString()
        });
        save();
        form.reset();
        render();
      });
    }

    render();
  });
}

initComments();
