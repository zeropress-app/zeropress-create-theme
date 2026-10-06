import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runBuild } from '@zeropress/build';
import { JSDOM, VirtualConsole } from 'jsdom';

const template = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
const source = await fs.readFile(path.join(template, 'theme/assets/theme.js'), 'utf8');
const inlineTheme = (await fs.readFile(path.join(template, 'theme/partials/theme-init.html'), 'utf8'))
  .replace(/^<script>\s*|\s*<\/script>\s*$/g, '');
const data = JSON.parse(await fs.readFile(path.join(template, 'zeropress-preview-data.json'), 'utf8'));
data.site.newsletter.signup_url = '/zp_newsletter/';
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-blog-interactions-'));
after(() => fs.rm(temporary, { recursive: true, force: true }));
await runBuild(path.join(template, 'theme'), data, temporary);
const html = await fs.readFile(path.join(temporary, 'index.html'), 'utf8');

async function openPage(t, { storageFailure = '', nativeDialog = true } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    url: 'https://site.example/?q=sample', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const { window } = dom;
  const { document } = window;
  window.matchMedia = query => ({ matches: query === '(prefers-color-scheme: dark)' });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.fetch = () => { throw new Error('Unexpected network request'); };
  if (storageFailure === 'access') {
    Object.defineProperty(window, 'localStorage', { get() { throw new window.DOMException('Storage unavailable', 'SecurityError'); } });
  } else if (storageFailure) {
    Object.defineProperty(window, 'localStorage', { value: {
      getItem() {
        if (storageFailure === 'read') throw new window.DOMException('Storage unavailable', 'SecurityError');
        return storageFailure === 'invalid' ? 'invalid-theme' : null;
      },
      setItem() {
        if (storageFailure === 'write') throw new window.DOMException('Storage full', 'QuotaExceededError');
      },
    } });
  }
  const modal = document.querySelector('[data-newsletter-modal]');
  assert.equal(modal.localName, 'dialog');
  // JSDOM has no native modal implementation. Browser QA covers inertness,
  // Tab traversal across the iframe, and native Escape cancellation.
  if (nativeDialog) {
    modal.showModal = () => { modal.open = true; };
    modal.close = () => { modal.open = false; modal.dispatchEvent(new window.Event('close')); };
  }
  window.eval(inlineTheme);
  const initialTheme = document.documentElement.dataset.theme;
  window.eval(source);
  window.loadSearchAdapter = async () => ({ search: async () => ({ results: [
    { data: async () => ({ url: '/#first', meta: { title: 'First sample' }, plain_excerpt: 'First synthetic result.' }) },
    { data: async () => ({ url: '/#second', meta: { title: 'Second sample' }, plain_excerpt: 'Second synthetic result.' }) },
  ] }) });
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const key = (element, value, options = {}) => {
    const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    return event;
  };
  const search = async () => {
    document.querySelector('[data-cmdk-open]').click();
    const input = document.querySelector('[data-cmdk-input]');
    input.value = 'sample';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    for (let i = 0; i < 100 && document.querySelectorAll('.cmdk__result').length !== 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const results = [...document.querySelectorAll('.cmdk__result')];
    assert.equal(results.length, 2);
    return { input, results };
  };
  return { window, document, modal, key, search, initialTheme };
}

for (const storageFailure of ['access', 'read', 'write', 'invalid']) {
  test(`theme, search and newsletter still initialize with ${storageFailure} storage`, async t => {
    const p = await openPage(t, { storageFailure });
    assert.equal(p.initialTheme, 'dark');
    assert.equal(p.document.documentElement.dataset.theme, 'dark');
    const toggle = p.document.querySelector('[data-theme-toggle]');
    assert.equal(toggle.disabled, false);
    toggle.click();
    assert.equal(p.document.documentElement.dataset.theme, 'light');
    await p.search();
    p.key(p.document.querySelector('[data-cmdk-input]'), 'Escape');
    p.document.querySelector('[data-newsletter-open]').click();
    assert.equal(p.modal.open, true);
    p.document.querySelector('button[data-newsletter-close]').click();
    assert.equal(p.modal.open, false);
  });
}

test('focused search results keep native Enter activation and synchronize selection', async t => {
  const p = await openPage(t);
  const { input, results } = await p.search();
  results[1].focus();
  assert.equal(results[1].getAttribute('aria-selected'), 'true');
  assert.equal(results[0].getAttribute('aria-selected'), 'false');
  assert.equal(input.getAttribute('aria-activedescendant'), results[1].id);
  assert.equal(p.key(results[1], 'Enter').defaultPrevented, false);
  assert.equal(p.window.location.hash, '');
  p.key(results[1], 'ArrowUp');
  assert.equal(p.document.activeElement, results[0]);
  assert.equal(results[0].getAttribute('aria-selected'), 'true');
});

test('search input activates its selected option and ignores IME confirmation', async t => {
  const p = await openPage(t);
  const { input, results } = await p.search();
  input.focus();
  p.key(input, 'ArrowDown');
  assert.equal(input.getAttribute('aria-activedescendant'), results[1].id);
  assert.equal(p.key(input, 'Enter', { isComposing: true }).defaultPrevented, false);
  assert.equal(p.window.location.hash, '');
  assert.equal(p.key(input, 'Enter').defaultPrevented, true);
  assert.equal(p.window.location.hash, '#second');
});

test('newsletter uses a native modal, suppresses background search, and restores focus when closed', async t => {
  const p = await openPage(t);
  const opener = p.document.querySelector('[data-newsletter-open]');
  const close = p.document.querySelector('button[data-newsletter-close]');
  opener.focus();
  opener.click();
  assert.equal(p.modal.open, true);
  assert.equal(p.document.activeElement, close);
  assert.equal(p.document.documentElement.classList.contains('newsletter-modal-open'), true);
  p.key(close, 'k', { ctrlKey: true });
  p.key(close, '/');
  assert.equal(p.document.querySelector('[data-cmdk]').hidden, true);
  close.click();
  assert.equal(p.modal.open, false);
  assert.equal(p.document.activeElement, opener);
  assert.equal(p.document.documentElement.classList.contains('newsletter-modal-open'), false);
  opener.click();
  p.document.querySelector('.newsletter-modal__backdrop').click();
  assert.equal(p.modal.open, false);
  assert.equal(p.document.activeElement, opener);
});

test('newsletter retains its standalone link when native dialogs are unavailable', async t => {
  const p = await openPage(t, { nativeDialog: false });
  assert.equal(p.document.documentElement.classList.contains('newsletter-ready'), false);
  assert.equal(p.document.querySelector('[data-newsletter-fallback]').getAttribute('href'), '/zp_newsletter/');
  p.document.querySelector('[data-newsletter-open]').click();
  assert.equal(p.modal.open, false);
  assert.equal(p.document.querySelector('[data-cmdk-open]').disabled, false);
});

test('Escape inside the same-origin newsletter closes the modal without consuming child dialog or IME input', async t => {
  const p = await openPage(t);
  const opener = p.document.querySelector('[data-newsletter-open]');
  const frame = p.modal.querySelector('iframe');
  const frameDocument = frame.contentDocument;
  const childDialog = frameDocument.createElement('dialog');
  childDialog.open = true;
  frameDocument.append(childDialog);
  opener.click();
  p.key(frameDocument, 'Escape');
  assert.equal(p.modal.open, true);
  childDialog.remove();
  p.key(frameDocument, 'Escape', { isComposing: true });
  assert.equal(p.modal.open, true);
  const consumed = new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  consumed.preventDefault();
  frameDocument.dispatchEvent(consumed);
  assert.equal(p.modal.open, true);
  p.key(frameDocument, 'Escape');
  assert.equal(p.modal.open, false);
  assert.equal(p.document.activeElement, opener);

  // A frame navigation replaces its document, so attach to the next load too.
  const nextDocument = p.document.implementation.createHTMLDocument('Newsletter');
  Object.defineProperty(frame, 'contentDocument', { configurable: true, value: nextDocument });
  frame.dispatchEvent(new p.window.Event('load'));
  opener.click();
  p.key(nextDocument, 'Escape');
  assert.equal(p.modal.open, false);
  Object.defineProperty(frame, 'contentDocument', { get() { throw new p.window.DOMException('Cross-origin frame', 'SecurityError'); } });
  frame.dispatchEvent(new p.window.Event('load'));
  opener.click();
  p.document.querySelector('button[data-newsletter-close]').click();
  assert.equal(p.modal.open, false);
});
