(function () {
  'use strict';

  // ===== Dark mode toggle =====
  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var isDark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('loomis-theme', isDark ? 'dark' : 'light'); } catch (e) {}
    });
  });

  // ===== Sidebar active link =====
  var path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.sidebar__link').forEach(function (a) {
    var href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/';
    if (href === path) {
      a.classList.add('is-active');
      a.setAttribute('aria-current', 'page');
    }
  });

  // ===== Mobile nav close on link click =====
  var navToggle = document.getElementById('nav-toggle');
  if (navToggle) {
    document.querySelectorAll('.sidebar a').forEach(function (a) {
      a.addEventListener('click', function () { navToggle.checked = false; });
    });
  }

  // ===== Code copy buttons =====
  document.querySelectorAll('pre > code, .code-block__code').forEach(function (code) {
    var host = code.closest('.code-block') || code.parentElement;
    if (!host || host.querySelector(':scope > .copy-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'copy-btn'; btn.textContent = 'Copy';
    btn.addEventListener('click', function () {
      var text = code.innerText;
      if (!navigator.clipboard) { btn.textContent = 'Unavailable'; return; }
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      });
    });
    host.style.position = host.style.position || 'relative';
    host.appendChild(btn);
  });

  // ===== HTML document TOC progressive enhancement =====
  document.querySelectorAll('[data-enhance-toc]').forEach(function (toc) {
    var article = toc.closest('.article-grid') || document;
    var headings = Array.prototype.slice.call(article.querySelectorAll('.prose h2[id], .prose h3[id], .prose h4[id]'));
    if (!headings.length) return;

    var title = document.createElement('p');
    title.className = 'toc__title';
    title.textContent = 'On this page';

    var nav = document.createElement('nav');
    var listEl = document.createElement('ul');

    headings.forEach(function (heading) {
      var level = Number((heading.tagName || '').replace('H', '')) || 2;
      var item = document.createElement('li');
      var link = document.createElement('a');
      item.className = 'toc__item toc__item--level-' + level;
      link.href = '#' + heading.id;
      link.setAttribute('data-toc-link', '');
      link.textContent = heading.textContent.trim();
      item.appendChild(link);
      listEl.appendChild(item);
    });

    nav.appendChild(listEl);
    toc.appendChild(title);
    toc.appendChild(nav);
    toc.hidden = false;
  });

  // ===== TOC active section =====
  var tocLinks = document.querySelectorAll('[data-toc-link]');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var headings = [];
    tocLinks.forEach(function (link) {
      var id = (link.getAttribute('href') || '').replace('#', '');
      var el = id && document.getElementById(id);
      if (el) headings.push({ el: el, link: link });
    });
    var setActive = function (id) {
      tocLinks.forEach(function (l) {
        var li = l.parentElement;
        var match = (l.getAttribute('href') || '') === '#' + id;
        l.classList.toggle('is-active', match);
        if (li) li.classList.toggle('is-active', match);
      });
    };
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });
    headings.forEach(function (h) { observer.observe(h.el); });
  }

  // ===== Command palette =====
  var palette = document.querySelector('[data-cmdk]');
  if (!palette) return;
  var input = palette.querySelector('[data-cmdk-input]');
  var list = palette.querySelector('[data-cmdk-list]');
  var empty = palette.querySelector('[data-cmdk-empty]');
  var indexNode = palette.querySelector('[data-cmdk-index]');
  var data = { groups: [] };
  try { data = JSON.parse(indexNode.textContent); } catch (e) {}

  function render(query) {
    var q = (query || '').trim().toLowerCase();
    list.innerHTML = '';
    var matches = 0;
    data.groups.forEach(function (group) {
      var items = group.items.filter(function (it) {
        return !q || it.title.toLowerCase().indexOf(q) !== -1 || (it.url || '').toLowerCase().indexOf(q) !== -1;
      });
      if (!items.length) return;
      var header = document.createElement('li');
      header.className = 'cmdk__group';
      header.textContent = group.label;
      list.appendChild(header);
      items.forEach(function (it) {
        matches++;
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = it.url;
        a.textContent = it.title;
        li.appendChild(a);
        list.appendChild(li);
      });
    });
    empty.hidden = matches > 0;
    var first = list.querySelector('a');
    if (first) first.classList.add('is-active');
  }

  function open() {
    palette.hidden = false;
    render('');
    if (input) { input.value = ''; setTimeout(function () { input.focus(); }, 10); }
  }
  function close() { palette.hidden = true; }

  document.querySelectorAll('[data-cmdk-open]').forEach(function (btn) {
    btn.addEventListener('click', open);
  });
  palette.querySelectorAll('[data-cmdk-close]').forEach(function (el) {
    el.addEventListener('click', close);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.hidden ? open() : close();
    } else if (e.key === 'Escape' && !palette.hidden) {
      close();
    } else if (!palette.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      var items = Array.prototype.slice.call(list.querySelectorAll('a'));
      if (!items.length) return;
      var idx = items.findIndex(function (i) { return i.classList.contains('is-active'); });
      items.forEach(function (i) { i.classList.remove('is-active'); });
      idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[idx].classList.add('is-active');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (!palette.hidden && e.key === 'Enter') {
      var active = list.querySelector('a.is-active');
      if (active) { e.preventDefault(); window.location.href = active.href; }
    }
  });

  if (input) input.addEventListener('input', function () { render(input.value); });
})();
