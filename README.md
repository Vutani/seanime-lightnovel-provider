# Seanime Light Novel Provider

A [Seanime](https://seanime.app) extension that searches **Baka-Tsuki** for light novels and renders chapters as image pages in Seanime's manga reader.

> Seanime has no native novel type, so this is a *manga provider* that converts text to SVG pages. It is experimental.

## Install
1. Push this repo to GitHub and replace `YOUR_USERNAME` in `manifest.json`.
2. In Seanime: **Extensions → Add extensions**, paste:
   `https://raw.githubusercontent.com/YOUR_USERNAME/seanime-lightnovel-provider/main/src/manga/bakatsuki-ln/manifest.json`
3. Open a light novel entry (AniList lists them as manga) and pick **Baka-Tsuki Light Novels** as the source.

## Testing
Use **Extensions → Playground → Manga provider** and paste `provider.js` to test `search`, `findChapters` and `findChapterPages`.

## Known limitations
- Rendering depends on Seanime's reader accepting `data:image/svg+xml` page URLs. If pages are blank, see "Fallback" below.
- Only series that Baka-Tsuki hosts; English titles; `Series:Volume N` page layout.
- Chapters are the top-level sections of each volume page.

## Fallback if data URIs are rejected
Run a tiny local server that serves the SVG for `/page?vol=..&section=..&n=..` and return `http://localhost:PORT/...` URLs from `findChapterPages` instead.

## Disclaimer
Seanime doesn't host content. Respect Baka-Tsuki's terms and each work's licensing; please support official releases.
