import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { run } from '../src/index.js';

const execFileAsync = promisify(execFile);
const packageJsonPath = new URL('../package.json', import.meta.url);
const packageRoot = path.dirname(fileURLToPath(packageJsonPath));
const createThemeBin = path.join(packageRoot, 'bin', 'zeropress-create-theme.js');
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

test('run prints help and exits cleanly with no args', async () => {
  const logs = await captureLogs(() => run([]));

  assert.equal(logs.some((line) => line.includes('Usage:')), true);
  assert.equal(logs.some((line) => line.includes('npx @zeropress/create-theme --name <slug> --template <template>')), true);
  assert.equal(
    logs.some((line) => line.includes('theme/, preview-data.json, optional public/, package.json, and .gitignore')),
    true,
  );
});

test('run prints help and exits cleanly with --help', async () => {
  const logs = await captureLogs(() => run(['--help']));

  assert.equal(logs.some((line) => line.includes('Required Options:')), true);
  assert.equal(logs.some((line) => line.includes('--name <slug>')), true);
  assert.equal(logs.some((line) => line.includes('--template <template>')), true);
  assert.equal(logs.some((line) => line.includes('--help, -h')), true);
  assert.equal(logs.some((line) => line.includes('--version, -v')), true);
});

for (const flag of ['--version', '-v']) {
  test(`run prints version with ${flag}`, async () => {
    const logs = await captureLogs(() => run([flag]));
    const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

    assert.deepEqual(logs, [pkg.version]);
  });
}

test('run prints help when --help appears anywhere in argv', async () => {
  const logs = await captureLogs(() => run(['--name', 'my-theme', '--help']));

  assert.equal(logs.some((line) => line.includes('Usage:')), true);
  assert.equal(logs.some((line) => line.includes('npx @zeropress/create-theme --name <slug> --template <template>')), true);
});

test('run rejects unsupported slug option aliases', async () => {
  await assert.rejects(
    () => run(['--slug', 'my-theme']),
    /Unknown option: --slug/,
  );
  await assert.rejects(
    () => run(['--theme-slug', 'my-theme']),
    /Unknown option: --theme-slug/,
  );
});

test('run requires --template when only --name is provided', async () => {
  await assert.rejects(
    () => run(['--name', 'my-theme']),
    /--template is required\. Allowed: minimal, blog, magazine, docs, portfolio/,
  );
});

test('run rejects invalid template values', async () => {
  await assert.rejects(
    () => run(['--name', 'my-theme', '--template', 'cms']),
    /Invalid template "cms"\. Allowed: minimal, blog, magazine, docs, portfolio/,
  );
});

test('run requires --name when only --template is provided', async () => {
  await assert.rejects(
    () => run(['--template', 'blog']),
    /--name is required/,
  );
});

test('run guides allowed templates when --template value is missing', async () => {
  await assert.rejects(
    () => run(['--name', 'my-theme', '--template']),
    /--template requires a value\. Allowed: minimal, blog, magazine, docs, portfolio/,
  );
});

test('run scaffolds a buildable v0.7 theme runtime with v0.7 preview data', async () => {
  await withTempCwd(async (tempDir) => {
    const startedAt = Date.now();
    const logs = await captureLogs(() => run(['--name', 'my-theme', '--template', 'portfolio']));
    const completedAt = Date.now();
    const projectDir = path.join(tempDir, 'my-theme');
    const themeJson = JSON.parse(await fs.readFile(path.join(projectDir, 'theme', 'theme.json'), 'utf8'));
    const previewData = JSON.parse(await fs.readFile(path.join(projectDir, 'preview-data.json'), 'utf8'));
    const starterPackage = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
    const gitignore = await fs.readFile(path.join(projectDir, '.gitignore'), 'utf8');
    const canonicalProjectDir = await fs.realpath(projectDir);

    assert.equal(themeJson.$schema, 'https://schemas.zeropress.dev/theme-runtime/v0.7/schema.json');
    assert.equal(themeJson.name, 'my-theme');
    assert.equal(themeJson.namespace, 'my-company');
    assert.equal(themeJson.slug, 'my-theme');
    assert.equal(themeJson.version, '0.1.0');
    assert.equal(themeJson.license, 'MIT');
    assert.equal(themeJson.runtime, '0.7');
    assert.equal(previewData.version, '0.7');
    assert.equal(previewData.$schema, 'https://schemas.zeropress.dev/preview-data/v0.7/schema.json');
    assert.equal(previewData.generator, 'zeropress-create-theme');
    assert.equal(typeof previewData.generated_at, 'string');
    assert.equal(Date.parse(previewData.generated_at) >= startedAt, true);
    assert.equal(Date.parse(previewData.generated_at) <= completedAt, true);
    assert.equal(previewData.site.media_origin, '');
    assert.equal(Object.hasOwn(previewData.site, 'media_base_url'), false);
    assert.equal(starterPackage.private, true);
    assert.deepEqual(starterPackage.engines, {
      node: '>=22.22.0',
    });
    assert.equal(Object.hasOwn(starterPackage.scripts, 'clean'), false);
    assert.equal(
      starterPackage.scripts.build,
      'zeropress-build ./theme --data ./preview-data.json --out ./dist --empty-out-dir',
    );
    assert.equal(starterPackage.scripts.dev, 'zeropress-theme dev ./theme --data ./preview-data.json');
    assert.equal(gitignore, 'node_modules/\ndist/\n');
    assert.equal(logs.some((line) => line.includes('Created ZeroPress starter: my-theme')), true);
    assert.equal(logs.some((line) => line.includes(`Location: ${canonicalProjectDir}`)), true);
    assert.equal(logs.some((line) => line.includes('Template preset: portfolio')), true);
    assert.equal(logs.some((line) => line === 'Next:'), true);
    assert.equal(logs.some((line) => line === '  cd my-theme'), true);
    assert.equal(logs.some((line) => line === '  npm install'), true);
    assert.equal(logs.some((line) => line === '  npm run dev'), true);
    assert.equal(logs.some((line) => line === 'Build static output later with:'), true);
    assert.equal(logs.some((line) => line === '  npm run build'), true);
    await assert.rejects(() => fs.access(path.join(projectDir, 'layout.html')));
  });
});

