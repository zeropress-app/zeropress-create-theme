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
  const data = JSON.parse(await fs.readFile(path.join(template, 'zeropress-preview-data.json'), 'utf8'));
  data.site.comments = { enabled: true, provider: 'wordpress', api_base_url: 'https://comments.example/wp-json/wp/v2' };
  data.content.posts.forEach(post => { post.allow_comments = true; });
  const output = path.join(temporary, templateName);
  await runBuild(path.join(template, 'theme'), data, output);
  const html = await fs.readFile(path.join(output, `posts/${data.content.posts[0].slug}/index.html`), 'utf8');
  return { templateName, source, html };
}));

for (const { templateName, source, html } of fixtures) {
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

  async function openComments(t, overrides = {}, stored = null, dateStyles = null) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(html, { url: 'https://site.example/', runScripts: 'outside-only', virtualConsole });
    t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
    await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    const { window } = dom;
    if (dateStyles) Object.assign(window.document.documentElement.dataset, dateStyles);
    const mount = window.document.querySelector('[data-zp-comments]');
    const storageKey = `zeropress:comment-draft:v1:${mount.dataset.zpCommentsTargetType}:${mount.dataset.zpCommentsTargetPublicId}`;
    if (stored) window.sessionStorage.setItem(storageKey, JSON.stringify(stored));
    let notifyIdentity;
    window.fetch = () => { throw new Error('Unexpected network request'); };
    window.ZeroPressCommentData = {
      create: () => ({
        load: async page => pageAt(page),
        submit: async () => ({ publication: 'pending_moderation' }),
        initializeIdentity: callback => { notifyIdentity = callback; },
        ...overrides,
      }),
      getErrorMessages: error => [error.message],
    };
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
