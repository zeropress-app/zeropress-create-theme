import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runBuild } from '@zeropress/build';

const template = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
const themeSource = await fs.readFile(path.join(template, 'theme/assets/theme.js'), 'utf8');
const data = JSON.parse(await fs.readFile(path.join(template, 'zeropress-preview-data.json'), 'utf8'));
const item = (title, children = []) => ({ title, url: `/#${title.toLowerCase()}`, target: '_self', children });
data.menus.primary.items = [item('Writing', [item('Stories', [item('Reading')])]), item('About')];
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-mobile-navigation-'));
after(() => fs.rm(root, { recursive: true, force: true }));
await runBuild(path.join(template, 'theme'), data, path.join(root, 'dist'), { projectRoot: root });
const html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');

async function page(t, { scripts = true, nativeDialog = true } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  let breakpointChanged;
  let initializedBeforeBody = false;
  const media = { matches: false, addEventListener(type, handler) { breakpointChanged = handler; } };
  const dom = new JSDOM(html, {
    url: 'https://site.example/', pretendToBeVisual: true,
    runScripts: scripts ? 'dangerously' : 'outside-only', virtualConsole: console,
    beforeParse(window) {
      window.matchMedia = query => {
        if (query === '(min-width: 640px)') {
          initializedBeforeBody = window.document.body === null;
          return media;
        }
        return { matches: false };
      };
      window.fetch = () => { throw new Error('Unexpected network request'); };
      window.HTMLElement.prototype.scrollIntoView = () => {};
      // JSDOM does not implement layout or native dialog focus/inertness.
      // Browser QA covers those; these shims exercise our event/state handling.
      window.HTMLElement.prototype.getClientRects = function () {
        if (this.closest('[hidden], dialog:not([open]), .site-nav__submenu:not([data-nav-open])')) return [];
        return [{}];
      };
      if (nativeDialog) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
        window.HTMLDialogElement.prototype.close = function () {
          this.open = false;
          window.queueMicrotask(() => this.dispatchEvent(new window.Event('close')));
        };
      } else {
        window.HTMLDialogElement.prototype.showModal = undefined;
      }
    },
  });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const { window } = dom;
  const { document } = window;
  const dialog = document.querySelector('[data-mobile-nav-dialog]');
  const trigger = document.querySelector('[data-mobile-nav-trigger]');
  const navigation = document.querySelector('[data-mobile-nav-content]');
  const parent = navigation.parentElement;
  const close = dialog.querySelector('[data-mobile-nav-close]');
  const key = (element, value, options = {}) => {
    const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    if (value === 'Escape' && !event.defaultPrevented) dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    return event;
  };
  const loadTheme = () => { window.eval(themeSource); document.dispatchEvent(new window.Event('DOMContentLoaded')); };
  const desktop = () => { media.matches = true; breakpointChanged(); window.dispatchEvent(new window.Event('resize')); };
  return { window, document, dialog, trigger, navigation, parent, close, key, loadTheme, desktop, initializedBeforeBody };
}

test('mobile navigation works before the external theme script and moves a single link tree', async t => {
  const p = await page(t);
  assert.equal(p.initializedBeforeBody, true);
  assert.equal(p.document.documentElement.classList.contains('mobile-nav-ready'), true);
  p.trigger.click();
  assert.equal(p.dialog.open, true);
  assert.equal(p.dialog.querySelector('[data-mobile-nav-content]'), p.navigation);
  assert.equal(p.document.querySelectorAll('[data-mobile-nav-content]').length, 1);
  assert.equal(p.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(p.document.activeElement, p.close);
  assert.equal(p.document.documentElement.classList.contains('mobile-nav-open'), true);
  p.loadTheme();
  assert.equal(p.dialog.open, true, 'Delayed theme.js must not reset the menu');
  p.close.click();
  assert.equal(p.navigation.parentElement, p.parent);
  assert.equal(p.document.activeElement, p.trigger);
});

test('Tab and Shift+Tab wrap among visible menu controls', async t => {
  const p = await page(t);
  p.trigger.click();
  const last = p.navigation.querySelector('a[href="/#about"]');
  last.focus();
  assert.equal(p.key(last, 'Tab').defaultPrevented, true);
  assert.equal(p.document.activeElement, p.close);
  assert.equal(p.key(p.close, 'Tab', { shiftKey: true }).defaultPrevented, true);
  assert.equal(p.document.activeElement, last);
});

test('Escape closes the deepest submenu before closing the mobile dialog', async t => {
  const p = await page(t);
  p.trigger.click();
  const writing = p.navigation.querySelector('button[aria-label="Toggle Writing submenu"]');
  const stories = p.navigation.querySelector('button[aria-label="Toggle Stories submenu"]');
  writing.click();
  stories.click();
  const reading = p.navigation.querySelector('a[href="/#reading"]');
  reading.focus();
  p.key(reading, 'Escape');
  assert.equal(stories.getAttribute('aria-expanded'), 'false');
  assert.equal(writing.getAttribute('aria-expanded'), 'true');
  assert.equal(p.document.activeElement, stories);
  p.key(stories, 'Escape');
  assert.equal(writing.getAttribute('aria-expanded'), 'false');
  assert.equal(p.dialog.open, true);
  p.key(writing, 'Escape');
  assert.equal(p.dialog.open, false);
  assert.equal(p.document.activeElement, p.trigger);
});

for (const action of ['close button', 'backdrop', 'link']) {
  test(`${action} closes the menu and restores navigation and scrolling`, async t => {
    const p = await page(t);
    p.trigger.click();
    if (action === 'close button') p.close.click();
    else if (action === 'backdrop') p.dialog.click();
    else p.navigation.querySelector('a[href="/#about"]').click();
    assert.equal(p.dialog.open, false);
    assert.equal(p.navigation.parentElement, p.parent);
    assert.equal(p.trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(p.document.documentElement.classList.contains('mobile-nav-open'), false);
    p.trigger.click();
    assert.equal(p.dialog.open, true);
    p.dialog.dispatchEvent(new p.window.Event('close'));
    assert.equal(p.dialog.open, true, 'A queued close from an earlier opening must not reset the new one');
  });
}

test('desktop transition restores the menu and focus and releases scroll lock', async t => {
  const p = await page(t);
  p.trigger.click();
  const about = p.navigation.querySelector('a[href="/#about"]');
  about.focus();
  p.desktop();
  assert.equal(p.dialog.open, false);
  assert.equal(p.navigation.parentElement, p.parent);
  assert.equal(p.document.activeElement, about);
  assert.equal(p.document.documentElement.classList.contains('mobile-nav-open'), false);
});

test('search shortcuts close the mobile menu before opening search', async t => {
  const p = await page(t);
  p.loadTheme();
  p.trigger.click();
  p.key(p.close, 'k', { ctrlKey: true });
  assert.equal(p.dialog.open, false);
  assert.equal(p.document.querySelector('[data-cmdk]').hidden, false);
  assert.equal(p.document.documentElement.classList.contains('mobile-nav-open'), false);
  const input = p.document.querySelector('[data-cmdk-input]');
  p.key(input, 'Escape');
  assert.equal(p.document.activeElement, p.trigger);
});

for (const options of [{ scripts: false }, { nativeDialog: false }]) {
  test(`navigation remains in the document with ${JSON.stringify(options)}`, async t => {
    const p = await page(t, options);
    assert.equal(p.document.documentElement.classList.contains('mobile-nav-ready'), false);
    assert.equal(p.navigation.parentElement, p.parent);
    assert.equal(p.dialog.contains(p.navigation), false);
    assert.ok(p.navigation.querySelector('a[href="/#reading"]'));
  });
}
