# GitHub Pages comments app

This folder is the standalone comments site used by the Neocities article pages.
It lives at `comments/` in the `icely-puz.github.io` GitHub Pages repository.

## Layout

This folder is deployed as the `comments/` directory of the
`icely-puz.github.io` repository, **plus one copy of `404.html` at the
repository root**:

```text
icely-puz.github.io/
  404.html              <- copy of comments/404.html; must be at the root
  comments/
    index.html
    404.html
    comments.css
    site-fallback.css
    markdown.js
    comments.js
```

Do not flatten this folder into the repository root, and do not upload the
folder under its own name (`github-comments/`). Both break the site, because
`index.html` and `404.html` load their assets from absolute `/comments/...`
paths:

```html
<link rel="stylesheet" href="/comments/site-fallback.css">
<link rel="stylesheet" href="/comments/comments.css">
<script src="/comments/markdown.js"></script>
<script src="/comments/comments.js"></script>
```

The root `404.html` is the one file that genuinely has to sit a level up. The
article generator emits iframes pointing at:

```text
https://icely-puz.github.io/comments/<article-slug>
```

No file exists at that path, so GitHub Pages serves a custom `404.html` — which
is why one has to exist at the repository root. `comments/404.html` is kept
identical to it so that it does not matter which of the two GitHub Pages picks
for a `/comments/...` miss, and `comments/index.html` makes `/comments/` itself
work when opened directly.

Because the root `404.html` is the site-wide 404, *any* missing path on the
site — a mistyped `/toads/` image, a dead link — now renders the comments app
as its 404 body. That is harmless (the status code is still 404) but expected. `comments.js` reads the slug from the path segment after
`comments` and treats `index.html` / `404.html` as an empty slug, so all three
entry points behave.

Keep the three copies of the page in sync: if you edit `comments/index.html`,
copy it over `comments/404.html` and the root `404.html` as well.

## The appendix

An appendix is icely's own writing attached to an article: a row in the backend
spreadsheet's `Appendix` sheet, shown above the comments. It is written in
article markdown, and `markdown.js` renders it.

`markdown.js` is a port of the "Custom Markdown Processing" section of
`0_manage_articles.py` — the same helper every article is built with — so
an appendix can use the whole article syntax: tooltips, `censor[...]`,
`spoiler[...]`, colours, `jitter[...]` and the other text effects, slideshows,
`youtube[...]`, `:frog:`, images with captions, `(Collapsible)` headings. It is
a port, not a rewrite: the passes run in the same order and produce the same
markup, and the two were checked to render all 55 current articles byte for
byte identically. **When one changes, change the other the same way.**

Three things necessarily differ from the Python, and each is commented where it
happens:

- Links to `some-article.md` cannot be resolved against the articles folder, so
  they take the Python's fallback and become `some-article.html`.
- Relative URLs are resolved against the *article's* URL afterwards by
  `comments.js`, because this document is served from another origin, and
  appendix links are forced to open in a new tab so that a click cannot replace
  the comments app with something else.
- The click-to-zoom image modal is not ported; it would be clipped to the
  iframe.

`comments.js` binds the spoiler and slideshow behaviour the article page would
otherwise provide, and `comments.css` carries the `ARTICLE_CSS` rules this
markup needs.

The backend sends the raw markdown as `appendixMarkdown` and a plain rendering
of it as `appendixHtml`. If `markdown.js` is missing, fails to parse (it uses
regex lookbehind) or throws, `comments.js` falls back to `appendixHtml`: the
appendix loses the extensions but never disappears.

## Deploying

`deploy.bat` in the repository root commits and pushes the whole folder. The
repository is temporary: there is no `.git` in that folder between deploys, and
the script clones one at the start and deletes it again on every exit path.

It refuses to push a deletion without an explicit `YES`, and restores any
tracked file missing from the working folder before staging — a partial copy
of the site silently deleted the comments app from the live site once already.
Because a missing file is therefore always read as an accident, removing one
from the live site is done by naming it:

```text
deploy.bat comments/old-thing.js
```

## Requirements

Enable GitHub Pages for the repository. The site must be a user/organization
site at exactly `icely-puz.github.io`. If it is instead a project site with a
repository path, change `COMMENTS_GITHUB_BASE` in `0_manage_articles.py` and
the absolute asset paths in `index.html` / `404.html` before rebuilding the
articles.

The app gets the article slug from the URL, uses JSONP for reading moderated
comments, and sends submissions to the existing Google Apps Script endpoint.
Those requests happen inside the GitHub Pages iframe rather than inside the
Neocities document, avoiding the Neocities `connect-src` restriction.

## Keeping it looking identical to the old in-page widget

This app is the *inside* of the old modal, not a redesign. The modal itself -
open button, dialog box, header, close button - is still drawn by the article
page; only the status line, comment list and form are in here. Two things keep
the seam invisible, and both need care when editing:

- **Styling.** `index.html` loads `https://icely.neocities.org/styles.css`, so
  this document inherits the same Tajawal font, button chrome, link and
  selection styling the widget inherited when it lived in the article.
  `site-fallback.css` is a verbatim copy of the parts of `styles.css` that the
  comments UI depends on, loaded first in case that cross-origin request fails;
  update it if the site's base font or button styling changes. `comments.css`
  loads last and is a verbatim copy of `COMMENTS_CSS` from
  `0_manage_articles.py`, plus the article rules that appendix HTML can hit.
  Class names, markup and declaration values are matched to the original - a
  rename here is a visual change there.

- **Height.** The old dialog was as tall as its content, up to
  `min(88vh, 900px)`, after which the comment list scrolled. `comments.js`
  measures what the content wants and posts it to the article page, which caps
  it at the dialog's remaining space; when capped, the list scrolls inside the
  iframe exactly as before. The article page also sends its own URL and any
  `#comment-<id>` hash into the frame, so "Copy link" still hands out article
  URLs and comment permalinks still work.
