import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runBuild } from '@zeropress/build';
import { JSDOM, requestInterceptor, VirtualConsole } from 'jsdom';

const publicRoot = new URL('../../src/templates/blog/public/', import.meta.url);
const kinds = ['form', 'newsletter'];
const fixtures = new Map(await Promise.all(kinds.map(async kind => [
  kind,
  Object.fromEntries(await Promise.all(['index.html', 'style.css', 'app.js', 'config.json'].map(async file => [
    file, await fs.readFile(new URL('zp_' + kind + '/' + file, publicRoot)),
  ]))),
])));
const json = data => Response.json(data);
const item = data => json({ success: true, data: { item: data } });
const endpointFor = kind => 'https://edge.example/api/' + (kind === 'form' ? 'forms/feedback' : 'newsletters/updates');

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for the embed');
    await delay(5);
  }
}

async function openEmbed(t, kind, { config, configResponse, hash = '', search = '', frameElement, api, turnstile = false } = {}) {
  const files = fixtures.get(kind);
  // Load just this folder at a different URL: no sibling or shared assets exist.
  const base = 'https://site.example/embedded/' + kind + '/';
  const calls = [];
  const resources = [];
  const unexpected = [];
  const errors = [];
  const assets = requestInterceptor(request => {
    const url = request.url;
    resources.push(url);
    for (const file of ['app.js', 'style.css']) {
      if (url === base + file) return new Response(files[file], {
        headers: { 'content-type': file.endsWith('.js') ? 'application/javascript' : 'text/css' },
      });
    }
    if (turnstile && url === 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit') {
      return new Response('window.turnstile = {' +
        'render: function (container, options) { this.options = options; return "test-widget"; },' +
        'execute: function () { this.options.callback("test-turnstile-token"); }, remove: function () {} };',
      { headers: { 'content-type': 'application/javascript' } });
    }
    unexpected.push(url);
    return Promise.reject(new Error('Unexpected resource: ' + url));
  });
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(files['index.html'].toString(), {
    url: base + search + hash, runScripts: 'dangerously', resources: { interceptors: [assets] }, virtualConsole,
    beforeParse(window) {
      if (frameElement) Object.defineProperty(window, 'frameElement', { get: frameElement });
      window.TextEncoder = TextEncoder;
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        calls.push({ url, method: options.method || 'GET', body: options.body });
        if (url === base + 'config.json') {
          return configResponse ? configResponse() : json(config ?? JSON.parse(files['config.json']));
        }
        if (api) {
          const response = await api(url, options);
          if (response) return response;
        }
        unexpected.push(url);
        throw new Error('Unexpected API request: ' + url);
      };
    },
  });
  t.after(() => {
    dom.window.close();
    assert.deepEqual(unexpected, [], 'Every network request must use a test double');
    assert.deepEqual(errors, [], 'The standalone script must load without errors');
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  const { document } = dom.window;
  const form = document.querySelector('form');
  await waitFor(() => form.getAttribute('aria-busy') === 'false');
  const message = document.querySelector('[data-' + kind + '-message]');
  const submit = () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  return { document, window: dom.window, form, calls, resources, message, submit, base };
}

function themeNewsletterFrame(t, {
  base = 'https://edge.example/api', provider = 'zeropress',
  parentUrl = 'https://site.example/posts/example/', marked = true,
} = {}) {
  const parent = new JSDOM('<iframe></iframe>', { url: parentUrl });
  t.after(() => parent.window.close());
  const frame = parent.window.document.querySelector('iframe');
  if (marked) frame.setAttribute('data-zp-newsletter-embed', '');
  frame.setAttribute('data-zp-newsletter-provider', provider);
  frame.setAttribute('data-zp-newsletter-api-base-url', base);
  return frame;
}

test('newsletter infers the default list from its same-origin theme iframe', async t => {
  for (const [base, expected] of [
    ['https://edge.example/api', 'https://edge.example/api/newsletters/default'],
    ['  https://edge.example/api/  ', 'https://edge.example/api/newsletters/default'],
    ['/api', 'https://site.example/api/newsletters/default'],
    ['http://localhost:8787/api', 'http://localhost:8787/api/newsletters/default'],
  ]) {
    const frame = themeNewsletterFrame(t, { base });
    const page = await openEmbed(t, 'newsletter', {
      config: { newsletter_endpoint: '  ' }, frameElement: () => frame,
      api(url) {
        if (url === expected) return item({ newsletter: { title: 'Theme newsletter' }, fields: [] });
      },
    });
    assert.equal(page.document.querySelector('fieldset').disabled, false);
    assert.equal(page.document.querySelector('h1').textContent, 'Theme newsletter');
    assert.deepEqual(page.calls.map(call => call.url), [page.base + 'config.json', expected]);
  }
});

test('an explicit newsletter endpoint controls the destination even when its API fails', async t => {
  for (const status of [200, 503]) {
    const endpoint = endpointFor('newsletter');
    const page = await openEmbed(t, 'newsletter', {
      config: { newsletter_endpoint: endpoint }, frameElement: () => themeNewsletterFrame(t),
      api(url) {
        if (url !== endpoint) return;
        return status === 200 ? item({ newsletter: { title: 'Configured list' }, fields: [] })
          : new Response('{}', { status });
      },
    });
    assert.equal(page.document.querySelector('fieldset').disabled, status !== 200);
    assert.deepEqual(page.calls.map(call => call.url), [page.base + 'config.json', endpoint]);
  }
});

test('newsletter reports configuration errors even when theme inference is available', async t => {
  const frame = themeNewsletterFrame(t);
  for (const input of [
    { config: { newsletter_endpoint: 'not-a-url' } },
    { config: { newsletter_endpoint: null } },
    { config: {} },
    { configResponse: () => new Response('Missing', { status: 404 }) },
    { configResponse: () => new Response('{') },
  ]) {
    const page = await openEmbed(t, 'newsletter', { ...input, frameElement: () => frame });
    assert.equal(page.message.dataset.state, 'error');
    assert.match(page.message.textContent, /config\.json/);
    assert.equal(page.document.querySelector('fieldset').disabled, true);
    assert.deepEqual(page.calls.map(call => call.url), [page.base + 'config.json']);
  }
});

test('newsletter requires a same-origin theme frame and a standard ZeroPress API base', async t => {
  const frameOptions = [
    { parentUrl: 'https://other.example/' }, { marked: false }, { provider: 'wordpress' },
    { base: '' }, { base: 'https://edge.example/api2' }, { base: '//edge.example/api' },
    { base: 'https://user:password@edge.example/api' },
    { base: 'https://edge.example/api?target=other' }, { base: 'https://edge.example/api#fragment' },
    { base: 'javascript:alert(1)' }, { base: 'https://edge.example/ap\ni' },
  ];
  const readers = frameOptions.map(options => {
    const frame = themeNewsletterFrame(t, options);
    return () => frame;
  });
  readers.push(() => { throw new DOMException('Access denied', 'SecurityError'); });
  for (const frameElement of readers) {
    const page = await openEmbed(t, 'newsletter', { frameElement });
    assert.equal(page.message.dataset.state, 'setup');
    assert.equal(page.document.querySelector('fieldset').disabled, true);
    assert.deepEqual(page.calls.map(call => call.url), [page.base + 'config.json']);
  }
});

test('URL parameters cannot select a newsletter destination', async t => {
  const search = '?api_host=https://other.example&newsletter_endpoint=https://other.example/api/newsletters/other';
  const frame = themeNewsletterFrame(t);
  const endpoint = 'https://edge.example/api/newsletters/default';
  const embedded = await openEmbed(t, 'newsletter', {
    search, frameElement: () => frame,
    api: url => url === endpoint ? item({ newsletter: { title: 'Theme list' }, fields: [] }) : undefined,
  });
  assert.equal(embedded.document.querySelector('fieldset').disabled, false);
  assert.deepEqual(embedded.calls.map(call => call.url), [embedded.base + 'config.json', endpoint]);
  const standalone = await openEmbed(t, 'newsletter', { search });
  assert.equal(standalone.message.dataset.state, 'setup');
  assert.deepEqual(standalone.calls.map(call => call.url), [standalone.base + 'config.json']);
});

test('an inferred newsletter still checks availability and supports retry', async t => {
  const frame = themeNewsletterFrame(t);
  const endpoint = 'https://edge.example/api/newsletters/default';
  let attempts = 0;
  const page = await openEmbed(t, 'newsletter', {
    frameElement: () => frame,
    api(url) {
      if (url !== endpoint) return;
      attempts += 1;
      return item({ newsletter: { title: 'Theme list' }, fields: [], accepting_subscriptions: attempts > 1 });
    },
  });
  assert.equal(page.message.dataset.state, 'error');
  assert.equal(page.document.querySelector('fieldset').disabled, true);
  page.document.querySelector('[data-newsletter-retry]').click();
  await waitFor(() => !page.document.querySelector('fieldset').disabled);
  assert.equal(attempts, 2);
});

test('blog supplies site-wide newsletter inference on home, archive, post, and page routes', async t => {
  const template = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
  const data = JSON.parse(await fs.readFile(path.join(template, 'preview-data.json'), 'utf8'));
  data.site.comments = { enabled: true, provider: 'zeropress', api_base_url: 'https://edge.example/api' };
  for (const post of [...data.content.posts, ...data.content.pages]) post.allow_comments = false;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-blog-newsletter-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'dist');
  await runBuild(path.join(template, 'theme'), data, output, { publicDir: path.join(template, 'public'), projectRoot: root });
  for (const route of ['/', '/archive/', '/posts/writing-in-the-margins/', '/about/']) {
    const parent = new JSDOM(await fs.readFile(path.join(output, route.slice(1), 'index.html'), 'utf8'), {
      url: 'https://site.example' + route,
    });
    t.after(() => parent.window.close());
    const frame = parent.window.document.querySelector('iframe[data-zp-newsletter-embed]');
    assert.ok(frame, route);
    assert.equal(frame.getAttribute('data-zp-newsletter-provider'), 'zeropress');
    assert.equal(frame.getAttribute('data-zp-newsletter-api-base-url'), 'https://edge.example/api');
    const page = await openEmbed(t, 'newsletter', {
      frameElement: () => frame,
      api: url => url === 'https://edge.example/api/newsletters/default'
        ? item({ newsletter: { title: 'Site newsletter' }, fields: [] }) : undefined,
    });
    assert.equal(page.document.querySelector('fieldset').disabled, false, route);
  }
});

