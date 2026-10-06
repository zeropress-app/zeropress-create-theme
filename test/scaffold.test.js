import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { canonicalizePreviewDataKeyOrder } from '@zeropress/preview-data-validator';
import { JSDOM } from 'jsdom';
import { run } from '../src/index.js';

const execFileAsync = promisify(execFile);
const packageJsonPath = new URL('../package.json', import.meta.url);
const templates = ['minimal', 'blog', 'magazine', 'docs', 'portfolio'];

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

async function captureLogs(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    await fn();
    return logs;
  } finally {
    console.log = originalLog;
  }
}

test('run scaffolds a buildable v0.7 theme runtime with v0.7 preview data', async () => {
  await withTempCwd(async (tempDir) => {
    const startedAt = Date.now();
    const logs = await captureLogs(() => run(['--name', 'my-theme', '--template', 'portfolio']));
    const completedAt = Date.now();
    const projectDir = path.join(tempDir, 'my-theme');
    const themeJson = JSON.parse(await fs.readFile(path.join(projectDir, 'theme', 'theme.json'), 'utf8'));
    const previewData = JSON.parse(await fs.readFile(path.join(projectDir, 'zeropress-preview-data.json'), 'utf8'));
    const starterPackage = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
    const gitignore = await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8');
    const canonicalProjectDir = await fs.realpath(projectDir);

    assert.equal(themeJson.$schema, 'https://www.schemastore.org/zeropress-theme-runtime-0.7.json');
    assert.equal(themeJson.name, 'my-theme');
    assert.equal(themeJson.namespace, 'my-company');
    assert.equal(themeJson.slug, 'my-theme');
    assert.equal(themeJson.version, '0.1.0');
    assert.equal(themeJson.license, 'MIT');
    assert.equal(themeJson.runtime, '0.7');
    assert.equal(previewData.version, '0.7');
    assert.equal(previewData.$schema, 'https://www.schemastore.org/zeropress-preview-data-0.7.json');
    assert.equal(previewData.generator, 'zeropress-create-theme');
    assert.equal(typeof previewData.generated_at, 'string');
    assert.equal(Date.parse(previewData.generated_at) >= startedAt, true);
    assert.equal(Date.parse(previewData.generated_at) <= completedAt, true);
    assert.equal(previewData.site.media_origin, '');
    assert.equal(Object.hasOwn(previewData.site, 'media_base_url'), false);
    assert.equal(starterPackage.private, true);
    const packageMetadata = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    assert.deepEqual(starterPackage.engines, packageMetadata.engines);
    for (const command of ['build', 'dev']) {
      assert.equal(typeof starterPackage.scripts[command], 'string');
      assert.notEqual(starterPackage.scripts[command].trim(), '');
      assert.match(starterPackage.scripts[command], /(?:^|\s)--data\s+\.\/zeropress-preview-data\.json(?:\s|$)/u, command);
    }
    for (const dependency of ['@zeropress/build', '@zeropress/theme']) {
      assert.equal(typeof starterPackage.dependencies[dependency], 'string', dependency);
      // Explicit release versions/ranges keep generated projects installable from npm.
      assert.match(starterPackage.dependencies[dependency], /^[~^]?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u, dependency);
    }
    const ignoredPaths = new Set(gitignore.split(/\r?\n/u).map((line) => line.trim()));
    for (const ignoredPath of ['node_modules/', 'dist/']) assert.ok(ignoredPaths.has(ignoredPath));
    assert.ok(logs.some((line) => line.includes(canonicalProjectDir)));
    const output = logs.join('\n');
    for (const command of [/\bcd\s+my-theme\b/u, /\bnpm\s+install\b/u, /\bnpm\s+run\s+dev\b/u, /\bnpm\s+run\s+build\b/u]) {
      assert.match(output, command);
    }
    await assert.rejects(() => fs.access(path.join(projectDir, 'layout.html')));
  });
});

