import fs from 'node:fs/promises';
import { canonicalizePreviewDataKeyOrder } from '@zeropress/preview-data-validator';

const templateRoot = new URL('../src/templates/', import.meta.url);
const templates = (await fs.readdir(templateRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory());
const files = await Promise.all(templates.map(async ({ name }) => {
  const file = new URL(`${name}/zeropress-preview-data.json`, templateRoot);
  const source = await fs.readFile(file, 'utf8');
  const data = canonicalizePreviewDataKeyOrder(JSON.parse(source));
  return { file, name, source, formatted: `${JSON.stringify(data, null, 2)}\n` };
}));

for (const { file, name, source, formatted } of files) {
  if (source === formatted) continue;
  await fs.writeFile(file, formatted, 'utf8');
  console.log(`Formatted: ${name}/zeropress-preview-data.json`);
}
