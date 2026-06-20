# Markdown

Build Pages is designed for ordinary Markdown source trees. Keep links between documents source-relative so they work in editors, Git hosting UIs, and the generated site.

## Source-Relative Links

This page links to a directory index page with a normal Markdown path:

```md
[Markdown Examples](../markdown-examples/index.md)
```

Open [Markdown Examples](../markdown-examples/index.md) to see how the generated docs2 theme renders headings, tables, alerts, code blocks, media elements, and Mermaid diagrams.

The source path stays useful before the site is built, and Build Pages rewrites it to the generated page URL during prebuild.

## Document Routes

This preview intentionally contains two common route shapes:

| Source file | Generated route |
| --- | --- |
| `getting-started.md` | `/getting-started` |
| `guides/markdown.md` | `/guides/markdown` |
| `markdown-examples/index.md` | `/markdown-examples/` |

Use ordinary files when the source tree already has category directories. Use `index.md` when a directory itself is the page.

## Public Assets

Public assets live outside the Markdown source tree. A source-relative asset link can still point to a file under the public directory when that is convenient for repository browsing.

```md
![Site icon](../../public/favicon.png)
```

Build Pages rewrites source-relative public asset links only when the target file exists under the configured public directory.

## Next Step

Review the small [configuration reference](configuration.md) used by this preview site.