for (const template of templates) {
  test(`${template} source Preview Data uses canonical formatting and identifies its generator`, async () => {
    const source = await fs.readFile(
      new URL(`../src/templates/${template}/zeropress-preview-data.json`, import.meta.url), 'utf8',
    );
    const previewData = JSON.parse(source);
    assert.equal(
      source,
      `${JSON.stringify(canonicalizePreviewDataKeyOrder(previewData), null, 2)}\n`,
      'Run npm run format:preview-data to format the bundled samples.',
    );
    assert.equal(previewData.generator, 'zeropress-create-theme');
    assert.equal(typeof previewData.generated_at, 'string');
    assert.equal(Number.isNaN(Date.parse(previewData.generated_at)), false);
  });

  test(`run self-validates and builds generated ${template} starter`, async () => {
    await withTempCwd(async (tempDir) => {
      const slug = `${template}-starter`;
      await run(['--name', slug, '--template', template]);

      const projectDir = path.join(tempDir, slug);
      const themeJson = JSON.parse(await fs.readFile(path.join(projectDir, 'theme', 'theme.json'), 'utf8'));
      const previewData = JSON.parse(await fs.readFile(path.join(projectDir, 'zeropress-preview-data.json'), 'utf8'));
      await assert.rejects(() => fs.access(path.join(projectDir, 'preview-data.json')), /ENOENT/);
      assert.equal(themeJson.slug, slug);
      assert.equal(themeJson.runtime, '0.7');
      assert.equal(themeJson.$schema, 'https://www.schemastore.org/zeropress-theme-runtime-0.7.json');
      assert.equal(previewData.$schema, 'https://www.schemastore.org/zeropress-preview-data-0.7.json');
      assert.equal(previewData.generator, 'zeropress-create-theme');
      assert.equal(Number.isNaN(Date.parse(previewData.generated_at)), false);
      assert.equal(JSON.stringify(previewData), JSON.stringify(canonicalizePreviewDataKeyOrder(previewData)));

      if (template === 'blog') {
        previewData.content.posts[0].excerpt = '';
        previewData.content.posts[0].content = 'A body-derived summary for the blog listing.';
        await fs.writeFile(path.join(projectDir, 'zeropress-preview-data.json'), JSON.stringify(previewData), 'utf8');
      }

      await execFileAsync('npm', ['run', 'build'], { cwd: projectDir });

      await fs.access(path.join(projectDir, 'dist', 'index.html'));

      await fs.writeFile(path.join(projectDir, 'dist', 'stale.txt'), 'stale output', 'utf8');

      await execFileAsync('npm', ['run', 'build'], { cwd: projectDir });

      await fs.access(path.join(projectDir, 'dist', 'index.html'));
      await assert.rejects(
        () => fs.access(path.join(projectDir, 'dist', 'stale.txt')),
        /ENOENT/,
      );

      if (template === 'blog') {
        assert.equal(previewData.site.newsletter.embed_url, '/zp_newsletter/');
        const newsletterFile = 'zp_newsletter/index.html';
        for (const folder of ['zp_form', 'zp_newsletter']) {
          for (const file of ['index.html', 'style.css', 'app.js', 'config.json']) {
            const source = await fs.readFile(path.join(projectDir, 'public', folder, file));
            const output = await fs.readFile(path.join(projectDir, 'dist', folder, file));
            assert.deepEqual(output, source);
          }
        }
        await fs.access(path.join(projectDir, 'dist', '_zeropress', 'search.js'));
        const html = await fs.readFile(path.join(projectDir, 'dist', 'index.html'), 'utf8');
        const newsletter = await fs.readFile(path.join(projectDir, 'public', newsletterFile), 'utf8');
        const home = new JSDOM(html);
        const subscription = new JSDOM(newsletter);
        try {
          assert.equal(themeJson.features.search, true);
          const document = home.window.document;
          assert.ok(document.querySelector('[data-newsletter-open]'));
          assert.ok(document.querySelector('iframe[src="/zp_newsletter/"]'));
          assert.ok([...document.querySelectorAll('.post-excerpt')].some(
            (element) => element.textContent.trim() === 'A body-derived summary for the blog listing.',
          ));
          assert.ok(document.querySelector('[data-cmdk-open]'));
          assert.ok(document.querySelector('[data-cmdk-input]'));
          const formDocument = subscription.window.document;
          assert.ok(formDocument.querySelector('form[data-newsletter-form]'));
          assert.equal(formDocument.querySelector('[data-newsletter-controls]').disabled, true);
          assert.equal(formDocument.querySelector('[data-newsletter-submit]').disabled, true);
        } finally {
          home.window.close();
          subscription.window.close();
        }
      }

      if (template === 'docs') {
        const previewData = JSON.parse(await fs.readFile(path.join(projectDir, 'zeropress-preview-data.json'), 'utf8'));
        const homeHtml = await fs.readFile(path.join(projectDir, 'dist', 'index.html'), 'utf8');
        const allPageContent = previewData.content.pages.map((page) => page.content).join('\n');

        assert.equal(previewData.generator, 'zeropress-create-theme');
        assert.equal(previewData.site.url, '');
        assert.doesNotMatch(allPageContent, /@zeropress\/build-pages|zeropress-build-pages|\.\/documents/);
        assert.equal(previewData.content.pages.some((page) => Object.hasOwn(page.meta || {}, 'source_markdown_url')), false);
        assert.doesNotMatch(homeHtml, /docs2\.zeropress\.page|@zeropress\/build-pages/);
        await assert.rejects(() => fs.access(path.join(projectDir, 'public', 'index.md')), /ENOENT/);
        await fs.access(path.join(projectDir, 'public', 'media', 'video.mp4'));
      }

      if (template === 'portfolio') {
        const previewDataRaw = await fs.readFile(path.join(projectDir, 'zeropress-preview-data.json'), 'utf8');
        const contactPartial = await fs.readFile(
          path.join(projectDir, 'theme', 'partials', 'contact-info.html'),
          'utf8',
        );
        assert.doesNotMatch(`${previewDataRaw}\n${contactPartial}`, /junpark\.studio|press@/i);
        assert.match(previewDataRaw, /hello@example\.com/);
      }
    });
  });
}

