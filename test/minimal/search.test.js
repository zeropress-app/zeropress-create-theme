import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { runBuild } from '@zeropress/build';
import { JSDOM, VirtualConsole } from 'jsdom';

const template = fileURLToPath(new URL('../../src/templates/minimal/theme/', import.meta.url));
const source = await fs.readFile(path.join(template, 'assets/search.js'), 'utf8');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-minimal-search-'));
after(() => fs.rm(root, { recursive: true, force: true }));
const menuItem = (title, children = []) => ({ title, url: `/${title.toLowerCase()}/`, target: '_self', children });
const data = {
  version: '0.7', generator: 'minimal-search-test', generated_at: '2026-01-01T00:00:00Z',
  site: { title: 'Sample publication', description: 'Synthetic test content.', url: 'https://site.example', locale: 'en-US', timezone: 'UTC', media_origin: '', posts_per_page: 10, date_style: 'medium', time_style: 'none' },
  content: {
    authors: [{ id: 'sample-author', display_name: 'Sample Author' }],
    posts: [{ public_id: 1, title: 'Sample article', slug: 'sample', author_id: 'sample-author', document_type: 'markdown',
      content: 'A searchable sample body.', excerpt: 'A short sample.', status: 'published',
      published_at_iso: '2026-01-01T00:00:00Z', updated_at_iso: '2026-01-01T00:00:00Z', category_slugs: [], tag_slugs: [] }],
    pages: [], categories: [], tags: [],
  },
  menus: {
    primary: { name: 'Primary', items: [menuItem('Writing', [menuItem('Stories', [menuItem('Older')])]), menuItem('About')] },
    footer: { name: 'Footer', items: [menuItem('Legal', [menuItem('Policy')])] },
  },
};
const originalData = structuredClone(data);
const { warnings } = await runBuild(template, data, path.join(root, 'enabled'));
const html = await fs.readFile(path.join(root, 'enabled/index.html'), 'utf8');
await runBuild(template, { ...data, site: { ...data.site, search: { enabled: false } } }, path.join(root, 'disabled'));

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.ok(predicate(), 'Expected search state before timeout');
}
function response(rows) {
  return { results: rows.map(row => ({ data: async () => row })) };
}
const sampleRows = [
  { url: '/#first', meta: { title: 'First sample' }, plain_excerpt: 'First synthetic result.' },
  { url: '/#second', meta: { title: 'Second sample' }, plain_excerpt: 'Second synthetic result.' },
];

async function openPage(t, { search = async () => response(sampleRows), initialize = true } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: 'https://site.example/?q=untouched', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const { window } = dom;
  const { document } = window;
  window.fetch = () => { throw new Error('Unexpected network request'); };
  const dialog = document.querySelector('[data-search-dialog]');
  // Native inertness and Tab containment are checked separately in the browser.
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  const loads = [];
  if (initialize) {
    new Script(source).runInContext(dom.getInternalVMContext());
    window.loadSearchAdapter = async () => {
      loads.push(true);
      return { search };
    };
  }
  const input = document.querySelector('[data-search-input]');
  const opener = document.querySelector('[data-search-open]');
  const key = (element, value, options = {}) => {
    const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    return event;
  };
  const type = value => { input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const links = () => [...document.querySelectorAll('[data-search-results] a')];
  return { window, document, dialog, input, opener, key, type, links, loads };
}

test('minimal builds one-level menus without changing Preview Data and enables the shared search adapter', async t => {
  const p = await openPage(t, { initialize: false });
  assert.deepEqual(data, originalData);
  assert.deepEqual(warnings.map(({ code, menuId, maxDepth, actualDepth, omittedItems }) => ({ code, menuId, maxDepth, actualDepth, omittedItems })), [
    { code: 'MENU_MAX_DEPTH_EXCEEDED', menuId: 'primary', maxDepth: 1, actualDepth: 3, omittedItems: 2 },
    { code: 'MENU_MAX_DEPTH_EXCEEDED', menuId: 'footer', maxDepth: 1, actualDepth: 2, omittedItems: 1 },
  ]);
  assert.deepEqual([...p.document.querySelectorAll('.site-nav a')].map(a => a.textContent), ['Writing', 'About']);
  assert.deepEqual([...p.document.querySelectorAll('.site-footer__nav a')].map(a => a.textContent), ['Legal']);
  assert.equal(p.document.querySelector('.site-nav ul ul'), null);
  assert.equal(p.opener.disabled, true);
  assert.equal(p.dialog.open, false);
  await fs.access(path.join(root, 'enabled/_zeropress/search.js'));
  await fs.access(path.join(root, 'enabled/_zeropress/search_pagefind.js'));
  const post = new JSDOM(await fs.readFile(path.join(root, 'enabled/posts/sample/index.html'), 'utf8'));
  t.after(() => post.window.close());
  assert.ok(post.window.document.querySelector('[data-pagefind-body]'));
});

test('disabled search omits the entry point, dialog and search script', async t => {
  const dom = new JSDOM(await fs.readFile(path.join(root, 'disabled/index.html'), 'utf8'));
  t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelector('[data-search-open], [data-search-dialog]'), null);
  assert.ok([...dom.window.document.scripts].every(script => !/\/search(?:\.[a-f0-9]+)?\.js$/u.test(script.src)));
  await assert.rejects(fs.access(path.join(root, 'disabled/_zeropress/search.json')), /ENOENT/u);
});

