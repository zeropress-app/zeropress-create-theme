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
});

test('run prints help and exits cleanly with --help', async () => {
  const logs = await captureLogs(() => run(['--help']));

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

test('run rejects a theme slug that is not already valid', async () => {
  await assert.rejects(
    () => run(['--name', 'My Theme', '--template', 'blog']),
    /Theme slug must use lowercase/,
  );
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
