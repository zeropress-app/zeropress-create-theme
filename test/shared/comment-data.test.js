import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const sources = await Promise.all(['blog', 'minimal'].map(async name => ({
  name,
  source: await fs.readFile(new URL(`../../src/templates/${name}/theme/assets/comment-data.js`, import.meta.url), 'utf8'),
})));
const input = { parentId: '1', authorName: 'Sample Reader', authorEmail: 'reader@example.com', content: 'Synthetic reply.' };
const proof = { algorithm: 'zp-comment-pow-v1', scope: 'write', challenge_token: 'test-challenge', difficulty: 0, expires_at: '2099-01-01T00:00:00Z' };
const success = data => ({ ok: true, json: async () => ({ success: true, data }) });

for (const { name, source } of sources) {
  function open(t, respond) {
    const dom = new JSDOM('<!doctype html><form><div data-verification></div></form>', {
      url: 'https://site.example/posts/sample/', runScripts: 'outside-only',
    });
    const unexpected = [];
    t.after(() => { dom.window.close(); assert.deepEqual(unexpected, []); });
    dom.window.fetch = async (url, options = {}) => {
      const result = respond(new URL(url), options);
      if (!result) {
        unexpected.push(String(url));
        throw new Error('Unexpected API request');
      }
      return result;
    };
    dom.window.eval(source);
    const api = dom.window.ZeroPressCommentData.create({
      provider: 'zeropress', apiBaseUrl: 'https://edge.example/api', targetType: 'post',
      targetPublicId: 42, requestToken: 'test-request-token',
    });
    return { window: dom.window, api, target: dom.window.document.querySelector('[data-verification]') };
  }

  test(`${name}: guest comments work without optional identity and use PoW verification`, async t => {
    let submitted;
    const p = open(t, (url, options) => {
      if (url.pathname === '/api/comments/auth') return success({ enabled: false });
      if (url.pathname.endsWith('/challenge/write')) return success({ item: { mode: 'pow', scope: 'write', pow: proof } });
      if (options.method === 'POST') {
        submitted = options;
        return success({ publication: 'pending_moderation' });
      }
    });
    const state = await p.api.initializeIdentity();
    assert.equal(state.available, false);
    assert.equal(p.window.document.querySelector('script'), null);
    assert.equal((await p.api.submit(input)).publication, 'pending_moderation');
    const body = JSON.parse(submitted.body);
    assert.equal(submitted.headers.Authorization, undefined);
    assert.equal(body.parent_id, 1);
    assert.equal(body.author_email, input.authorEmail);
    assert.equal(body.comment_request_token, 'test-request-token');
    assert.equal(body.comment_challenge_token, 'test-challenge');
    assert.equal(typeof body.comment_challenge_solution, 'string');
  });

  test(`${name}: Turnstile mounts inside the active form and cleans up after submission`, async t => {
    let submitted;
    const p = open(t, (url, options) => {
      if (url.pathname.endsWith('/challenge/write')) return success({ item: {
        mode: 'turnstile', scope: 'write', turnstile: { site_key: 'test-site-key', action: 'comment_create' },
      } });
      if (options.method === 'POST') { submitted = JSON.parse(options.body); return success({ publication: 'published' }); }
    });
    let callback;
    let removed = false;
    p.window.turnstile = {
      render(container, options) {
        assert.equal(container.parentElement, p.target);
        assert.equal(options.sitekey, 'test-site-key');
        callback = options.callback;
        return 'test-widget';
      },
      execute(id) { assert.equal(id, 'test-widget'); callback('test-verification-token'); },
      remove(id) { assert.equal(id, 'test-widget'); removed = true; },
    };
    await p.api.submit({ ...input, verificationTarget: p.target });
    assert.equal(submitted.turnstile_token, 'test-verification-token');
    assert.equal(submitted.comment_challenge_token, undefined);
    assert.equal(removed, true);
    assert.equal(p.target.children.length, 0);
  });

  test(`${name}: optional identity signs in, authenticates writes and returns to guest access`, async t => {
    const writes = [];
    const p = open(t, (url, options) => {
      if (url.pathname === '/api/comments/auth') return success({
        enabled: true, provider: 'supabase', mode: 'optional',
        project_url: 'https://auth.example', publishable_key: 'sb_publishable_test_only_123456789',
      });
      if (url.pathname.endsWith('/challenge/write')) return success({ item: { mode: 'pow', scope: 'write', pow: proof } });
      if (options.method === 'POST') { writes.push(options); return success({ publication: 'published' }); }
    });
    let session = null;
    let authChanged;
    let signIn;
    p.window.supabase = { createClient: (url, key) => {
      assert.equal(url, 'https://auth.example');
      assert.equal(key, 'sb_publishable_test_only_123456789');
      return { auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange(callback) { authChanged = callback; return { data: { subscription: {} } }; },
        signInWithOtp: async options => { signIn = options; return {}; },
        signOut: async () => { session = null; authChanged('SIGNED_OUT', null); return {}; },
      } };
    } };
    const states = [];
    await p.api.initializeIdentity(state => states.push(state));
    assert.equal(states.at(-1).available, true);
    assert.equal(states.at(-1).signedIn, false);
    await p.api.requestIdentitySignIn('reader@example.com');
    assert.equal(signIn.email, 'reader@example.com');
    assert.equal(signIn.options.emailRedirectTo, 'https://site.example/posts/sample/');
    session = { access_token: 'test-access-token', user: { email: 'reader@example.com', user_metadata: { full_name: 'Sample Reader' } } };
    authChanged('SIGNED_IN', session);
    await p.api.submit(input);
    assert.equal(writes.at(-1).headers.Authorization, 'Bearer test-access-token');
    assert.equal(Object.hasOwn(JSON.parse(writes.at(-1).body), 'author_email'), false);
    await p.api.signOutIdentity();
    await p.api.submit(input);
    assert.equal(writes.at(-1).headers.Authorization, undefined);
    assert.equal(JSON.parse(writes.at(-1).body).author_email, input.authorEmail);
    assert.equal(states.at(-1).signedIn, false);
  });
}
