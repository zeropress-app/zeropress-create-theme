import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { runBuild } from '@zeropress/build';
import { JSDOM } from 'jsdom';

const themeSource = await fs.readFile(new URL('../../src/templates/blog/theme/assets/theme.js', import.meta.url), 'utf8');
const redirectSource = await fs.readFile(new URL('../../src/templates/blog/theme/assets/legacy-wp-query-redirect.js', import.meta.url), 'utf8');

function redirect({ pattern = '/posts/:public_id', outputStyle = 'directory', query = '?p=42', pathname = '/', hash = '#comments' } = {}) {
  const destinations = [];
  vm.runInNewContext(redirectSource, {
    document: { currentScript: { dataset: { postPath: pattern, outputStyle } } },
    window: { location: { pathname, search: query, hash, replace: destination => destinations.push(destination) } },
    URLSearchParams,
  }, { filename: 'legacy-wp-query-redirect.js' });
  return destinations;
}

test('legacy WordPress redirect uses directory or extensionless public URLs and preserves fragments', () => {
  assert.deepEqual(redirect(), ['/posts/42/#comments']);
  assert.deepEqual(redirect({ outputStyle: 'html-extension' }), ['/posts/42#comments']);
  assert.deepEqual(redirect({ pattern: '/writing/:public_id/' }), ['/writing/42/#comments']);
  assert.deepEqual(redirect({ pattern: '/writing/:public_id/', outputStyle: 'html-extension' }), ['/writing/42#comments']);
});

test('legacy WordPress redirect leaves URLs requiring unavailable post data unchanged', () => {
  for (const pattern of ['/posts/:year/:public_id', '/:year/:month/:day/:public_id', '/:slug/:public_id', '/:slug']) {
    assert.deepEqual(redirect({ pattern }), [], pattern);
  }
});

test('legacy WordPress redirect only handles positive IDs on the home page with a supported output style', () => {
  for (const query of ['', '?p=', '?p=0', '?p=-1', '?p=01', '?p=hello', '?p=42.5']) {
    assert.deepEqual(redirect({ query }), [], query);
  }
  assert.deepEqual(redirect({ pathname: '/about/' }), []);
  assert.deepEqual(redirect({ outputStyle: 'unknown' }), []);
});

