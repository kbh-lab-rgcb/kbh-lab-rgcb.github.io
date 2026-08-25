# CRP7 — Cancer Research Programme 7

Website for the laboratory of **Dr. K.B. Harikumar** at BRIC-Rajiv Gandhi Centre
for Biotechnology, Thiruvananthapuram.

Research theme: *cellular dynamics of resolving inflammation, with special
reference to the role of sphingolipids.*

---

## Updating the site

**Everything on the website is a file in [`content/`](content/).** Change a file
from GitHub's web editor, commit it, and the site rebuilds and republishes
itself in about two minutes.

👉 **[Read EDITING.md](EDITING.md)** — the guide for everyone in the lab. No code
knowledge needed.

Every folder under `content/` also contains its own README explaining what to put
in it, which GitHub shows when you open the folder.

### The convention in one table

| To change | Put files in |
| --- | --- |
| Lab name, address, phones, emails | `content/site.json` |
| A page's words | `content/pages/<page>/text/` |
| A page's banner (2+ images = slideshow) | `content/pages/<page>/banner/` |
| Lab members | `content/pages/04-team/photos/` + `text/` (same filename) |
| Alumni | `content/pages/05-alumni/text/` |
| Publications (the lab's own) | `content/pages/06-publications/years/2026.txt` |
| Publications (the PI's other work) | `content/pages/06-publications/pi/2026.txt` |
| Gallery | `content/pages/07-gallery/photos/` |
| Photo albums | `content/pages/07-gallery/photos/<album-name>/` |
| A person's own page | `profile: yes` in their file in `content/pages/04-team/text/` |
| Outgoing links | `content/pages/09-links/links/` |
| Code and repositories | `content/pages/10-resources/<branch>/<item>/` |

One folder under `content/pages/` = one page = one item in the navigation. Add a
folder to add a page.

**Nothing in `content/` can break the build.** A photo without a text file, an
empty file, a missing folder — each produces a sensible fallback and a warning in
the Actions log, never a failed deploy.

---

## For developers

A small TypeScript static site generator. No framework, no database, no server.

```bash
npm install
npm run dev        # preview at localhost:3000 with live reload
npm run build      # generate docs/
npm run check      # report what the site reads from content/, without building
npm run test       # build the fixture + real site and assert over the HTML
npm run typecheck  # tsc --noEmit
```

### Layout

```text
src/
  content/     load.ts walks content/ into a typed model; never throws
               text.ts parses the key:value + body format
               images.ts sharp variants + srcset, content-hash cached
  render/      layout.ts is the page shell, pages.ts one renderer per page kind
  client/      main.ts — carousel, theme toggle, mobile nav, lightbox
  styles/      tokens.css (light + dark), base, layout, components
  build.ts     the single build entry point used by dev, build and tests
scripts/       build.ts  dev.ts  check.ts
tests/         build.test.mjs + fixture/ covering the edge cases
```

### Things worth knowing before changing it

- **All URLs are relative to the page that emits them** (`src/render/url.ts`), so
  the same output works at `user.github.io/CRP7/`, on a custom domain, and opened
  from disk. There is no base path to configure. A test asserts no root-absolute
  URLs are ever emitted.
- **Loading content never throws.** Problems become `Warning`s with a stated
  fallback. This is what makes the site safe for non-technical editors, and it is
  covered by tests — please keep it that way.
- **Escaping goes through `esc()` in `src/html.ts`** and nowhere else.
- **Dark mode is defined in three places** — light on bare `:root`, dark under
  both `@media (prefers-color-scheme: dark)` (guarded so an explicit light choice
  wins) and `:root[data-theme="dark"]`. A test checks all three exist.
- **Everything interactive is progressive enhancement.** With JavaScript off the
  banner shows its first image, the nav works, and the gallery shows thumbnails.

### Deployment

Pushing to `main` triggers [`.github/workflows/pages.yml`](.github/workflows/pages.yml),
which builds and publishes to GitHub Pages. `docs/` is generated and gitignored.

One-time setup: **Settings → Pages → Build and deployment → GitHub Actions**.
