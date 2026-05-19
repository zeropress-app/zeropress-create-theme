const THEME_KEY = "zeropress-theme";

document.documentElement.classList.add("js");

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

function parsePositiveInteger(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return 0;
  }

  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    return 0;
  }

  const parsed = Number.parseInt(normalizedValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

function parseCommentPostPublicId(element) {
  if (!(element instanceof HTMLElement)) {
    return 0;
  }

  return parsePositiveInteger(element.dataset.zpCommentsPost || "");
}

function buildCommentTree(comments) {
  const map = new Map();
  const roots = [];

  comments.forEach((comment) => {
    map.set(comment.id, {
      ...comment,
      children: [],
    });
  });

  comments.forEach((comment) => {
    const node = map.get(comment.id);
    if (!node) {
      return;
    }

    if (comment.parent_id && map.has(comment.parent_id)) {
      map.get(comment.parent_id).children.push(node);
      return;
    }

    roots.push(node);
  });

  return roots;
}

function reportCommentsContractError(message, details = "") {
  console.error("[ZeroPress Comments]", message, details);
}

function getCommentInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getCommentTemplate(scope, attribute, label) {
  const template = scope.querySelector(`template[${attribute}]`);
  if (!(template instanceof HTMLTemplateElement)) {
    reportCommentsContractError(`Missing required ${label} template.`, attribute);
    return null;
  }

  return template;
}

function resolveCommentsTemplates(mount) {
  const scope = mount.closest(".comments-block");
  if (!(scope instanceof HTMLElement)) {
    reportCommentsContractError("Comments mount is missing a .comments-block scope.");
    return null;
  }

  const shell = getCommentTemplate(scope, "data-zp-comments-shell", "comments shell");
  const form = getCommentTemplate(scope, "data-zp-comments-form", "comments form");
  const replyForm = getCommentTemplate(scope, "data-zp-comment-reply-form", "comment reply form");
  const item = getCommentTemplate(scope, "data-zp-comment-item", "comment item");
  const empty = getCommentTemplate(scope, "data-zp-comments-empty", "comments empty state");
  const error = getCommentTemplate(scope, "data-zp-comment-error", "comment error state");
  const success = getCommentTemplate(scope, "data-zp-comment-success", "comment success state");

  if (!shell || !form || !replyForm || !item || !empty || !error || !success) {
    return null;
  }

  return { shell, form, replyForm, item, empty, error, success };
}

function cloneTemplateFragment(template) {
  return template.content.cloneNode(true);
}

function getCommentRole(container, role) {
  const target = container.querySelector(`[data-role="${role}"]`);
  return target instanceof HTMLElement ? target : null;
}

function getRequiredCommentRole(container, role, contextLabel) {
  const target = getCommentRole(container, role);
  if (!target) {
    reportCommentsContractError(`Missing required ${role} role in ${contextLabel}.`);
    return null;
  }

  return target;
}

function validateCommentFormFragment(fragment, options = {}) {
  const { parentId = "" } = options;
  const form = fragment.querySelector("[data-zp-comment-form]");
  if (!(form instanceof HTMLFormElement)) {
    reportCommentsContractError("Comments form template must contain <form data-zp-comment-form>.");
    return null;
  }

  const requiredFieldNames = [
    "author_name",
    "author_email",
    "content",
    "parent_id",
    "website",
  ];

  for (const name of requiredFieldNames) {
    const field = form.querySelector(`[name="${name}"]`);
    if (!(field instanceof HTMLElement)) {
      reportCommentsContractError(`Comments form template is missing required field: ${name}.`);
      return null;
    }
  }

  const parentIdField = form.querySelector('[name="parent_id"]');
  if (parentIdField instanceof HTMLInputElement) {
    parentIdField.value = parentId;
  }

  return form;
}

function createCommentFeedbackFragment(templates, errors, successMessage) {
  const fragment = document.createDocumentFragment();

  if (Array.isArray(errors) && errors.length > 0) {
    errors.forEach((errorMessage) => {
      const errorFragment = cloneTemplateFragment(templates.error);
      const messageTarget = getRequiredCommentRole(errorFragment, "message", "comment error template");
      if (!messageTarget) {
        return;
      }

      messageTarget.textContent = String(errorMessage || "");
      fragment.append(errorFragment);
    });
    return fragment;
  }

  if (successMessage) {
    const successFragment = cloneTemplateFragment(templates.success);
    const messageTarget = getRequiredCommentRole(successFragment, "message", "comment success template");
    if (!messageTarget) {
      return fragment;
    }

    messageTarget.textContent = successMessage;
    fragment.append(successFragment);
  }

  return fragment;
}

function createReplyFormFragment(node, templates) {
  const fragment = cloneTemplateFragment(templates.replyForm);
  const form = validateCommentFormFragment(fragment, {
    parentId: String(node.id || ""),
  });

  if (!form) {
    return null;
  }

  return fragment;
}

function createCommentItemFragment(node, templates, replyState) {
  const fragment = cloneTemplateFragment(templates.item);
  const authorTarget = getRequiredCommentRole(fragment, "author", "comment item template");
  const dateTarget = getRequiredCommentRole(fragment, "date", "comment item template");
  const contentTarget = getRequiredCommentRole(fragment, "content", "comment item template");
  const replyFormTarget = getRequiredCommentRole(fragment, "reply-form", "comment item template");
  const repliesTarget = getRequiredCommentRole(fragment, "replies", "comment item template");

  if (!authorTarget || !dateTarget || !contentTarget || !replyFormTarget || !repliesTarget) {
    return null;
  }

  authorTarget.textContent = String(node.author_name || "");
  dateTarget.textContent = String(node.created_at || "");
  if (dateTarget instanceof HTMLTimeElement) {
    dateTarget.dateTime = String(node.created_at || "");
  }

  contentTarget.textContent = String(node.content || "");

  const avatarTarget = getCommentRole(fragment, "avatar");
  if (avatarTarget) {
    avatarTarget.textContent = getCommentInitials(node.author_name);
  }

  const itemRoot = fragment.querySelector('[data-role="comment-item"]');
  if (itemRoot instanceof HTMLElement) {
    itemRoot.dataset.commentId = String(node.id || "");
  }

  const replyButton = fragment.querySelector('[data-action="reply"]');
  if (replyButton instanceof HTMLButtonElement) {
    const isReplyOpen = replyState.activeCommentId === String(node.id || "");
    replyButton.dataset.replyCommentId = String(node.id || "");
    replyButton.dataset.replyOpen = isReplyOpen ? "true" : "false";
    replyButton.textContent = isReplyOpen ? "Cancel" : "Reply";
    replyButton.setAttribute("aria-expanded", isReplyOpen ? "true" : "false");
  }

  if (replyState.activeCommentId === String(node.id || "")) {
    const replyFormFragment = createReplyFormFragment(node, templates);
    if (replyFormFragment) {
      replyFormTarget.append(replyFormFragment);
    }
  }

  if (Array.isArray(node.children) && node.children.length > 0) {
    node.children.forEach((childNode) => {
      const childFragment = createCommentItemFragment(childNode, templates, replyState);
      if (childFragment) {
        repliesTarget.append(childFragment);
      }
    });
  }

  return fragment;
}

function createCommentListFragment(comments, templates, replyState) {
  if (!Array.isArray(comments) || comments.length === 0) {
    return cloneTemplateFragment(templates.empty);
  }

  const fragment = document.createDocumentFragment();
  buildCommentTree(comments).forEach((rootNode) => {
    const itemFragment = createCommentItemFragment(rootNode, templates, replyState);
    if (itemFragment) {
      fragment.append(itemFragment);
    }
  });

  return fragment;
}

function createCommentsShellFragment(templates, options) {
  const {
    comments,
    errors = [],
    successMessage = "",
    showForm = true,
    showList = true,
    replyState = { activeCommentId: null },
  } = options;

  const shellFragment = cloneTemplateFragment(templates.shell);
  const feedbackTarget = getRequiredCommentRole(shellFragment, "feedback", "comments shell template");
  const formTarget = getRequiredCommentRole(shellFragment, "form", "comments shell template");
  const listTarget = getRequiredCommentRole(shellFragment, "list", "comments shell template");

  if (!feedbackTarget || !formTarget || !listTarget) {
    return null;
  }

  const countTarget = getCommentRole(shellFragment, "count");
  if (countTarget) {
    countTarget.textContent = String(Array.isArray(comments) ? comments.length : 0);
  }

  feedbackTarget.replaceChildren(createCommentFeedbackFragment(templates, errors, successMessage));

  if (showForm) {
    const formFragment = cloneTemplateFragment(templates.form);
    const form = validateCommentFormFragment(formFragment, {
      parentId: "",
    });
    if (!form) {
      return null;
    }
    formTarget.replaceChildren(formFragment);
  } else {
    formTarget.replaceChildren();
  }

  if (showList) {
    listTarget.replaceChildren(createCommentListFragment(comments, templates, replyState));
  } else {
    listTarget.replaceChildren();
  }
  return shellFragment;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getCommentsEndpoint(publicId) {
  return `/api/comments?post=${encodeURIComponent(String(publicId))}`;
}

function initComments(root = document) {
  const mounts = Array.from(root.querySelectorAll("[data-zp-comments]"))
    .filter((element) => element instanceof HTMLElement)
    .filter((element) => element.dataset.commentsReady !== "true");

  if (mounts.length === 0) {
    return;
  }

  mounts.forEach((mount) => {
    mount.dataset.commentsReady = "true";
    const publicId = parseCommentPostPublicId(mount);
    if (!publicId) {
      return;
    }

    const templates = resolveCommentsTemplates(mount);
    if (!templates) {
      mount.hidden = true;
      mount.replaceChildren();
      return;
    }

    let currentComments = [];
    const replyState = {
      activeCommentId: null,
    };

    const focusReplyForm = (commentId) => {
      if (!commentId) {
        return;
      }

      const commentItems = Array.from(mount.querySelectorAll('[data-role="comment-item"]'))
        .filter((element) => element instanceof HTMLElement);
      const targetItem = commentItems.find((element) => element.dataset.commentId === commentId);
      if (!(targetItem instanceof HTMLElement)) {
        return;
      }

      const textarea = targetItem.querySelector('.zp-comment__reply-slot textarea[name="content"]');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
      }
    };

    const renderLoadedState = (options = {}) => {
      const {
        errors = [],
        successMessage = "",
        focusReplyCommentId = "",
      } = options;
      const shellFragment = createCommentsShellFragment(templates, {
        comments: currentComments,
        errors,
        successMessage,
        showForm: true,
        replyState,
      });
      if (!shellFragment) {
        mount.hidden = true;
        mount.replaceChildren();
        return;
      }

      mount.replaceChildren(shellFragment);
      mount.hidden = false;
      bindCommentInteractions();

      if (focusReplyCommentId) {
        queueMicrotask(() => {
          focusReplyForm(focusReplyCommentId);
        });
      }
    };

    const renderErrorState = (message) => {
      const shellFragment = createCommentsShellFragment(templates, {
        comments: [],
        errors: [message],
        showForm: false,
        showList: false,
      });
      if (!shellFragment) {
        mount.hidden = true;
        mount.replaceChildren();
        return;
      }

      mount.replaceChildren(shellFragment);
      mount.hidden = false;
    };

    const loadComments = async (options = {}) => {
      const response = await fetch(getCommentsEndpoint(publicId), {
        headers: {
          Accept: "application/json",
        },
      });
      const payload = await readJsonResponse(response);

      if (!response.ok || !payload?.ok) {
        renderErrorState(payload?.message || "Comments are temporarily unavailable.");
        return;
      }

      currentComments = Array.isArray(payload.comments) ? payload.comments : [];
      if (
        replyState.activeCommentId &&
        !currentComments.some((comment) => String(comment.id || "") === replyState.activeCommentId)
      ) {
        replyState.activeCommentId = null;
      }
      renderLoadedState({
        successMessage: options.successMessage || "",
      });
    };

    const bindCommentInteractions = () => {
      const replyButtons = Array.from(mount.querySelectorAll('[data-action="reply"]'))
        .filter((element) => element instanceof HTMLButtonElement);

      replyButtons.forEach((button) => {
        if (button.dataset.replyReady === "true") {
          return;
        }

        button.dataset.replyReady = "true";
        button.addEventListener("click", () => {
          const commentId = String(button.dataset.replyCommentId || "");
          if (!commentId) {
            return;
          }

          const isAlreadyOpen = replyState.activeCommentId === commentId;
          replyState.activeCommentId = isAlreadyOpen ? null : commentId;
          renderLoadedState({
            focusReplyCommentId: isAlreadyOpen ? "" : commentId,
          });
        });
      });

      const cancelButtons = Array.from(mount.querySelectorAll('[data-action="cancel-reply"]'))
        .filter((element) => element instanceof HTMLButtonElement);

      cancelButtons.forEach((button) => {
        if (button.dataset.cancelReplyReady === "true") {
          return;
        }

        button.dataset.cancelReplyReady = "true";
        button.addEventListener("click", () => {
          replyState.activeCommentId = null;
          renderLoadedState();
        });
      });

      const forms = Array.from(mount.querySelectorAll("[data-zp-comment-form]"))
        .filter((element) => element instanceof HTMLFormElement);

      forms.forEach((form) => {
        if (form.dataset.commentFormReady === "true") {
          return;
        }

        form.dataset.commentFormReady = "true";
        form.addEventListener("submit", async (event) => {
          event.preventDefault();

          const parentIdField = form.querySelector('[name="parent_id"]');
          const parentId = parentIdField instanceof HTMLInputElement ? parentIdField.value.trim() : "";

          const response = await fetch(getCommentsEndpoint(publicId), {
            method: "POST",
            headers: {
              Accept: "application/json",
            },
            body: new FormData(form),
          });
          const payload = await readJsonResponse(response);

          if (!response.ok || !payload?.ok) {
            replyState.activeCommentId = parentId || null;
            renderLoadedState({
              errors: Array.isArray(payload?.errors) && payload.errors.length > 0
                ? payload.errors
                : [payload?.message || "Something went wrong. Please try again."],
              focusReplyCommentId: parentId,
            });
            return;
          }

          replyState.activeCommentId = null;

          if (payload.requires_approval === false) {
            await loadComments({
              successMessage: payload.message || "Your comment has been posted.",
            });
            return;
          }

          renderLoadedState({
            successMessage: payload.message || "Your comment has been submitted and is awaiting moderation.",
          });
        });
      });
    };

    void loadComments();
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

function applyPageEnhancements(root = document) {
  updateFeaturedPosts(root);
  initComments(root);
  initArticleContentLinks(root);
  initNavigationState();
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  applyPageEnhancements(document);
});