test('run canonicalizes disordered source keys while preserving values and array order', async (t) => {
  const sourcePath = fileURLToPath(new URL('../src/templates/minimal/zeropress-preview-data.json', import.meta.url));
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  };
  const disordered = reverseKeys(source);
  const readFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (file, ...args) => (
    file === sourcePath ? JSON.stringify(disordered) : readFile(file, ...args)
  ));

  await withTempCwd(async (tempDir) => {
    await run(['--name', 'ordered-starter', '--template', 'minimal']);
    const output = await fs.readFile(path.join(tempDir, 'ordered-starter', 'zeropress-preview-data.json'), 'utf8');
    const generated = JSON.parse(output);
    const expected = { ...disordered, generated_at: generated.generated_at };
    assert.deepEqual(generated, expected);
    assert.equal(output, `${JSON.stringify(canonicalizePreviewDataKeyOrder(expected), null, 2)}\n`);
  });
});

test('run rejects a symbolic-link target without writing through it', async () => {
  await withTempCwd(async (tempDir) => {
    const outsideDir = path.join(tempDir, 'outside');
    const targetDir = path.join(tempDir, 'my-theme');
    await fs.mkdir(outsideDir);
    await fs.symlink(outsideDir, targetDir, 'dir');

    await assert.rejects(
      () => run(['--name', 'my-theme', '--template', 'minimal']),
      /Target directory must not be a symbolic link/,
    );

    assert.equal((await fs.lstat(targetDir)).isSymbolicLink(), true);
    assert.deepEqual(await fs.readdir(outsideDir), []);
  });
});

test('run commits into an existing empty real directory', async () => {
  await withTempCwd(async (tempDir) => {
    const targetDir = path.join(tempDir, 'my-theme');
    await fs.mkdir(targetDir);

    await run(['--name', 'my-theme', '--template', 'minimal']);

    assert.equal((await fs.lstat(targetDir)).isDirectory(), true);
    assert.equal((await fs.lstat(targetDir)).isSymbolicLink(), false);
    await fs.access(path.join(targetDir, 'theme', 'theme.json'));
  });
});

test('run fails when generated scaffold does not pass self-check', async () => {
  const originalReadDir = fs.readdir;

  fs.readdir = async function patchedReadDir(currentPath, options) {
    const result = await originalReadDir.call(this, currentPath, options);
    if (
      typeof currentPath === 'string'
      && path.basename(currentPath) === 'theme'
      && currentPath.includes('.broken-theme.zeropress-create-theme-')
      && Array.isArray(result)
    ) {
      return result.filter((entry) => {
        const name = typeof entry === 'string' ? entry : entry.name;
        return name !== 'page.html';
      });
    }
    return result;
  };

  try {
    await withTempCwd(async (tempDir) => {
      await assert.rejects(
        () => run(['--name', 'broken-theme', '--template', 'minimal']),
        /Required template 'page\.html' is missing/,
      );
      await assert.rejects(() => fs.access(path.join(tempDir, 'broken-theme')), /ENOENT/);
      assert.deepEqual(await fs.readdir(tempDir), []);

      const existingTarget = path.join(tempDir, 'broken-theme');
      await fs.mkdir(existingTarget);
      await assert.rejects(
        () => run(['--name', 'broken-theme', '--template', 'minimal']),
        /Required template 'page\.html' is missing/,
      );
      assert.equal((await fs.lstat(existingTarget)).isDirectory(), true);
      assert.deepEqual(await fs.readdir(existingTarget), []);
      assert.deepEqual(await fs.readdir(tempDir), ['broken-theme']);
    });
  } finally {
    fs.readdir = originalReadDir;
  }
});

test('README documents current contracts and supported local workflow', async () => {
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /https:\/\/zeropress\.dev\/reference\/theme-runtime\/specs\/v0\.7\//);
  assert.match(readme, /https:\/\/zeropress\.dev\/reference\/preview-data\/specs\/v0\.7\//);
  assert.doesNotMatch(readme, /\/spec\/(?:theme-runtime|preview-data)-v0\.7\.html/);
  assert.doesNotMatch(readme, /belong in the ZeroPress theme catalog|admin runtime install flow/);
});
