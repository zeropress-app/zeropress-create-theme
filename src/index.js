import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  validateSlug,
  validateThemeFiles,
  validateThemeManifest,
} from '@zeropress/theme-validator';

const DEFAULT_RUNTIME = '0.6';
const TEMPLATES = new Set(['minimal', 'blog', 'magazine', 'docs', 'portfolio']);
const TEMPLATE_LIST = 'minimal, blog, magazine, docs, portfolio';
const DEFAULT_NAMESPACE = 'my-company';
const DEFAULT_VERSION = '0.1.0';
const DEFAULT_LICENSE = 'MIT';
const DEFAULT_THEME_SCHEMA = 'https://zeropress.dev/schemas/theme.v0.6.runtime.schema.json';
const ZEROPRESS_BUILD_VERSION = '0.6.1';
const ZEROPRESS_THEME_VERSION = '0.6.1';
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
  const targetDir = path.resolve(process.cwd(), name);

  await ensureEmptyDirectory(targetDir);
  await scaffoldTheme(targetDir, {
    slug,
    template,
  });

  console.log(`Created ZeroPress starter at ${targetDir}`);
  console.log(`Template: ${template}`);
  console.log('Next: npm install && npm run build');
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
  - generated output includes theme/, preview-data.json, and package.json
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

async function ensureEmptyDirectory(targetDir) {
  try {
    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      throw new Error(`Path exists and is not a directory: ${targetDir}`);
    }
    const entries = await fs.readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Directory is not empty: ${targetDir}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(targetDir, { recursive: true });
      return;
    }
    throw error;
  }
}

async function scaffoldTheme(targetDir, options) {
  const { slug, template } = options;
  const templateDir = path.join(TEMPLATE_ROOT, template);
  const themeSourceDir = path.join(templateDir, 'theme');
  const previewDataSourcePath = path.join(templateDir, 'preview-data.json');
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
  await fs.copyFile(previewDataSourcePath, path.join(targetDir, 'preview-data.json'));
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

async function writeStarterPackageJson(targetDir, slug) {
  const packageJson = {
    name: slug,
    private: true,
    version: DEFAULT_VERSION,
    type: 'module',
    scripts: {
      build: 'zeropress-build ./theme --data ./preview-data.json --out ./dist',
      dev: 'zeropress-theme dev ./theme --data ./preview-data.json',
    },
    dependencies: {
      '@zeropress/build': ZEROPRESS_BUILD_VERSION,
      '@zeropress/theme': ZEROPRESS_THEME_VERSION,
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
  const manifest = JSON.parse(await fs.readFile(path.join(themeDir, 'theme.json'), 'utf8'));
  const manifestCheck = validateThemeManifest(manifest);
  if (!manifestCheck.ok) {
    throw new Error(manifestCheck.errors[0]?.message || 'Generated manifest is invalid');
  }

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