test('blog renders site date settings and redirects to the same public URLs as the build', async () => {
  const templateRoot = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
  const data = JSON.parse(await fs.readFile(path.join(templateRoot, 'zeropress-preview-data.json'), 'utf8'));
  data.site.date_style = 'full';
  data.site.time_style = 'short';
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-blog-runtime-'));
  try {
    for (const outputStyle of ['directory', 'html-extension']) {
      data.site.permalinks = { posts: '/writing/:public_id', output_style: outputStyle };
      const output = path.join(temporaryRoot, outputStyle);
      await runBuild(path.join(templateRoot, 'theme'), structuredClone(data), output, {
        publicDir: path.join(templateRoot, 'public'),
        projectRoot: temporaryRoot,
      });
      const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
      assert.match(html, /data-zp-date-style="full" data-zp-time-style="short"/);
      const pattern = html.match(/data-post-path="([^"]+)"/)?.[1];
      const style = html.match(/data-output-style="([^"]+)"/)?.[1];
      assert.equal(pattern, data.site.permalinks.posts);
      assert.equal(style, outputStyle);
      const [destination] = redirect({
        pattern,
        outputStyle: style,
        query: `?p=${data.content.posts[0].public_id}`,
        hash: '',
      });
      const postLink = html.match(/<h2><a href="([^"]+)"/)?.[1];
      assert.equal(destination, postLink);
      const outputPath = outputStyle === 'directory'
        ? `${destination.slice(1)}index.html`
        : `${destination.slice(1)}.html`;
      await fs.access(path.join(output, outputPath));
    }
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('blog shares sidebar widgets across listings, posts with or without a TOC, and pages', async t => {
  const templateRoot = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
  const data = JSON.parse(await fs.readFile(path.join(templateRoot, 'zeropress-preview-data.json'), 'utf8'));
  data.site.permalinks = { posts: '/writing/:public_id', output_style: 'directory' };
  data.site.search = { enabled: false };
  data.content.posts = data.content.posts.slice(0, 2);
  data.content.posts[0].content = '## First section\n\nSample content.\n\n## Second section\n\nMore content.';
  data.content.posts[1].content = 'A short post without headings.';
  data.widgets.sidebar.items = [
    { type: 'recent-posts', title: 'Recent writing', settings: { limit: 2, show_date: false } },
    { type: 'profile', title: 'About the author', settings: { display_name: 'Sample Author', bio_short: 'Synthetic test profile.' } },
  ];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-blog-sidebar-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'dist');
  await runBuild(path.join(templateRoot, 'theme'), data, output, {
    publicDir: path.join(templateRoot, 'public'), projectRoot: root,
  });

  for (const file of [
    'index.html',
    ...data.content.posts.map(post => `writing/${post.public_id}/index.html`),
    'about/index.html',
  ]) {
    const dom = new JSDOM(await fs.readFile(path.join(output, file), 'utf8'));
    t.after(() => dom.window.close());
    const { document } = dom.window;
    const sidebar = document.querySelector('main .sidebar-stack');
    assert.ok(sidebar, `A sidebar is rendered in ${file}`);
    assert.deepEqual([...sidebar.querySelectorAll('.widget-card h2')].map(el => el.textContent),
      ['Recent writing', 'About the author'], file);
    assert.equal(sidebar.querySelector('.widget-profile__name').textContent, 'Sample Author', file);
    const recentLinks = [...sidebar.querySelectorAll('.widget-card--recent-posts a')];
    assert.equal(recentLinks.length, 2, file);
    for (const link of recentLinks) {
      await fs.access(path.join(output, link.getAttribute('href').slice(1), 'index.html'));
    }

    if (file === `writing/${data.content.posts[0].public_id}/index.html`) {
      const toc = sidebar.querySelector('nav[aria-label="Table of contents"]');
      assert.ok(toc, 'The post retains its TOC alongside widgets');
      assert.deepEqual([...toc.querySelectorAll('a')].map(a => a.textContent), ['First section', 'Second section']);
      for (const link of toc.querySelectorAll('a')) {
        assert.ok(document.querySelector('.article-content').contains(
          document.getElementById(link.getAttribute('href').slice(1)),
        ), 'TOC links resolve to article headings');
      }
    }
  }
});

test('the blog sample renders nested navigation, both authors, and locally served figures and covers', async t => {
  const templateRoot = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
  const data = JSON.parse(await fs.readFile(path.join(templateRoot, 'zeropress-preview-data.json'), 'utf8'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-blog-sample-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'dist');
  const result = await runBuild(path.join(templateRoot, 'theme'), data, output, {
    publicDir: path.join(templateRoot, 'public'), projectRoot: root,
  });
  assert.deepEqual(result.warnings, []);
  const documentAt = async route => {
    const dom = new JSDOM(await fs.readFile(path.join(output, route, 'index.html'), 'utf8'));
    t.after(() => dom.window.close());
    return dom.window.document;
  };
  const home = await documentAt('');
  assert.ok(home.querySelector('.site-nav__submenu--nested a'));
  for (const link of home.querySelectorAll('.site-nav a, .footer-nav a')) {
    await fs.access(path.join(output, link.getAttribute('href').slice(1), 'index.html'));
  }
  const bylineNames = new Set();
  for (const post of data.content.posts) {
    const doc = await documentAt('posts/' + post.slug);
    const author = data.content.authors.find(item => item.id === post.author_id);
    assert.ok(doc.querySelector('.meta-row').textContent.includes(author.display_name));
    bylineNames.add(author.display_name);
  }
  assert.equal(bylineNames.size, 2);
  const article = await documentAt('posts/notes-on-typography');
  assert.equal(article.querySelectorAll('.article-content tbody tr').length, 3);
  assert.ok(article.querySelector('.article-content figure img[alt]'));
  assert.ok(article.querySelector('.article-content figcaption').textContent.trim());
  for (const doc of [article, await documentAt('about')]) {
    assert.ok(doc.querySelector('.article-featured-image'));
    for (const image of doc.querySelectorAll('main img')) {
      await fs.access(path.join(output, image.getAttribute('src').slice(1)));
    }
  }
});

test('blog listing pages adapt to a Studio publication with no widgets or menus', async t => {
  const templateRoot = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
  const data = JSON.parse(await fs.readFile(path.join(templateRoot, 'zeropress-preview-data.json'), 'utf8'));
  delete data.widgets;
  delete data.menus;
  delete data.site.newsletter;
  data.site.title = 'Synthetic publication';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-blog-minimal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'dist');
  await runBuild(path.join(templateRoot, 'theme'), data, output, {
    publicDir: path.join(templateRoot, 'public'), projectRoot: root,
  });
  for (const route of ['', 'archive', 'categories/design', 'tags/design']) {
    const dom = new JSDOM(await fs.readFile(path.join(output, route, 'index.html'), 'utf8'));
    t.after(() => dom.window.close());
    const { document } = dom.window;
    assert.equal(document.querySelector('.site-title').textContent, data.site.title);
    assert.equal(document.querySelector('.content-grid').children.length, 1);
    assert.ok(document.querySelector('.posts-area a'));
    if (!route) assert.equal(document.querySelector('main h1').textContent, 'Latest posts');
  }
});