for (const kind of kinds) {
  test(kind + ' shows setup guidance with no external requests until its endpoint is set', async t => {
    const page = await openEmbed(t, kind);
    assert.equal(page.message.dataset.state, 'setup');
    assert.match(page.message.textContent, /Set (?:form|newsletter)_endpoint in config\.json/);
    assert.equal(page.document.querySelector('fieldset').disabled, true);
    assert.equal(page.document.querySelector('button[type="submit"]').disabled, true);
    page.submit();
    page.document.querySelector('[data-' + kind + '-retry]').click();
    await delay(0);
    assert.deepEqual(page.calls.map(call => call.url), [page.base + 'config.json']);
    assert.deepEqual(page.resources.sort(), [page.base + 'app.js', page.base + 'style.css']);
  });

  test(kind + ' rejects invalid configuration without calling an API', async t => {
    for (const config of [
      {}, { [kind + '_endpoint']: null }, [], { [kind + '_endpoint']: 42 },
      { [kind + '_endpoint']: '/api/resource' }, { [kind + '_endpoint']: 'javascript:alert(1)' },
      { [kind + '_endpoint']: 'https://user:password@edge.example/api/resource' },
      { [kind + '_endpoint']: 'https://edge.example/api/resource?key=test' },
      { [kind + '_endpoint']: 'https://edge.example/api/resource#fragment' },
    ]) {
      const page = await openEmbed(t, kind, { config });
      assert.equal(page.message.dataset.state, 'error');
      assert.match(page.message.textContent, /valid (?:form|newsletter)_endpoint/);
      assert.equal(page.calls.length, 1);
    }
    const blank = await openEmbed(t, kind, { config: { [kind + '_endpoint']: '   ' } });
    assert.equal(blank.message.dataset.state, 'setup');
    assert.equal(blank.calls.length, 1);
  });

  test(kind + ' reports a missing, unreadable, or malformed config file', async t => {
    for (const configResponse of [
      () => new Response('Missing', { status: 404 }),
      () => new Response('{'),
      () => json(null),
      () => { throw new Error('Network failure'); },
    ]) {
      const page = await openEmbed(t, kind, { configResponse });
      assert.equal(page.message.dataset.state, 'error');
      assert.match(page.message.textContent, /config\.json/);
      assert.equal(page.calls.length, 1);
      assert.equal(page.document.querySelector('fieldset').disabled, true);
    }
  });

  for (const mode of ['pow', 'turnstile']) {
    test(kind + ' loads and submits to its configured endpoint using ' + mode, async t => {
      const endpoint = endpointFor(kind);
      const scope = kind === 'form' ? 'submit' : 'subscribe';
      const writes = [];
      const page = await openEmbed(t, kind, {
        config: { [kind + '_endpoint']: '  ' + endpoint + '/  ' }, turnstile: mode === 'turnstile',
        api(url, options) {
          if (url === endpoint) {
            return item({
              [kind]: { title: 'Test ' + kind, description: 'A synthetic example.' },
              fields: [{ key: 'message', type: 'textarea', label: 'Message' }],
            });
          }
          if (url === endpoint + '/challenge/' + scope) {
            return item({
              scope, mode,
              pow: { algorithm: 'zp-' + kind + '-pow-v1', scope, difficulty: 0, challenge_token: 'test-challenge' },
              turnstile: { site_key: 'test-site-key', action: kind + '_' + scope },
            });
          }
          if (url === endpoint + (kind === 'form' ? '/submissions' : '/subscriptions')) {
            assert.equal(options.method, 'POST');
            writes.push(JSON.parse(options.body));
            return json({ success: true, data: { message: 'Test submission accepted.' } });
          }
        },
      });
      await waitFor(() => !page.document.querySelector('fieldset').disabled);
      assert.equal(page.document.querySelector('h1').textContent, 'Test ' + kind);
      assert.equal(page.resources.length, 2, 'Verification stays lazy until submission');
      page.document.querySelector('[name="message"]').value = 'Synthetic response';
      if (kind === 'newsletter') page.document.querySelector('[name="email"]').value = 'reader@example.com';
      page.submit();
      await waitFor(() => page.message.dataset.state === 'success');
      assert.equal(writes.length, 1);
      assert.equal(writes[0].fields.message, 'Synthetic response');
      assert.equal(writes[0].source_url, page.base);
      if (kind === 'newsletter') assert.equal(writes[0].email, 'reader@example.com');
      if (mode === 'pow') {
        assert.equal(writes[0][kind + '_challenge_token'], 'test-challenge');
        assert.equal(writes[0][kind + '_challenge_solution'], '0');
        assert.equal(writes[0].turnstile_token, undefined);
      } else {
        assert.equal(writes[0].turnstile_token, 'test-turnstile-token');
        assert.equal(writes[0][kind + '_challenge_token'], undefined);
        assert.equal(page.resources.length, 3);
      }
    });
  }

  test(kind + ' preserves unavailable-state handling and retries after configuration', async t => {
    const endpoint = endpointFor(kind);
    let attempts = 0;
    const page = await openEmbed(t, kind, {
      config: { [kind + '_endpoint']: endpoint },
      api(url) {
        if (url !== endpoint) return;
        attempts += 1;
        return attempts === 1 ? new Response('{}', { status: 503 })
          : item({ [kind]: { title: 'Available again' }, fields: [] });
      },
    });
    await waitFor(() => page.message.dataset.state === 'error');
    assert.equal(page.document.querySelector('fieldset').disabled, true);
    page.document.querySelector('[data-' + kind + '-retry]').click();
    await waitFor(() => !page.document.querySelector('fieldset').disabled);
    assert.equal(attempts, 2);
  });
}

