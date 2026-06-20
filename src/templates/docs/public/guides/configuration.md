# Configuration

This page collects the small amount of configuration used by the preview site.

## Theme

The site uses the bundled docs2 theme:

```bash
--theme docs2
```

The canonical theme ID is:

```txt
zeropress.docs2
```

## Site Indexing

This preview intentionally opts out of site indexing:

```json
{
  "site": {
    "indexing": false
  }
}
```

This is appropriate for theme previews and fixture sites. It is not a privacy or access-control feature.

## Search

Docs2 supports ZeroPress native static search. The preview enables it so the command palette can demonstrate the search UI:

```json
{
  "site": {
    "search": true
  }
}
```

## Collection Order

The preview uses a small collection so the previous and next links can show the intended reading order:

```json
{
  "collections": {
    "preview": {
      "title": "Get Started",
      "items": [
        "index.md",
        "getting-started.md"
      ]
    },
    "guides": {
      "title": "Guides",
      "items": [
        "guides/markdown.md",
        "markdown-examples/index.md"
      ]
    },
    "reference": {
      "title": "Reference",
      "items": [
        "guides/configuration.md"
      ]
    }
  }
}
```

## Related Sites

- <a href="https://zeropress.page/" target="_blank">ZeroPress Theme Previews</a>
- <a href="https://build-pages.zeropress.dev/" target="_blank">Build Pages Documentation</a>
- <a href="https://zeropress.dev/theme-authoring/" target="_blank">Theme Authoring Guide</a>
