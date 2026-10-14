import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { runBuild } from '@zeropress/build';
import { fileURLToPath } from 'node:url';

const template = fileURLToPath(new URL('../../src/templates/blog/', import.meta.url));
const source = await fs.readFile(path.join(template, 'theme/assets/comment-data.js'), 'utf8');
const ui = await fs.readFile(path.join(template, 'theme/assets/comment.js'), 'utf8');
const config = { provider: 'wordpress', apiBaseUrl: 'https://api.example/sub/wp-json/wp/v2', targetType: 'post', targetPublicId: 42 };
const policy = (extra = {}) => ({ version: 1, post: 42, can_write: true, reason: 'allowed', revision: 'synthetic-revision', mode: 'pow', ...extra });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const input = { authorName: 'Example Reader', authorEmail: 'reader@example.com', content: 'Synthetic note', parentId: '7' };
const signedToken = 'zpc1.' + Buffer.from(JSON.stringify({ synthetic: true })).toString('base64url') + '.' + 'a'.repeat(43);
const descriptor = () => policy({ pow: { challenge_token: signedToken, difficulty: 15, expires_at: new Date(Date.now() + 60000).toISOString() } });
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-writing-ui-'));
after(() => fs.rm(output, { recursive: true, force: true }));
const data = JSON.parse(await fs.readFile(path.join(template, 'zeropress-preview-data.json'), 'utf8'));
data.site.comments = { enabled: true, provider: 'wordpress', api_base_url: config.apiBaseUrl };
data.content.posts.forEach(post => { post.allow_comments = true; });
await runBuild(path.join(template, 'theme'), data, output);
const html = await fs.readFile(path.join(output, 'posts', data.content.posts[0].slug, 'index.html'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));


function open(t, transport, html = '<!doctype html><div id="verification"></div>') {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(html, { url: 'https://public.example/', runScripts: 'outside-only', virtualConsole });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  dom.window.fetch = transport;
  dom.window.AbortController = AbortController;
  dom.window.eval(source);
  return { window: dom.window, api: dom.window.ZeroPressCommentData.create(config) };
}

test('WordPress plugin policy preserves subdirectories; only explicit no-route opts into legacy writes', async t => {
  const calls = [];
  const { api } = open(t, async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(new URL(url).pathname, '/sub/wp-json/zeropress-static/v1/comments/policy');
    assert.equal(new URL(url).searchParams.get('post'), '42');
    return json({ code: 'rest_no_route' }, 404);
  });
  assert.equal((await api.loadWritePolicy()).kind, 'legacy');
  assert.equal((await api.loadWritePolicy()).canWrite, true);
  assert.equal(calls.length, 1);
  for (const response of [() => new Response('<html>Not found</html>', { status: 404 }), () => json({}, 401), () => json({}, 503), () => json({ code: 'zpsp_comment_target_unavailable' }, 404), () => json(policy({ version: 2 })), () => json(policy({ post: 99 }))]) {
    const { api: failing } = open(t, async () => response());
    await assert.rejects(failing.loadWritePolicy());
  }
});

test('a real SHA-256 PoW solution and namespaced fields are submitted once', async t => {
  const calls = [];
  const { api, window } = open(t, async (url, options) => {
    const route = new URL(url).pathname; calls.push(route);
    if (route.endsWith('/policy')) return json(policy());
    if (route.endsWith('/challenge')) {
      assert.equal(options.body.get('zeropress_client'), 'theme-v1');
      assert.equal(options.body.get('post'), '42');
      return json(descriptor());
    }
    assert.equal(options.body.get('zeropress_client'), 'theme-v1');
    assert.equal(options.body.get('zeropress_policy_revision'), 'synthetic-revision');
    assert.equal(options.body.get('parent'), '7');
    const digest = createHash('sha256').update(options.body.get('zeropress_challenge_token') + '.' + options.body.get('zeropress_challenge_solution')).digest();
    assert.equal(digest[0], 0); assert.equal(digest[1] & 254, 0);
    return json({ id: 9, post: 42, status: 'hold' }, 201);
  });
  assert.equal((await api.submit(input)).publication, 'pending_moderation');
  assert.equal(calls.length, 3);
  assert.equal(window.document.querySelector('script'), null);
});

