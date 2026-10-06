import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RUNTIME,
  validateSlug,
  validateThemeFiles,
} from '@zeropress/theme-validator';
import { canonicalizePreviewDataKeyOrder } from '@zeropress/preview-data-validator';
import { toTerminalSafeText } from './terminal.js';

const TEMPLATES = new Set(['minimal', 'blog', 'magazine', 'docs', 'portfolio']);
const TEMPLATE_LIST = 'minimal, blog, magazine, docs, portfolio';
const DEFAULT_NAMESPACE = 'my-company';
const DEFAULT_VERSION = '0.1.0';
const DEFAULT_LICENSE = 'MIT';
const DEFAULT_THEME_SCHEMA = 'https://www.schemastore.org/zeropress-theme-runtime-0.7.json';
const ZEROPRESS_BUILD_DEPENDENCY_RANGE = '^0.7.6';
const ZEROPRESS_THEME_DEPENDENCY_RANGE = '^0.7.6';
const MANIFEST_ORDERED_KEYS = new Set(['$schema', 'name', 'namespace', 'slug', 'version', 'license', 'runtime']);
const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_ROOT = path.join(__dirname, 'templates');

export async function run(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(PACKAGE_VERSION);
    return;
  }

  if (argv.length === 0) {
    printHelp();
    return;
  }

  const { name, template } = parseArgs(argv);
  const slug = validateSlug(name);
  const generatedAt = new Date().toISOString();
  const workingDirectory = await fs.realpath(process.cwd());
  const targetDir = path.join(workingDirectory, name);
  const targetState = await inspectTargetDirectory(targetDir);
  const stagingDir = await createStagingDirectory(targetDir, targetState);

  try {
    await scaffoldTheme(stagingDir, {
      generatedAt,
      slug,
      template,
    });
    await commitScaffold(stagingDir, targetDir, targetState);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  console.log(`Created ZeroPress starter: ${toTerminalSafeText(name)}`);
  console.log(`Location: ${toTerminalSafeText(targetDir)}`);
  console.log(`Template preset: ${template}`);
  console.log('');
  console.log('Next:');
  console.log(`  cd ${toTerminalSafeText(name)}`);
  console.log('  npm install');
  console.log('  npm run dev');
  console.log('');
  console.log('Build static output later with:');
  console.log('  npm run build');
}

function printHelp() {
  console.log(`@zeropress/create-theme - ZeroPress theme starter generator

Usage:
  npx @zeropress/create-theme --name <slug> --template <template>

Required Options:
  --name <slug>         Starter directory name and generated theme.json.slug
  --template <template> Starter template: ${TEMPLATE_LIST}

Options:
  --help, -h            Show help
  --version, -v         Show version

Notes:
  - creates a new starter project in the current working directory
  - generated output includes theme/, zeropress-preview-data.json, optional public/, package.json, and .gitignore
  - generated theme.json uses the current ZeroPress runtime contract`);
}

function parseArgs(argv) {
  if (argv.length === 0) {
    throw new Error('@zeropress/create-theme requires --name and --template. Run with --help to see usage.');
  }

  let name = null;
  let template = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}. Use --name <value> and --template <value>.`);
    }

    if (arg === '--name') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--name requires a value');
      }
      name = value;
      i += 1;
      continue;
    }

    if (arg === '--template') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`--template requires a value. Allowed: ${TEMPLATE_LIST}`);
      }
      if (!TEMPLATES.has(value)) {
        throw new Error(`Invalid template "${value}". Allowed: ${TEMPLATE_LIST}`);
      }
      template = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!name) {
    throw new Error('--name is required');
  }

  if (!template) {
    throw new Error(`--template is required. Allowed: ${TEMPLATE_LIST}`);
  }

  return { name, template };
}

async function inspectTargetDirectory(targetDir) {
  let stat;

  try {
    stat = await fs.lstat(targetDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        exists: false,
        mode: 0o777 & ~process.umask(),
      };
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Target directory must not be a symbolic link: ${targetDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Path exists and is not a directory: ${targetDir}`);
  }

  const entries = await fs.readdir(targetDir);
  if (entries.length > 0) {
    throw new Error(`Directory is not empty: ${targetDir}`);
  }

  return {
    exists: true,
    device: stat.dev,
    inode: stat.ino,
    mode: stat.mode & 0o777,
  };
}

async function createStagingDirectory(targetDir, targetState) {
  const parentDir = path.dirname(targetDir);
  const prefix = path.join(parentDir, `.${path.basename(targetDir)}.zeropress-create-theme-`);
  const stagingDir = await fs.mkdtemp(prefix);
  await fs.chmod(stagingDir, targetState.mode);
  return stagingDir;
}