for (const template of templates) {
  test(`${template} source Preview Data identifies create-theme as its generator`, async () => {
    const previewData = JSON.parse(
      await fs.readFile(new URL(`../src/templates/${template}/preview-data.json`, import.meta.url), 'utf8'),
    );
    assert.equal(previewData.generator, 'zeropress-create-theme');
    assert.equal(previewData.generated_at, '2026-07-15T09:00:00Z');
  });

  test(`run self-validates and builds generated ${template} starter`, async () => {
    await withTempCwd(async (tempDir) => {
      const slug = `${template}-starter`;
      await run(['--name', slug, '--template', template]);

      const projectDir = path.join(tempDir, slug);
      const themeJson = JSON.parse(await fs.readFile(path.join(projectDir, 'theme', 'theme.json'), 'utf8'));
      const previewData = JSON.parse(await fs.readFile(path.join(projectDir, 'preview-data.json'), 'utf8'));
      assert.equal(themeJson.slug, slug);
      assert.equal(themeJson.runtime, '0.7');
      assert.equal(previewData.generator, 'zeropress-create-theme');
      assert.equal(Number.isNaN(Date.parse(previewData.generated_at)), false);

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
        await fs.access(path.join(projectDir, 'public', 'newsletter.html'));
        await fs.access(path.join(projectDir, 'dist', 'newsletter.html'));
        await fs.access(path.join(projectDir, 'dist', '_zeropress', 'search.js'));
        const html = await fs.readFile(path.join(projectDir, 'dist', 'index.html'), 'utf8');
        const newsletter = await fs.readFile(path.join(projectDir, 'public', 'newsletter.html'), 'utf8');
        const themeScript = await fs.readFile(path.join(projectDir, 'theme', 'assets', 'theme.js'), 'utf8');
        assert.equal(themeJson.features.search, true);
        assert.match(html, /data-newsletter-open/);
        assert.match(html, /src="\/newsletter\.html"/);
        assert.match(html, /data-cmdk-open/);
        assert.match(html, /data-cmdk-input/);
        assert.match(themeScript, /\/_zeropress\/search\.js/);
        assert.match(themeScript, /api\.search\(normalizedQuery/);
        assert.doesNotMatch(newsletter, /<form\b|buttondown\.com|action=/);
        assert.match(newsletter, /This placeholder does not submit data\./);
        assert.match(newsletter, /<button type="button" disabled>/);
      }

      if (template === 'docs') {
        const previewData = JSON.parse(await fs.readFile(path.join(projectDir, 'preview-data.json'), 'utf8'));
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
        const previewDataRaw = await fs.readFile(path.join(projectDir, 'preview-data.json'), 'utf8');
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

test('bundled starter themes use runtime summaries for listings and authored excerpts for detail ledes', async () => {
  const listingFiles = [
    ['blog', 'partials/post-list-item.html', 'post'],
    ['magazine', 'index.html', 'post'],
    ['magazine', 'partials/post-card.html', 'post'],
    ['minimal', 'index.html', 'post'],
    ['minimal', 'category.html', 'post'],
    ['minimal', 'tag.html', 'post'],
    ['portfolio', 'category.html', 'post'],
    ['portfolio', 'tag.html', 'post'],
    ['portfolio', 'partials/project-card.html', 'project'],
    ['portfolio', 'partials/work-row.html', 'project'],
  ];

  for (const [template, relativePath, alias] of listingFiles) {
    const source = await fs.readFile(
      new URL(`../src/templates/${template}/theme/${relativePath}`, import.meta.url),
      'utf8',
    );
    assert.match(source, new RegExp(`\\{\\{#if ${alias}\\.summary\\}\\}`));
    assert.match(source, new RegExp(`\\{\\{${alias}\\.summary\\}\\}`));
    assert.doesNotMatch(source, new RegExp(`\\{\\{${alias}\\.excerpt\\}\\}`));
  }

  const detailFiles = [
    ['blog', 'post.html', 'post'],
    ['magazine', 'post.html', 'post'],
    ['portfolio', 'post.html', 'post'],
    ['portfolio', 'page.html', 'page'],
  ];

  for (const [template, relativePath, alias] of detailFiles) {
    const source = await fs.readFile(
      new URL(`../src/templates/${template}/theme/${relativePath}`, import.meta.url),
      'utf8',
    );
    assert.match(source, new RegExp(`\\{\\{#if ${alias}\\.excerpt\\}\\}`));
    assert.match(source, new RegExp(`\\{\\{${alias}\\.excerpt\\}\\}`));
  }
});

for (const template of ['blog', 'minimal']) {
  test(`${template} starter uses the route-level comments island contract`, async () => {
    const templateRoot = new URL(`../src/templates/${template}/theme/`, import.meta.url);
    const [post, page, footer, island, dataClient, style] = await Promise.all([
      fs.readFile(new URL('post.html', templateRoot), 'utf8'),
      fs.readFile(new URL('page.html', templateRoot), 'utf8'),
      fs.readFile(new URL('partials/footer.html', templateRoot), 'utf8'),
      fs.readFile(new URL('partials/comments-island.html', templateRoot), 'utf8'),
      fs.readFile(new URL('assets/comment-data.js', templateRoot), 'utf8'),
      fs.readFile(new URL('assets/style.css', templateRoot), 'utf8'),
    ]);

    assert.match(post, /\{\{#if comments\.enabled\}\}/);
    assert.match(page, /\{\{#if comments\.enabled\}\}/);
    assert.match(footer, /\{\{#if comments\.enabled\}\}/);
    assert.match(island, /data-zp-comments-target-type="\{\{comments\.target_type\}\}"/);
    assert.match(island, /data-zp-comments-provider="\{\{comments\.provider\}\}"/);
    assert.match(island, /data-role="pagination"/);
    assert.match(island, /data-action="load-more"/);
    if (template === 'minimal') {
      assert.match(style, /\.zp-comment-form__honeypot\s*\{[^}]*position:\s*absolute\s*!important;[^}]*clip:\s*rect\(0, 0, 0, 0\)\s*!important;/s);
      assert.match(style, /\.zp-comments__pagination\s*\{/);
    }
    assert.doesNotMatch(`${post}\n${page}\n${footer}`, /post\.comments_enabled/);
    assert.doesNotMatch(dataClient, /isWordPressEndpoint/);
  });
}

test('run rejects a theme slug that is not already valid', async () => {
  await assert.rejects(
    () => run(['--name', 'My Theme', '--template', 'blog']),
    /Theme slug must use lowercase/,
  );
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

test('CLI errors escape terminal control and directional characters', async () => {
  const unsafeOption = '--unknown\n\u001b\u0085\u202eoption';
  let stderr = '';

  try {
    await execFileAsync(process.execPath, [createThemeBin, unsafeOption], {
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    });
    assert.fail('CLI should reject an unknown option');
  } catch (error) {
    stderr = error.stderr;
  }

  assert.doesNotMatch(stderr, /[\u001b\u0085\u202e]/u);
  assert.match(stderr, /--unknown\\u000A\\u001B\\u0085\\u202Eoption/);
});

test('success output escapes unsafe characters inherited from the working-directory path', async () => {
  await withTempCwd(async (tempDir) => {
    const unsafeDir = path.join(tempDir, 'unsafe\u202e');
    await fs.mkdir(unsafeDir);
    process.chdir(unsafeDir);

    try {
      const logs = await captureLogs(() => run(['--name', 'my-theme', '--template', 'minimal']));
      assert.doesNotMatch(logs.join('\n'), /\u202e/u);
      assert.match(logs.join('\n'), /unsafe\\u202E/);
    } finally {
      process.chdir(tempDir);
    }
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
  assert.match(readme, /symbolic-link targets and non-empty directories are rejected/);
});