for (const action of ['confirm', 'unsubscribe']) {
  test('newsletter ' + action + ' remains disabled when configuration is missing', async t => {
    const page = await openEmbed(t, 'newsletter', { hash: '#' + action + '_token=test-token' });
    assert.equal(page.message.dataset.state, 'setup');
    const button = page.document.querySelector('[data-newsletter-' + action + '-submit]');
    assert.equal(button.disabled, true);
    button.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
    await delay(0);
    assert.equal(page.calls.length, 1);
  });

  test('newsletter ' + action + ' posts its token only on explicit activation after configuration', async t => {
    const endpoint = endpointFor('newsletter');
    const page = await openEmbed(t, 'newsletter', {
      config: { newsletter_endpoint: endpoint }, hash: '#' + action + '_token=test-token',
      api(url, options) {
        if (url !== endpoint + '/subscriptions/' + action) return;
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { token: 'test-token' });
        return json({ success: true });
      },
    });
    assert.equal(page.calls.length, 1, 'Opening a link must not mutate a subscription');
    const panel = page.document.querySelector('[data-newsletter-' + action + ']');
    assert.equal(panel.hidden, false);
    page.document.querySelector('[data-newsletter-' + action + '-submit]').click();
    await waitFor(() => page.window.location.hash === '');
    assert.equal(page.calls.length, 2);
  });
}
