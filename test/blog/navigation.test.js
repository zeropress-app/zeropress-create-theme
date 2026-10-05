import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runBuild } from '@zeropress/build';

const template = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
const source = await fs.readFile(path.join(template, 'theme/assets/theme.js'), 'utf8');
const stylesheet = await fs.readFile(path.join(template, 'theme/assets/style.css'), 'utf8');
const navigationStyles = stylesheet.slice(stylesheet.indexOf('.site-nav {'), stylesheet.indexOf('.header-search {'));
const item = (title, children = []) => ({ title, url: '/' + title.toLowerCase() + '/', target: '_self', children });
let root;
let html;
let warnings;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-blog-menu-'));
  const data = JSON.parse(await fs.readFile(path.join(template, 'preview-data.json'), 'utf8'));
  data.menus = {
    primary: { name: 'Primary', items: [
      item('Writing', [item('Stories', [item('Reading', [item('Hidden')])]), item('Notes', [item('Today')])]),
      item('Topics', [item('News')]), item('About'),
    ] },
    footer: { name: 'Footer', items: [item('Legal', [item('Privacy')])] },
  };
  ({ warnings } = await runBuild(path.join(template, 'theme'), data, path.join(root, 'dist'), { publicDir: path.join(template, 'public'), projectRoot: root }));
  html = await fs.readFile(path.join(root, 'dist/index.html'), 'utf8');
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function navigation(t, enhanced = true) {
  const media = { matches: true };
  let initializedBeforeNavigation = false;
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'Page initialization completes without script errors'));
  const dom = new JSDOM(html.replace('</head>', `<style>${navigationStyles}</style></head>`), {
    url: 'https://example.com/',
    pretendToBeVisual: true,
    virtualConsole,
    runScripts: enhanced ? 'dangerously' : 'outside-only',
    beforeParse(window) {
      window.matchMedia = query => {
        if (query === '(min-width: 640px)') {
          initializedBeforeNavigation = window.document.querySelector('.site-nav') === null;
        }
        return media;
      };
    },
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const { document } = dom.window;
  Object.defineProperties(document.documentElement, {
    clientWidth: { value: 900 }, clientHeight: { value: 700 },
  });
  const navigationSource = document.querySelector('script[data-zp-navigation]').textContent;
  const button = title => document.querySelector(`button[aria-label="Toggle ${title} submenu"]`);
  const panel = title => document.getElementById(button(title).getAttribute('aria-controls'));
  const escape = element => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const visible = title => dom.window.getComputedStyle(panel(title)).display !== 'none';
  return { document, window: dom.window, media, button, panel, visible, escape, navigationSource, initializedBeforeNavigation };
}

test('blog renders all three primary levels as nested links when inline scripts cannot run', async t => {
  const { document, window } = await navigation(t, false);
  assert.deepEqual([...document.querySelectorAll('.site-nav a')].map(a => a.textContent.trim()),
    ['Writing', 'Stories', 'Reading', 'Notes', 'Today', 'Topics', 'News', 'About']);
  assert.deepEqual([...document.querySelectorAll('.footer-nav a')].map(a => a.textContent.trim()), ['Legal']);
  assert.equal(warnings.length, 2);
  assert.ok([...document.querySelectorAll('.site-nav__submenu')].every(panel => window.getComputedStyle(panel).display !== 'none'));
  assert.ok([...document.querySelectorAll('.site-nav__toggle')].every(button => window.getComputedStyle(button).display === 'none'));
  assert.equal(document.querySelector('a[href="/reading/"]').parentElement.querySelector('button'), null);
});

test('click toggles independent disclosure buttons and preserves normal links', async t => {
  const { button, visible, document, window, navigationSource } = await navigation(t);
  assert.equal(button('Writing').getAttribute('aria-expanded'), 'false');
  assert.equal(visible('Writing'), false);
  button('Writing').click();
  assert.equal(visible('Writing'), true);
  assert.equal(button('Writing').getAttribute('aria-expanded'), 'true');
  const link = document.querySelector('a[href="/writing/"]');
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  // Prevent jsdom's unimplemented page navigation after checking the theme did not cancel it.
  document.addEventListener('click', e => { assert.equal(e.defaultPrevented, false); e.preventDefault(); }, { once: true });
  link.dispatchEvent(event);
  assert.equal(visible('Writing'), true);
  button('Writing').click();
  assert.equal(visible('Writing'), false);
  window.eval(navigationSource);
  button('Writing').click();
  assert.equal(visible('Writing'), true, 'Repeated enhancement does not attach duplicate handlers');
});

test('siblings close their descendants and Escape returns focus from the innermost panel', async t => {
  const { button, visible, escape, document } = await navigation(t);
  button('Writing').click();
  button('Stories').click();
  document.querySelector('a[href="/reading/"]').focus();
  escape(document.activeElement);
  assert.equal(document.activeElement, button('Stories'));
  assert.equal(visible('Stories'), false);
  assert.equal(visible('Writing'), true);
  button('Stories').click();
  button('Notes').click();
  assert.equal(visible('Stories'), false);
  assert.equal(visible('Notes'), true);
  button('Topics').click();
  assert.equal(visible('Writing'), false);
  assert.equal(visible('Notes'), false);
  assert.equal(visible('Topics'), true);
  escape(button('Topics'));
  assert.equal(document.activeElement, button('Topics'));
  assert.equal(visible('Topics'), false);
});

test('nested menus stay open when a pointer click does not move focus to its button', async t => {
  const { button, visible } = await navigation(t);
  button('Writing').focus();
  button('Writing').click();

  // Some browsers blur the previous control on pointer down without focusing
  // the clicked button. The submenu must remain available until click fires.
  button('Writing').blur();
  await Promise.resolve();
  assert.equal(visible('Writing'), true, 'Do not hide the nested button before its click');
  button('Stories').click();
  assert.equal(visible('Writing'), true);
  assert.equal(visible('Stories'), true);

  button('Stories').focus();
  button('Stories').blur();
  await Promise.resolve();
  button('Notes').click();
  assert.equal(visible('Writing'), true);
  assert.equal(visible('Stories'), false);
  assert.equal(visible('Notes'), true);
});

test('outside click and keyboard focus leaving navigation close all panels', async t => {
  const { button, visible, document } = await navigation(t);
  button('Writing').click();
  button('Stories').click();
  document.body.click();
  assert.equal(visible('Writing'), false);
  assert.equal(visible('Stories'), false);
  button('Writing').focus();
  button('Writing').click();
  button('Stories').focus();
  await Promise.resolve();
  assert.equal(visible('Writing'), true, 'Focus inside the navigation preserves the open branch');
  document.querySelector('.site-title-link').focus();
  await Promise.resolve();
  assert.equal(visible('Writing'), false);
});

test('desktop panels fit the viewport, flip nested panels left, and reset placement on mobile', async t => {
  const { button, panel, visible, media, window } = await navigation(t);
  button('Writing').closest('li').getBoundingClientRect = () => ({ left: 790, right: 860, top: 100, bottom: 140 });
  panel('Writing').getBoundingClientRect = () => ({ left: 624, right: 884, width: 260, height: 120 });
  button('Writing').click();
  assert.equal(panel('Writing').style.left, '-166px');
  const nested = button('Stories').closest('li');
  nested.getBoundingClientRect = () => ({ left: 630, right: 880, top: 600, bottom: 630 });
  panel('Stories').getBoundingClientRect = () => ({ width: 200, height: 160 });
  button('Stories').click();
  assert.equal(panel('Stories').style.left, '-206px');
  assert.equal(panel('Stories').style.top, '-76px');
  assert.equal(button('Stories').dataset.opensLeft, 'true');
  panel('Writing').getBoundingClientRect = () => ({ left: 300, right: 684, width: 384, height: 120 });
  nested.getBoundingClientRect = () => ({ left: 310, right: 674, top: 200, bottom: 240 });
  panel('Stories').getBoundingClientRect = () => ({ width: 384, height: 160 });
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(panel('Stories').style.left, '0px');
  assert.equal(panel('Stories').style.top, '44px', 'Keep the controlling row and focus ring visible when neither side fits');
  media.matches = false;
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(panel('Stories').style.left, '');
  assert.equal(panel('Stories').style.top, '');
  assert.equal(visible('Stories'), true);
});

test('navigation is ready before its HTML and works while the external theme script is unavailable', async t => {
  const { document, window, button, panel, visible, initializedBeforeNavigation } = await navigation(t);
  assert.equal(initializedBeforeNavigation, true);
  const buttons = [...document.querySelectorAll('.site-nav__toggle')];
  const controlledIds = buttons.map(control => control.getAttribute('aria-controls'));
  assert.equal(new Set(controlledIds).size, buttons.length);
  for (const control of buttons) {
    assert.equal(control.getAttribute('aria-expanded'), 'false');
    assert.ok(document.getElementById(control.getAttribute('aria-controls')));
    assert.equal(window.getComputedStyle(control).display, 'inline-flex');
  }
  button('Writing').click();
  button('Stories').click();
  assert.equal(visible('Stories'), true);

  // Arriving later must not reset an already open menu or add a second toggle.
  window.eval(source);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(visible('Writing'), true);
  assert.equal(visible('Stories'), true);
  assert.equal(panel('Stories').id, button('Stories').getAttribute('aria-controls'));
  button('Stories').click();
  assert.equal(visible('Stories'), false);
  assert.equal(visible('Writing'), true);
});

test('the full theme keeps the nested-link fallback when the inline initializer is blocked', async t => {
  const { document, window } = await navigation(t, false);
  window.eval(source);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  for (const panel of document.querySelectorAll('.site-nav__submenu')) {
    assert.equal(window.getComputedStyle(panel).display, 'flex');
  }
  for (const button of document.querySelectorAll('.site-nav__toggle')) {
    assert.equal(window.getComputedStyle(button).display, 'none');
  }
});
