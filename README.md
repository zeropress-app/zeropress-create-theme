# @zeropress/create-theme

![npm](https://img.shields.io/npm/v/%40zeropress%2Fcreate-theme)
![license](https://img.shields.io/npm/l/%40zeropress%2Fcreate-theme)
![node](https://img.shields.io/node/v/%40zeropress%2Fcreate-theme)

Public ZeroPress starter generator for Theme Runtime v0.6.

This package creates a buildable ZeroPress starter project for the
`preview-data.json + theme/` workflow. The five starter templates are bundled
inside the npm package.

It uses directly:

- [@zeropress/theme-validator](https://www.npmjs.com/package/@zeropress/theme-validator) to validate generated theme output

Generated starter projects use:

- [@zeropress/theme](https://www.npmjs.com/package/@zeropress/theme) for local theme preview
- [@zeropress/build](https://www.npmjs.com/package/@zeropress/build) for static site output

Public contract references:

- [Theme Runtime v0.6 Spec](https://zeropress.dev/spec/theme-runtime-v0.6.html)
- [Theme Runtime v0.6 Schema](https://schemas.zeropress.dev/theme-runtime/v0.6/schema.json)
- [Preview Data v0.6 Spec](https://zeropress.dev/spec/preview-data-v0.6.html)
- [Preview Data v0.6 Schema](https://schemas.zeropress.dev/preview-data/v0.6/schema.json)

## Quick Start

```bash
npx @zeropress/create-theme --name my-portfolio --template portfolio
cd my-portfolio
npm install
npm run build
```

The build output is written to `dist/`.

For local preview while developing the theme:

```bash
npm run dev
```

After editing the generated theme, use `npm run build` to produce static output
with `@zeropress/build`.

## Usage

```bash
npx @zeropress/create-theme --name <slug> --template <template>
```

The npm package is `@zeropress/create-theme`, and the installed binary is
`zeropress-create-theme`.

### Required Options

- `--name <slug>`: starter directory name and generated `theme.json.slug`
- `--template <template>`: `minimal`, `blog`, `docs`, `portfolio`, or `magazine`

### Other Options

- `--help`, `-h`: show help
- `--version`, `-v`: show package version

## Templates

The package intentionally ships only five built-in starters:

- `minimal`: quiet content-first starter.
- `blog`: editorial blog starter with menus, widgets, posts, categories, tags, comments, and a newsletter CTA.
- `docs`: documentation starter with pages, navigation, and Markdown-friendly prose.
- `portfolio`: portfolio starter using site metadata and named collections.
- `magazine`: editorial magazine starter with curated landing sections.

Remote theme catalog downloads are not part of this package. Additional themes
belong in the ZeroPress theme catalog and admin runtime install flow.

## Generated Project

```text
my-portfolio/
  package.json
  preview-data.json
  public/                 # optional, included by starters that need trusted public HTML/assets
  theme/
    theme.json
    layout.html
    index.html
    post.html
    page.html
    archive.html
    category.html
    tag.html
    404.html
    partials/
    assets/
```

Generated `package.json` includes:

```json
{
  "scripts": {
    "clean": "rm -rf ./dist",
    "build": "npm run clean && zeropress-build ./theme --data ./preview-data.json --out ./dist",
    "dev": "zeropress-theme dev ./theme --data ./preview-data.json"
  },
  "dependencies": {
    "@zeropress/build": "^0.6.0",
    "@zeropress/theme": "^0.6.0"
  }
}
```

Generated `theme/theme.json` is rewritten with:

- `$schema: "https://schemas.zeropress.dev/theme-runtime/v0.6/schema.json"`
- `runtime: "0.6"`
- `namespace: "my-company"`
- `slug` and `name` from `--name`
- `version: "0.1.0"`

Update `namespace`, `name`, and demo fixture content before publishing a theme.

## Validation

The generated theme is validated immediately with
[`@zeropress/theme-validator`](https://www.npmjs.com/package/@zeropress/theme-validator).

The package test suite validates and builds every bundled starter.

## Legacy Package

The old unscoped package name, `create-zeropress-theme`, is retained only as a
compatibility notice. New usage should prefer:

```bash
npx @zeropress/create-theme
```

## License

MIT
