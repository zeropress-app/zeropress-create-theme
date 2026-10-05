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

Sample content disallows crawling by default. After replacing it with your own
content, set `site.robots.allow_indexing` to `true` in `preview-data.json` when
you are ready for search engines to crawl the site.

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

- `minimal`: quiet content-first starter with search and single-level navigation.
- `blog`: editorial blog starter with menus, widgets, posts, categories, tags, comments, and a newsletter CTA.
- `docs`: documentation starter with pages, navigation, search, and Markdown-friendly Preview Data content.
- `portfolio`: portfolio starter using site metadata and named collections.
- `magazine`: editorial magazine starter with curated landing sections.

The blog starter declares a three-level `primary` menu and a one-level
`footer` menu in `theme.json`. Builds warn when deeper descendants are excluded;
Preview Data stays complete. Separate chevron buttons expand submenus by click
or keyboard, and Escape closes the innermost submenu. Without JavaScript, all
supported levels remain visible as nested lists. Minimal declares one level for
both `primary` and `footer`; deeper descendants also produce a build warning
and are excluded from rendering. Other starters leave `max_depth` unspecified.

In the blog, **Menu** opens navigation over the page on narrow screens and keeps keyboard
focus inside. **Escape** closes the innermost submenu first, then the panel.
Closing the panel returns focus to the Menu button.

Minimal keeps navigation links visible and lets them wrap on narrow screens.
Its Search button opens a keyboard-accessible dialog; `/` or Ctrl/Cmd+K also
opens it outside editable fields. The search adapter loads on the first query
and supports built-in search or a Pagefind replacement. Set
`site.search.enabled` to `false` in Preview Data to omit the search interface.
Results link directly to their pages without adding a query or highlighting
the destination text.

Minimal uses a single content column up to 42rem wide, with matching header and
footer alignment. Its four sample posts span two pages. Both blog and minimal
support ZeroPress Edge and WordPress comments, replies, and draft preservation
while switching replies or loading more comments. ZeroPress Edge can also
provide optional email sign-in and author badges.

Blog, minimal, and docs display dates and times in the visitor's browser language
and time zone, using `site.date_style` and `site.time_style` for the display format.
Setting both styles to `none` hides them. Without JavaScript or supported date
formatting, the initial HTML keeps the site's language and time zone.

The blog sample includes three-level navigation, multiple authors, paginated
posts, and Markdown and HTML articles with tables, figures, and captions.
Small illustrations in `public/demo/` provide post and page cover images
without an external image service.

The blog starter uses the Docs2 light and dark palette with SVG interface icons.
Its standalone form and newsletter pages also support light and dark color schemes.

All bundled starters use system fonts and make no webfont requests by default.
Font families are defined in `theme/assets/style.css`. To use webfonts, add
their stylesheet or `@font-face` rule and override the font families in the theme,
or through
Preview Data's `custom_html.head_end` and `custom_css.content`. The blog's
standalone form and newsletter pages use their own `style.css` files.

Blog sidebar widgets appear on home, archive, taxonomy, post, and page views.
On desktop, posts place their table of contents above the widgets in the same
column. On narrow screens, widgets follow the article and the desktop TOC is
hidden.

Listing pages use a single column when no sidebar widgets are configured.
Pages, like posts, display their featured image when one is supplied.

Remote theme catalogs and runtime theme installation are not supported. Create
another starter locally, or copy an existing generated project, when you need an
additional theme.

### Blog forms and newsletters

The blog starter includes independent `public/zp_form/` and
`public/zp_newsletter/` folders. Each contains `index.html`, `style.css`,
`app.js`, and `config.json`; keep only the folders you use.

Set `form_endpoint` in `public/zp_form/config.json`, or `newsletter_endpoint`
in `public/zp_newsletter/config.json`, to your ZeroPress Edge form or
newsletter API URL, such as `https://edge.example/api/forms/contact` or
`https://edge.example/api/newsletters/default`. Use an absolute HTTP(S) URL
without credentials, query parameters, or a fragment. The corresponding Edge
feature must be enabled.

Studio shows these addresses and a **Copy config.json** action in Form settings
and the Newsletter screen after you set **Edge URL**.

The sample links to `/zp_form/` and embeds `/zp_newsletter/`. Setting
`newsletter_endpoint` explicitly is recommended, especially for standalone
signup, confirmation, and unsubscribe pages or a newsletter other than `default`.
When that value is empty, the blog's same-origin newsletter iframe can use
`site.comments.provider: "zeropress"` and a standard `/api` base URL to connect
to `/api/newsletters/default`. This fallback requires the comments connection
to be available in the rendered theme. It does not enable the Edge newsletter
or change `config.json`.

Without an explicit or inferred endpoint, the samples display setup guidance
and make no external API requests. Invalid configuration still shows a
configuration error. To hide the newsletter entry point, set
`site.newsletter.enabled` to `false` in Preview Data. Preserve `config.json`
when replacing the other files with updated copies.

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
    "@zeropress/build": "^0.7.6",
    "@zeropress/theme": "^0.7.6"
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
