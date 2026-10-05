import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { runBuild } from '@zeropress/build';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

async function withTempCwd(fn) {
  const cwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zp-theme-'));

  try {
    process.chdir(tempDir);
    return await fn(tempDir);
  } finally {
    process.chdir(cwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function syntheticPublication() {
  const authorId = '11111111-1111-4111-8111-111111111111';
  const posts = [
    { slug: 'body-summary', excerpt: '', content: 'A summary derived from body text.' },
    { slug: 'authored-summary', excerpt: 'An authored description.', content: 'Different body text.' },
  ].map((post, index) => ({
    public_id: index + 1, title: `Sample post ${index + 1}`, document_type: 'markdown',
    published_at_iso: '2026-01-01T00:00:00Z', updated_at_iso: '2026-01-01T00:00:00Z',
    author_id: authorId, status: 'published', category_slugs: ['sample'], tag_slugs: ['sample'],
    ...post,
  }));
  const projects = posts.map((post) => ({
    public_id: post.public_id + 10, title: `Sample project ${post.public_id}`,
    slug: `project-${post.slug}`, document_type: 'markdown', content: post.content,
    excerpt: post.excerpt, status: 'published', meta: { page_type: 'project' },
  }));
  const projectItems = projects.map((page) => ({ type: 'page', path: page.slug }));
  return {
    version: '0.7', generator: 'create-theme-test', generated_at: '2026-01-01T00:00:00Z',
    site: {
      title: 'Sample publication', description: 'Synthetic content.', url: 'https://site.example',
      locale: 'en-US', timezone: 'UTC', media_origin: '', posts_per_page: 10,
      date_style: 'medium', time_style: 'none',
      permalinks: { output_style: 'directory', posts: '/posts/:slug/', pages: '/:slug/', categories: '/categories/:slug/', tags: '/tags/:slug/' },
    },
    content: {
      authors: [{ id: authorId, display_name: 'Sample Author' }], posts,
      pages: [...projects, { title: 'Work', slug: 'work', document_type: 'markdown', content: 'Selected projects.', status: 'published' }],
      categories: [{ slug: 'sample', name: 'Sample category' }],
      tags: [{ slug: 'sample', name: 'Sample tag' }],
    },
    menus: {},
    collections: {
      cases: { title: 'Featured projects', items: projectItems },
      work: { title: 'All projects', items: projectItems },
      'cover-story': { title: 'Cover story', items: [{ type: 'post', slug: posts[0].slug }] },
      'latest-grid': { title: 'Latest stories', items: posts.map((post) => ({ type: 'post', slug: post.slug })) },
    },
  };
}

async function readDocument(output, route, check) {
  const html = await fs.readFile(path.join(output, route, 'index.html'), 'utf8');
  const dom = new JSDOM(html);
  try {
    check(dom.window.document);
  } finally {
    dom.window.close();
  }
}

for (const template of ['blog', 'magazine', 'minimal', 'portfolio']) {
  test(`${template} renders body summaries in listings and authored excerpts in detail ledes`, async () => {
    await withTempCwd(async (root) => {
      const data = syntheticPublication();
      const output = path.join(root, 'dist');
      await runBuild(path.join(packageRoot, 'src', 'templates', template, 'theme'), data, output);
      const routes = ['', 'categories/sample', 'tags/sample'];
      if (template === 'portfolio') routes.push('work');
      for (const route of routes) {
        await readDocument(output, route, (document) => {
          const text = document.querySelector('main').textContent;
          assert.ok(text.includes(data.content.posts[0].content), `${route}: body summary`);
          assert.ok(text.includes(data.content.posts[1].excerpt), `${route}: authored excerpt`);
        });
      }
      if (template === 'minimal') return;
      const details = data.content.posts.map((post) => ({ route: `posts/${post.slug}`, excerpt: post.excerpt }));
      if (template === 'portfolio') {
        details.push(...data.content.pages.slice(0, 2).map((page) => ({ route: page.slug, excerpt: page.excerpt })));
      }
      for (const { route, excerpt } of details) {
        await readDocument(output, route, (document) => {
          const lede = document.querySelector('article .lede, article .article__dek, article .page-lede');
          assert.equal(lede?.textContent.trim() ?? '', excerpt, route);
        });
      }
    });
  });
}

for (const template of ['blog', 'minimal']) {
  test(`${template} renders comments and their scripts only on enabled routes`, async () => {
    await withTempCwd(async (root) => {
      const data = syntheticPublication();
      data.site.comments = { enabled: true, provider: 'wordpress', api_base_url: 'https://comments.example/wp-json/wp/v2' };
      data.content.posts.forEach((post, index) => { post.allow_comments = index === 0; });
      data.content.pages.forEach((page, index) => { page.allow_comments = index === 0; });
      const routes = [
        { route: '', enabled: false },
        ...data.content.posts.map((post) => ({ route: `posts/${post.slug}`, enabled: post.allow_comments, type: 'post', id: post.public_id })),
        ...data.content.pages.slice(0, 2).map((page) => ({ route: page.slug, enabled: page.allow_comments, type: 'page', id: page.public_id })),
      ];
      for (const enabled of [true, false]) {
        data.site.comments.enabled = enabled;
        const output = path.join(root, String(enabled));
        await runBuild(path.join(packageRoot, 'src', 'templates', template, 'theme'), data, output);
        for (const route of routes) {
          await readDocument(output, route.route, (document) => {
            const expected = enabled && route.enabled;
            const island = document.querySelector('[data-zp-comments]');
            assert.equal(Boolean(island), expected, route.route);
            for (const script of ['comment.js', 'comment-data.js']) {
              const name = script.slice(0, -3);
              const sourcePattern = new RegExp(`/assets/${name}(?:\\.[a-f0-9]+)?\\.js$`, 'u');
              assert.equal([...document.querySelectorAll('script[src]')].some(
                (element) => sourcePattern.test(element.getAttribute('src')),
              ), expected, route.route);
            }
            if (!expected) return;
            assert.equal(island.dataset.zpCommentsTargetType, route.type);
            assert.equal(island.dataset.zpCommentsTargetPublicId, String(route.id));
            assert.equal(island.dataset.zpCommentsProvider, data.site.comments.provider);
            assert.equal(island.dataset.zpCommentsApiBaseUrl, data.site.comments.api_base_url);
            const shell = document.querySelector('template[data-zp-comments-shell]').content;
            assert.ok(shell.querySelector('[data-role="pagination"] [data-action="load-more"]'));
            const form = document.querySelector('template[data-zp-comments-form]').content;
            assert.equal(form.querySelector('[aria-hidden="true"] input[name="website"]').tabIndex, -1);
          });
        }
      }
    });
  });
}
