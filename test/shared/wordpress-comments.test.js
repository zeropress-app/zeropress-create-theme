import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const sources = await Promise.all(['blog', 'minimal'].map(async name => ({
  name, source: await fs.readFile(new URL(`../../src/templates/${name}/theme/assets/comment-data.js`, import.meta.url), 'utf8'),
})));
const rows = (count, offset = 0) => Array.from({ length: count }, (_, index) => ({
  id: offset + index + 1, post: 42, parent: 0, author_name: '<b>Reader</b>',
  date_gmt: '2026-01-01T00:00:00', content: { rendered: '<p>Synthetic comment</p>' },
}));
const response = (payload, headers = {}, status = 200) => new Response(JSON.stringify(payload), { status, headers });
for (const { name, source } of sources) {
  function open(t, fetch, overrides = {}) {
    const dom = new JSDOM('<!doctype html>', { url: 'https://site.example/', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    dom.window.fetch = async (url, options) => new URL(url).pathname.endsWith('/zeropress-static/v1/comments/policy')
      ? response({ code: 'rest_no_route' }, {}, 404) : fetch(url, options);
    dom.window.eval(source);
    const api = dom.window.ZeroPressCommentData.create({ provider: 'wordpress', apiBaseUrl: 'https://wordpress.example/blog/wp-json/wp/v2', targetType: 'post', targetPublicId: 42, ...overrides });
    return { api, window: dom.window };
  }
  for (const total of [0, 50, 100, 150, 400]) {
    test(`${name}: WordPress reads honor total headers (${total})`, async t => {
      let calls = 0;
      const { api } = open(t, async (url, options) => {
        const query = new URL(url).searchParams;
        assert.equal(query.get('post'), '42'); assert.equal(query.get('per_page'), '50');
        assert.equal(query.get('orderby'), 'date_gmt'); assert.equal(query.get('order'), 'desc');
        assert.equal(options.credentials, 'omit'); assert.ok(options.signal);
        const page = ++calls;
        assert.equal(query.get('page'), String(page));
        return response(rows(Math.max(0, Math.min(50, total - (page - 1) * 50)), (page - 1) * 50), { 'X-WP-Total': String(total), 'X-WP-TotalPages': String(Math.ceil(total / 50)) });
      });
      const result = await api.load();
      assert.equal(calls, name === 'blog' ? 1 : Math.min(3, Math.max(1, Math.ceil(total / 50))));
      assert.equal(result.comments.length, Math.min(total, name === 'blog' ? 50 : 150));
      assert.equal(result.pagination.totalComments, total);
      if (name === 'blog') {
        const pages = Math.max(1, Math.ceil(total / 50));
        assert.equal(result.pagination.totalPages, pages);
        for (let page = 2; page <= pages; page++) {
          const next = await api.load(page);
          assert.equal(calls, page);
          assert.equal(next.pagination.currentPage, page);
          assert.equal(next.pagination.totalPages, pages);
          assert.equal(next.comments[0].id, String((page - 1) * 50 + 1));
        }
      } else assert.equal(result.pagination.limited, total > 150);
      assert.equal(api.originalUrl, name === 'blog' ? undefined : 'https://wordpress.example/blog/?p=42#comments');
    });
  }
  test(`${name}: WordPress works without exposed headers and tolerates a terminal full-page probe`, async t => {
    let calls = 0;
    const { api } = open(t, async () => ++calls === 1 ? response(rows(50)) : response({ code: 'rest_comment_invalid_page_number' }, {}, 400));
    const result = await api.load();
    assert.equal(result.comments.length, 50);
    if (name === 'blog') {
      assert.equal(calls, 1);
      assert.equal(result.pagination.totalPages, 2);
      assert.equal('totalComments' in result.pagination, false);
      const last = await api.load(2);
      assert.equal(last.comments.length, 0);
      assert.equal(last.pagination.currentPage, 2);
      assert.equal(last.pagination.totalPages, 2);
    } else assert.equal(result.pagination.limited, false);
    assert.equal(calls, 2);
  });
  test(`${name}: missing headers preserve the theme's pagination policy`, async t => {
    let calls = 0;
    const { api } = open(t, async () => response(rows(100, calls++ * 100)), { perPage: 100, order: 'asc', targetType: 'page' });
    const result = await api.load();
    if (name === 'blog') {
      assert.equal(calls, 1); assert.equal(result.comments.length, 100);
      assert.equal('totalComments' in result.pagination, false);
      for (let page = 2; page <= 4; page++) {
        const next = await api.load(page);
        assert.equal(calls, page);
        assert.equal(next.pagination.totalPages, page + 1);
      }
    } else {
      assert.equal(calls, 3); assert.equal(result.comments.length, 300); assert.equal(result.pagination.limited, true);
    }
    assert.equal(api.originalUrl, name === 'blog' ? undefined : 'https://wordpress.example/blog/?page_id=42#comments');
  });
  test(`${name}: WordPress rejects a failure instead of inventing zero comments`, async t => {
    for (const status of [401, 403, 429, 503]) {
      const { api } = open(t, async () => response({}, {}, status));
      await assert.rejects(api.load());
    }
    const { api } = open(t, async () => response([{ ...rows(1)[0], post: 43 }]));
    await assert.rejects(api.load(), /unreadable/);
    const oversized = open(t, async () => response(rows(51))).api;
    await assert.rejects(oversized.load(), /unreadable/);
  });
  if (name === 'blog') {
    test('blog: validates pages without requests and supports total-only pagination headers', async t => {
      let calls = 0;
      const { api } = open(t, async () => {
        calls++;
        return response(rows(2), { 'X-WP-Total': '9' });
      }, { perPage: 2 });
      for (const page of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2']) {
        await assert.rejects(api.load(page), /page is invalid/);
      }
      assert.equal(calls, 0);
      const first = await api.load();
      assert.equal(first.pagination.totalPages, 5);
      assert.equal(first.pagination.totalComments, 9);
      assert.equal(calls, 1);
    });
    test('blog: a short or empty page with unknown totals ends pagination', async t => {
      for (const payload of [[], rows(1)]) {
        const { api } = open(t, async () => response(payload, { 'X-WP-Total': 'invalid', 'X-WP-TotalPages': '-1' }), { perPage: 2 });
        const result = await api.load(4);
        assert.equal(result.pagination.totalPages, 4);
        assert.equal('totalComments' in result.pagination, false);
      }
    });
  }
  test(`${name}: WordPress POST never retries uncertain writes`, async t => {
    for (const finish of [() => { throw new Error('Connection lost'); }, () => response({}, {}, 500), () => new Response('<html>Unknown outcome</html>'), () => response({ id: 1, post: 43 })]) {
      let calls = 0;
      const { api } = open(t, async (url, options) => {
        calls++; assert.equal(options.method, 'POST'); assert.equal(new URL(url).searchParams.get('post'), '42');
        assert.equal(options.body.get('content'), 'Synthetic message'); return finish();
      });
      await assert.rejects(api.submit({ authorName: 'Reader', authorEmail: 'reader@example.com', content: 'Synthetic message' }), /could not be confirmed/);
      assert.equal(calls, 1);
    }
  });
  test(`${name}: WordPress times out and retains a confirmed publication outcome`, async t => {
    const { api, window } = open(t, (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })));
    const original = window.setTimeout.bind(window);
    window.setTimeout = callback => original(callback, 1);
    await assert.rejects(api.load(), /Cannot reach/);
    window.fetch = async url => new URL(url).pathname.endsWith('/zeropress-static/v1/comments/policy')
      ? response({ code: 'rest_no_route' }, {}, 404) : response({ id: 5, post: 42, status: 'approved' }, {}, 201);
    assert.equal((await api.submit({ authorName: 'Reader', authorEmail: 'reader@example.com', content: 'Message' })).publication, 'published');
  });
  test(`${name}: WordPress text is decoded without executable or invisible HTML`, async t => {
    const { api } = open(t, async () => response([{ ...rows(1)[0], author_name: '<b>Reader &amp; Co</b>', content: { rendered: '<p>Hello</p><script>secret()</script><style>body{}</style>' } }]));
    const result = await api.load();
    assert.equal(result.comments[0].authorName, 'Reader & Co');
    assert.equal(result.comments[0].contentText, 'Hello');
  });
}