test('blog preserves accessible SVG controls when switching and restoring color themes', async t => {
  const templateRoot = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
  const data = JSON.parse(await fs.readFile(path.join(templateRoot, 'zeropress-preview-data.json'), 'utf8'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-blog-icons-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'dist');
  await runBuild(path.join(templateRoot, 'theme'), data, output, {
    publicDir: path.join(templateRoot, 'public'), projectRoot: root,
  });
  const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');

  for (const { saved, prefersDark, expected } of [
    { saved: null, prefersDark: false, expected: 'light' },
    { saved: null, prefersDark: true, expected: 'dark' },
    { saved: 'light', prefersDark: true, expected: 'light' },
    { saved: 'dark', prefersDark: false, expected: 'dark' },
  ]) {
    const dom = new JSDOM(html, { url: 'https://example.com/', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    const { document } = dom.window;
    dom.window.matchMedia = () => ({ matches: prefersDark });
    if (saved) dom.window.localStorage.setItem('zeropress-theme', saved);
    dom.window.eval(themeSource);
    dom.window.eval('initThemeToggle()');

    const toggle = document.querySelector('[data-theme-toggle]');
    const icons = [...toggle.querySelectorAll('svg')];
    assert.equal(icons.length, 2);
    assert.equal(toggle.disabled, false);
    const assertTheme = theme => {
      const next = theme === 'dark' ? 'light' : 'dark';
      assert.equal(document.documentElement.dataset.theme, theme);
      assert.equal(document.documentElement.style.colorScheme, theme);
      assert.equal(dom.window.localStorage.getItem('zeropress-theme'), theme);
      assert.equal(toggle.getAttribute('aria-label'), `Switch to ${next} theme`);
      assert.deepEqual([...toggle.querySelectorAll('svg')], icons);
    };
    assertTheme(expected);
    dom.window.eval('initThemeToggle()');
    toggle.click();
    assertTheme(expected === 'dark' ? 'light' : 'dark');
    toggle.click();
    assertTheme(expected);

    for (const selector of [
      '[data-theme-toggle]', '[data-cmdk-open]', '[data-clear-search-highlights]',
      '[data-back-to-top]', 'button[data-newsletter-close]',
    ]) {
      const control = document.querySelector(selector);
      assert.ok(control.getAttribute('aria-label'), selector);
      const svg = control.querySelector('svg');
      assert.ok(svg, selector);
      assert.equal(svg.getAttribute('aria-hidden'), 'true');
      assert.equal(svg.getAttribute('focusable'), 'false');
    }
    for (const use of document.querySelectorAll('svg use')) {
      const symbol = document.querySelector(use.getAttribute('href'));
      assert.equal(symbol?.localName, 'symbol');
      assert.ok(symbol.querySelector('path, circle'), 'Each rendered icon resolves to SVG geometry');
    }
  }
});