async function commitScaffold(stagingDir, targetDir, targetState) {
  const currentState = await inspectTargetDirectory(targetDir);

  if (currentState.exists !== targetState.exists) {
    throw new Error(`Target directory changed while the starter was being created: ${targetDir}`);
  }

  if (
    targetState.exists
    && (currentState.device !== targetState.device || currentState.inode !== targetState.inode)
  ) {
    throw new Error(`Target directory changed while the starter was being created: ${targetDir}`);
  }

  if (targetState.exists) {
    await fs.rmdir(targetDir);
  }

  try {
    await fs.rename(stagingDir, targetDir);
  } catch (error) {
    if (targetState.exists) {
      await fs.mkdir(targetDir, { mode: targetState.mode }).catch(() => {});
    }
    throw error;
  }
}

async function scaffoldTheme(targetDir, options) {
  const { generatedAt, slug, template } = options;
  const templateDir = path.join(TEMPLATE_ROOT, template);
  const themeSourceDir = path.join(templateDir, 'theme');
  const publicSourceDir = path.join(templateDir, 'public');
  const previewDataSourcePath = path.join(templateDir, 'zeropress-preview-data.json');
  let stat;

  try {
    stat = await fs.stat(themeSourceDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Template "${template}" is not available`);
    }
    throw error;
  }

  if (!stat.isDirectory()) {
    throw new Error(`Template theme path is not a directory: ${themeSourceDir}`);
  }

  await fs.cp(themeSourceDir, path.join(targetDir, 'theme'), { recursive: true });
  if (await isDirectory(publicSourceDir)) {
    await fs.cp(publicSourceDir, path.join(targetDir, 'public'), { recursive: true });
  }
  await writePreviewData(previewDataSourcePath, path.join(targetDir, 'zeropress-preview-data.json'), generatedAt);
  await writeStarterGitignore(targetDir);
  await writeStarterPackageJson(targetDir, slug);

  const manifest = {
    name: slug,
    namespace: DEFAULT_NAMESPACE,
    slug,
    version: DEFAULT_VERSION,
    license: DEFAULT_LICENSE,
    runtime: DEFAULT_RUNTIME,
  };
  await updateThemeManifest(path.join(targetDir, 'theme', 'theme.json'), manifest);
  await validateScaffoldedTheme(path.join(targetDir, 'theme'));
}

async function writePreviewData(sourcePath, targetPath, generatedAt) {
  const raw = await fs.readFile(sourcePath, 'utf8');
  const previewData = JSON.parse(raw);
  previewData.generated_at = generatedAt;
  const orderedPreviewData = canonicalizePreviewDataKeyOrder(previewData);
  await fs.writeFile(targetPath, `${JSON.stringify(orderedPreviewData, null, 2)}\n`, 'utf8');
}

async function writeStarterGitignore(targetDir) {
  await fs.writeFile(path.join(targetDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');
}

async function isDirectory(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function writeStarterPackageJson(targetDir, slug) {
  const packageJson = {
    name: slug,
    private: true,
    version: DEFAULT_VERSION,
    type: 'module',
    engines: {
      node: '>=22.22.0',
    },
    scripts: {
      build: 'zeropress-build ./theme --data ./zeropress-preview-data.json --out ./dist --empty-out-dir',
      dev: 'zeropress-theme dev ./theme --data ./zeropress-preview-data.json',
    },
    dependencies: {
      '@zeropress/build': ZEROPRESS_BUILD_DEPENDENCY_RANGE,
      '@zeropress/theme': ZEROPRESS_THEME_DEPENDENCY_RANGE,
    },
  };

  await fs.writeFile(path.join(targetDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

async function updateThemeManifest(themeJsonPath, values) {
  const raw = await fs.readFile(themeJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  const optionalEntries = Object.entries(parsed).filter(([key]) => !MANIFEST_ORDERED_KEYS.has(key));
  const orderedManifest = {
    $schema: DEFAULT_THEME_SCHEMA,
    name: values.name,
    namespace: values.namespace,
    slug: values.slug,
    version: values.version,
    license: values.license,
    runtime: values.runtime,
    ...Object.fromEntries(optionalEntries),
  };
  await fs.writeFile(themeJsonPath, `${JSON.stringify(orderedManifest, null, 2)}\n`, 'utf8');
}

async function validateScaffoldedTheme(themeDir) {
  const fileMap = await readThemeFiles(themeDir);
  const result = await validateThemeFiles(fileMap);
  if (!result.ok) {
    throw new Error(result.errors[0]?.message || 'Generated theme failed validation');
  }
}

async function readThemeFiles(rootDir) {
  const files = new Map();
  await walkThemeFiles(rootDir, rootDir, files);
  return files;
}

async function walkThemeFiles(rootDir, currentDir, files) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      await walkThemeFiles(rootDir, absolutePath, files);
      continue;
    }

    files.set(relativePath, await fs.readFile(absolutePath));
  }
}