test('read-only policy and challenge failure never submit a comment', async t => {
  for (const mode of ['read_only', 'challenge_failed']) {
    let posts = 0;
    const { api } = open(t, async url => {
      if (url.endsWith('/challenge')) return json({ code: 'zpsp_comment_writing_disabled' }, 403);
      if (url.includes('/policy?')) return json(policy(mode === 'read_only' ? { can_write: false, reason: 'read_only' } : {}));
      posts++; throw new Error('No comment should be sent');
    });
    await assert.rejects(api.submit(input), /turned off/);
    assert.equal(posts, 0);
  }
});

test('Turnstile runs only for opted-in writes and sends only its proof', async t => {
  let renders = 0; let callback;
  const { api, window } = open(t, async (url, options) => {
    if (url.includes('/policy?')) return json(policy({ mode: 'turnstile' }));
    if (url.endsWith('/challenge')) return json(policy({ mode: 'turnstile', turnstile: { site_key: 'synthetic-key', action: 'zpsp_comment_create' } }));
    assert.equal(options.body.get('zeropress_turnstile_token'), 'synthetic-token');
    assert.equal(options.body.has('zeropress_challenge_solution'), false);
    return json({ id: 10, post: 42, status: 'approved' }, 201);
  });
  window.turnstile = { render(_host, options) { renders++; assert.equal(options.sitekey, 'synthetic-key'); assert.equal(options.action, 'zpsp_comment_create'); callback = options.callback; return 1; }, execute() { callback('synthetic-token'); }, remove() {} };
  await api.loadWritePolicy(); assert.equal(renders, 0);
  assert.equal((await api.submit({ ...input, verificationTarget: window.document.querySelector('#verification') })).publication, 'published');
  assert.equal(renders, 1);
  assert.equal(window.document.querySelector('[data-zp-turnstile]'), null);
});

