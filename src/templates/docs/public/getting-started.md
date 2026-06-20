# Getting Started

Docs2 is a sidebar documentation theme. It keeps sections visible while each page focuses on document content.

## Source Tree

A Build Pages source tree can mix ordinary Markdown files with directory index pages:

```txt
documents/
  index.md
  getting-started.md
  guides/
    markdown.md
    configuration.md
  markdown-examples/
    index.md
  .zeropress/
    config.json
public/
  favicon.png
```

The ordinary file `guides/markdown.md` is published as a page route under `/guides/markdown`. The directory index file `markdown-examples/index.md` is published as `/markdown-examples/`.

## Build Command

Use the bundled `docs2` theme:

```bash
npx --yes @zeropress/build-pages --source ./documents --destination ./_site --public-dir ./public --theme docs2
```

The generated site is static HTML and can be deployed to static hosting providers.

## Sidebar Model

Docs2 renders `menus.primary` as grouped sidebar navigation:

```json
{
  "menus": {
    "primary": {
      "name": "Primary Menu",
      "items": [
        {
          "title": "GET STARTED",
          "url": "/",
          "children": [
            { "title": "Overview", "url": "/" },
            { "title": "Getting Started", "url": "/getting-started" }
          ]
        },
        {
          "title": "GUIDES",
          "url": "/guides/markdown",
          "children": [
            {
              "title": "Markdown",
              "url": "/guides/markdown",
              "children": [
                { "title": "Markdown Examples", "url": "/markdown-examples/" }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

Top-level items become groups. Child links become pages, and one additional child level can be rendered beneath a page link.
