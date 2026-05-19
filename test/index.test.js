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
const buildBin = path.join(packageRoot, 'node_modules', '.bin', 'zeropress-build');
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
  assert.equal(logs.some((line) => line.includes('theme/, preview-data.json, and package.json')), true);
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

test('run scaffolds a buildable v0.6 starter project', async () => {
  await withTempCwd(async (tempDir) => {
    const logs = await captureLogs(() => run(['--name', 'my-theme', '--template', 'portfolio']));
    const projectDir = path.join(tempDir, 'my-theme');
    const themeJson = JSON.parse(await fs.readFile(path.join(projectDir, 'theme', 'theme.json'), 'utf8'));
    const previewData = JSON.parse(await fs.readFile(path.join(projectDir, 'preview-data.json'), 'utf8'));
    const starterPackage = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));

    assert.equal(themeJson.$schema, 'https://zeropress.dev/schemas/theme.v0.6.runtime.schema.json');
    assert.equal(themeJson.name, 'my-theme');
    assert.equal(themeJson.namespace, 'my-company');
    assert.equal(themeJson.slug, 'my-theme');
    assert.equal(themeJson.version, '0.1.0');
    assert.equal(themeJson.license, 'MIT');
    assert.equal(themeJson.runtime, '0.6');
    assert.equal(previewData.version, '0.6');
    assert.equal(previewData.$schema, 'https://zeropress.dev/schemas/preview-data.v0.6.schema.json');
    assert.equal(starterPackage.private, true);
    assert.equal(starterPackage.scripts.build, 'zeropress-build ./theme --data ./preview-data.json --out ./dist');
    assert.equal(starterPackage.scripts.dev, 'zeropress-theme dev ./theme --data ./preview-data.json');
    assert.deepEqual(starterPackage.dependencies, {
      '@zeropress/build': '0.6.1',
      '@zeropress/theme': '0.6.1',
    });
    assert.equal(logs.some((line) => line.includes('Template: portfolio')), true);
    assert.equal(logs.some((line) => line.includes('Next: npm install && npm run build')), true);
    await assert.rejects(() => fs.access(path.join(projectDir, 'layout.html')));
  });
});

for (const template of templates) {
  test(`run self-validates and builds generated ${template} starter`, async () => {
    await withTempCwd(async (tempDir) => {
      const slug = `${template}-starter`;
      await run(['--name', slug, '--template', template]);

      const projectDir = path.join(tempDir, slug);
      const themeJson = JSON.parse(await fs.readFile(path.join(projectDir, 'theme', 'theme.json'), 'utf8'));
      assert.equal(themeJson.slug, slug);
      assert.equal(themeJson.runtime, '0.6');

      await execFileAsync(buildBin, [
        './theme',
        '--data',
        './preview-data.json',
        '--out',
        './dist',
      ], { cwd: projectDir });

      await fs.access(path.join(projectDir, 'dist', 'index.html'));
    });
  });
}

test('run rejects a theme slug that is not already valid', async () => {
  await assert.rejects(
    () => run(['--name', 'My Theme', '--template', 'blog']),
    /Theme slug must use lowercase/,
  );
});

test('run fails when generated scaffold does not pass self-check', async () => {
  const originalReadDir = fs.readdir;

  fs.readdir = async function patchedReadDir(currentPath, options) {
    const result = await originalReadDir.call(this, currentPath, options);
    if (typeof currentPath === 'string' && currentPath.endsWith('/broken-theme/theme') && Array.isArray(result)) {
      return result.filter((entry) => {
        const name = typeof entry === 'string' ? entry : entry.name;
        return name !== 'page.html';
      });
    }
    return result;
  };

  try {
    await withTempCwd(async () => {
      await assert.rejects(
        () => run(['--name', 'broken-theme', '--template', 'minimal']),
        /Required template 'page\.html' is missing/,
      );
    });
  } finally {
    fs.readdir = originalReadDir;
  }
});