for (const pageFails of [false, true]) {
  test(`pagination ${pageFails ? 'failure' : 'completion'} restores draft submission before Turnstile verification`, { timeout: 5000 }, async t => {
    const pageResponse = Promise.withResolvers();
    const widgetReady = Promise.withResolvers();
    const postStarted = Promise.withResolvers();
    const postResponse = Promise.withResolvers();
    const pages = [];
    let challenges = 0; let writes = 0; let completeVerification;
    const { window } = open(t, async (url, options) => {
      const target = new URL(url);
      const post = Number(target.searchParams.get('post') || options.body?.get('post'));
      if (target.pathname.endsWith('/policy')) return json(policy({ post, mode: 'turnstile' }));
      if (target.pathname.endsWith('/challenge')) {
        challenges++;
        return json(policy({ post, mode: 'turnstile', turnstile: { site_key: 'synthetic-key', action: 'zpsp_comment_create' } }));
      }
      if (options.method === 'POST') {
        writes++;
        assert.equal(options.body.get('parent'), '1');
        assert.equal(options.body.get('content'), 'Reply draft');
        postStarted.resolve();
        await postResponse.promise;
        return json({ id: 100, post, status: 'hold' }, 201);
      }
      const page = Number(target.searchParams.get('page'));
      pages.push(page);
      if (page === 2) {
        await pageResponse.promise;
        if (pageFails) return json({}, 503);
      }
      return new Response(JSON.stringify([{
        id: page, post, parent: 0, author_name: 'Reader', date_gmt: '2026-01-01T00:00:00',
        content: { rendered: `Comment ${page}` },
      }]), { headers: { 'X-WP-Total': '3', 'X-WP-TotalPages': '3' } });
    }, html);
    window.turnstile = {
      render(host, options) { completeVerification = options.callback; widgetReady.resolve(host); return 1; },
      execute() {}, remove() {},
    };
    window.eval(ui); await tick();
    const mount = window.document.querySelector('[data-zp-comments]');
    const form = parent => [...mount.querySelectorAll('form')].find(element => element.elements.parent.value === parent);
    const fill = (parent, content) => {
      for (const [key, value] of Object.entries({ author_name: input.authorName, author_email: input.authorEmail, content })) {
        form(parent).elements[key].value = value;
      }
    };
    const submit = parent => form(parent).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const more = () => mount.querySelector('[data-action="load-more"]');
    fill('', 'Main draft');
    mount.querySelector('[data-action="reply"]').click();
    fill('1', 'Reply draft');
    more().click();
    for (const parent of ['', '1']) {
      assert.equal(form(parent).querySelector('[type="submit"]').disabled, true);
      assert.equal(form(parent).elements.content.disabled, false);
      submit(parent);
    }
    await tick();
    assert.equal(challenges, 0);
    assert.equal(writes, 0);
    pageResponse.resolve(); await tick();
    assert.equal(form('').elements.content.value, 'Main draft');
    assert.equal(form('1').elements.content.value, 'Reply draft');
    for (const parent of ['', '1']) assert.equal(form(parent).querySelector('[type="submit"]').disabled, false);
    submit('1');
    const widget = await widgetReady.promise;
    assert.equal(widget.isConnected, true);
    assert.equal(more().disabled, true);
    more().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await tick();
    assert.deepEqual(pages, [1, 2]);
    assert.equal(widget.isConnected, true);
    completeVerification('synthetic-token');
    await postStarted.promise;
    assert.equal(more().disabled, true);
    postResponse.resolve(); await tick();
    assert.equal(challenges, 1);
    assert.equal(writes, 1);
    assert.equal(more().disabled, false);
    assert.equal(form('').elements.content.value, 'Main draft');
    assert.match(mount.textContent, /awaiting moderation/);
  });
}

test('unconfirmed writes are never replayed and concurrent submissions are rejected', async t => {
  let release; let writes = 0;
  const { api } = open(t, async url => {
    if (url.includes('/policy?')) return json({ code: 'rest_no_route' }, 404);
    writes++; await new Promise(resolve => { release = resolve; }); throw new Error('Lost response');
  });
  const first = api.submit(input);
  await assert.rejects(api.submit(input), /already being submitted/);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  release(); await assert.rejects(first, /could not be confirmed/);
  assert.equal(writes, 1);
});

test('policy errors preserve lists; retry restores forms and readonly hides all writing affordances', async t => {
  let state = 'error'; let release;
  const { window } = open(t, async url => {
    const u = new URL(url); const post = Number(u.searchParams.get('post'));
    if (u.pathname.endsWith('/policy')) {
      if (state === 'error') return json({}, 503);
      if (state === 'pending') await new Promise(resolve => { release = resolve; });
      return json(policy({ post, can_write: state === 'allowed', reason: state === 'allowed' ? 'allowed' : 'read_only' }));
    }
    return json([{ id: 1, post, parent: 0, author_name: 'Reader', date_gmt: '2026-01-01T00:00:00', content: { rendered: 'Visible note' } }]);
  }, html);
  window.eval(ui); await tick();
  const mount = window.document.querySelector('[data-zp-comments]');
  assert.match(mount.textContent, /Visible note/);
  assert.equal(mount.querySelector('form'), null);
  assert.equal(mount.querySelector('[data-action="reply"]'), null);
  state = 'pending'; mount.querySelector('[data-role="writing-policy"] button').click(); await tick();
  assert.equal(mount.querySelector('form'), null);
  assert.match(mount.textContent, /Visible note/);
  state = 'allowed'; release(); await tick();
  assert.ok(mount.querySelector('form')); assert.ok(mount.querySelector('[data-action="reply"]'));
  assert.equal(mount.querySelector('[data-role="writing-policy"]').hidden, true);
});

