# @zeropress/create-theme

![npm](https://img.shields.io/npm/v/%40zeropress%2Fcreate-theme)
![license](https://img.shields.io/npm/l/%40zeropress%2Fcreate-theme)
![node](https://img.shields.io/node/v/%40zeropress%2Fcreate-theme)

Public ZeroPress starter generator for Theme Runtime v0.7 and Preview Data v0.7.

This package creates a buildable ZeroPress starter project for the
`preview-data.json + theme/` workflow. The five starter templates are bundled
inside the npm package.

It uses directly:

- [@zeropress/theme-validator](https://www.npmjs.com/package/@zeropress/theme-validator) to validate generated theme output

Generated starter projects use:

- [@zeropress/theme](https://www.npmjs.com/package/@zeropress/theme) for local theme preview
- [@zeropress/build](https://www.npmjs.com/package/@zeropress/build) for static site output

Public contract references:

- [Theme Runtime v0.7 Spec](https://zeropress.dev/reference/theme-runtime/specs/v0.7/)
- [Theme Runtime v0.7 Schema](https://schemas.zeropress.dev/theme-runtime/v0.7/schema.json)
- [Preview Data v0.7 Spec](https://zeropress.dev/reference/preview-data/specs/v0.7/)
- [Preview Data v0.7 Schema](https://schemas.zeropress.dev/preview-data/v0.7/schema.json)

## Quick Start

```bash
npx @zeropress/create-theme --name my-portfolio --template portfolio
cd my-portfolio
npm install
npm run dev
```

The development server prints the local preview URL and watches the generated
theme and Preview Data. To produce static output later:

```bash
npm run build
```

The build output is written to `dist/`.

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
- `docs`: documentation starter with pages, navigation, search, and Markdown-friendly Preview Data content.
- `portfolio`: portfolio starter using site metadata and named collections.
- `magazine`: editorial magazine starter with curated landing sections.

Remote theme catalogs and runtime theme installation are not supported. Create
another starter locally, or copy an existing generated project, when you need an
additional theme.

## Generated Project

```text
my-portfolio/
  package.json
  .gitignore
  preview-data.json
  public/                 # optional, included by starters that need trusted public HTML/assets
  theme/
    theme.json
    layout.html
    index.html
    post.html
    page.html
    archive.html             # optional, template-dependent
    category.html            # optional, template-dependent
    tag.html                 # optional, template-dependent
    404.html
    partials/
    assets/
```

The generated `.gitignore` excludes `node_modules/` and the reproducible
`dist/` build output. Commit the generated lockfile when you install
dependencies.

Generated `package.json` includes:

```json
{
  "engines": {
    "node": ">=22.22.0"
  },
  "scripts": {
    "build": "zeropress-build ./theme --data ./preview-data.json --out ./dist --empty-out-dir",
    "dev": "zeropress-theme dev ./theme --data ./preview-data.json"
  },
  "dependencies": {
    "@zeropress/build": "^0.7.3",
    "@zeropress/theme": "^0.7.3"
  }
}
```

The build is assembled in a sibling staging directory. ZeroPress replaces
`dist/` only after the new build succeeds, so no shell-specific or evaluated
cleanup script is needed.

Generated `theme/theme.json` is rewritten with:

- `$schema: "https://schemas.zeropress.dev/theme-runtime/v0.7/schema.json"`
- `runtime: "0.7"`
- `namespace: "my-company"`
- `slug` and `name` from `--name`
- `version: "0.1.0"`

Update `namespace`, `name`, and demo fixture content before publishing a theme.

Generated templates use the effective Theme Runtime feature objects: check `site.search.enabled`, `site.feed.enabled`, `site.archive.enabled`, and `site.comments.enabled`, and use `site.feed.url` or `site.archive.url` only in the enabled branch.
Preview Data preferences use the same `{ "enabled": boolean }` shape; omitting search, feed, or archive requests the enabled default.

## Validation

The generated theme is validated immediately with
[`@zeropress/theme-validator`](https://www.npmjs.com/package/@zeropress/theme-validator).

Generation is staged in a temporary sibling directory and committed only after
validation succeeds. The requested target may be absent or an existing empty
real directory; symbolic-link targets and non-empty directories are rejected.
Human-readable diagnostics escape terminal control and directional characters.

The package test suite validates and builds every bundled starter.

## License

MIT
