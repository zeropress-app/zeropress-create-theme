import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test as baseTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runBuild } from '@zeropress/build';
import { JSDOM, VirtualConsole } from 'jsdom';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-comment-runtime-'));
after(() => fs.rm(temporary, { recursive: true, force: true }));
const fixtures = await Promise.all(['blog', 'minimal'].map(async templateName => {
  const template = fileURLToPath(new URL(`../../src/templates/${templateName}/`, import.meta.url));
  const source = await fs.readFile(path.join(template, 'theme/assets/comment.js'), 'utf8');
  const dataSource = await fs.readFile(path.join(template, 'theme/assets/comment-data.js'), 'utf8');
  const data = JSON.parse(await fs.readFile(path.join(template, 'zeropress-preview-data.json'), 'utf8'));
  data.site.comments = { enabled: true, provider: 'wordpress', api_base_url: 'https://comments.example/wp-json/wp/v2' };
  data.content.posts.forEach(post => { post.allow_comments = true; });
  const output = path.join(temporary, templateName);
  await runBuild(path.join(template, 'theme'), data, output);
  const html = await fs.readFile(path.join(output, `posts/${data.content.posts[0].slug}/index.html`), 'utf8');
  return { templateName, source, dataSource, html };
}));

for (const { templateName, source, dataSource, html } of fixtures) {
  const test = (name, run) => baseTest(`${templateName}: ${name}`, run);

  const comments = [1, 2, 3].map(id => ({
    id: String(id), parentId: null, authorName: 'Sample Reader', authorKind: id === 1 ? 'site_user' : id === 2 ? 'authenticated_user' : 'guest',
    createdAt: '2026-01-01T00:00:00Z', contentText: 'Synthetic comment ' + id,
  }));
  const pageAt = page => ({
    comments: page === 1 ? comments.slice(0, 2) : comments.slice(2),
    pagination: { currentPage: page, totalPages: 2, totalComments: 3 },
  });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  async function openComments(t, overrides = {}, stored = null, dateStyles = null, transport = null, threadDepth = null) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(html, { url: 'https://site.example/', runScripts: 'outside-only', virtualConsole });
    t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
    await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    const { window } = dom;
    if (dateStyles) Object.assign(window.document.documentElement.dataset, dateStyles);
    const mount = window.document.querySelector('[data-zp-comments]');
    if (threadDepth !== null) mount.dataset.zpCommentsThreadingMaxDepth = String(threadDepth);
    const storageKey = `zeropress:comment-draft:v1:${mount.dataset.zpCommentsTargetType}:${mount.dataset.zpCommentsTargetPublicId}`;
    if (stored) window.sessionStorage.setItem(storageKey, JSON.stringify(stored));
    let notifyIdentity;
    window.fetch = async (url, options) => new URL(url).pathname.endsWith('/zeropress-static/v1/comments/policy')
      ? new Response(JSON.stringify({ code: 'rest_no_route' }), { status: 404 })
      : (transport || (() => { throw new Error('Unexpected network request'); }))(url, options);
    window.ZeroPressCommentData = {
      create: () => ({
        load: async page => pageAt(page),
        submit: async () => ({ publication: 'pending_moderation' }),
        initializeIdentity: callback => { notifyIdentity = callback; },
        ...overrides,
      }),
      getErrorMessages: error => [error.message],
    };
    if (transport) {
      window.AbortController = AbortController;
      window.eval(dataSource);
    }
    window.eval(source);
    await tick();
    const form = (parent = '') => [...mount.querySelectorAll('[data-zp-comment-form]')]
      .find(el => el.querySelector('[name="parent"]').value === parent);
    const values = (parent = '') => {
      const target = form(parent);
      return target && Object.fromEntries(['author_name', 'author_email', 'content']
        .map(key => [key, target.querySelector(`[name="${key}"]`).value]));
    };
    const fill = (parent, content) => {
      const target = form(parent);
      assert.ok(target);
      for (const [key, value] of Object.entries({ author_name: 'Sample Author', author_email: 'reader@example.com', content })) {
        const input = target.querySelector(`[name="${key}"]`);
        input.value = value;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
      return values(parent);
    };
    const reply = id => mount.querySelector(`[data-reply-comment-id="${id}"]`).click();
    const submit = parent => form(parent).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    return { window, mount, form, values, fill, reply, submit, identity: state => notifyIdentity(state) };
  }

  test('WordPress results and failures respect the theme source-link policy', async t => {
    const originalUrl = 'https://wordpress.example/?p=42#comments';
    const p = await openComments(t, { originalUrl, order: 'desc', load: async () => ({
      comments, pagination: { currentPage: 1, totalPages: 1, totalComments: 400, limited: true, loadedComments: 3 },
    }) });
    assert.equal(p.mount.querySelector('[data-role="count"]').textContent, '400');
    const link = p.mount.querySelector('.zp-comments__wordpress-note a');
    if (templateName === 'blog') {
      assert.equal(link, null);
      assert.doesNotMatch(p.mount.textContent, /Showing .*comments/);
    } else {
      assert.match(p.mount.textContent, /Showing the latest 3 comments/);
      assert.equal(link.href, originalUrl); assert.equal(link.target, '_blank');
      assert.equal(link.rel, 'noopener noreferrer');
    }
    const failed = await openComments(t, { originalUrl, load: async () => { throw new Error('Cannot reach WordPress'); } });
    assert.match(failed.mount.textContent, /Cannot reach WordPress/);
    if (templateName === 'blog') assert.equal(failed.mount.querySelector('.zp-comments__wordpress-note a'), null);
    else assert.equal(failed.mount.querySelector('.zp-comments__wordpress-note a').href, originalUrl);
    assert.equal(failed.form(), undefined);
    assert.equal(failed.mount.querySelector('[data-role="count"]').hidden, true);
  });

  if (templateName === 'blog') {
    test('WordPress loads beyond three pages on demand, preserves drafts on failure, and joins late parents', async t => {
      const calls = [];
      let fail = true;
      const pages = [[{ id: 2, parent: 1 }], [{ id: 2, parent: 1 }, { id: 3, parent: 0 }], [{ id: 1, parent: 0 }], [{ id: 4, parent: 0 }]];
      const p = await openComments(t, {}, null, null, async (url, options) => {
        const target = new URL(url);
        assert.equal(target.origin, 'https://comments.example');
        assert.equal(target.pathname, '/wp-json/wp/v2/comments');
        assert.equal(options.credentials, 'omit');
        const page = Number(target.searchParams.get('page'));
        calls.push(page);
        if (page === 2 && fail) return new Response('{}', { status: 429 });
        const payload = pages[page - 1].map(row => ({
          ...row, post: Number(target.searchParams.get('post')), author_name: 'Reader',
          date_gmt: '2026-01-01T00:00:00', content: { rendered: '<p>Comment ' + row.id + '</p>' },
        }));
        return new Response(JSON.stringify(payload), { headers: { 'X-WP-Total': '4', 'X-WP-TotalPages': '4' } });
      }, 3);
      assert.deepEqual(calls, [1]);
      const draft = p.fill('', 'Unsent comment');
      p.reply('2');
      const replyDraft = p.fill('2', 'Unsent reply');
      const more = () => p.mount.querySelector('[data-action="load-more"]');
      more().click();
      await tick();
      assert.match(p.mount.textContent, /too many requests/);
      assert.equal(p.mount.querySelectorAll('[data-role="comment-item"]').length, 1);
      assert.deepEqual(p.values(''), draft);
      fail = false;
      for (let page = 2; page <= 4; page++) {
        more().click();
        await tick();
        assert.deepEqual(p.values(''), draft);
        assert.deepEqual(p.values('2'), replyDraft);
      }
      assert.deepEqual(calls, [1, 2, 2, 3, 4]);
      assert.equal(p.mount.querySelectorAll('[data-role="comment-item"]').length, 4);
      assert.ok(p.mount.querySelector('[data-comment-id="1"]').contains(p.mount.querySelector('[data-comment-id="2"]')));
      assert.equal(p.mount.querySelector('[data-role="pagination"]').hidden, true);
      assert.equal(p.mount.querySelector('.zp-comments__wordpress-note'), null);
    });
  }

  test('comment and reply drafts survive switching replies and cancelling a reply', async t => {
    const p = await openComments(t);
    const main = p.fill('', 'Unsent main comment');
    p.reply('1');
    const first = p.fill('1', 'First reply draft');
    p.reply('2');
    const second = p.fill('2', 'Second reply draft');
    p.reply('1');
    assert.deepEqual(p.values(''), main);
    assert.deepEqual(p.values('1'), first);
    p.form('1').querySelector('[data-action="cancel-reply"]').click();
    p.reply('2');
    assert.deepEqual(p.values('2'), second);
    assert.deepEqual(p.values(''), main);
  });

  test('loading more comments preserves edits made before and during the request', async t => {
    let finish;
    const p = await openComments(t, { load: page => page === 1 ? Promise.resolve(pageAt(1)) : new Promise(resolve => { finish = resolve; }) });
    p.fill('', 'Initial main draft');
    p.reply('1');
    const reply = p.fill('1', 'Reply draft');
    p.mount.querySelector('[data-action="load-more"]').click();
    const latest = p.fill('', 'Edited while loading');
    finish(pageAt(2));
    await tick();
    assert.deepEqual(p.values(''), latest);
    assert.deepEqual(p.values('1'), reply);
    assert.equal(p.mount.querySelectorAll('[data-role="comment-item"]').length, 3);
  });

  test('failed pagination keeps drafts and loaded comments available for retry', async t => {
    let fail = true;
    const p = await openComments(t, { load: async page => {
      if (page === 2 && fail) throw new Error('Synthetic loading failure');
      return pageAt(page);
    } });
    const draft = p.fill('', 'Keep this draft after an API failure');
    p.mount.querySelector('[data-action="load-more"]').click();
    await tick();
    assert.deepEqual(p.values(''), draft);
    assert.equal(p.mount.querySelectorAll('[data-role="comment-item"]').length, 2);
    assert.match(p.mount.textContent, /Synthetic loading failure/);
    assert.equal(p.mount.querySelector('[data-action="load-more"]').disabled, false);
    fail = false;
    p.mount.querySelector('[data-action="load-more"]').click();
    await tick();
    assert.deepEqual(p.values(''), draft);
    assert.equal(p.mount.querySelectorAll('[data-role="comment-item"]').length, 3);
  });

  test('a rejected submission preserves both the submitted reply and the main draft', async t => {
    const p = await openComments(t, { submit: async () => { throw new Error('Synthetic submission failure'); } });
    const main = p.fill('', 'Independent main draft');
    p.reply('1');
    const reply = p.fill('1', 'Rejected reply');
    p.submit('1');
    await tick();
    assert.deepEqual(p.values(''), main);
    assert.deepEqual(p.values('1'), reply);
    assert.match(p.mount.textContent, /Synthetic submission failure/);
  });

  for (const publication of ['published', 'pending_moderation']) {
    for (const parent of ['', '1']) {
      test(`${publication} submission clears only its own draft (${parent || 'main'})`, async t => {
        const p = await openComments(t, { submit: async () => ({ publication }) });
        const main = p.fill('', 'Main draft');
        p.reply('1');
        const reply = p.fill('1', 'Reply draft');
        p.submit(parent);
        await tick();
        if (parent) {
          assert.deepEqual(p.values(''), main);
          p.reply('1');
          assert.equal(p.values('1').content, '');
        } else {
          assert.equal(p.values('').content, '');
          assert.deepEqual(p.values('1'), reply);
        }
      });
    }
  }

  test('successful submission does not erase later edits made while it was pending', async t => {
    let finish;
    const p = await openComments(t, { submit: () => new Promise(resolve => { finish = resolve; }) });
    p.fill('', 'Submitted draft');
    p.submit('');
    const next = p.fill('', 'Next draft, typed while sending');
    finish({ publication: 'published' });
    await tick();
    assert.deepEqual(p.values(''), next);
  });

  test('restored replies and disabled guest email fields survive identity changes and pagination', async t => {
    const stored = { parent: '1', author_name: 'Sample Author', author_email: 'reader@example.com', content: 'Restored reply' };
    const p = await openComments(t, {}, stored);
    assert.equal(p.values('1').content, stored.content);
    p.identity({ available: true, signedIn: true, email: 'reader@example.com', displayName: 'Sample Author' });
    assert.equal(p.form('1').querySelector('[name="author_email"]').disabled, true);
    p.mount.querySelector('[data-action="load-more"]').click();
    await tick();
    p.identity({ available: true, signedIn: false });
    assert.equal(p.values('1').author_email, stored.author_email);
    assert.equal(p.values('1').content, stored.content);
  });


  test('optional identity controls and server-confirmed author badges preserve guest access', async t => {
    const p = await openComments(t);
    const panel = p.mount.querySelector('[data-role="identity"]');
    assert.equal(panel.hidden, true);
    assert.equal(p.form('').querySelector('[name="author_email"]').required, true);
    assert.equal(p.mount.querySelector('[data-comment-id="1"] [data-role="author-badge"]').textContent, 'Site author');
    assert.equal(p.mount.querySelector('[data-comment-id="2"] [data-role="author-badge"]').textContent, 'Signed-in user');
    p.identity({ available: true, signedIn: false });
    assert.equal(panel.hidden, false);
    assert.ok(panel.querySelector('[name="identity_email"]'));
    p.identity({ available: true, signedIn: true, email: 'reader@example.com', displayName: 'Sample Reader' });
    assert.equal(p.form('').querySelector('[name="author_email"]').disabled, true);
    assert.equal(p.form('').querySelector('[data-role="guest-email-field"]').hidden, true);
    p.identity({ available: true, signedIn: false });
    assert.equal(p.form('').querySelector('[name="author_email"]').required, true);
    assert.equal(p.form('').querySelector('[data-role="guest-email-field"]').hidden, false);
  });

  test('comment and reply submissions use their own inline verification container', async t => {
    const targets = [];
    const p = await openComments(t, { submit: async input => {
      targets.push(input.verificationTarget);
      return { publication: 'pending_moderation' };
    } });
    for (const parent of ['', '1']) {
      if (parent) p.reply(parent);
      p.fill(parent, 'Synthetic submission');
      const target = p.form(parent).querySelector('[data-role="write-verification"]');
      assert.ok(target);
      p.submit(parent);
      await tick();
      assert.equal(targets.at(-1), target);
    }
  });

  test('comment dates use site date/time styles and browser locale/timezone', async t => {
    for (const [dateStyle, timeStyle] of [['short', 'none'], ['long', 'short'], ['none', 'none']]) {
      const p = await openComments(t, {}, null, { zpDateStyle: dateStyle, zpTimeStyle: timeStyle });
      const styles = {};
      if (dateStyle !== 'none') styles.dateStyle = dateStyle;
      if (timeStyle !== 'none') styles.timeStyle = timeStyle;
      const expected = Object.keys(styles).length
        ? new Intl.DateTimeFormat(undefined, styles).format(new Date(comments[0].createdAt)) : '';
      assert.equal(p.mount.querySelector('[data-role="date"]').textContent, expected);
    }
  });
}