test('empty readonly state does not invite writing', async t => {
  const { window } = open(t, async url => url.includes('/policy?')
    ? json(policy({ post: Number(new URL(url).searchParams.get('post')), can_write: false, reason: 'read_only' })) : json([]), html);
  window.eval(ui); await tick();
  const mount = window.document.querySelector('[data-zp-comments]');
  assert.match(mount.textContent, /No comments yet/);
  assert.doesNotMatch(mount.textContent, /Be the first|Leave a note/);
  assert.equal(mount.querySelector('form'), null);
});

test('origin failures distinguish verification preparation from reads and uncertain writes', async t => {
  for (const [code, message] of [
    ['zpsp_comment_origin_invalid', /origin.*could not be verified/],
    ['zpsp_comment_origin_mismatch', /not allowed from this site address/],
    ['zpsp_comment_site_url_required', /not configured for this site/],
  ]) {
    for (const stage of ['challenge', 'submit']) {
      let writes = 0;
      const { api } = open(t, async url => {
        if (url.includes('/policy?')) return json(policy());
        if (url.endsWith('/challenge')) return stage === 'challenge' ? json({ code }, 403) : json(descriptor());
        writes++;
        return json({ code }, 403);
      });
      await assert.rejects(api.submit(input), message);
      assert.equal(writes, stage === 'challenge' ? 0 : 1);
    }
  }
  for (const [response, message] of [
    [() => json({}, 403), /does not allow comment submissions/],
    [() => json({}, 503), /verification is temporarily unavailable/],
    [() => { throw new TypeError('Lost challenge response'); }, /verification is temporarily unavailable/],
  ]) {
    let writes = 0;
    const { api } = open(t, async url => {
      if (url.includes('/policy?')) return json(policy());
      if (url.endsWith('/challenge')) return response();
      writes++; throw new Error('Unexpected write');
    });
    await assert.rejects(api.submit(input), message);
    assert.equal(writes, 0);
  }
});

test('origin rejection preserves visible comments and the reply draft without replaying POSTs', async t => {
  for (const stage of ['challenge', 'submit']) {
    let challenges = 0; let writes = 0;
    const { window } = open(t, async (url, options) => {
      const u = new URL(url); const post = Number(u.searchParams.get('post'));
      if (u.pathname.endsWith('/policy')) return json(policy({ post }));
      if (u.pathname.endsWith('/challenge')) {
        challenges++;
        return stage === 'challenge' ? json({ code: 'zpsp_comment_origin_mismatch' }, 403)
          : json({ ...descriptor(), post: Number(options.body.get('post')) });
      }
      if (challenges) { writes++; return json({ code: 'zpsp_comment_origin_mismatch' }, 403); }
      return json([{ id: 1, post, parent: 0, author_name: 'Reader', date_gmt: '2026-01-01T00:00:00', content: { rendered: 'Visible note' } }]);
    }, html);
    window.eval(ui); await tick();
    const mount = window.document.querySelector('[data-zp-comments]');
    mount.querySelector('[data-action="reply"]').click();
    const form = [...mount.querySelectorAll('form')].find(form => form.elements.parent.value === '1');
    for (const [key, value] of Object.entries({ author_name: input.authorName, author_email: input.authorEmail, content: input.content })) form.elements[key].value = value;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 100 && !mount.textContent.includes('not allowed from this site address'); i++) await tick();
    assert.match(mount.textContent, /not allowed from this site address/);
    assert.match(mount.textContent, /Visible note/);
    const retained = [...mount.querySelectorAll('form')].find(form => form.elements.parent.value === '1');
    assert.equal(retained.elements.content.value, input.content);
    assert.equal(retained.elements.author_email.value, input.authorEmail);
    assert.equal(challenges, 1);
    assert.equal(writes, stage === 'challenge' ? 0 : 1);
  }
});