test('search loads on demand, preserves result URLs and restores focus when closed', async t => {
  const p = await openPage(t);
  assert.equal(p.opener.disabled, false);
  assert.equal(p.loads.length, 0);
  p.opener.focus(); p.opener.click();
  assert.equal(p.dialog.open, true);
  assert.equal(p.document.activeElement, p.input);
  assert.equal(p.loads.length, 0);
  p.type('sample');
  await until(() => p.links().length === 2);
  assert.deepEqual(p.links().map(a => a.getAttribute('href')), ['/#first', '/#second']);
  assert.equal(p.window.location.search, '?q=untouched');
  assert.equal(p.document.querySelector('main mark'), null);
  const close = p.document.querySelector('[data-search-close]');
  close.focus();
  p.key(close, 'Tab', { shiftKey: true });
  assert.equal(p.document.activeElement, p.links().at(-1));
  p.key(p.links().at(-1), 'Tab');
  assert.equal(p.document.activeElement, close);
  p.input.focus();
  p.key(p.input, 'ArrowDown');
  assert.equal(p.document.activeElement, p.links()[0]);
  p.key(p.links()[0], 'ArrowDown');
  assert.equal(p.document.activeElement, p.links()[1]);
  assert.equal(p.key(p.links()[1], 'Enter').defaultPrevented, false);
  p.document.querySelector('[data-search-close]').click();
  assert.equal(p.document.activeElement, p.opener);
  assert.equal(p.document.documentElement.classList.contains('search-is-open'), false);
});

test('search supports Pagefind excerpts as text and excludes unsafe or external result URLs', async t => {
  const p = await openPage(t, { search: async () => response([
    { url: '/sample/?view=full#section', meta: { title: '<img src=x onerror=alert(1)>' }, excerpt: 'An <mark>example</mark> &amp; text.' },
    { url: 'javascript:alert(1)', meta: { title: 'Unsafe' } },
    { url: '//external.example/', meta: { title: 'External' } },
  ]) });
  p.opener.click(); p.type('example');
  await until(() => p.links().length === 1);
  assert.equal(p.links()[0].getAttribute('href'), '/sample/?view=full#section');
  assert.equal(p.links()[0].querySelector('.search-result__title').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(p.links()[0].querySelector('.search-result__excerpt').textContent, 'An example & text.');
  assert.equal(p.links()[0].querySelector('img, mark, script'), null);
});

test('search offers a reload after failure and distinguishes a successful empty result', async t => {
  const p = await openPage(t, { search: async () => { throw new Error('Synthetic failure'); } });
  p.opener.click(); p.type('sample');
  const retry = p.document.querySelector('[data-search-retry]');
  await until(() => !retry.hidden);
  assert.match(p.document.querySelector('[data-search-status]').textContent, /unavailable/u);
  assert.equal(retry.textContent, 'Reload page');

  const refreshed = await openPage(t, { search: async () => response([]) });
  refreshed.opener.click(); refreshed.type('sample');
  await until(() => refreshed.document.querySelector('[data-search-status]').textContent === 'No matches.');
  assert.equal(refreshed.document.querySelector('[data-search-retry]').hidden, true);
});

test('late results and rejected requests cannot replace a newer query or update a closed dialog', async t => {
  const pending = new Map();
  const p = await openPage(t, { search: query => new Promise((resolve, reject) => pending.set(query, { resolve, reject })) });
  p.opener.click(); p.type('old'); await until(() => pending.has('old'));
  p.type('new'); await until(() => pending.has('new'));
  pending.get('new').resolve(response(sampleRows)); await until(() => p.links().length === 2);
  pending.get('old').reject(new Error('Old failure')); await tick();
  assert.equal(p.links().length, 2);
  assert.equal(p.document.querySelector('[data-search-retry]').hidden, true);
  p.type('closing'); await until(() => pending.has('closing'));
  p.dialog.close();
  pending.get('closing').resolve(response(sampleRows)); await tick();
  assert.equal(p.links().length, 0);
});

test('shortcuts respect editable fields, other dialogs and IME composition', async t => {
  const p = await openPage(t);
  const editor = p.document.createElement('textarea'); p.document.body.append(editor); editor.focus();
  assert.equal(p.key(editor, '/').defaultPrevented, false);
  assert.equal(p.key(editor, 'k', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(p.dialog.open, false);
  p.opener.focus(); p.key(p.opener, '/', { isComposing: true });
  assert.equal(p.dialog.open, false);
  p.key(p.opener, 'k', { metaKey: true });
  assert.equal(p.dialog.open, true);
  p.input.dispatchEvent(new p.window.CompositionEvent('compositionstart'));
  p.type('검'); await new Promise(resolve => setTimeout(resolve, 175));
  assert.equal(p.loads.length, 0);
  const cancel = new p.window.Event('cancel', { cancelable: true }); p.dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  p.input.dispatchEvent(new p.window.CompositionEvent('compositionend'));
  await until(() => p.links().length === 2);
  assert.equal(p.key(p.input, 'Enter', { isComposing: true }).defaultPrevented, false);
  assert.equal(p.window.location.hash, '');
  let destination;
  p.links()[0].addEventListener('click', event => { destination = event.currentTarget.getAttribute('href'); event.preventDefault(); });
  p.key(p.input, 'Enter');
  assert.equal(destination, '/#first');
  p.dialog.close();
  const other = p.document.createElement('dialog'); other.open = true; p.document.body.append(other);
  assert.equal(p.key(p.opener, '/').defaultPrevented, false);
  assert.equal(p.dialog.open, false);
});

test('only a pointer click that starts and ends on the backdrop dismisses search', async t => {
  const p = await openPage(t);
  p.opener.click();
  p.dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 400, bottom: 400 });
  const pointer = (type, x) => p.dialog.dispatchEvent(new p.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: 150 }));
  pointer('pointerdown', 150); pointer('click', 10);
  assert.equal(p.dialog.open, true);
  pointer('pointerdown', 10); pointer('click', 10);
  assert.equal(p.dialog.open, false);
});
