import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runBuild } from '@zeropress/build';
import { JSDOM, VirtualConsole } from 'jsdom';

const timestamp = '2026-01-01T23:30:00Z';
const publication = {
  version: '0.7', generator: 'date-time-test', generated_at: timestamp,
  site: {
    title: 'Sample publication', description: 'Synthetic content.', url: 'https://site.example',
    locale: 'en-US', timezone: 'UTC', media_origin: '', posts_per_page: 10,
    date_style: 'long', time_style: 'short', search: { enabled: false },
  },
  content: {
    authors: [{ id: 'sample-author', display_name: 'Sample Author' }],
    posts: [{
      public_id: 1, title: 'Sample article', slug: 'sample', author_id: 'sample-author',
      document_type: 'markdown', content: 'Synthetic article.', excerpt: '', status: 'published',
      published_at_iso: timestamp, updated_at_iso: timestamp, category_slugs: ['sample'], tag_slugs: ['sample'],
    }],
    pages: [{
      public_id: 2, title: 'Sample page', slug: 'about', document_type: 'markdown',
      content: 'Synthetic page.', status: 'published', updated_at_iso: timestamp,
    }],
    categories: [{ slug: 'sample', name: 'Sample' }], tags: [{ slug: 'sample', name: 'Sample' }],
  },
  menus: {},
};
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-date-time-'));
after(() => fs.rm(root, { recursive: true, force: true }));
const fixtures = await Promise.all(['blog', 'minimal', 'docs'].map(async name => {
  const template = fileURLToPath(new URL(`../../src/templates/${name}/theme/`, import.meta.url));
  const output = path.join(root, name);
  await runBuild(template, structuredClone(publication), output);
  return {
    name, template, output,
    source: await fs.readFile(path.join(template, 'assets/theme.js'), 'utf8'),
    html: await fs.readFile(path.join(output, 'posts/sample/index.html'), 'utf8'),
  };
}));

function withBrowser(fixture, options, check) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { throw error; });
  const dom = new JSDOM(fixture.html, {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://site.example/posts/sample/', virtualConsole,
  });
  try {
    const { window } = dom;
    const calls = [];
    window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    window.fetch = () => { throw new Error('Unexpected external request'); };
    const element = window.document.querySelector('time');
    assert.ok(element, `${fixture.name}: expected a timestamp`);
    const initial = element.textContent;
    if (options.dateStyle !== undefined) window.document.documentElement.dataset.zpDateStyle = options.dateStyle;
    if (options.timeStyle !== undefined) window.document.documentElement.dataset.zpTimeStyle = options.timeStyle;
    if (options.datetime !== undefined) element.setAttribute('datetime', options.datetime);
    if (options.intlAvailable === false) {
      window.Intl = undefined;
    } else {
      window.Intl.DateTimeFormat = function (requestedLocale, styles) {
        calls.push({ locale: requestedLocale, styles: { ...styles } });
        return new Intl.DateTimeFormat(requestedLocale ?? options.locale ?? 'ko-KR', {
          timeZone: options.timezone ?? 'Asia/Seoul', ...styles,
        });
      };
    }
    window.eval(fixture.source);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    check({ element, initial, calls });
  } finally {
    dom.window.close();
  }
}

for (const fixture of fixtures) {
  const { name } = fixture;
  test(`${name}: date/time styles use browser language and timezone across date and DST boundaries`, () => {
    for (const [dateStyle, timeStyle] of [['short', 'none'], ['long', 'short'], ['none', 'full']]) {
      const styles = {};
      if (dateStyle !== 'none') styles.dateStyle = dateStyle;
      if (timeStyle !== 'none') styles.timeStyle = timeStyle;
      for (const [locale, timezone] of [['ko-KR', 'Asia/Seoul'], ['en-US', 'America/New_York']]) {
        for (const datetime of [timestamp, '2026-07-01T23:30:00Z']) {
          withBrowser(fixture, { dateStyle, timeStyle, locale, timezone, datetime }, ({ element, calls }) => {
            assert.equal(element.textContent, new Intl.DateTimeFormat(locale, {
              ...styles, timeZone: timezone,
            }).format(new Date(datetime)));
            assert.equal(element.getAttribute('datetime'), datetime);
            for (const call of calls) {
              assert.equal(call.locale, undefined, 'Use the browser language');
              assert.equal(Object.hasOwn(call.styles, 'timeZone'), false, 'Use the browser timezone');
            }
            assert.deepEqual(calls.at(-1).styles, styles);
          });
        }
      }
    }
  });

  test(`${name}: unavailable formatting and invalid timestamps preserve the initial HTML`, () => {
    for (const options of [{ intlAvailable: false }, { dateStyle: 'invalid-style' }, { datetime: 'invalid-date' }]) {
      withBrowser(fixture, options, ({ element, initial }) => {
        assert.equal(element.textContent, initial);
        assert.equal(element.getAttribute('title'), timestamp);
      });
    }
  });

  test(`${name}: hiding dates and times stays hidden before and after client initialization`, async () => {
    const hidden = structuredClone(publication);
    hidden.site.date_style = 'none';
    hidden.site.time_style = 'none';
    const output = path.join(root, `${name}-hidden`);
    await runBuild(fixture.template, hidden, output);
    for (const route of name === 'docs' ? ['posts/sample', 'about'] : ['posts/sample', '']) {
      const html = await fs.readFile(path.join(output, route, 'index.html'), 'utf8');
      const dom = new JSDOM(html, { runScripts: 'outside-only' });
      try {
        assert.ok([...dom.window.document.querySelectorAll('time')].every(time => time.textContent === ''));
        if (name === 'docs') {
          assert.equal(dom.window.document.querySelector('.page-meta__updated'), null);
        }
      } finally {
        dom.window.close();
      }
      if (name !== 'docs') {
        withBrowser({ ...fixture, html }, {}, ({ element, calls }) => {
          assert.equal(element.textContent, '');
          assert.equal(calls.length, 0);
        });
      }
    }
    // Even a pre-existing time element must not regain its date after initialization.
    withBrowser(fixture, { dateStyle: 'none', timeStyle: 'none' }, ({ element, calls }) => {
      assert.equal(element.textContent, '');
      assert.equal(calls.length, 0);
    });
  });

  test(`${name}: rendered routes expose ISO timestamps and site styles with a no-JavaScript fallback`, async () => {
    const routes = name === 'docs'
      ? ['posts/sample', 'about']
      : ['', 'archive', 'categories/sample', 'tags/sample', 'posts/sample'];
    const fallback = new Intl.DateTimeFormat(publication.site.locale, {
      dateStyle: 'long', timeStyle: 'short', timeZone: publication.site.timezone,
    }).format(new Date(timestamp));
    for (const route of routes) {
      const html = await fs.readFile(path.join(fixture.output, route, 'index.html'), 'utf8');
      const dom = new JSDOM(html);
      try {
        const { document } = dom.window;
        assert.equal(document.documentElement.dataset.zpDateStyle, 'long');
        assert.equal(document.documentElement.dataset.zpTimeStyle, 'short');
        const times = [...document.querySelectorAll('time')];
        assert.ok(times.length, route);
        for (const time of times) {
          assert.equal(time.getAttribute('datetime'), timestamp, route);
          assert.equal(time.getAttribute('title'), timestamp, route);
          assert.equal(time.textContent, fallback, route);
          assert.ok(time.hasAttribute('data-zp-local-date-time'), route);
        }
      } finally {
        dom.window.close();
      }
    }
  });
}
